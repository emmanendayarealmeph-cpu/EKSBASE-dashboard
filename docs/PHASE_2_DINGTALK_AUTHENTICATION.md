# EKSBASE Phase 2 — DingTalk Authentication

## Objective

Connect the already-tested EKSBASE Employee Access and Dashboard Authorization layers to DingTalk.

The final identity chain is:

```text
DingTalk User
    ↓
DingTalk authCode
    ↓
DingTalk userAccessToken
    ↓
DingTalk current user
    ↓
DingTalk unionId
    ↓
DingTalk enterprise userid
    ↓
DingTalk job_number
    ↓
Kingdee Employee No.
    ↓
EKSBASE Employee Access
    ↓
req.dashboardUser
    ↓
Dashboard Authorization
```

DingTalk documents `requestAuthCode` for H5 micro-app login, and the user authorization code can be exchanged through `/v1.0/oauth2/userAccessToken`. The current-user endpoint is `/v1.0/contact/users/me`. citeturn3search0turn2search11turn2search1

For the EKSBASE requirement, the implementation then resolves the DingTalk unionId to userid and retrieves the employee detail containing `job_number`. citeturn5search0turn5search4

## Critical identity rule

The browser does NOT submit:

```text
employeeNo
salesNo
role
district
region
warehouse
```

The server derives Employee No. from DingTalk:

```text
DingTalk job_number
        =
Kingdee Employee No.
```

The user must already be provisioned in EKSBASE Employee Access.

This prevents an employee from changing the browser request to impersonate another employee.

## Backend endpoints

```text
POST /auth/dingtalk/login
GET  /auth/dingtalk/me
POST /auth/dingtalk/logout
```

### POST /auth/dingtalk/login

Input:

```json
{
  "authCode": "ONE_TIME_DINGTALK_AUTH_CODE"
}
```

The backend exchanges the code server-side and never returns the DingTalk access token to the browser.

If the Employee No. is not registered as an active EKSBASE employee, the login is rejected with HTTP 403.

### GET /auth/dingtalk/me

Returns only the EKSBASE authorization information:

```json
{
  "status": "ok",
  "user": {
    "employeeNo": "...",
    "role": "...",
    "accessLevel": "...",
    "district": "...",
    "region": "...",
    "subRegion": "...",
    "warehouseCode": "..."
  }
}
```

### POST /auth/dingtalk/logout

Clears the signed EKSBASE session cookie.

## Session

Phase 2 uses a signed HttpOnly cookie.

The DingTalk access token is NOT stored in the browser.

The cookie contains the normalized identity needed to rehydrate the EKSBASE Employee Access record.

## Security

The following are server-controlled:

- Employee No.
- Role
- Access Level
- District
- Region
- Sub-Region
- Warehouse
- Promoter Sales No.

The frontend must never be trusted for these values.

## Promoter

For:

```text
role = PROMOTER
```

the existing Phase 1A/1B rule remains:

```text
Organization 110
AND
sales_no = Employee No.
```

Warehouse Code is not used for Promoter authorization.

## DingTalk configuration

In the backend `.env`:

```text
DINGTALK_CLIENT_ID=...
DINGTALK_CLIENT_SECRET=...
EKSBASE_SESSION_SECRET=...
```

Do not commit the real secret values to Git.

## DingTalk application configuration

For an H5 micro app, configure the application's homepage/redirect behavior in DingTalk according to the DingTalk developer console.

The DingTalk H5 micro-app JSAPI provides `requestAuthCode`; the official JSAPI documentation identifies the Client ID as the internal app's AppKey and requires the enterprise CorpId. citeturn3search0

The application must also have the required user/contact permissions enabled in DingTalk. DingTalk's documentation states that server APIs are authorized at the application level and require the relevant permission points. citeturn5search4

## Current limitation

This phase contains the backend authentication implementation and provider-specific frontend login helper.

It does NOT automatically modify your current frontend entry point because the current frontend source structure was not included in the Phase 2 source set.

The next integration action is to add:

```js
loginWithDingTalk(...)
```

to the current dashboard bootstrap/login flow and mount:

```js
router.use("/auth/dingtalk", dingtalkAuthRouter);
```

in the existing Express application.

## Test

First run the existing Phase 1A test:

```powershell
node src/scripts/testEmployeeAccess.js
```

Then:

```powershell
node src/scripts/testPhase2Auth.js
```

The second test validates the identity-to-authorization handoff without contacting DingTalk.

A real DingTalk login test requires:

- valid DingTalk Client ID/AppKey
- valid Client Secret/AppSecret
- configured H5 micro app
- required permissions
- a real DingTalk one-time authCode
- the user's DingTalk job number matching a Kingdee Employee No.
