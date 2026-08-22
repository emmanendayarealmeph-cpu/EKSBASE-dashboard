import crypto from "node:crypto";
import { db } from "../database/database.js";
import {
  ensureNeonAuthSchema,
  getNeonPool,
  isNeonAuthConfigured,
} from "../database/neon.js";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
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

function getLegacyCredential(employeeNo) {
  try {
    return (
      db
        .prepare(`
          SELECT
            employee_no,
            password_hash,
            is_active,
            created_at,
            updated_at,
            last_login_at,
            must_change_password
          FROM local_credentials
          WHERE employee_no = ?
            AND is_active = 1
        `)
        .get(employeeNo) || null
    );
  } catch {
    return null;
  }
}

async function migrateLegacyCredentialIfPresent(employeeNo) {
  if (!isNeonAuthConfigured()) {
    return getLegacyCredential(employeeNo);
  }

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  const existing = await database.query(
    `
      SELECT
        employee_no,
        password_hash,
        is_active,
        created_at,
        updated_at,
        last_login_at,
        must_change_password
      FROM public.local_credentials
      WHERE employee_no = $1
        AND is_active = TRUE
    `,
    [employeeNo]
  );

  if (existing.rows.length) {
    return existing.rows[0];
  }

  const legacy = getLegacyCredential(employeeNo);
  if (!legacy) return null;

  await database.query(
    `
      INSERT INTO public.local_credentials (
        employee_no,
        password_hash,
        is_active,
        created_at,
        updated_at,
        last_login_at,
        must_change_password
      )
      VALUES ($1, $2, $3, COALESCE($4, CURRENT_TIMESTAMP), COALESCE($5, CURRENT_TIMESTAMP), NULLIF($6, '')::timestamptz, $7)
      ON CONFLICT (employee_no) DO NOTHING
    `,
    [
      employeeNo,
      legacy.password_hash,
      Boolean(legacy.is_active),
      legacy.created_at,
      legacy.updated_at,
      legacy.last_login_at,
      Boolean(legacy.must_change_password),
    ]
  );

  const migrated = await database.query(
    `
      SELECT
        employee_no,
        password_hash,
        is_active,
        created_at,
        updated_at,
        last_login_at,
        must_change_password
      FROM public.local_credentials
      WHERE employee_no = $1
        AND is_active = TRUE
    `,
    [employeeNo]
  );

  return migrated.rows[0] || null;
}

export async function hasLocalCredential(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return false;

  const row = await migrateLegacyCredentialIfPresent(normalizedEmployeeNo);
  return Boolean(row);
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

  const passwordHash = hashPassword(password);
  const mustChangePassword = Boolean(options?.mustChangePassword);

  if (!isNeonAuthConfigured()) {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS local_credentials (
        employee_no TEXT PRIMARY KEY COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT DEFAULT '',
        must_change_password INTEGER NOT NULL DEFAULT 0
      )
    `).run();

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
    `).run(normalizedEmployeeNo, passwordHash, mustChangePassword ? 1 : 0);

    return;
  }

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  await database.query(
    `
      INSERT INTO public.local_credentials (
        employee_no,
        password_hash,
        is_active,
        must_change_password,
        updated_at
      )
      VALUES ($1, $2, TRUE, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (employee_no) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        is_active = TRUE,
        must_change_password = EXCLUDED.must_change_password,
        updated_at = CURRENT_TIMESTAMP
    `,
    [normalizedEmployeeNo, passwordHash, mustChangePassword]
  );
}

export async function getLocalCredentialState(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return null;

  const row = await migrateLegacyCredentialIfPresent(normalizedEmployeeNo);
  if (!row) return null;

  return {
    employee_no: row.employee_no,
    is_active: row.is_active,
    must_change_password: row.must_change_password,
  };
}

export async function markPasswordChanged(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  if (!isNeonAuthConfigured()) {
    db.prepare(`
      UPDATE local_credentials
      SET must_change_password = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE employee_no = ?
        AND is_active = 1
    `).run(normalizedEmployeeNo);
    return;
  }

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  await database.query(
    `
      UPDATE public.local_credentials
      SET must_change_password = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE employee_no = $1
        AND is_active = TRUE
    `,
    [normalizedEmployeeNo]
  );
}

export async function verifyLocalCredential(employeeNo, password) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo || typeof password !== "string") {
    return false;
  }

  const row = await migrateLegacyCredentialIfPresent(normalizedEmployeeNo);
  if (!row) return false;

  return verifyPassword(password, row.password_hash);
}

export async function markLocalCredentialLogin(employeeNo) {
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return;

  if (!isNeonAuthConfigured()) {
    db.prepare(`
      UPDATE local_credentials
      SET last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE employee_no = ?
    `).run(normalizedEmployeeNo);
    return;
  }

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  await database.query(
    `
      UPDATE public.local_credentials
      SET last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE employee_no = $1
    `,
    [normalizedEmployeeNo]
  );
}


export async function resetLocalCredentialToDefault(employeeNo, defaultPassword) {
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

  if (!isNeonAuthConfigured()) {
    db.prepare(`
      UPDATE local_credentials
      SET is_active = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE employee_no = ?
    `).run(normalizedEmployeeNo);
    return;
  }

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  await database.query(
    `
      UPDATE public.local_credentials
      SET is_active = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE employee_no = $1
    `,
    [normalizedEmployeeNo]
  );
}
