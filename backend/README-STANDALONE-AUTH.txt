EKSBASE Standalone Authentication - Development

This update adds local EKSBASE password authentication without reading from or writing to Kingdee password fields.

Architecture:
  Employee No. + EKSBASE password
    -> local_credentials (scrypt password hash)
    -> refresh ONLY this employee from Kingdee
    -> current Department/Role
    -> existing dashboard authorization resolution
    -> session token

The Kingdee Employee List is NOT bulk-extracted during login.

Provision a development password:
  node src/scripts/setStandalonePassword.mjs 200804001

Login endpoint:
  POST /auth/standalone/login
  JSON: { "employeeNo": "200804001", "password": "your-password" }

Important:
- Passwords are never stored in plaintext.
- Kingdee password fields are not accessed or modified.
- This remains a development-only standalone provider until DingTalk SSO is integrated.
- Do not expose the password provisioning script as an HTTP endpoint.
