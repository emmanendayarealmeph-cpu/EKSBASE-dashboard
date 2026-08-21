import express from "express";
import {
  changeStandalonePassword,
  createStandaloneSession,
  destroyStandaloneSession,
} from "../auth/standaloneAuth.js";
import {
  setLocalCredentialPassword,
  markPasswordChanged,
  markLocalCredentialLogin,
} from "../auth/localCredentials.js";
import { db } from "../database/database.js";
import { requireAuthenticatedUser } from "../auth/requireAuthenticatedUser.js";

const router = express.Router();


function getBearerToken(req) {
  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

function clean(value) {
  return String(value ?? "").trim();
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
      user: result.employee,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      status: "error",
      message: error.message || "Password change failed.",
    });
  }
});

/*
 * LOCAL DEVELOPMENT ONLY:
 * Existing users can reset their local EKSBASE password directly.
 * This is separate from the first-time password-change flow.
 */
router.post("/reset-password", async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({
        status: "error",
        message: "Password reset is disabled in production.",
      });
    }

    const employeeNo = clean(req.body?.employeeNo);
    const password = String(req.body?.newPassword ?? "");

    if (!employeeNo) {
      return res.status(400).json({
        status: "error",
        message: "Employee No. is required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        status: "error",
        message: "Password must be at least 8 characters.",
      });
    }

    const employee = db.prepare(`
      SELECT employee_no, is_active
      FROM employee_access
      WHERE employee_no = ?
    `).get(employeeNo);

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

    setLocalCredentialPassword(employeeNo, password, {
      mustChangePassword: false,
    });
    markPasswordChanged(employeeNo);
    markLocalCredentialLogin(employeeNo);

    const result = await createStandaloneSession(employeeNo, password);

    return res.json({
      status: "ok",
      provider: "standalone",
      requiresPasswordChange: false,
      passwordChangeToken: "",
      token: result.token || "",
      expiresAt: result.expiresAt
        ? new Date(result.expiresAt).toISOString()
        : "",
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

router.post("/logout", (req, res) => {
  const token = getBearerToken(req);
  destroyStandaloneSession(token);

  return res.json({
    status: "ok",
    message: "Logged out.",
  });
});

export default router;
