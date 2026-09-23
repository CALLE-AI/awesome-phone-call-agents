# CALL-E API integration layer (pack V4)

The existing Express app already exposes `/api/calle` (mock/live gateway with `{ ok, data }` envelopes). This V4 layer mounts **alongside** that router:

- Create/get/health stay on the existing gateway (`server/calle/router.ts`) so there is a single CALL-E client path.
- V4 adds reconcile, batch, analytics, HMAC webhook dedupe, Drizzle persistence, and the Calls-screen runtime panel.

## Architecture

```text
React Native (Call command center + API demo panel)
     │  POST /api/calle/calls   (no API key)
     ▼
Existing Express app  (server/_core/index.ts)
     ├── Consent / safety policy
     ├── E.164 validation
     ├── Idempotency-Key
     ├── Retry / timeout
     ▼
CALL-E API  POST /v1/calls     or DemoCalleProvider when CALLE_DEMO_MODE=true
     ├──────────────► POST /api/calle/webhooks
     │                    HMAC + event dedupe
     │                    ▼
     │              GET /v1/calls/{id} reconcile
     ▼
Drizzle MySQL (calle_api_calls / events / idempotency)
     or in-memory repo when DATABASE_URL is unset
     ▼
React Native status timeline + structured result
```

## Why this is separate from `server/calle/`

The existing modules already implement prepare/confirm, policy, FakeCalleRuntime, and the `@call-e/calle` SDK adapter. This pack adds the **HTTP contract** the hackathon judging script expects: Idempotency-Key, result schemas, webhooks, reconciliation, and a visible runtime request from the phone UI.

## Env (server-only)

```text
CALLE_API_KEY=                 # never EXPO_PUBLIC_*
CALLE_BASE_URL=https://api.heycall-e.com
CALLE_WEBHOOK_SECRET=
CALLE_TIMEOUT_MS=30000
CALLE_MAX_RETRIES=3
CALLE_ALLOWED_REGIONS=CA,US,GB,AU,SG,IN
CALLE_DEMO_MODE=true
CALLE_LIVE_CALLS=false
CALLE_LIVE_TEST=false
CALLE_LIVE_TEST_PHONE=         # authorized recipient only, live tests
```

Fresh checkout stays in demo mode. Live `/v1/calls` requires `CALLE_DEMO_MODE=false`, `CALLE_LIVE_CALLS=true`, and a server-side key.

## Demo flow

1. Open CHW **Calls** (`app/chw/calls.tsx`).
2. Tap **Create CALL-E request** — fixture `+15555550123`, explicit consent.
3. Server validates E.164 + schema + consent, then creates a task.
4. UI polls status (queued → in progress → completed).
5. Structured result shows constrained `unknown` outcomes when evidence is thin.
6. **Reconcile with provider** re-fetches CALL-E truth.

## Tests

```bash
pnpm exec vitest run tests/calle-v4-api.test.ts tests/calle-v4.integration.test.ts
CALLE_LIVE_TEST=true CALLE_LIVE_TEST_PHONE=+1… pnpm exec vitest run tests/calle-v4-live.test.ts
```

Live tests are skipped unless both env flags are set. Never commit a real recipient number.

## Safety

- Tasks that ask for passwords, OTPs, PINs, or payment credentials are rejected.
- Logs redact 6+ digit tokens and API-key metadata.
- Webhook HMAC is required when `CALLE_WEBHOOK_SECRET` is set.
