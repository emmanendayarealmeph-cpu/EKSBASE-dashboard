/*
 * EKSBASE Export / Authorization Role Revision
 *
 * Run from:
 *   backend\
 *
 * Usage:
 *   node applyExportRoleRevision.js
 *
 * The script:
 *   1. Backs up the target files.
 *   2. Removes STORE from dashboard authorization.
 *   3. Adds role-aware Inventory-sheet control to the workbook builder.
 *   4. Adds the Promoter/non-Promoter export flag to dashboard export.
 *
 * It aborts instead of guessing if the expected source structure is not found.
 */

import fs from "node:fs";
import path from "node:path";

const backend = process.cwd();

const files = {
  authorization: path.join(backend, "src", "auth", "dashboardAuthorization.js"),
  service: path.join(backend, "src", "services", "kingdeeService.js"),
  controller: path.join(backend, "src", "controllers", "dashboardController.js"),
};

for (const [key, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) {
    throw new Error(`[ABORT] Missing ${key} file: ${file}`);
  }
}

function backup(file) {
  const backupPath = `${file}.backup-before-export-role-revision`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(file, backupPath);
    console.log(`[BACKUP] ${backupPath}`);
  }
}

for (const file of Object.values(files)) backup(file);

function replaceOnce(text, oldText, newText, label) {
  const count = text.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(`[ABORT] Expected exactly 1 match for ${label}, found ${count}.`);
  }
  return text.replace(oldText, newText);
}

/* -----------------------------------------------------------
 * 1. Authorization: remove STORE access level completely.
 * --------------------------------------------------------- */
{
  const file = files.authorization;
  let text = fs.readFileSync(file, "utf8");

  if (text.includes('"STORE",')) {
    text = replaceOnce(
      text,
      '  "STORE",\n',
      '',
      'STORE access level'
    );
  }

  const storeCase = `    case "STORE":
      if (!authenticatedUser.warehouseCode) {
        throw new Error(
          \`STORE access requires warehouseCode.\`
        );
      }

      return {
        authenticated: true,
        accessControlled: true,
        level: "store",
        district: "",
        region: "",
        subRegion: "",
        warehouseCode:
          clean(authenticatedUser.warehouseCode),
        salesNo: "",
        employeeNo,
        role,
        accessLevel,
        organizationCode: "110",
      };
`;

  if (text.includes(storeCase)) {
    text = replaceOnce(
      text,
      storeCase,
      "",
      'STORE authorization switch case'
    );
  } else {
    /*
     * Some versions use a condition/SQL form rather than the object-return
     * form above. In that case, do not guess.
     */
    const storeIndex = text.indexOf('case "STORE":');
    if (storeIndex >= 0) {
      throw new Error(
        '[ABORT] STORE case exists but its structure differs. Inspect dashboardAuthorization.js manually.'
      );
    }
  }

  fs.writeFileSync(file, text, "utf8");
  console.log("[UPDATED] dashboardAuthorization.js");
}

/* -----------------------------------------------------------
 * 2. Workbook builder: optional Inventory worksheet.
 *
 * We add includeInventorySheet=true to the existing builder.
 * The Inventory worksheet is created only when true.
 * --------------------------------------------------------- */
{
  const file = files.service;
  let text = fs.readFileSync(file, "utf8");

  const signatureOld = `  async buildInventorySellOutWorkbook({
    fromDate = "",
    toDate = "",
    warehouseCode = "",
    region = "",
    district = "",
    materialCode = "",
    category = "",
    brand = "",
  } = {}) {`;

  const signatureNew = `  async buildInventorySellOutWorkbook({
    fromDate = "",
    toDate = "",
    warehouseCode = "",
    region = "",
    district = "",
    materialCode = "",
    category = "",
    brand = "",
    includeInventorySheet = true,
  } = {}) {`;

  if (text.includes(signatureOld)) {
    text = replaceOnce(
      text,
      signatureOld,
      signatureNew,
      'workbook builder signature'
    );
  } else if (!text.includes("includeInventorySheet = true")) {
    throw new Error(
      '[ABORT] Could not find the expected buildInventorySellOutWorkbook signature.'
    );
  }

  const markerStart = `    // ========================================
    // Inventory Sheet
    // ========================================`;

  const markerSellOut = `    // ========================================
    // Sell-out Sheet
    // ========================================`;

  const start = text.indexOf(markerStart);
  const sellOut = text.indexOf(markerSellOut);

  if (start < 0 || sellOut < 0 || sellOut <= start) {
    throw new Error(
      '[ABORT] Could not locate Inventory/Sell-out worksheet sections.'
    );
  }

  const inventoryBlock = text.slice(start, sellOut);

  if (!inventoryBlock.includes("const inventorySheet")) {
    throw new Error(
      '[ABORT] Inventory worksheet block does not contain inventorySheet.'
    );
  }

  if (!inventoryBlock.includes("if (includeInventorySheet)")) {
    const body = inventoryBlock
      .split("\n")
      .map(line => `      ${line}`)
      .join("\n");

    const wrapped =
`    if (includeInventorySheet) {
${body}
    }

`;

    text =
      text.slice(0, start) +
      wrapped +
      text.slice(sellOut);
  }

  fs.writeFileSync(file, text, "utf8");
  console.log("[UPDATED] kingdeeService.js");
}

/* -----------------------------------------------------------
 * 3. Dashboard export: pass the authenticated role.
 *
 * We intentionally use req.dashboardUser, never req.query.role.
 * --------------------------------------------------------- */
{
  const file = files.controller;
  let text = fs.readFileSync(file, "utf8");

  if (text.includes("includeInventorySheet:")) {
    console.log("[SKIP] dashboardController.js already has includeInventorySheet.");
  } else {
    const callMarker = `buildInventorySellOutWorkbook({`;
    const callStart = text.indexOf(callMarker);

    if (callStart < 0) {
      throw new Error(
        '[ABORT] Could not find buildInventorySellOutWorkbook call in dashboardController.js.'
      );
    }

    /*
     * Find the end of the call by locating the first "});" after the call.
     * This is intentionally conservative; if the file uses a different
     * formatting/nesting pattern, abort rather than risk corrupting code.
     */
    const close = text.indexOf("\n          });", callStart);
    if (close < 0) {
      throw new Error(
        '[ABORT] Could not safely locate the end of the workbook call in dashboardController.js.'
      );
    }

    const insertion =
`            includeInventorySheet:
              String(
                req.dashboardUser?.role || ""
              ).trim().toUpperCase() !== "PROMOTER",
`;

    text =
      text.slice(0, close) +
      "\n" +
      insertion +
      text.slice(close);
  }

  fs.writeFileSync(file, text, "utf8");
  console.log("[UPDATED] dashboardController.js");
}

console.log("");
console.log("Revision complete.");
console.log("");
console.log("Rules now intended:");
console.log("  PROMOTER    -> Sell-out only; Inventory worksheet removed.");
console.log("  DISTRICT    -> Inventory scoped to District.");
console.log("  REGION      -> Inventory scoped to Region.");
console.log("  SUB_REGION  -> Inventory scoped to Sub-Region.");
console.log("  HQ/ADMIN/ALL -> Inventory remains available.");
console.log("  STORE       -> removed as a dashboard authorization level.");
console.log("");
console.log("Backups were created beside each modified file.");
