import fs from "node:fs";
import path from "node:path";

import {
  db,
} from "../src/database/database.js";

const projectRoot =
  process.cwd();

const databasePath =
  path.resolve(
    projectRoot,
    "data",
    "kingdee.db"
  );

const viewDiagnosticPath =
  path.resolve(
    projectRoot,
    "src",
    "kingdee",
    "viewFormData.js"
  );

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}

if (!fs.existsSync(databasePath)) {
  throw new Error(
    `Database not found: ${databasePath}`
  );
}

const backupPath =
  `${databasePath}.before-phase1-cleanup-${timestamp()}.bak`;

fs.copyFileSync(
  databasePath,
  backupPath
);

console.log(
  `[CLEANUP] Database backup created: ${backupPath}`
);

const tableExists =
  db.prepare(`
    SELECT 1 AS found
    FROM sqlite_master
    WHERE type = 'table'
      AND name = 'serial_main_file'
  `).get();

if (!tableExists) {
  throw new Error(
    "serial_main_file table does not exist."
  );
}

const beforeCount =
  Number(
    db.prepare(`
      SELECT COUNT(1) AS total
      FROM serial_main_file
    `).get()?.total
  ) || 0;

const columns =
  db.prepare(
    "PRAGMA table_info(serial_main_file)"
  ).all();

const hasInventoryType =
  columns.some(
    (column) =>
      column.name ===
      "inventory_type"
  );

console.log(
  `[CLEANUP] Records before cleanup: ${beforeCount}`
);

if (hasInventoryType) {
  const dependentObjects =
    db.prepare(`
      SELECT
        type,
        name
      FROM sqlite_master
      WHERE name <> 'serial_main_file'
        AND sql IS NOT NULL
        AND lower(sql) LIKE '%inventory_type%'
    `).all();

  if (dependentObjects.length > 0) {
    console.table(
      dependentObjects
    );

    throw new Error(
      "inventory_type is referenced by another SQLite object."
    );
  }

  db.exec("BEGIN IMMEDIATE");

  try {
    db.exec(`
      ALTER TABLE serial_main_file
      DROP COLUMN inventory_type
    `);

    db.exec("COMMIT");

    console.log(
      "[CLEANUP] Removed serial_main_file.inventory_type"
    );
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
} else {
  console.log(
    "[CLEANUP] inventory_type column is already absent."
  );
}

const afterCount =
  Number(
    db.prepare(`
      SELECT COUNT(1) AS total
      FROM serial_main_file
    `).get()?.total
  ) || 0;

const afterColumns =
  db.prepare(
    "PRAGMA table_info(serial_main_file)"
  ).all();

const stillExists =
  afterColumns.some(
    (column) =>
      column.name ===
      "inventory_type"
  );

if (beforeCount !== afterCount) {
  throw new Error(
    `Record count changed. Before=${beforeCount}, After=${afterCount}`
  );
}

if (stillExists) {
  throw new Error(
    "inventory_type still exists after cleanup."
  );
}

if (
  fs.existsSync(
    viewDiagnosticPath
  )
) {
  fs.rmSync(
    viewDiagnosticPath
  );

  console.log(
    "[CLEANUP] Removed temporary src/kingdee/viewFormData.js"
  );
}

console.log(
  `[CLEANUP] Records after cleanup: ${afterCount}`
);

console.log(
  "[CLEANUP] Phase 1 cleanup completed successfully."
);