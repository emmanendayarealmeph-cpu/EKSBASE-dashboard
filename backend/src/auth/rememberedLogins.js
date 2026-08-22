import crypto from "node:crypto";
import { ensureNeonAuthSchema, getNeonPool, isNeonAuthConfigured } from "../database/neon.js";

function clean(value) {
  return String(value ?? "").trim();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(clean(token)).digest("hex");
}

export async function rememberLogin(token, employeeNo, expiresAt) {
  if (!isNeonAuthConfigured()) return false;

  const normalizedToken = clean(token);
  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedToken || !normalizedEmployeeNo) return false;

  await ensureNeonAuthSchema();

  const expires = new Date(expiresAt);
  if (Number.isNaN(expires.getTime())) return false;

  const database = getNeonPool();

  await database.query(
    `
      INSERT INTO public.remembered_logins (
        token_hash,
        employee_no,
        expires_at,
        last_used_at
      )
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (token_hash) DO UPDATE SET
        employee_no = EXCLUDED.employee_no,
        expires_at = EXCLUDED.expires_at,
        last_used_at = CURRENT_TIMESTAMP
    `,
    [hashToken(normalizedToken), normalizedEmployeeNo, expires]
  );

  return true;
}

export async function restoreRememberedLogin(token) {
  if (!isNeonAuthConfigured()) return null;

  const normalizedToken = clean(token);
  if (!normalizedToken) return null;

  await ensureNeonAuthSchema();

  const database = getNeonPool();
  const result = await database.query(
    `
      SELECT employee_no, expires_at
      FROM public.remembered_logins
      WHERE token_hash = $1
        AND expires_at > CURRENT_TIMESTAMP
    `,
    [hashToken(normalizedToken)]
  );

  if (!result.rows.length) {
    await database.query(
      `DELETE FROM public.remembered_logins WHERE token_hash = $1`,
      [hashToken(normalizedToken)]
    );
    return null;
  }

  const employeeNo = clean(result.rows[0].employee_no);

  await database.query(
    `
      UPDATE public.remembered_logins
      SET last_used_at = CURRENT_TIMESTAMP
      WHERE token_hash = $1
    `,
    [hashToken(normalizedToken)]
  );

  return {
    employeeNo,
    expiresAt: new Date(result.rows[0].expires_at).getTime(),
  };
}

export async function forgetLogin(token) {
  if (!isNeonAuthConfigured()) return false;

  const normalizedToken = clean(token);
  if (!normalizedToken) return false;

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  await database.query(
    `DELETE FROM public.remembered_logins WHERE token_hash = $1`,
    [hashToken(normalizedToken)]
  );

  return true;
}

export async function forgetEmployeeRememberedLogins(employeeNo) {
  if (!isNeonAuthConfigured()) return false;

  const normalizedEmployeeNo = clean(employeeNo);
  if (!normalizedEmployeeNo) return false;

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  await database.query(
    `DELETE FROM public.remembered_logins WHERE employee_no = $1`,
    [normalizedEmployeeNo]
  );

  return true;
}

export async function purgeExpiredRememberedLogins() {
  if (!isNeonAuthConfigured()) return 0;

  await ensureNeonAuthSchema();
  const database = getNeonPool();

  const result = await database.query(
    `DELETE FROM public.remembered_logins WHERE expires_at <= CURRENT_TIMESTAMP`
  );

  return result.rowCount || 0;
}
