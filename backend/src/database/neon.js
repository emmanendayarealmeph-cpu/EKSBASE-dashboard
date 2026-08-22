import pg from "pg";

const { Pool } = pg;

let pool = null;
let schemaPromise = null;

function getConnectionString() {
  return String(process.env.NEON_DATABASE_URL || "").trim();
}

export function isNeonAuthConfigured() {
  return Boolean(getConnectionString());
}

export function getNeonPool() {
  const connectionString = getConnectionString();

  if (!connectionString) {
    throw new Error(
      "NEON_DATABASE_URL is not configured. EKSBASE persistent authentication requires the Neon database connection string."
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pool.on("error", (error) => {
      console.error("[NEON] Unexpected PostgreSQL pool error:", error.message);
    });
  }

  return pool;
}

export async function ensureNeonAuthSchema() {
  if (!isNeonAuthConfigured()) {
    return false;
  }

  if (!schemaPromise) {
    schemaPromise = (async () => {
      const database = getNeonPool();

      await database.query(`
        CREATE TABLE IF NOT EXISTS public.local_credentials (
          employee_no TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_login_at TIMESTAMPTZ,
          must_change_password BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);

      await database.query(`
        CREATE INDEX IF NOT EXISTS idx_local_credentials_active
        ON public.local_credentials (is_active)
      `);

      await database.query(`
        CREATE TABLE IF NOT EXISTS public.remembered_logins (
          token_hash TEXT PRIMARY KEY,
          employee_no TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
          expires_at TIMESTAMPTZ NOT NULL,
          last_used_at TIMESTAMPTZ
        )
      `);

      await database.query(`
        CREATE INDEX IF NOT EXISTS idx_remembered_logins_employee
        ON public.remembered_logins (employee_no)
      `);

      await database.query(`
        CREATE INDEX IF NOT EXISTS idx_remembered_logins_expires
        ON public.remembered_logins (expires_at)
      `);

      console.log("[NEON] EKSBASE authentication schema is ready.");
      return true;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  await schemaPromise;
  return true;
}
