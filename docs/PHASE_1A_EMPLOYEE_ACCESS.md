# EKSBASE Phase 1A — Employee Access Master

## Objective

Create a provider-independent authorization layer without changing the existing dashboard.

Kingdee remains the employee source.

EKSBASE stores only dashboard-specific access configuration.

## Tables

### employee_access

Stores:

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

Stores:

- provider
- provider_subject
- employee_no

This allows the same employee to authenticate through DingTalk now and a standalone provider later.

## Identity rule

For DingTalk:

`DingTalk Job Number = Kingdee Employee No.`

The provider must produce a normalized identity containing:

```js
{
  provider: "dingtalk",
  providerSubject: "...",
  employeeNo: "1913444"
}
```

## Promoter rule

If:

`role = PROMOTER`

the authorization key is the authenticated employee number.

The server-side scope is:

```text
organization_code = '110'
AND sales_no = authenticated employee_no
```

The promoter's Warehouse Code is NOT an authorization key.

Warehouse Code may still be displayed or used as a normal dashboard
filter, but it cannot change the promoter's permitted identity scope.

### Why

A promoter may move from one store to another.

Example:

```text
Employee 1913444
    ↓
Store A
    ↓
Store B
```

The promoter must continue seeing their own data based on:

```text
Employee No. = 1913444
```

rather than being tied permanently to Store A.

Frontend filters cannot expand this scope.

## Non-promoter rule

Access level determines scope:

- ALL / ADMIN / HQ
- DISTRICT
- REGION
- SUB_REGION
- STORE

## Integration rule

Do not replace the existing dashboard controller/service yet.

First verify the new database and authorization layer independently.

Then integrate the resulting `req.dashboardUser` into:

- `/dashboard/summary`
- `/dashboard/search`
- `/dashboard/export`

The same server-side scope must apply to all three.

## Test

Run:

```powershell
node src/scripts/testEmployeeAccess.js
```

Expected output should show:

```text
organization_code = '110'
warehouse_code = STR.008215
sales_no = 1913444
```

After this test succeeds, the next phase is integrating the scope into the existing dashboard service.


---

## Promoter acceptance tests

### Test 1 — Own data

```text
DingTalk Job Number = 1913444
Kingdee Employee No. = 1913444
Role = PROMOTER
```

Expected:

```text
Organization 110
AND
Sales No. 1913444
```

### Test 2 — Store change

Change the promoter's assigned store from:

```text
STR.008215
```

to:

```text
STR.009999
```

Expected:

The promoter's authorization remains based on:

```text
Sales No. 1913444
```

### Test 3 — Attempt another employee

Attempt:

```text
salesNo=1914401
```

Expected:

The backend continues enforcing:

```text
salesNo=1913444
```

### Test 4 — Attempt another warehouse

Attempt:

```text
warehouseCode=STR.009999
```

Expected:

The promoter's authorization is still:

```text
salesNo=1913444
```

The warehouse parameter cannot expand the promoter's data scope.
