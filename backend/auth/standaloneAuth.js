import crypto from "node:crypto";
import {
  getEmployeeAccess,
  upsertEmployeeAccess,
  resolveDashboardAccessFromDepartment,
} from "./employeeAccess.js";
import { kingdeeService } from "../services/kingdeeService.js";
import {
  hasLocalCredential,
  verifyLocalCredential,
  setLocalCredentialPassword,
  getLocalCredentialState,
  markPasswordChanged,
  markLocalCredentialLogin,
} from "./localCredentials.js";

// Development-only standalone authentication.
// The identity is supplied as Employee No. and the current employee
// authorization attributes are refreshed from Kingdee at login time.
// Replace this provider with DingTalk authentication at final integration.
const sessions = new Map();
const passwordChangeTokens = new Map();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_CHANGE_TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FIRST_LOGIN_PASSWORD = "EKSBASELOGIN";

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeDepartment(value) {
  const department = clean(value).toUpperCase();

  if (department === "SUB-REGION") {
    return "SUB_REGION";
  }

  if (department === "SUB REGION") {
    return "SUB_REGION";
  }

  return department;
}

/**
 * Refresh only the logged-in employee's authorization data from Kingdee.
 *
 * This deliberately does NOT extract the full Employee List.
 * Existing scope assignments (district/region/sub-region/store/sales no)
 * are preserved because the current Kingdee Employee Master fields being
 * used for authentication provide Department and Role, but do not yet
 * provide the dashboard hierarchy scope values.
 */
async function refreshEmployeeAccessFromKingdee(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);

  if (!normalizedEmployeeNo) {
    return null;
  }

  const currentAccess =
    getEmployeeAccess(normalizedEmployeeNo);

  const kingdeeEmployee =
    await kingdeeService.getEmployeeByEmployeeNo(
      normalizedEmployeeNo
    );

  if (!kingdeeEmployee) {
    return currentAccess || null;
  }

  const department = clean(kingdeeEmployee.department);

  const role = clean(
    kingdeeEmployee.role ||
      currentAccess?.role ||
      "STAFF"
  ).toUpperCase();

  /*
   * Promoters are always scoped by their Employee No.
   * Non-promoters are resolved dynamically from the dashboard hierarchy.
   */
  const hierarchy =
    role === "PROMOTER"
      ? {
          accessLevel: "PROMOTER",
          district: "",
          region: "",
          subRegion: "",
        }
      : resolveDashboardAccessFromDepartment(
          department
        );

  upsertEmployeeAccess({
    employeeNo: normalizedEmployeeNo,
    // Store the actual Kingdee Department value here.
    // accessLevel is the separately resolved dashboard authorization level.
    department: department || "NONE",
    accessLevel: hierarchy.accessLevel,
    role,
    district: hierarchy.district,
    region: hierarchy.region,
    subRegion: hierarchy.subRegion,
    warehouseCode:
      role === "PROMOTER"
        ? currentAccess?.warehouseCode || ""
        : "",
    salesNo:
      role === "PROMOTER"
        ? normalizedEmployeeNo
        : "",
    isActive: true,
  });

  return getEmployeeAccess(normalizedEmployeeNo);
}


function createPasswordChangeToken(employeeNo) {
  const token = crypto.randomBytes(32).toString("hex");

  passwordChangeTokens.set(token, {
    employeeNo: clean(employeeNo),
    createdAt: Date.now(),
    expiresAt: Date.now() + PASSWORD_CHANGE_TOKEN_TTL_MS,
  });

  return token;
}

function getPasswordChangeSession(token) {
  const normalizedToken = clean(token);
  if (!normalizedToken) return null;

  const record = passwordChangeTokens.get(normalizedToken);
  if (!record) return null;

  if (Date.now() >= record.expiresAt) {
    passwordChangeTokens.delete(normalizedToken);
    return null;
  }

  return record;
}

export function verifyStandalonePassword(employeeNo, password) {
  const normalizedEmployeeNo = clean(employeeNo);

  if (!normalizedEmployeeNo || typeof password !== "string") {
    return false;
  }

  const valid = verifyLocalCredential(normalizedEmployeeNo, password);

  if (valid) {
    markLocalCredentialLogin(normalizedEmployeeNo);
  }

  return valid;
}

export function getStandaloneCredentialState(employeeNo) {
  return getLocalCredentialState(employeeNo);
}

export function changeStandalonePassword(passwordChangeToken, newPassword) {
  const pending = getPasswordChangeSession(passwordChangeToken);

  if (!pending) {
    const error = new Error(
      "Password change session is invalid or expired."
    );
    error.statusCode = 401;
    throw error;
  }

  const normalizedEmployeeNo = pending.employeeNo;
  const password = String(newPassword ?? "");

  if (password.length < 8) {
    const error = new Error("Password must be at least 8 characters.");
    error.statusCode = 400;
    throw error;
  }

  setLocalCredentialPassword(normalizedEmployeeNo, password, {
    mustChangePassword: false,
  });
  markPasswordChanged(normalizedEmployeeNo);
  markLocalCredentialLogin(normalizedEmployeeNo);

  passwordChangeTokens.delete(passwordChangeToken);

  // Re-resolve the employee's current Kingdee Department/Role after
  // completing first-time password setup.
  return createStandaloneSession(normalizedEmployeeNo);
}

