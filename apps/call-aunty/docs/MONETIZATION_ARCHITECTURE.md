# Monetization Architecture (V6)

## Overview

Call Aunty V6 adds a **server-authoritative monetization layer** on top of V1–V5 CALL-E workflows. Billing logic never runs only on the client.

```
Mobile UI (pricing, usage meters)
  → tRPC billing.*
  → server/billing/service.ts
  → entitlements + usage meters + call-credit ledger
  → MockBillingProvider (demo) | Apple | Google | Stripe (future)
  → CALL-E prepare/confirm budget gates (live calls only)
```

## Domain modules

| Module | Role |
|--------|------|
| `catalog.ts` | Versioned plan catalog (free, professional, clinic, org preview) |
| `ethical-policy.ts` | Always-free features; prohibited pricing signals |
| `entitlements.ts` | `getEffectiveEntitlements(user, org)` |
| `usage-meters.ts` | Idempotent usage increments |
| `call-credit-ledger.ts` | Grant, reserve, consume, refund |
| `billing-provider.ts` | Provider adapter boundary + mock |
| `revenue-events.ts` | Funnel analytics (no PII) |
| `feature-gate.ts` | `isEntitled`, `requireEntitlement` |

## Ethical boundaries

Never paywall: safety triage, emergency guidance, privacy, offline work, dry-run calling safeguards, basic follow-up.

Paid scope: live call credits, advanced command center, exports, org dashboards, automation.

## Drizzle tables

Schema in `drizzle/schema.ts`: `billing_subscriptions`, `billing_usage_meters`, `billing_call_credits`, `billing_audit_events`. Runtime uses in-memory store when DB unavailable (same pattern as CALL-E workflows).

## Env vars

| Variable | Default | Effect |
|----------|---------|--------|
| `BILLING_ENABLED` | on | Master switch |
| `BILLING_DEMO_MODE` | on | Mock provider + synthetic metrics |
| `BILLING_LIVE_PROVIDERS` | off | Block real Apple/Google/Stripe |

## Verification

```bash
pnpm run test:billing
pnpm run billing:health
```
