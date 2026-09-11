# FieldClose Authentication and Workspaces

## Status

- Better Auth integration: Implemented with `better-auth@1.6.25`
- Primary authentication: Email or username plus password
- Passwordless authentication: Six-digit email OTP for existing accounts
- Secondary authentication: Optional GitHub OAuth
- Session storage: PostgreSQL through the Better Auth Drizzle adapter
- Public demo workspace — Authenticated, per-user, and fake-only
- Protected workspace provisioning: Implemented for server-allow-listed operators
- SMTP email delivery: Implemented; STARTTLS authentication and self-delivery
  verified with an operator-supplied provider configuration; production signup
  verification-code delivery and account verification were operator-verified on
  2026-08-24
- Protected staging endpoint and Basic-auth perimeter: Deployed and verified
- Protected staging resource isolation: Verified with an operator-approved
  same-owner SMTP exception
- Protected staging application access: Basic-auth and minimum-privilege
  operator workspace access verified on 2026-08-24
- Hosted Resend delivery and GitHub OAuth verification: Not yet completed

Deployment and account statements in this document are maintainer-reported
private operational observations unless they are directly visible at the public
URL. They do not identify a public deployment revision and are not offered as
public source, build, or independent validation provenance.

This document describes the implemented authentication boundary and workspace
isolation rules. SMTP credentials remain external to this repository. The
verification evidence confirms connection, TLS upgrade, authentication, and
provider acceptance of one self-test message. The protected-staging hostname is
deployed behind a valid TLS certificate and Caddy Basic-auth perimeter, and an
earlier private preflight record identifies a protected application release and
workspace. A later read-only server inspection verified separate public and
staging services, database URLs, authentication secrets, encryption and lookup
keys, and protected CALL-E/allowlist configuration. The environment files are
root-owned mode `0600`. Follow-up remediation isolated and rotated the Basic-auth
credential and added a dedicated, privacy-filtered, bounded-retention staging
access log. PostgreSQL uses distinct databases and roles over a loopback-only
same-host boundary. The operator accepted the shared QQ SMTP identity as a
documented same-owner deployment exception. A verified non-owner `operator`
subsequently signed in and observed the protected workspace; the bounded latest
session record independently confirmed that role and the eight-hour session
duration without retaining account identifiers.

On 2026-08-24 the operator completed the deployed signup verification-code
flow. A subsequent privacy-bounded query confirmed that the verified-user count
increased from one to two without reading an email address, verification code,
or account identifier. No active session remained at inspection time, and the
newly verified account had not yet been assigned a protected-workspace
membership at that inspection. Later on 2026-08-24, explicit operator authority
was used to assign the unique verified non-owner account an idempotent
`operator` membership. The environment administration allowlist and live-call
gates were not changed.

## Authentication boundary

Better Auth is mounted at `/api/auth/[...all]` on the Node.js runtime. Server code validates sessions with `auth.api.getSession`; a cookie's presence alone is never treated as authorization.

The application uses four Better Auth tables:

- `user` stores the minimum profile, verified-email state, normalized username, and display username;
- `session` stores expiring server-side sessions and opaque unique tokens;
- `account` stores credential password hashes or encrypted OAuth tokens and provider account references;
- `verification` stores short-lived OAuth state and hashed OTP verification values.

OAuth account tokens are encrypted by Better Auth before persistence. `BETTER_AUTH_SECRET` must contain at least 32 characters in a deployed environment. Local development uses an explicit non-production placeholder so tests can run without creating real credentials. Authentication is loaded only when a request needs it, so production builds do not require or embed a placeholder secret; production runtime remains fail-closed when the real secret is absent.

### Credential and email-code flows

Credential registration collects a display name, work email, and password. The
browser derives an internal username from the normalized email so registration
does not require a separate username field. Generated usernames contain 3–30
lowercase letters, numbers, dots, or underscores and remain unique; the work
email is the user-facing credential. Passwords must contain 8–128 characters. A
registration does not create a session until the email is verified, and
duplicate registration responses remain generic to reduce account enumeration.

Email verification and passwordless sign-in use a six-digit OTP:

- each code expires after 10 minutes;
- only a hash plus an attempt counter is stored in `verification`;
- five incorrect verification attempts invalidate the code;
- requesting a new code rotates the old value;
- the email-code endpoints allow at most three attempts per five-minute window;
- passwordless OTP cannot create a new account; the email must already be registered.

Successful verification creates a server-side session. The browser receives only the secure Better Auth session cookie; access, refresh, password, and OTP values are never stored in browser storage.

In local development and tests, missing email-provider configuration sends no
network request and prints the verification message to the server console.
Production fails closed when delivery is requested without a configured sender.

A deployment must configure exactly one delivery provider:

- SMTP requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and
  `SMTP_FROM`. Port 587 normally uses `SMTP_USE_TLS=true` and
  `SMTP_USE_SSL=false`, which requires a STARTTLS upgrade. Port 465 normally
  uses implicit SSL instead.
- Resend requires `RESEND_API_KEY` and `FIELDCLOSE_AUTH_EMAIL_FROM`.

FieldClose rejects partial SMTP or Resend configuration, simultaneous SMTP and
Resend configuration, and contradictory TLS/SSL flags. SMTP delivery uses
bounded connection timeouts, disables file and URL content access, and returns
a generic application error instead of provider or credential details.

### Optional GitHub login

The GitHub OAuth application callback is:

```text
https://<fieldclose-host>/api/auth/callback/github
```

