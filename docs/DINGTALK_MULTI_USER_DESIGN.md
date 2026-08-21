# EKSBASE Dashboard — Multi-Authentication / Multi-User Design

## Final identity model

EKSBASE must NOT make DingTalk a permanent dependency.

DingTalk is the first authentication provider, but the application
must also support a future standalone login or another SSO provider.

Authentication providers must be replaceable without changing:
- dashboard calculations
- dashboard scope
- reporting
- Excel export
- user authorization rules

### Identity rule

`DingTalk Job Number = Kingdee Employee No.`

The EKSBASE backend receives a verified DingTalk identity and extracts:

`Job Number`

That value is matched against the Kingdee Employee Master / synchronized employee access table.

If no active employee is found, dashboard access is denied.

---

## User fields

The dashboard access record should contain:

| Field | Purpose |
|---|---|
| DingTalk Job Number | Authenticated identity |
| Employee No. | Kingdee employee identity |
| Employee Name | Display |
| Department | Organizational source |
| Access Level | Determines dashboard data scope |
| Role | Additional restriction |
| District | Scope |
| Region | Scope |
| Sub-Region | Scope |
| Warehouse Code | Store scope |
| Sales No. | Promoter scope |
| Active | Access enabled/disabled |

Because Job Number must equal Employee No., the two values should be stored separately during synchronization but validated as an exact match.

---

## Department vs Access Level

Do not use the raw department name as the SQL security rule.

Use:

`Department → Access Level → Data Scope`

Example:

```text
SLA Department
    ↓
Access Level = SLA
    ↓
SLA permitted scope
```

This makes organizational restructuring safer.

---

## Role rule

The special role is:

`PROMOTER`

If `role = PROMOTER`, the dashboard is restricted to:

`organization_code = 110`

AND

`warehouse_code = assigned warehouse`

AND

`sales_no = authenticated employee's Sales No.`

This means a promoter cannot use URL parameters or frontend controls to see another promoter's data.

---

## Non-Promoter rule

For non-promoters, Access Level controls the maximum scope.

Suggested levels:

- ALL / ADMIN / HQ
- DISTRICT
- REGION
- SUB_REGION
- STORE

The actual department-to-access-level mapping should be maintained in the employee/access master rather than hard-coded throughout the dashboard.

---

## Mandatory backend rule

The frontend is NOT a security boundary.

For every dashboard API request:

1. Verify DingTalk identity.
2. Read Job Number.
3. Find matching Kingdee Employee No.
4. Load dashboard access mapping.
5. Build server-side scope.
6. Apply the scope to the existing Organization 110 query.
7. Apply the user's requested filters only inside that permitted scope.

Example:

```text
Promoter:
  Server scope = STR.008215 + Sales No. 1913444

User URL:
  warehouseCode=STR.009999

Result:
  Still STR.008215 data only
```

The URL must never be able to override the authenticated scope.

---

## Dashboard and Excel export

The same access scope must be applied to:

- Dashboard summary
- District/Region/Sub-Region/Store drill-down
- Promoter drill-down
- Model performance
- Color performance
- Fuzzy search results
- Sales Date filter
- Activation Date filter
- Excel export

This is especially important for Excel export because a frontend-only restriction could otherwise allow unrestricted data to be downloaded.

---

## DingTalk integration

The temporary adapter in this phase expects a verified identity object:

```js
req.dingtalkUser = {
  jobNumber: "1913444"
};
```

This is NOT a production authentication mechanism.

Before deployment inside DingTalk, replace it with DingTalk's official server-side authentication flow appropriate to the selected DingTalk application type.

The backend must validate the DingTalk token/code and obtain the Job Number from DingTalk rather than trusting a browser-supplied Job Number.

---

## Employee synchronization

Recommended process:

```text
Kingdee Employee Master
        ↓
Employee No.
        ↓
EKSBASE Employee / Access Master
        ↑
Department → Access Level
Role
District
Region
Sub-Region
Warehouse
Sales No.
        ↑
DingTalk Job Number
```

Validation:

```text
DingTalk Job Number
        =
Kingdee Employee No.
```

Mismatch:

```text
ACCESS DENIED
```

---

## Recommended next implementation order

### Step 1 — Employee Access Master

Create/synchronize the dashboard access table.

### Step 2 — DingTalk SSO

Implement official DingTalk authentication.

### Step 3 — Dashboard API protection

Apply `requireDingTalkUser` to `/dashboard/summary`.

### Step 4 — Backend scope

Apply `getDashboardScope(req.dashboardUser)` inside the existing dashboard service.

### Step 5 — Export protection

Apply the same scope to the existing Excel export endpoint.

### Step 6 — Frontend

The frontend should simply call the API.

It should display the authenticated user's:

- Employee Name
- Department
- Access Level
- Role

The frontend does not decide what data the user is allowed to see.

---

## Acceptance tests

### Test A — Promoter

Job Number: `1913444`

Kingdee Employee No.: `1913444`

Role: `PROMOTER`

Warehouse: `STR.008215`

Sales No.: `1913444`

Expected:

Only promoter `1913444` data is returned.

### Test B — Promoter URL manipulation

Attempt another store:

`warehouseCode=STR.009999`

Expected:

No unauthorized data.

### Test C — Promoter another sales number

Attempt:

`salesNo=1914401`

Expected:

No unauthorized data.

### Test D — Non-promoter

Access Level = `DISTRICT`

Expected:

All permitted data within assigned district.

### Test E — Job number mismatch

DingTalk Job Number = `1234567`

Kingdee Employee No. = `7654321`

Expected:

Access denied.

### Test F — Inactive employee

Employee exists but `isActive = false`.

Expected:

Access denied.

---

## Important

Do not integrate the previous username/password authentication package into the current backend.

This DingTalk-based design replaces that approach.


---

## Provider-neutral architecture

```text
Authentication Provider
        ↓
Normalized Identity
        ↓
Identity Mapping
        ↓
EKSBASE Employee
        ↓
Access Level + Role
        ↓
Dashboard Scope
        ↓
Organization 110 Data
```

Supported providers can include:

- DingTalk
- Standalone/local login
- Microsoft Entra ID
- Google or another SSO provider in the future

Each provider must only authenticate the person and return a normalized
identity. It must not contain dashboard authorization logic.

---

## Identity mapping

Use a separate identity mapping table:

`user_identities`

Key fields:

- provider
- provider_subject
- employee_no

Example:

```text
provider = dingtalk
provider_subject = dingtalk-user-abc
employee_no = 1913444
```

A future standalone account could be:

```text
provider = local
provider_subject = 1913444
employee_no = 1913444
```

Both can point to the same EKSBASE employee.

---

## Why this matters

If DingTalk is removed in the future, the dashboard does not change.

Only the authentication provider changes:

```text
Today:

DingTalk → Identity → EKSBASE User → Authorization → Dashboard

Future:

Standalone → Identity → EKSBASE User → Authorization → Dashboard
```

---

## Important design rule

Never use:

```text
if DingTalk then ...
```

inside dashboard queries.

Instead use:

```text
authenticatedIdentity
        ↓
employee/access record
        ↓
getDashboardScope(user)
```

The dashboard should not know which provider authenticated the user.

---

## Future standalone mode

When EKSBASE becomes standalone:

1. Enable `local` provider.
2. Implement standalone login/session.
3. Map local users to `employee_no`.
4. Keep the same employee/access table.
5. Keep the same dashboard scope.
6. Keep the same export restrictions.

No dashboard rewrite should be required.
