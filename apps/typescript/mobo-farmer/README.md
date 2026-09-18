# MoboFarmer

Next.js dashboard for SA smallholders — lets the farm make its own phone calls via CALL-E.

## What actually ships (3 agents)

1. **Input Sourcing** `POST /api/agent/check-stock` — checks Afgri/OVK/NTK for L33 seed, returns `price_per_bag, stock_quantity, next_delivery_date`. Code: `lib/agentSchemas.ts`, `app/api/agent/check-stock/route.ts`.

2. **Market Linker** `POST /api/agent/status` — checks JHB/Tshwane Fresh markets, returns `produce_grade_accepted, price_per_kg, payment_terms`.

3. **Water Coordinator** `GET /api/agent/call-history` + `components/WaterManagement.tsx` — Vaalharts WUA irrigation slots.

Async polling avoids serverless timeouts. Polling is abortable — client AbortController + `DELETE /api/agent/status/[id]`.

## Demo (dry-run by default)

`npm run demo` — uses `lib/mockData.ts` fixture, zero phone calls.
`npm run dev` — UI. Live calls need explicit `{live:true}` + human approval, never auto-purchases.

## Stack

Next.js 16, Firebase Auth/Firestore only (env vars via `.env.example`), no Firebase Storage. CALL-E client `lib/calle.ts`.

## Validation

`python3 scripts/validate_repository.py --app mobo-farmer` passes.
`NEXT_PUBLIC_FIREBASE_API_KEY=dummy npm run build` passes.
