# SECURITY — GoodFaith

## Threat matrix

| Threat | Enforcement | File |
|---|---|---|
| Secret leak to client | server-only env module; no `NEXT_PUBLIC_` secrets; keys read only in route handlers / server modules | `lib/env.ts` |
| Accidental live call / spend | mock-first `isLive()` requires BOTH `GOODFAITH_LIVE=1` and `CALLE_API_KEY` | `lib/env.ts`, `lib/calle.ts` |
| Webhook replay | idempotency keyed on `CALL-E-Event-Id` before any state mutation | `lib/store.ts`, `app/api/calle/webhook/route.ts` |
| Oversized / malformed request | JSON parse guarded, procedure required, clinic count capped at 1–10, phone sanitized | `app/api/quotes/route.ts` |
| Fabricated price shown as real | structural rule: `ranked` can only be true with a non-empty `quoted_verbatim`; MOCK badge on every result surface | `lib/normalize.ts`, `components/AuditTrail.tsx`, `components/ComparisonTable.tsx` |
| CALL-E / Places outage crashing the app | graceful degradation — create failure → 502 structured error; Places failure → seeded fallback; events failure → empty list 200; null result → no_quote | `app/api/quotes/route.ts`, `lib/places.ts`, `lib/normalize.ts` |

## Not defended against (out of scope for this sprint)

- **Webhook signature verification.** Only event-id idempotency; no HMAC. Current CALL-E deliveries are
  unsigned (the SDK's `webhooks.verify`/`unwrap` are deprecated legacy helpers), so there is no signature to
  check. Listed as a limitation.
- **Multi-tenant auth / user accounts.** No login by design.
- **Durable storage / cross-instance persistence.** In-memory store is per-serverless-instance (K10);
  mock normalizes at read time and the live GET falls back to `calls.get`, so no durable store is required
  for correctness.
- **PHI handling.** The app deliberately captures no patient health information and never books.
