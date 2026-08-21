EKSBASE Dashboard Export Role Revision

Final rules:
- PROMOTER:
  - authorization = Employee No.
  - Sell-out sheet = included
  - Inventory sheet = removed
  - Warehouse Code is not an authorization key
- DISTRICT:
  - Inventory scoped to authenticated District
- REGION:
  - Inventory scoped to authenticated Region
- SUB_REGION:
  - Inventory scoped to authenticated Sub-Region
- HQ / ADMIN / ALL:
  - Inventory remains available
- STORE:
  - removed as a dashboard authorization level
- Organization 110 remains mandatory.

IMPORTANT:
Run the patch from the backend directory. It creates backups and aborts if
your local source structure differs from the expected revision, rather than
guessing or overwriting code.

Commands:
  cd C:\Users\enday\kingdee-data-platform\backend
  node applyExportRoleRevision.js
  node testExportRoleRevision.js

Then restart:
  npm start

After restart, test Promoter export and confirm the workbook contains
Sell-out but no Inventory worksheet.
