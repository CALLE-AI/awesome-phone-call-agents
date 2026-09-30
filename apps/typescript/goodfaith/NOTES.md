# GoodFaith — Build Notes

AI phone agent on the CALL-E platform that calls standalone imaging clinics for self-pay
Good Faith Estimate cash prices (demo: MRI lumbar spine, CPT 72148), enforces comparability
on the call, and returns a confidence-gated, transcript-evidenced, landed-cost comparison vs a
fair-price benchmark. Next.js App Router · TypeScript strict · Tailwind v3 · mock-first.

## How to run

### Mock mode (default — zero network, no credentials)
```bash
pnpm install
pnpm dev            # http://localhost:3000
```
On the landing page: click **Load sample MRI clinics** → **Get a cash price**. The console shows
call progress, the winner-flip comparison ($438 all-inclusive winner vs $525 facility-only decoy),
and an expandable per-row receipt (quoted sentence + transcript timestamp).

Verify the whole pipeline without a browser:
```bash
pnpm typecheck      # 0 errors
pnpm test           # 13 tests (normalizer + routes + webhook)
pnpm verify         # recomputes headline numbers from committed fixtures -> evidence/verify-claims.json
pnpm seed           # prints fixture summary + demo URL
pnpm build          # production build, all 8 routes
```

### Live mode (opt-in, requires a KYC-activated CALL-E account)
Set in `.env.local` (never commit it):
```
CALLE_API_KEY=iams_live_xxx
GOODFAITH_LIVE=1
CALLE_WEBHOOK_URL=https://<your-public-host>/api/calle/webhook   # for terminal events
```
A real outbound call is placed only when **both** `GOODFAITH_LIVE=1` **and** `CALLE_API_KEY` are
present (`isLive()` in `lib/env.ts`). Everything else is identical to mock — the adapter maps the
real CALL-E response into the same internal shape, so the normalizer and UI never branch on mode.

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `CALLE_API_KEY` | CALL-E auth (server-only) | unset → mock |
| `CALLE_BASE_URL` | CALL-E base URL | `https://api.heycall-e.com` |
| `GOODFAITH_LIVE` | `1` enables real calls (with key) | `0` |
| `CALLE_WEBHOOK_URL` | public HTTPS for terminal webhook events | unset |
| `CALLE_GOAL_ID` | enables optional Goals path | unset |
| `PLACES_API_KEY` | live Google Places clinic sourcing | unset → seeded list |
| `GOODFAITH_PERSIST` | `1` writes a JSON store snapshot | `0` |

## The four load-bearing CALL-E integration surfaces

| Surface | Where it lives |
|---|---|
| 1. Multi-recipient parallel calls (`recipients[]` fan-out) | `src/lib/calle.ts` → `createQuoteCall` |
| 2. Per-recipient structured extraction (`recipientResultSchema`) | `src/lib/schemas.ts` → `RECIPIENT_RESULT_SCHEMA`; sent in `src/lib/calle.ts` |
| 3. `completion_confidence` gating (fail-closed at 0.6) | `src/lib/normalize.ts` → `CONFIDENCE_THRESHOLD` / `normalizeRecipient` |
| 4. Evidence / transcript audit trail | `src/lib/normalize.ts` → `findEvidence`; `src/components/AuditTrail.tsx` |

**Also implemented**
- Idempotent webhook receiver keyed on `CALL-E-Event-Id` — `src/app/api/calle/webhook/route.ts` + `src/lib/store.ts`.
- Live call-events stream surfaced to the console — `src/app/api/quotes/[id]/events/route.ts` → `calls.listEvents`.
- `metadata.rfq_id` correlation across call and webhook — `src/lib/calle.ts`, webhook route.
- Server-side-only credentials, mock-first default — `src/lib/env.ts`.

**Optional / stretch**
- Goals API path (`runAndWait`, per-run idempotency key) when `CALLE_GOAL_ID` is set — `src/lib/calle.ts` → `maybeRunGoal`.

