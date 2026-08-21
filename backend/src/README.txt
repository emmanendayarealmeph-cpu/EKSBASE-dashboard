EKSBASE Dynamic Department Authorization Fix v2

Replace these backend files:
  src/auth/dashboardAuthorization.js
  src/auth/employeeAccess.js
  src/auth/standaloneAuth.js

Behavior:
- Kingdee Department is stored separately from resolved accessLevel.
- HQ.* departments get all-area access dynamically.
- Non-HQ departments are resolved against current serial_main_file hierarchy data.
- Deepest matching hierarchy wins: sub-region, then region, then district.
- No match => NONE; stale previous HQ scope is not reused.
- Department changes are refreshed from Kingdee at login.
- Non-promoter scope is server-controlled.

After replacement:
1. Restart backend.
2. Logout from dashboard.
3. Login again as 220704002.
4. Check /auth/standalone/me and /dashboard/summary.
