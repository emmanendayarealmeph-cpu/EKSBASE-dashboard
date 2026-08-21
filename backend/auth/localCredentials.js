import crypto from "node:crypto";
import { db } from "../database/database.js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

const MIN_PASSWORD_LENGTH = 8;

db.exec(`
  CREATE TABLE IF NOT EXISTS local_credentials (
    employee_no TEXT PRIMARY KEY COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT DEFAULT '',
    must_change_password INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (employee_no)
      REFERENCES employee_access(employee_no)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_local_credentials_active
    ON local_credentials(is_active);
`);

// Safe migration for databases created before first-time password activation.
try {
  db.exec(`ALTER TABLE local_credentials ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0`);
} catch (error) {
  if (!String(error?.message || "").toLowerCase().includes("duplicate column")) {
    throw error;
  }
}

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

function hashPassword(password) {
  assertPassword(password);

  const salt = crypto.randomBytes(SALT_BYTES);
  const derivedKey = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

function verifyPassword(password, encodedHash) {
  if (typeof password !== "string" || !encodedHash) return false;

  const parts = String(encodedHash).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltRaw, keyRaw] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  try {
    const salt = Buffer.from(saltRaw, "base64url");
    const expected = Buffer.from(keyRaw, "base64url");
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 32 * 1024 * 1024,
    });

    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}

export function hasLocalCredential(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return false;

  const row = db.prepare(`
    SELECT employee_no
    FROM local_credentials
    WHERE employee_no = ?
      AND is_active = 1
  `).get(normalizedEmployeeNo);

  return Boolean(row);
}

export function setLocalCredentialPassword(employeeNo, password, options = {}) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) {
    throw new Error("employeeNo is required.");
  }

  const passwordHash = hashPassword(password);
  const mustChangePassword = options?.mustChangePassword ? 1 : 0;

  db.prepare(`
    INSERT INTO local_credentials (
      employee_no,
      password_hash,
      is_active,
      must_change_password,
      updated_at
    )
    VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(employee_no) DO UPDATE SET
      password_hash = excluded.password_hash,
      is_active = 1,
      must_change_password = excluded.must_change_password,
      updated_at = CURRENT_TIMESTAMP
  `).run(normalizedEmployeeNo, passwordHash, mustChangePassword);
}


export function getLocalCredentialState(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return null;

  return db.prepare(`
    SELECT employee_no, is_active, must_change_password
    FROM local_credentials
    WHERE employee_no = ?
      AND is_active = 1
  `).get(normalizedEmployeeNo) || null;
}

export function markPasswordChanged(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  db.prepare(`
    UPDATE local_credentials
    SET must_change_password = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE employee_no = ?
      AND is_active = 1
  `).run(normalizedEmployeeNo);
}

export function verifyLocalCredential(employeeNo, password) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo || typeof password !== "string") {
    return false;
  }

  const row = db.prepare(`
    SELECT password_hash
    FROM local_credentials
    WHERE employee_no = ?
      AND is_active = 1
  `).get(normalizedEmployeeNo);

  if (!row) return false;
  return verifyPassword(password, row.password_hash);
}

export function markLocalCredentialLogin(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  db.prepare(`
    UPDATE local_credentials
    SET last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE employee_no = ?
  `).run(normalizedEmployeeNo);
}

export function disableLocalCredential(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  db.prepare(`
    UPDATE local_credentials
    SET is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE employee_no = ?
  `).run(normalizedEmployeeNo);
}
