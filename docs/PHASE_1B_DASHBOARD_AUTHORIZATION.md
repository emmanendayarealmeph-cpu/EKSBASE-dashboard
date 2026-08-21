# EKSBASE Phase 1B — Dashboard Authorization Integration

Phase 1B adds server-controlled authorization on top of the existing dashboard.

## Promoter

For:

```text
role = PROMOTER
```

the server forces:

```text
level = promoter
salesNo = authenticated employeeNo
warehouseCode = ""
organization = 110
```

Warehouse Code is not an authorization key for Promoters.

## Non-promoters

Department maps to Access Level:

- DISTRICT → configured district
- REGION → configured region
- SUB_REGION → configured sub-region
- STORE → configured warehouse
- ALL / ADMIN / HQ → higher-level access

## Protected endpoints

The same server-controlled scope is applied to:

```text
/dashboard/summary
/dashboard/search
/dashboard/export
```

The existing Sales Date and Activation Date filters remain available.

Fuzzy search is performed only against rows already restricted to the authorized scope.

Export receives the same effective scope before workbook generation.

## Authentication

The adapter consumes:

```text
req.dashboardUser
```

DingTalk authentication is not yet attached to the dashboard router, so current standalone behavior is preserved when `req.dashboardUser` is absent.

When DingTalk authentication is ready, add:

```js
requireAuthenticatedUser
```

to all three dashboard routes.

## Test

Run:

```powershell
node src/scripts/testDashboardAuthorization.js
```

Expected:

```text
PASS: Dashboard authorization adapter is working.
```
