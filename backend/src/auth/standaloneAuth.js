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
  resetLocalCredentialToDefault,
} from "./localCredentials.js";
const sessions = new Map();
const passwordChangeTokens = new Map();

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const PASSWORD_CHANGE_TOKEN_TTL_MS = 10 * 60 * 1000;
const DEFAULT_FIRST_LOGIN_PASSWORD = "EKSBASELOGIN";
const ADMIN_EMPLOYEE_NO = clean(process.env.EKSBASE_ADMIN_EMPLOYEE_NO);
const ADMIN_PASSWORD = String(process.env.EKSBASE_ADMIN_PASSWORD ?? "");

function clean(value) {
  return String(value ?? "").trim();
}

function logLoginTiming(stage, startedAt, extra = "") {
  const elapsedMs = Math.round(performance.now() - startedAt);
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[AUTH PERF] ${stage} +${elapsedMs}ms${suffix}`);
}

function normalizeDepartment(value) {
  const department = clean(value).toUpperCase();
  if (department === "SUB-REGION") return "SUB_REGION";
  if (department === "SUB REGION") return "SUB_REGION";
  return department;
}

async function refreshEmployeeAccessFromKingdee(employeeNo, loginStartedAt = null) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return null;

  const currentAccess = getEmployeeAccess(normalizedEmployeeNo);

  if (loginStartedAt !== null) {
    logLoginTiming("Kingdee employee lookup START", loginStartedAt);
  }

  const kingdeeStartedAt = performance.now();
  const kingdeeEmployee = await kingdeeService.getEmployeeByEmployeeNo(
    normalizedEmployeeNo
  );

  const kingdeeElapsedMs = Math.round(performance.now() - kingdeeStartedAt);
  if (loginStartedAt !== null) {
    logLoginTiming(
      "Kingdee employee lookup COMPLETE",
      loginStartedAt,
      `(step=${kingdeeElapsedMs}ms)`
    );
  }

  if (!kingdeeEmployee) return currentAccess || null;

  const department = normalizeDepartment(kingdeeEmployee.department);
  const role = clean(
    kingdeeEmployee.role || currentAccess?.role || "STAFF"
  ).toUpperCase();

  const hierarchy =
    role === "PROMOTER"
      ? {
          accessLevel: "PROMOTER",
          district: "",
          region: "",
          subRegion: "",
        }
      : resolveDashboardAccessFromDepartment(department);

  upsertEmployeeAccess({
    employeeNo: normalizedEmployeeNo,
    department: department || "NONE",
    accessLevel: hierarchy.accessLevel,
    role,
    district: hierarchy.district,
    region: hierarchy.region,
    subRegion: hierarchy.subRegion,
    warehouseCode:
      role === "PROMOTER" ? currentAccess?.warehouseCode || "" : "",
    salesNo: role === "PROMOTER" ? normalizedEmployeeNo : "",
    isActive: kingdeeEmployee.isActive === true,
  });

  return {
    ...getEmployeeAccess(normalizedEmployeeNo),
    employeeName: clean(kingdeeEmployee.employeeName),
  };
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

function createSessionToken(employeeNo, employeeName = "", options = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;

  sessions.set(token, {
    employeeNo: clean(employeeNo),
    employeeName: clean(employeeName),
    isAdmin: options?.isAdmin === true,
    createdAt: Date.now(),
    expiresAt,
  });

  return { token, expiresAt };
}

function isConfiguredAdminCredential(employeeNo, password) {
  return Boolean(
    ADMIN_EMPLOYEE_NO &&
    ADMIN_PASSWORD &&
    clean(employeeNo) === ADMIN_EMPLOYEE_NO &&
    String(password ?? "") === ADMIN_PASSWORD
  );
}

function createAdminSession() {
  return createSessionToken(
    ADMIN_EMPLOYEE_NO,
    "EKSBASE Administrator",
    { isAdmin: true }
  );
}

function buildAdminUser() {
  return {
    employeeNo: ADMIN_EMPLOYEE_NO,
    employeeName: "EKSBASE Administrator",
    role: "ADMIN",
    department: "ADMIN",
    accessLevel: "ADMIN",
    district: "",
    region: "",
    subRegion: "",
    warehouseCode: "",
    salesNo: "",
    isActive: 1,
    organizationCode: "110",
    isAdmin: true,
  };
}

async function createSessionForEmployee(employee, employeeNo) {
  const { token, expiresAt } = createSessionToken(
    employeeNo,
    employee?.employeeName
  );

  return {
    token,
    expiresAt,
    employee,
    requiresPasswordChange: false,
    passwordChangeToken: "",
  };
}

export async function verifyStandalonePassword(employeeNo, password) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo || typeof password !== "string") return false;

  const valid = await verifyLocalCredential(normalizedEmployeeNo, password);
  if (valid) await markLocalCredentialLogin(normalizedEmployeeNo);
  return valid;
}

export async function getStandaloneCredentialState(employeeNo) {
  return getLocalCredentialState(employeeNo);
}

export async function changeStandalonePassword(passwordChangeToken, newPassword) {
  const pending = getPasswordChangeSession(passwordChangeToken);

  if (!pending) {
    const error = new Error("Password change session is invalid or expired.");
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

  if (password === DEFAULT_FIRST_LOGIN_PASSWORD) {
    const error = new Error(
      "New password cannot remain EKSBASELOGIN. Please choose a different password."
    );
    error.statusCode = 400;
    throw error;
  }

  await setLocalCredentialPassword(normalizedEmployeeNo, password, {
    mustChangePassword: false,
  });
  await markPasswordChanged(normalizedEmployeeNo);
  await markLocalCredentialLogin(normalizedEmployeeNo);

  passwordChangeTokens.delete(passwordChangeToken);

  return createStandaloneSession(normalizedEmployeeNo, password);
}

export async function resetEmployeePasswordByAdmin(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);

  if (!normalizedEmployeeNo) {
    const error = new Error("Employee No. is required.");
    error.statusCode = 400;
    throw error;
  }

  if (ADMIN_EMPLOYEE_NO && normalizedEmployeeNo === ADMIN_EMPLOYEE_NO) {
    const error = new Error("The EKSBASE administrator account cannot be reset here.");
    error.statusCode = 400;
    throw error;
  }

  const employee = await refreshEmployeeAccessFromKingdee(normalizedEmployeeNo);
  if (!employee) {
    const error = new Error("Employee was not found in Kingdee Employee Master and is not configured for dashboard access.");
    error.statusCode = 404;
    throw error;
  }

  if (Number(employee.isActive) !== 1) {
    const error = new Error("Employee dashboard access is inactive.");
    error.statusCode = 403;
    throw error;
  }

  await resetLocalCredentialToDefault(
    normalizedEmployeeNo,
    DEFAULT_FIRST_LOGIN_PASSWORD
  );

  return {
    employee,
    temporaryPassword: DEFAULT_FIRST_LOGIN_PASSWORD,
    requiresPasswordChange: true,
  };
}

export async function createStandaloneSession(employeeNo, password) {
  const loginStartedAt = performance.now();
  const normalizedEmployeeNo = clean(employeeNo);

  console.log("[AUTH PERF] Login START");

  if (isConfiguredAdminCredential(normalizedEmployeeNo, password)) {
    const { token, expiresAt } = createAdminSession();
    logLoginTiming("Login COMPLETE (admin)", loginStartedAt);
    return {
      token,
      expiresAt,
      employee: buildAdminUser(),
      requiresPasswordChange: false,
      passwordChangeToken: "",
    };
  }

  if (!normalizedEmployeeNo) {
    const error = new Error("employeeNo is required.");
    error.statusCode = 400;
    logLoginTiming("Login FAILED (missing employeeNo)", loginStartedAt);
    throw error;
  }

  const employee = await refreshEmployeeAccessFromKingdee(
    normalizedEmployeeNo,
    loginStartedAt
  );

  if (!employee) {
    logLoginTiming("Login FAILED (employee not found)", loginStartedAt);
    const error = new Error(
      "Employee was not found in Kingdee Employee Master and is not configured for dashboard access."
    );
    error.statusCode = 401;
    throw error;
  }

  if (Number(employee.isActive) !== 1) {
    logLoginTiming("Login FAILED (inactive employee)", loginStartedAt);
    const error = new Error("Employee is inactive.");
    error.statusCode = 403;
    throw error;
  }

  if (
    !employee.accessLevel &&
    String(employee.role).toUpperCase() !== "PROMOTER"
  ) {
    logLoginTiming("Login FAILED (no dashboard access)", loginStartedAt);
    const error = new Error(
      "Employee has no dashboard access level configured."
    );
    error.statusCode = 403;
    throw error;
  }

  const suppliedPassword = String(password ?? "");

  const credentialStartedAt = performance.now();
  logLoginTiming("Neon credential lookup START", loginStartedAt);

  const credentialExists = await hasLocalCredential(normalizedEmployeeNo);
  const credentialState = await getLocalCredentialState(normalizedEmployeeNo);

  const credentialElapsedMs = Math.round(
    performance.now() - credentialStartedAt
  );
  logLoginTiming(
    "Neon credential lookup COMPLETE",
    loginStartedAt,
    `(step=${credentialElapsedMs}ms)`
  );

  if (!credentialExists) {
    if (suppliedPassword !== DEFAULT_FIRST_LOGIN_PASSWORD) {
      logLoginTiming("Login FAILED (invalid first-login password)", loginStartedAt);
      const error = new Error(
        "First-time login requires the default password."
      );
      error.statusCode = 401;
      throw error;
    }

    const writeStartedAt = performance.now();
    await setLocalCredentialPassword(
      normalizedEmployeeNo,
      DEFAULT_FIRST_LOGIN_PASSWORD,
      { mustChangePassword: true }
    );
    logLoginTiming(
      "Neon first-login credential CREATE COMPLETE",
      loginStartedAt,
      `(step=${Math.round(performance.now() - writeStartedAt)}ms)`
    );

    const passwordChangeToken = createPasswordChangeToken(
      normalizedEmployeeNo
    );

    logLoginTiming("Login COMPLETE (requires password change)", loginStartedAt);
    return {
      token: "",
      expiresAt: "",
      employee,
      requiresPasswordChange: true,
      passwordChangeToken,
    };
  }

  if (Boolean(credentialState?.must_change_password)) {
    const verifyStartedAt = performance.now();
    const validPassword = await verifyLocalCredential(
      normalizedEmployeeNo,
      suppliedPassword
    );
    logLoginTiming(
      "Password verification COMPLETE (must change)",
      loginStartedAt,
      `(step=${Math.round(performance.now() - verifyStartedAt)}ms)`
    );

    if (!validPassword) {
      logLoginTiming("Login FAILED (invalid password)", loginStartedAt);
      const error = new Error("Invalid employee number or password.");
      error.statusCode = 401;
      throw error;
    }

    const passwordChangeToken = createPasswordChangeToken(
      normalizedEmployeeNo
    );

    logLoginTiming("Login COMPLETE (password change required)", loginStartedAt);
    return {
      token: "",
      expiresAt: "",
      employee,
      requiresPasswordChange: true,
      passwordChangeToken,
    };
  }

  const verifyStartedAt = performance.now();
  const validPassword = await verifyLocalCredential(
    normalizedEmployeeNo,
    suppliedPassword
  );
  logLoginTiming(
    "Password verification COMPLETE",
    loginStartedAt,
    `(step=${Math.round(performance.now() - verifyStartedAt)}ms)`
  );

  if (!validPassword) {
    logLoginTiming("Login FAILED (invalid password)", loginStartedAt);
    const error = new Error("Invalid employee number or password.");
    error.statusCode = 401;
    throw error;
  }

  const markLoginStartedAt = performance.now();
  await markLocalCredentialLogin(normalizedEmployeeNo);
  logLoginTiming(
    "Neon last-login update COMPLETE",
    loginStartedAt,
    `(step=${Math.round(performance.now() - markLoginStartedAt)}ms)`
  );

  const result = await createSessionForEmployee(
    employee,
    normalizedEmployeeNo
  );

  logLoginTiming("Login COMPLETE", loginStartedAt);
  return result;
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

  if (session.isAdmin) {
    if (!ADMIN_EMPLOYEE_NO || session.employeeNo !== ADMIN_EMPLOYEE_NO) {
      sessions.delete(normalizedToken);
      return null;
    }
    return buildAdminUser();
  }

  const employee = getEmployeeAccess(session.employeeNo);
  if (!employee || Number(employee.isActive) !== 1) {
    sessions.delete(normalizedToken);
    return null;
  }

  return {
    ...employee,
    employeeName: clean(
      session.employeeName || employee.employeeName || ""
    ),
  };
}

// Standalone authentication no longer supports persistent Remember Me sessions.
// Keep this export as a compatibility shim for any existing route imports.
export async function restoreRememberedSession() {
  return null;
}

export async function destroyStandaloneSession(token) {
  const normalizedToken = clean(token);
  if (!normalizedToken) return false;

  return sessions.delete(normalizedToken);
}

export function clearExpiredStandaloneSessions() {
  const now = Date.now();

  for (const [token, session] of sessions.entries()) {
    if (now >= session.expiresAt) sessions.delete(token);
  }

  for (const [token, pending] of passwordChangeTokens.entries()) {
    if (now >= pending.expiresAt) passwordChangeTokens.delete(token);
  }
}

setInterval(clearExpiredStandaloneSessions, 15 * 60 * 1000).unref();
