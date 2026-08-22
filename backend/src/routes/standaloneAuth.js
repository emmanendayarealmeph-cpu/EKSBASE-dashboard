import express from "express";
import {
  changeStandalonePassword,
  createStandaloneSession,
  destroyStandaloneSession,
  restoreRememberedSession,
  resetEmployeePasswordByAdmin,
} from "../auth/standaloneAuth.js";
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
    const { employeeNo, password } = req.body || {};

    const result = await createStandaloneSession(employeeNo, password);

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

router.post("/admin/reset-password", requireAuthenticatedUser, async (req, res) => {
  try {
    if (String(req.dashboardUser?.role || "").toUpperCase() !== "ADMIN") {
      return res.status(403).json({
        status: "error",
        message: "EKSBASE administrator access is required.",
      });
    }

    const employeeNo = clean(req.body?.employeeNo);
    const result = await resetEmployeePasswordByAdmin(employeeNo);

    return res.json({
      status: "ok",
      provider: "standalone",
      employeeNo: result.employee.employeeNo,
      employeeName: result.employee.employeeName || "",
      temporaryPassword: result.temporaryPassword,
      requiresPasswordChange: true,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: error.message || "Administrator password reset failed.",
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
