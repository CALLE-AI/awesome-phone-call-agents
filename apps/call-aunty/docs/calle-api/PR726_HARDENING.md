# CALL-E gateway hardening

The direct `/api/calle` gateway is a **server-operator interface**, not the mobile application's authorization path. The Expo client must use the protected tRPC `calle.prepare`, `calle.confirm`, `calle.status`, and `calle.cancel` workflows. Do not place `CALLE_OPERATOR_TOKEN` or any provider credential in an `EXPO_PUBLIC_*` variable.

## Default-safe configuration

```text
CALLE_DEMO_MODE=true
CALLE_MOCK_MODE=true
CALLE_LIVE_CALLS=false
CALLE_KILL_SWITCH=false
CALLE_LIVE_INTENT_REQUIRED=true
CALLE_LIVE_LOOPBACK_ONLY=true
CALLE_ALLOW_LOOPBACK_OPERATOR=true
CALLE_OPERATOR_TOKEN=
CALLE_APPROVED_ORIGINS=
CALLE_APPROVED_PROVIDER_ORIGINS=https://api.heycall-e.com
CALLE_REJECT_REDIRECTS=true
CALLE_REQUIRE_HTTPS_ORIGIN=true
```

An API key is **configuration only**. It never selects live transport and never authorizes an outbound call. A direct live request additionally requires the exact `X-Calle-Live-Intent: confirm-live-v1` header, an authorized operator, valid E.164 recipients, recipient authorization, `CALLE_LIVE_CALLS=true`, a clear kill switch, and loopback origin by default.

For a non-loopback operator console, set a strong server-side `CALLE_OPERATOR_TOKEN`, set `CALLE_LIVE_LOOPBACK_ONLY=false`, and add the exact HTTPS console origin to `CALLE_APPROVED_ORIGINS`. Any unapproved origin, near-match domain, HTTP origin in production, or credentialed origin with a URL path is rejected.

Provider requests require HTTPS, reject userinfo URLs and cross-origin paths, and use `redirect: "error"` so bearer credentials are never followed to a redirect target. A live provider failure remains an error; it is never converted to a completed mock call.

The prior additive V4 runtime is now available only at `/api/internal/calle-v4` with operator authorization. Its public direct mobile panel was removed in favor of the protected workflow route.

## Ambiguous live operations

`POST /v1/calls` is sent **once only**. The transport never automatically retries a create request, because a timeout, connection reset, invalid success payload, or provider `5xx` may have occurred after the provider accepted the call. These conditions return `409 CALLE_MANUAL_REVIEW` with `state: "unknown"` and a non-sensitive remediation marker. A matching idempotency key is locked for manual reconciliation; the application will not emit a second live create for that key.

GET call and event reads may use the bounded retry budget because they are idempotent. Exhausted live reads also become an unknown/manual-review condition rather than a synthetic completed mock record. Protected workflows preserve this unknown state and do not make it automatically eligible for retry.

## Public response privacy boundary

Every CALL-E router response is copied and recursively sanitized immediately before `res.json`. Structured phone and recipient fields are fully redacted; phone-bearing task, transcript, summary, evidence, and error text is masked; bearer/basic credentials and secret-like fields are replaced with `[REDACTED]`. The source request, provider object, and persisted workflow remain unchanged internally so audit and reconciliation operations retain their private data.

Run the focused regression coverage with:

```bash
pnpm test:calle-security
```
