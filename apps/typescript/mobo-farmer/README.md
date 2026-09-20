# MoboFarmer

Next.js dashboard for SA smallholders — lets the farm make its own phone calls via CALL-E.

## What actually ships (3 agents)

1. **Input Sourcing** `POST /api/agent/check-stock` — checks Afgri/OVK/NTK for L33 seed, returns `price_per_bag, stock_quantity, next_delivery_date`. Code: `lib/agentSchemas.ts`, `app/api/agent/check-stock/route.ts`.

2. **Market Linker** `POST /api/agent/check-stock` with task type `Find Buyer` — asks market/buyer questions using the market-price schema.

3. **Water Coordinator** `POST /api/agent/check-stock` with task type `Check Water Allocation` or `Schedule Service` — asks water-allocation questions using the water schema. `GET /api/agent/call-history` is in-memory demo history, not a dispatch endpoint.

`GET /api/agent/status` polls results. There is no cancellation endpoint: closing the UI or stopping polling cannot recall an accepted call. An unknown submission outcome requires manual reconciliation; do not start another call automatically.

## Demo (dry-run by default)

`npm run demo` — uses `lib/mockData.ts` fixture, zero phone calls.
`npm run dev` — preview-only UI; the current UI does not send live approval flags or an operator token. The operator-only live API requires `ALLOW_LIVE_CALLS=true`, body `{live:true, confirmLive:true}`, headers `x-live-intent:true` and `x-operator-approval` matching `OPERATOR_APPROVAL_TOKEN`, and a valid authorized South African E.164 destination explicitly listed in `ALLOWED_E164`. An empty allowlist rejects live dispatch. The demo does not automatically purchase anything.

## Stack

Next.js 16, Firebase Auth/Firestore only (env vars via `.env.example`), no Firebase Storage. CALL-E client `lib/calle.ts`.

## Validation

Run `python3 scripts/validate_repository.py` from the repository root for structural validation. The author reports `NEXT_PUBLIC_FIREBASE_API_KEY=dummy npm run build` passing; external Firebase/live-call integration is not independently verified by this reference entry.