export async function createStandaloneSession(employeeNo, password) {
  const normalizedEmployeeNo = clean(employeeNo);

  if (!normalizedEmployeeNo) {
    const error = new Error("employeeNo is required.");
    error.statusCode = 400;
    throw error;
  }

  // Refresh the employee's current Department/Role from Kingdee first.
  // This makes Department changes effective on the next login.
  const employee =
    await refreshEmployeeAccessFromKingdee(normalizedEmployeeNo);

  if (!employee) {
    const error = new Error(
      "Employee was not found in Kingdee Employee Master and is not configured for dashboard access."
    );
    error.statusCode = 401;
    throw error;
  }

  if (Number(employee.isActive) !== 1) {
    const error = new Error(
      "Employee dashboard access is inactive."
    );
    error.statusCode = 403;
    throw error;
  }

  if (
    !employee.accessLevel &&
    String(employee.role).toUpperCase() !== "PROMOTER"
  ) {
    const error = new Error(
      "Employee has no dashboard access level configured."
    );
    error.statusCode = 403;
    throw error;
  }

  const suppliedPassword = String(password ?? "");
  const credentialExists = hasLocalCredential(normalizedEmployeeNo);
  const credentialState = getLocalCredentialState(normalizedEmployeeNo);

  // First-time login:
  // If no EKSBASE credential exists, the only accepted password is the
  // default first-login password. The account is then created with
  // must_change_password = 1 and no dashboard session is issued yet.
  if (!credentialExists) {
    if (suppliedPassword !== DEFAULT_FIRST_LOGIN_PASSWORD) {
      const error = new Error(
        "First-time login requires the default password."
      );
      error.statusCode = 401;
      throw error;
    }

    setLocalCredentialPassword(
      normalizedEmployeeNo,
      DEFAULT_FIRST_LOGIN_PASSWORD,
      { mustChangePassword: true }
    );

    const passwordChangeToken =
      createPasswordChangeToken(normalizedEmployeeNo);

    return {
      token: "",
      expiresAt: "",
      employee,
      requiresPasswordChange: true,
      passwordChangeToken,
    };
  }

  // Existing account that is still required to change its password.
  if (Number(credentialState?.must_change_password) === 1) {
    if (!verifyLocalCredential(normalizedEmployeeNo, suppliedPassword)) {
      const error = new Error("Invalid employee number or password.");
      error.statusCode = 401;
      throw error;
    }

    const passwordChangeToken =
      createPasswordChangeToken(normalizedEmployeeNo);

    return {
      token: "",
      expiresAt: "",
      employee,
      requiresPasswordChange: true,
      passwordChangeToken,
    };
  }

  // Normal subsequent login.
  if (!verifyLocalCredential(normalizedEmployeeNo, suppliedPassword)) {
    const error = new Error("Invalid employee number or password.");
    error.statusCode = 401;
    throw error;
  }

  markLocalCredentialLogin(normalizedEmployeeNo);

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;

  sessions.set(token, {
    employeeNo: normalizedEmployeeNo,
    employeeName: clean(employee.employeeName),
    createdAt: Date.now(),
    expiresAt,
  });

  return {
    token,
    expiresAt,
    employee,
    requiresPasswordChange: false,
    passwordChangeToken: "",
  };
}

export function getStandaloneUser(token) {
  const normalizedToken = clean(token);
  if (!normalizedToken) return null;

  const session = sessions.get(normalizedToken);
  if (!session) return null;

  if (Date.now() >= session.expiresAt) {
    sessions.delete(normalizedToken);
    return null;
  }

  const employee = getEmployeeAccess(session.employeeNo);
  if (!employee || Number(employee.isActive) !== 1) {
    sessions.delete(normalizedToken);
    return null;
  }

  return {
    ...employee,
    employeeName:
      clean(session.employeeName) ||
      clean(employee.employeeName),
  };
}

export function destroyStandaloneSession(token) {
  const normalizedToken = clean(token);
  if (!normalizedToken) return false;
  return sessions.delete(normalizedToken);
}

export function clearExpiredStandaloneSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (now >= session.expiresAt) {
      sessions.delete(token);
    }
  }

  for (const [token, pending] of passwordChangeTokens.entries()) {
    if (now >= pending.expiresAt) {
      passwordChangeTokens.delete(token);
    }
  }
}

setInterval(clearExpiredStandaloneSessions, 15 * 60 * 1000).unref();
