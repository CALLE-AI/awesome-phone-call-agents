# CALL-E API Upgrade for call-mobile-aunty

## Current repo fit
The existing project already includes Expo/React Native, Express, Drizzle, TRPC, Vitest, and `@call-e/calle`. This pack makes the phone agent boundary explicit and server-first.

## API flow
Mobile UI -> `/api/calle/calls` -> policy -> idempotency -> CALL-E `POST /v1/calls` -> poll `GET /v1/calls/{call_id}` -> structured result -> mobile result UI.

## Required env
```text
CALLE_API_KEY=
CALLE_BASE_URL=https://api.heycall-e.com
CALLE_TIMEOUT_MS=30000
CALLE_POLL_INTERVAL_MS=2000
CALLE_POLL_TIMEOUT_MS=180000
CALLE_MAX_RETRIES=4
CALLE_RETRY_BASE_MS=500
CALLE_MOCK_MODE=false
CALLE_WEBHOOK_SECRET=
CALLE_ALLOWED_REGIONS=US,CA,GB,AU,SG
```

## Integration
Mount `registerCalleRoutes(app)` in the existing Express bootstrap. Never put `CALLE_API_KEY` in `EXPO_PUBLIC_*` variables or the mobile bundle.

## Structured results
Use constrained string enums and an `unknown` state whenever evidence is insufficient. Keep result schemas simple enough for the CALL-E API contract.

## Reliability
The pack adds idempotency, bounded retries, request timeouts, polling deadlines, a mock transport, and event retrieval.

## Safety/privacy
Reject password/PIN/payment/verification credential requests. Redact phone numbers and secrets from application logs. Only run real calls with consenting recipients and a narrow, business-relevant goal.

## Hackathon submission
The CALL-E challenge requires a working project using the CALL-E SDK/API/MCP/CLI/SKILL, an open PR to `awesome-phone-call-agents`, a ~3-minute public demo video, and the email associated with the CALL-E account. Judges emphasize real-world impact, idea quality, technical implementation, and product experience.