We deliberately do **not** claim "deepest integration" or "10/10 points" (see CLAIMS.md).

## SDK probe outcome (P0 — real shape vs assumed)

Probed `@call-e/calle@0.7.0` against the installed `dist/*.d.ts`. The real shape **differs** from the
architecture doc's assumptions. All differences are quarantined to the single adapter `src/lib/calle.ts`;
the deterministic core and UI were unaffected.

| Architecture assumed | Real SDK (`0.7.0`) | Resolution |
|---|---|---|
| `calls.createAndWait({ result_schema, recipient_result_schema, webhook_url })` (snake_case) | camelCase: `resultSchema`, `recipientResultSchema`, `webhookUrl`; idempotency via 2nd arg `{ idempotencyKey }` | adapted the call site |
| `calls.events(id)` → `CallEvent[]` | `calls.listEvents(id)` → `{ data: DeveloperEvent[], nextCursor }` | renamed + unwrap `.data` |
| `goals.run(goalId, { inputs, idempotencyKey })` | `goals.runAndWait({ goalId, phone, variables, idempotencyKey })` — single phone per run | rewrote `maybeRunGoal` per-clinic |
| Response `CallTask` snake_case: `structured_result`, `completion_confidence`, `task_completed`, recipient `.name`/`.phone`, `transcript_turns`, speakers `agent`/`clinic` | `Call` camelCase: `structuredResult`, `completionConfidence`, `taskCompleted`, recipient `.phones[]` (no name), `transcriptTurns`, speakers `bot`/`user`/`unknown` | `mapCallToTask` in `lib/calle.ts` maps SDK `Call` → internal `CallTask`; recipient names recovered by matching returned `phones[0]` to the input clinic list; speakers mapped `bot→agent`, `user→clinic` |
| Webhook `verify`/`unwrap` (signed) | deprecated — current CALL-E deliveries are **unsigned**; dedupe on `CALL-E-Event-Id` | idempotency-by-event-id only (documented in SECURITY.md) |

**Why keep the internal snake_case shape.** The mock fixture, normalizer, and UI are the app's own
domain contract (`src/lib/calle-types.ts`). Keeping it stable and mapping the SDK at the adapter boundary
is exactly what the "CALL-E is quarantined to one file" rule prescribes, and it means mock mode exercises
the identical normalizer path as live. The mock path requires zero network.

## Stubbed / deferred

- **Live CALL-E call not exercised end-to-end** — requires a KYC-activated account and a public webhook
  URL. The live code path is written and type-checks against the real SDK types, but the recorded live
  call belongs to the `wire` / `demo` phases. Mock-first means the demo does not depend on it (INVARIANTS D-1).
- **Google Places live sourcing** — code path present (`lib/places.ts`); without `PLACES_API_KEY` it returns
  the seeded 4-clinic Austin list. Fully functional for the demo.
- **Goals API** — optional; only runs when `CALLE_GOAL_ID` is set and live.
- **Durable store** — in-memory per instance (K10). Mock normalizes at read time; live GET falls back to
  `calls.get`, so correctness does not depend on cross-instance persistence.
- **Webhook signature verification** — not possible; current CALL-E deliveries are unsigned (see SECURITY.md
  "Not defended against").

## Verification snapshot (this build)

- `pnpm typecheck` → 0 errors
- `pnpm test` → 13 passed (normalizer gate/landed/rank/evidence/null + route validation + webhook idempotency)
- `pnpm verify` → `verify-claims OK`; winner $438, ranked 1, non_comparable 1, no_quote 2 (recomputed)
- `pnpm build` → success, 8 routes; no `CALLE_API_KEY`/`PLACES_API_KEY` in any client bundle (F-010)
- Mock e2e: POST `/api/quotes` → `mode:"mock"`; GET → winner $438 (evidence@14s), $525 NON_COMPARABLE,
  2 no-quote; benchmark pct_vs_fair −12; events stream 10 items; webhook dedupes on second delivery.
