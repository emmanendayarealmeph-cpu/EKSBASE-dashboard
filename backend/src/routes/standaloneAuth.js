import crypto from "node:crypto";
import express from "express";
import {
  changeStandalonePassword,
  createStandaloneSession,
  destroyStandaloneSession,
  restoreRememberedSession,
} from "../auth/standaloneAuth.js";
import {
  setLocalCredentialPassword,
  markPasswordChanged,
  markLocalCredentialLogin,
} from "../auth/localCredentials.js";
import { db } from "../database/database.js";
import { requireAuthenticatedUser } from "../auth/requireAuthenticatedUser.js";

const router = express.Router();

const passwordResetTokens = new Map();
const PASSWORD_RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const LOCAL_PASSWORD_RESET_CODE =
  process.env.EKSBASE_LOCAL_RESET_CODE || "EKSBASE-LOCAL-RESET";

function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

function clean(value) {
  return String(value ?? "").trim();
}

function createPasswordResetToken(employeeNo) {
  const token = crypto.randomBytes(32).toString("hex");
  passwordResetTokens.set(token, {
    employeeNo: clean(employeeNo),
    expiresAt: Date.now() + PASSWORD_RESET_TOKEN_TTL_MS,
  });
  return token;
}

function getPasswordResetSession(token) {
  const normalizedToken = clean(token);
  if (!normalizedToken) return null;

  const record = passwordResetTokens.get(normalizedToken);
  if (!record) return null;

  if (Date.now() >= record.expiresAt) {
    passwordResetTokens.delete(normalizedToken);
    return null;
  }

  return record;
}

router.post("/login", async (req, res) => {
  try {
    const { employeeNo, password, rememberMe } = req.body || {};

    const result = await createStandaloneSession(employeeNo, password, {
      rememberMe: Boolean(rememberMe),
    });

    return res.json({
      status: "ok",
      provider: "standalone",
      requiresPasswordChange: Boolean(result.requiresPasswordChange),
      passwordChangeToken: result.passwordChangeToken || "",
      token: result.token || "",
      expiresAt: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : "",
      rememberMe: Boolean(result.rememberMe),
      user: result.employee,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: error.message || "Standalone login failed.",
    });
  }
});

router.post("/change-password", async (req, res) => {
  try {
    const { passwordChangeToken, newPassword } = req.body || {};
    const result = await changeStandalonePassword(
      passwordChangeToken,
      newPassword
    );

    return res.json({
      status: "ok",
      provider: "standalone",
      requiresPasswordChange: Boolean(result.requiresPasswordChange),
      passwordChangeToken: result.passwordChangeToken || "",
      token: result.token || "",
      expiresAt: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : "",
      rememberMe: Boolean(result.rememberMe),
      user: result.employee,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: error.message || "Password change failed.",
    });
  }
});

router.post("/remember", async (req, res) => {
  try {
    const token = getBearerToken(req);
    const user = await restoreRememberedSession(token);

    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "Remembered login is invalid or expired.",
      });
    }

    return res.json({
      status: "ok",
      provider: "standalone",
      user,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: error.message || "Remembered login failed.",
    });
  }
});

/*
 * LOCAL DEVELOPMENT ONLY:
 * Existing users can reset their local EKSBASE password using the
 * configured local reset code. Production keeps this endpoint disabled.
 */
router.post("/reset-password/request", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({
        status: "error",
        message: "Password reset is disabled in production.",
      });
    }

    const employeeNo = clean(req.body?.employeeNo);
    const resetCode = String(req.body?.resetCode ?? "");

    if (!employeeNo || !resetCode) {
      return res.status(400).json({
        status: "error",
        message: "Employee No. and reset code are required.",
      });
    }

    if (resetCode !== LOCAL_PASSWORD_RESET_CODE) {
      return res.status(401).json({
        status: "error",
        message: "Invalid local reset code.",
      });
    }

    const employee = db
      .prepare(`
        SELECT employee_no, is_active
        FROM employee_access
        WHERE employee_no = ?
      `)
      .get(employeeNo);

    if (!employee) {
      return res.status(404).json({
        status: "error",
        message: "Employee was not found in local dashboard access.",
      });
    }

    if (Number(employee.is_active) !== 1) {
      return res.status(403).json({
        status: "error",
        message: "Employee dashboard access is inactive.",
      });
    }

    return res.json({
      status: "ok",
      provider: "standalone",
      passwordResetToken: createPasswordResetToken(employeeNo),
      expiresAt: new Date(
        Date.now() + PASSWORD_RESET_TOKEN_TTL_MS
      ).toISOString(),
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: error.message || "Password reset request failed.",
    });
  }
});

router.post("/reset-password/complete", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({
        status: "error",
        message: "Password reset is disabled in production.",
      });
    }

    const { passwordResetToken, newPassword } = req.body || {};
    const pending = getPasswordResetSession(passwordResetToken);

    if (!pending) {
      return res.status(401).json({
        status: "error",
        message: "Password reset session is invalid or expired.",
      });
    }

    const password = String(newPassword ?? "");

    if (password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters.",
      });
    }

    await setLocalCredentialPassword(pending.employeeNo, password, {
      mustChangePassword: false,
    });
    await markPasswordChanged(pending.employeeNo);
    await markLocalCredentialLogin(pending.employeeNo);
    passwordResetTokens.delete(passwordResetToken);

    const result = await createStandaloneSession(
      pending.employeeNo,
      password,
      { rememberMe: false }
    );

    return res.json({
      status: "ok",
      provider: "standalone",
      requiresPasswordChange: false,
      passwordChangeToken: "",
      token: result.token || "",
      expiresAt: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : "",
      rememberMe: Boolean(result.rememberMe),
      user: result.employee,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: error.message || "Password reset failed.",
    });
  }
});

router.get("/me", requireAuthenticatedUser, (req, res) => {
  return res.json({
    status: "ok",
    provider: req.authenticatedIdentity.provider,
    user: req.dashboardUser,
  });
});

router.post("/logout", async (req, res) => {
  const token = getBearerToken(req);
  await destroyStandaloneSession(token);

  return res.json({
    status: "ok",
    message: "Logged out.",
  });
});

export default router;
