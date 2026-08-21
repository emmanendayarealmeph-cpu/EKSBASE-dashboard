# EKSBASE Phase 1A — Employee Access Master

## Database

The Employee Access tables use the existing EKSBASE database:

```text
backend/data/kingdee.db
```

They use the existing shared database connection:

```text
src/database/database.js
```

No `better-sqlite3` package is required.

## Tables

### employee_access

Stores EKSBASE-specific authorization:

- employee_no
- access_level
- role
- district
- region
- sub_region
- warehouse_code
- sales_no
- is_active

### user_identities

Stores authentication-provider identity mapping:

- provider
- provider_subject
- employee_no

## Identity

For DingTalk:

```text
DingTalk Job Number = Kingdee Employee No.
```

The authentication provider will later normalize this into:

```js
{
  provider: "dingtalk",
  providerSubject: "...",
  employeeNo: "..."
}
```

## Promoter

For:

```text
role = PROMOTER
```

the authorization scope is:

```text
Organization 110
AND
sales_no = authenticated employeeNo
```

Warehouse Code is NOT used for authorization.

This allows a promoter to move stores while retaining identity-based access.

## Non-promoter access

Department will map to Access Level.

Supported access levels:

- ALL
- ADMIN
- HQ
- DISTRICT
- REGION
- SUB_REGION
- STORE

## Current dashboard integration

Do not modify the current dashboard yet.

The next integration phase will apply the server-side scope to:

```text
/dashboard/summary
/dashboard/search
/dashboard/export
```

The same scope must apply to all three.

## Test

From:

```text
C:\Users\enday\kingdee-data-platform\backend
```

run:

```powershell
node src/scripts/testEmployeeAccess.js
```

Expected:

```text
PASS: Promoter authorization is employee-based.
PASS: Warehouse Code is not an authorization key.
PASS: Organization 110 is enforced.
```

## Important

The `organization_code` and `sales_no` expressions in `dashboardScope.js` represent the logical scope conditions.

During integration, they must be applied to the actual aliases/columns used by the existing dashboard query rather than blindly appended to unrelated SQL.
