# EKSBASE Dashboard — Phase 3 Authorization Integration

## Status

Implemented on top of the latest Dual Date + Yellow/White dashboard build.

DingTalk authentication is intentionally **not mounted** yet. The dashboard remains runnable in standalone mode while the backend is now ready to consume `req.dashboardUser` when the final authentication provider is attached.

## Implemented

### 1. Server-controlled dashboard scope

The dashboard now resolves the effective scope through:

```js
getAuthorizedDashboardScope(req.dashboardUser, requestedScope)
```

The authenticated employee controls:

- Employee No.
- Role
- Access Level
- District
- Region
- Sub-Region
- Warehouse Code
- Promoter Sales No.
- Organization 110

Query-string values are only treated as requested navigation/filter values. They cannot override an authenticated employee's authorization scope.

### 2. Summary endpoint

`GET /dashboard/summary`

The authorization scope is applied before dashboard aggregation.

The scope is also passed into Kingdee data retrieval so unauthorized rows are excluded as early as possible, followed by a second server-side scope filter before KPI/model aggregation.

Sales Date and Activation Date behavior remains unchanged.

### 3. Fuzzy search endpoint

`GET /dashboard/search`

Search candidates are built only from rows inside the authorized scope.

### 4. Excel export endpoint

`GET /dashboard/export`

Export uses the same server-resolved scope as the dashboard.

This prevents an authenticated user from changing `district`, `region`, `subRegion`, `warehouseCode`, or `salesNo` in the export URL to obtain another user's data.

### 5. Authorization metadata

Summary and search responses now expose non-sensitive authorization metadata for the frontend:

```json
{
  "authorization": {
    "authenticated": true,
    "accessControlled": true,
    "employeeNo": "...",
    "role": "...",
    "accessLevel": "...",
    "organizationCode": "110"
  }
}
```

### 6. Promoter rule

For `PROMOTER`:

```text
level       = promoter
salesNo     = authenticated Employee No.
warehouseCode = ""
organizationCode = 110
```

Warehouse Code is not used as the promoter authorization key.

## Authentication integration status

The provider-neutral middleware and Employee Access components are included, but the dashboard routes intentionally do **not** call `requireAuthenticatedUser` yet.

Final integration will add the authentication middleware after the DingTalk provider is connected.

Expected final route pattern:

```js
router.get("/summary", requireAuthenticatedUser, dashboardController.getSummary);
router.get("/search", requireAuthenticatedUser, dashboardController.search);
router.get("/export", requireAuthenticatedUser, dashboardController.exportReport);
```

Do not enable this until a real authentication provider populates `req.authenticatedIdentity`.

## Validation completed

- JavaScript syntax checks passed for the modified controller/service/auth files.
- Dashboard authorization regression test passed.
- Promoter malicious scope test passed.
- District server-enforced scope test passed.
- No DingTalk secrets are included.

## Next step

The next implementation step is **final authentication integration**:

1. Mount the DingTalk authentication router/provider.
2. Populate `req.authenticatedIdentity` from verified DingTalk identity.
3. Run `requireAuthenticatedUser` before all three dashboard endpoints.
4. Validate real DingTalk Job Number = Kingdee Employee No.
5. UAT summary, drill-down, fuzzy search, date filters, and Excel export using multiple employee access levels.
