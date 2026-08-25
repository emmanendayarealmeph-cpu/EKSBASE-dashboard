import {
  getCredentialRecord,
  setCredentialRecord,
  updateCredentialRecord,
  hashPassword,
  verifyPassword,
} from "./githubCredentialStore.js";

const MIN_PASSWORD_LENGTH = 8;

function clean(value) {
  return String(value ?? "").trim();
}

function assertPassword(password) {
  if (typeof password !== "string") {
    throw new Error("password is required.");
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }
}

export async function hasLocalCredential(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return false;

  const record = await getCredentialRecord(normalizedEmployeeNo);
  return Boolean(record?.passwordHash && record?.isActive !== 0);
}

export async function setLocalCredentialPassword(
  employeeNo,
  password,
  options = {}
) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) {
    throw new Error("employeeNo is required.");
  }

  assertPassword(password);

  const existing = await getCredentialRecord(normalizedEmployeeNo);

  await setCredentialRecord(normalizedEmployeeNo, {
    passwordHash: hashPassword(password),
    isActive: 1,
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastLoginAt: existing?.lastLoginAt || "",
    mustChangePassword: Boolean(options?.mustChangePassword),
  });
}

export async function getLocalCredentialState(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return null;

  const record = await getCredentialRecord(normalizedEmployeeNo);
  if (!record || record.isActive === 0) return null;

  return {
    employee_no: record.employeeNo || normalizedEmployeeNo,
    is_active: record.isActive === 0 ? 0 : 1,
    must_change_password: Boolean(record.mustChangePassword),
  };
}

export async function markPasswordChanged(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  await updateCredentialRecord(
    normalizedEmployeeNo,
    () => ({
      mustChangePassword: false,
    }),
    `EKSBASE: password changed ${normalizedEmployeeNo}`
  );
}

export async function verifyLocalCredential(employeeNo, password) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo || typeof password !== "string") {
    return false;
  }

  const record = await getCredentialRecord(normalizedEmployeeNo);
  if (!record || record.isActive === 0) return false;

  return verifyPassword(password, record.passwordHash);
}

export async function markLocalCredentialLogin(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  await updateCredentialRecord(
    normalizedEmployeeNo,
    () => ({
      lastLoginAt: new Date().toISOString(),
    }),
    `EKSBASE: standalone login ${normalizedEmployeeNo}`
  );
}

export async function resetLocalCredentialToDefault(
  employeeNo,
  defaultPassword
) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) {
    throw new Error("employeeNo is required.");
  }

  const password = String(defaultPassword ?? "");
  if (!password) {
    throw new Error("defaultPassword is required.");
  }

  await setLocalCredentialPassword(normalizedEmployeeNo, password, {
    mustChangePassword: true,
  });
}

export async function disableLocalCredential(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  const record = await getCredentialRecord(normalizedEmployeeNo);
  if (!record) return;

  await updateCredentialRecord(
    normalizedEmployeeNo,
    () => ({
      isActive: 0,
    }),
    `EKSBASE: disable standalone credential ${normalizedEmployeeNo}`
  );
}
