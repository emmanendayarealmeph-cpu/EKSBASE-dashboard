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
import {
  forgetLogin,
  rememberLogin,
  restoreRememberedLogin,
} from "./rememberedLogins.js";

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
  if (department === "SUB-REGION") return "SUB_REGION";
  if (department === "SUB REGION") return "SUB_REGION";
  return department;
}

async function refreshEmployeeAccessFromKingdee(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return null;

  const currentAccess = getEmployeeAccess(normalizedEmployeeNo);
  const kingdeeEmployee = await kingdeeService.getEmployeeByEmployeeNo(
    normalizedEmployeeNo
  );

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
    isActive: true,
  });

  return getEmployeeAccess(normalizedEmployeeNo);
}

function createPasswordChangeToken(employeeNo, rememberMe = false) {
  const token = crypto.randomBytes(32).toString("hex");
  passwordChangeTokens.set(token, {
    employeeNo: clean(employeeNo),
    rememberMe: Boolean(rememberMe),
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

function createSessionToken(employeeNo, rememberMe) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;

  sessions.set(token, {
    employeeNo: clean(employeeNo),
    createdAt: Date.now(),
    expiresAt,
    rememberMe: Boolean(rememberMe),
  });

  return { token, expiresAt };
}

async function createSessionForEmployee(employee, employeeNo, rememberMe) {
  const { token, expiresAt } = createSessionToken(employeeNo, rememberMe);

  if (rememberMe) {
    const remembered = await rememberLogin(token, employeeNo, expiresAt);
    if (!remembered) {
      sessions.delete(token);
      const error = new Error(
        "Remember Me could not be enabled because persistent authentication is not configured."
      );
      error.statusCode = 503;
      throw error;
    }
  }

  return {
    token,
    expiresAt,
    employee,
    requiresPasswordChange: false,
    passwordChangeToken: "",
    rememberMe: Boolean(rememberMe),
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

  return createStandaloneSession(normalizedEmployeeNo, password, {
    rememberMe: pending.rememberMe,
  });
}

export async function createStandaloneSession(
  employeeNo,
  password,
  options = {}
) {
  const normalizedEmployeeNo = clean(employeeNo);
  const rememberMe = Boolean(options?.rememberMe);

  if (!normalizedEmployeeNo) {
    const error = new Error("employeeNo is required.");
    error.statusCode = 400;
    throw error;
  }

  const employee = await refreshEmployeeAccessFromKingdee(normalizedEmployeeNo);

  if (!employee) {
    const error = new Error(
      "Employee was not found in Kingdee Employee Master and is not configured for dashboard access."
    );
    error.statusCode = 401;
    throw error;
  }

  if (Number(employee.isActive) !== 1) {
    const error = new Error("Employee dashboard access is inactive.");
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
  const credentialExists = await hasLocalCredential(normalizedEmployeeNo);
  const credentialState = await getLocalCredentialState(normalizedEmployeeNo);

  if (!credentialExists) {
    if (suppliedPassword !== DEFAULT_FIRST_LOGIN_PASSWORD) {
      const error = new Error(
        "First-time login requires the default password."
      );
      error.statusCode = 401;
      throw error;
    }

    await setLocalCredentialPassword(
      normalizedEmployeeNo,
      DEFAULT_FIRST_LOGIN_PASSWORD,
      { mustChangePassword: true }
    );

    const passwordChangeToken = createPasswordChangeToken(
      normalizedEmployeeNo,
      rememberMe
    );

    return {
      token: "",
      expiresAt: "",
      employee,
      requiresPasswordChange: true,
      passwordChangeToken,
      rememberMe,
    };
  }

  if (Boolean(credentialState?.must_change_password)) {
    if (!(await verifyLocalCredential(normalizedEmployeeNo, suppliedPassword))) {
      const error = new Error("Invalid employee number or password.");
      error.statusCode = 401;
      throw error;
    }

    const passwordChangeToken = createPasswordChangeToken(
      normalizedEmployeeNo,
      rememberMe
    );

    return {
      token: "",
      expiresAt: "",
      employee,
      requiresPasswordChange: true,
      passwordChangeToken,
      rememberMe,
    };
  }

  if (!(await verifyLocalCredential(normalizedEmployeeNo, suppliedPassword))) {
    const error = new Error("Invalid employee number or password.");
    error.statusCode = 401;
    throw error;
  }

  await markLocalCredentialLogin(normalizedEmployeeNo);
  return createSessionForEmployee(
    employee,
    normalizedEmployeeNo,
    rememberMe
  );
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

  return employee;
}

export async function restoreRememberedSession(token) {
  const normalizedToken = clean(token);
  if (!normalizedToken) return null;

  const existing = getStandaloneUser(normalizedToken);
  if (existing) return existing;

  const remembered = await restoreRememberedLogin(normalizedToken);
  if (!remembered) return null;

  const credentialState = await getLocalCredentialState(remembered.employeeNo);
  if (!credentialState || !Boolean(credentialState.is_active)) {
    await forgetLogin(normalizedToken);
    return null;
  }

  const employee = await refreshEmployeeAccessFromKingdee(
    remembered.employeeNo
  );

  if (!employee || Number(employee.isActive) !== 1) {
    await forgetLogin(normalizedToken);
    return null;
  }

  sessions.set(normalizedToken, {
    employeeNo: remembered.employeeNo,
    createdAt: Date.now(),
    expiresAt: remembered.expiresAt,
    rememberMe: true,
  });

  return employee;
}

export async function destroyStandaloneSession(token) {
  const normalizedToken = clean(token);
  if (!normalizedToken) return false;

  const removed = sessions.delete(normalizedToken);
  await forgetLogin(normalizedToken);
  return removed;
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
