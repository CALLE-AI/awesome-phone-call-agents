# Call Aunty × CALL-E — CHW phone follow-up skill

Reusable pattern for **human-centered phone-work orchestration** for community health workers.

## What it demonstrates

1. Server-only CALL-E credentials
2. Prepare → review side effects → confirm (no auto-dial)
3. Policy gates: consent, supported region/language, urgent-care deny, kill switch
4. Demo mode fail-closed with deterministic `FakeCalleRuntime`
5. AI call brief + outcome extraction with confidence gates (rule-based fallback)
6. Call command center with event timeline and correlation IDs
7. Structured result → existing follow-up state machine
8. Honest capability stance: UI language ≠ call language/region
9. Server-first REST gateway (`/api/calle`) plus additive V4 layer (`server/calle-v4/`) for webhooks, reconciliation, and analytics

## REST gateway (hackathon-ready)

The mobile client never holds `CALLE_API_KEY`. It posts to the Express gateway:

```
POST /api/calle/calls
GET  /api/calle/calls/:callId
GET  /api/calle/calls/:callId/events
POST /api/calle/webhook
```

Copy these modules into an upstream `awesome-phone-call-agents` app:

- `server/calle/client.ts` — REST default, SDK retained, mock for CI
- `server/calle/http.ts` — timeouts, retries, `Idempotency-Key`
- `server/calle/api-service.ts` — create/get/events + idempotency store
- `server/calle/router.ts` — `/api/calle` contract `{ ok, data }`
- `shared/calleClient.ts` + `hooks/useCalleCall.ts` — polling UI

Live evidence: a successful `POST /v1/calls` returns a `call_*` id. Mock evidence: `call_mock_*` with structured result + evidence.

## Hackathon entry points

- Judge script: `docs/calle-v5/judge-demo-script.md`
- Final ready: `docs/calle-v5/FINAL-READY.md`
- Hero E2E test: `tests/hackathon-e2e.test.ts`
- Health gate: `pnpm run calle:health`

## Suggested upstream layout

```
apps/typescript/call-aunty-chw-follow-up/
  README.md
  policy.ts
  adapter.ts
  fake-runtime.ts
  call-events.ts
  intent-compiler.ts
  map-to-follow-up.ts
  service.ts
```

Copy modules from this repo’s `server/calle/` and `server/ai/`. Do not paste patient data, live numbers, or API keys.

## Safety notes

- Never expose `CALLE_API_KEY` to a mobile client
- Never claim Bangla/BD support unless the live runtime documents it
- Keep urgent in-person care as a human-primary path
- Default `CALLE_DEMO_MODE=true` for safe demos