Both `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` must be configured together. Partial configuration is rejected. GitHub is a secondary convenience for developers and evaluators, not the primary business-user login.

## Workspace model

Every authenticated user receives one deterministic personal demo workspace when the bootstrap endpoint is called. The slug is derived from a one-way digest of the Better Auth user ID, not an email address or display name.

Workspace kinds:

| Kind | Provider | Live calls | Intended use |
| --- | --- | --- | --- |
| `demo` | Always `fake` | Always disabled | Public demo, local development, and evaluation |
| `protected` | `fake` or `call_e` | Explicitly configured | Separately controlled authorized testing |

PostgreSQL rejects a demo workspace if its provider is changed to `call_e` or its live-call flag is enabled. Contacts and closeout cases carry a non-null workspace ID, and a case cannot reference a contact from another workspace. Work-order reference uniqueness is scoped to a workspace.

## Roles

| Role | Read workspace | Operate fake workflow | Request live preflight | Change safety settings |
| --- | --- | --- | --- | --- |
| `owner` | Yes | Yes | Yes, when all gates pass | Intended administrative role |
| `operator` | Yes | Yes | Yes, when all gates pass | No |
| `auditor` | Yes | No | No | No |

The current feature implements membership storage, the live-call role gate, and self-provisioning for a small server-side allowlist. General member invitation and role-management endpoints remain deferred.

## Workspace API

`GET /api/workspaces` returns only workspaces in the authenticated user's membership set.

`POST /api/workspaces` idempotently creates or returns the authenticated user's personal demo workspace. It cannot create a protected or live-enabled workspace.

Both endpoints return the same bounded response when no valid server-side session is present:

```json
{
  "error": {
    "code": "authentication_required"
  }
}
```

## Protected administration API

Protected administration is unavailable by default. The protected deployment must set:

```dotenv
FIELDCLOSE_DEMO_MODE=false
FIELDCLOSE_PROTECTED_OPERATOR_EMAILS=owner@example.com
```

The allowlist is normalized server-side, limited to 20 valid email addresses, and never returned to the browser. A valid Better Auth session must match an allow-listed email; possessing an email string in a request body provides no authority.

An authorized user provisions their own protected CALL-E workspace with live calls still disabled:

```http
POST /api/admin/workspaces
Content-Type: application/json

{
  "slug": "authorized-hvac-live",
  "displayName": "Authorized HVAC live",
  "confirmation": "PROVISION_PROTECTED_WORKSPACE"
}
```

The operation is idempotent only when the slug, display name, owner, protected kind, and CALL-E provider all match. It creates an owner membership and one immutable `protected_workspace.provisioned` event. It cannot upgrade a demo workspace.

Enabling or pausing the workspace-level live gate is a separate operation:

```http
PATCH /api/admin/workspaces/<workspaceId>/live-calls
Content-Type: application/json

{
  "enabled": true,
  "confirmation": "ENABLE_LIVE_CALLS"
}
```

Enabling also requires `FIELDCLOSE_LIVE_CALLS_ENABLED=true` and both CALL-E credentials to be configured. Pausing requires `PAUSE_LIVE_CALLS`. Repeating the current state is a no-op and does not add duplicate evidence. Neither operation changes the independent database `live_calls_paused` kill switch.

## Live-call gate

A live CALL-E request is eligible only when all independent checks pass:

1. the authenticated user belongs to the requested workspace;
2. global demo mode is disabled;
3. `FIELDCLOSE_LIVE_CALLS_ENABLED` is `true`;
4. the workspace kind is `protected`;
5. the workspace provider is `call_e`;
6. the workspace live-call flag is enabled;
7. the database `live_calls_paused` switch is `false`;
8. the CALL-E API key is configured;
9. the membership role is `owner` or `operator`.

Any missing setting blocks the request with a machine-readable reason. A missing database switch is interpreted as paused.

This gate is necessary but not sufficient to create a call. The later call workflow must also validate the authorized contact, current case version, exact approval, calling window, do-not-call state, idempotency key, and call brief.

## Migration behavior

The workspace migration supports databases created by the prior persistence feature. Existing contacts and cases are backfilled into a locked fake-only legacy demo workspace with a non-login migration owner. New records require an authenticated workspace explicitly. A PostgreSQL integration test exercises this upgrade path from the previous migration.

## Verification implemented

- Better Auth's official CLI generated the four core Drizzle models.
- Credential signup requires hashed-code email verification before session creation.
- Username/password and existing-account email-code sign-in are exercised through the real Better Auth HTTP handler against PostgreSQL 17.
- Integration evidence confirms that OTP values are hashed at rest and cannot be reused after successful consumption.
- Next.js production build exposes the Node.js authentication handler.
- Unauthenticated workspace requests return bounded `401` responses without querying application data.
- Repeated demo bootstrap returns one workspace and one owner membership.
- Another user cannot list or authorize against that workspace without membership.
- Database checks reject live settings on demo workspaces and cross-workspace case/contact references.
- Protected administration defaults to nobody, requires the protected environment and an allow-listed authenticated email, and never enables live calls during provisioning.
- Workspace live enablement requires a separate exact confirmation plus live server configuration.
- Provisioning and actual live-gate changes create append-only workspace administration evidence without storing the actor email.
- Unit and PostgreSQL tests cover every independent live-call switch.

Hosted Resend delivery and GitHub OAuth login remain unverified. SMTP signup,
secret configuration, secure-cookie behavior on HTTPS, and protected-environment
access have maintainer-reported private operational evidence, but not independent
public verification.
