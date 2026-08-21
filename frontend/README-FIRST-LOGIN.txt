EKSBASE Standalone First-Login Password Flow
============================================

Behavior
--------
1. A valid Kingdee employee with no standalone credential can sign in with:
   Employee No. + EKSBASELOGIN
2. The backend automatically creates a local credential and stores only a scrypt hash.
3. The login does NOT create a dashboard session yet.
4. The frontend forces the employee to choose a new password.
5. The password must be at least 8 characters and cannot remain EKSBASELOGIN.
6. After the new password is saved, a normal dashboard session is created.
7. Future logins use the employee's chosen password.
8. Kingdee Employee Password is never changed.

Backend files
-------------
Copy these into the corresponding backend paths:
- backend/src/auth/localCredentials.js
- backend/src/auth/standaloneAuth.js
- backend/src/routes/standaloneAuth.js
- backend/src/scripts/resetStandaloneToDefault.mjs (optional test/reset helper)

Frontend files
--------------
Copy:
- frontend/index.html
- frontend/js/app.js
- frontend/css/styles.css

Important
---------
EKSBASELOGIN is a universal temporary password. It is intentionally implemented
because this is the requested first-login flow, but it should be treated as a
bootstrap credential and changed immediately. Never use it as a permanent password.

Testing an existing employee
----------------------------
Existing manually provisioned employees already have a chosen password, so they
will not automatically enter first-login mode.

To force a test employee back into first-login mode:

  node src/scripts/resetStandaloneToDefault.mjs 1914401

Then login through the frontend using:

  Employee No.: 1914401
  Password:     EKSBASELOGIN

The frontend should immediately show the Change Password screen.
