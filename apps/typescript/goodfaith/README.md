# GoodFaith

An AI phone agent that calls imaging clinics for a self-pay cash price, enforces comparability on the call, and returns a confidence-gated, transcript-evidenced landed-cost comparison.

Live demo (mock-first, no login): https://goodfaith-nu.vercel.app

## The problem

A cash MRI of the lumbar spine (CPT 72148) commonly runs anywhere from about **$400 to $2,000+ in the same metro area** on the same day (published self-pay / cash-price data; our live demo winner is $438, recomputed from the sample transcript). Under the federal No Surprises Act, every self-pay or uninsured patient has a legal right to a Good Faith Estimate before a scheduled service. Almost nobody uses it. Exercising the right means phoning a dozen billing desks, sitting through IVR trees, asking the same eight questions, and then normalizing wildly different answers ("that's just the facility fee, the radiologist reads separately") into something comparable. The right exists on paper. The labor makes it unusable.

GoodFaith is that labor, done by an AI agent, in parallel, with receipts.

## What it does

1. You pick a procedure and a shortlist of standalone imaging clinics.
2. GoodFaith places one CALL-E task that fans out to every clinic at once.
3. On each call the agent insists on an apples-to-apples cash quote (all-inclusive, not facility-fee-only) and captures the exact sentence the clinic said.
4. It gates every result on CALL-E's completion confidence, normalizes each quote to a true landed cost, benchmarks it against a fair self-pay price, and ranks only the comparable ones.
5. Every ranked price expands to the transcript turn it came from, with a timestamp.

## The winner-flip (the differentiator)

A naive "cheapest number" ranker picks the wrong clinic.

- Capitol Imaging Partners quotes **$525**, which looks cheaper. It is facility-fee-only: the radiologist's professional read is billed separately, so it is not a complete price. GoodFaith flags it `NON_COMPARABLE` and never ranks it.
- Lone Star Open MRI quotes **$438 all-inclusive** (scan plus read, one price). That is the true landed-cost winner, 12% below the fair self-pay benchmark.

GoodFaith enforces comparability first, so the lower sticker does not win by accident. This is the centerpiece of the demo.

## How it works: the four load-bearing CALL-E surfaces

The whole product rests on four CALL-E capabilities. Each one is load-bearing for the result you see.

| Surface | What it does | Where it lives |
|---|---|---|
| 1. Multi-recipient parallel calls | One task fans out to every clinic via `recipients[]`, dialed in parallel, rolled into a single result | `src/lib/calle.ts` (`createQuoteCall`) |
| 2. Per-recipient structured extraction | A locked `recipientResultSchema` pulls `cash_price`, `price_basis`, includes/excludes, and the quoted sentence out of each call as typed JSON | `src/lib/schemas.ts` (`RECIPIENT_RESULT_SCHEMA`), sent in `src/lib/calle.ts` |
| 3. Completion-confidence gating | Any call below 0.6 confidence is held back for review and never ranked, fail-closed | `src/lib/normalize.ts` (`CONFIDENCE_THRESHOLD`, `normalizeRecipient`) |
| 4. Evidence / transcript audit trail | Every ranked price traces to the exact transcript turn it was said in; a price with no traceable utterance is refused | `src/lib/normalize.ts` (`findEvidence`), `src/components/AuditTrail.tsx` |

**Also implemented:**

- Idempotent webhook receiver keyed on `CALL-E-Event-Id`, so a re-delivered terminal event is a no-op (`src/app/api/calle/webhook/route.ts`). The code is implemented and unit-tested for idempotency, but has not yet processed a real live delivery (mock-first; live is gated by CALL-E region/schema support, see LIMITATIONS).
- Live call-events stream surfaced to the console via `calls.listEvents` (`src/app/api/quotes/[id]/events/route.ts`). Implemented against the SDK; not yet exercised against a live call (mock mode synthesizes the stream from the fixture).
- `metadata.rfq_id` correlation carried across the call and the webhook.
- Optional Goals API path (`runAndWait`, per-run idempotency key) when `CALLE_GOAL_ID` is set (`src/lib/calle.ts`, `maybeRunGoal`).

The `/proof` page maps each surface to its code and recomputes the sample rollup live in the browser.

## The no-fabricated-quotes invariant

A price only ranks if it traces to a real utterance. Every ranked row must have a non-empty `quoted_verbatim` whose text appears in that recipient's transcript turns. This is made structurally unrepresentable: `NormalizedResult.ranked` can only be `true` when `quoted_verbatim` is a non-empty string. A ranked row without evidence cannot be constructed. `scripts/verify-claims.ts` fails the build if any displayed price lacks a traceable utterance and is not mock-badged.

## Run it

### Mock mode (default, zero network, no credentials)

```bash
pnpm install
pnpm dev
# open http://localhost:3000
```

On the landing page, load the sample MRI clinics and request a cash price. The console shows call progress, the winner-flip ($438 all-inclusive winner vs $525 facility-only decoy), and an expandable per-row receipt (quoted sentence plus transcript timestamp). No phone is dialed.

Verify the pipeline without a browser:

```bash
pnpm typecheck   # 0 errors
pnpm test        # normalizer + route + webhook tests
pnpm verify      # recomputes the headline numbers from committed fixtures
pnpm build       # production build, all 8 routes
```

### Live mode (opt-in, requires a KYC-activated CALL-E account)

```bash
# .env.local (never commit)
CALLE_API_KEY=iams_live_xxx
GOODFAITH_LIVE=1
CALLE_WEBHOOK_URL=https://<your-public-host>/api/calle/webhook
```

A real outbound call is placed only when both `GOODFAITH_LIVE=1` and `CALLE_API_KEY` are present (`isLive()` in `src/lib/env.ts`). Everything else is identical to mock: the adapter maps the real CALL-E response into the same internal shape, so the normalizer and UI never branch on mode.

| Var | Purpose | Default |
|---|---|---|
| `CALLE_API_KEY` | CALL-E auth, server-only | unset, falls back to mock |
| `CALLE_BASE_URL` | CALL-E base URL | `https://api.heycall-e.com` |
| `GOODFAITH_LIVE` | `1` enables real calls (with a key) | `0` |
| `CALLE_WEBHOOK_URL` | public HTTPS for terminal webhook events | unset |
| `CALLE_GOAL_ID` | enables the optional Goals path | unset |
| `PLACES_API_KEY` | live Google Places clinic sourcing | unset, falls back to a seeded list |

## Safety

- Credentials are read only in server route handlers and server modules. No key is ever inlined with `NEXT_PUBLIC_` or sent to the browser.
- Mock is the default. The app is fully functional with zero outbound calls, and every mock result is badged.
- Disclosure: in live mode the agent identifies itself on the call. The app captures no PHI and does not book appointments.
- GoodFaith is not medical or legal advice. A Good Faith Estimate is an estimate, not a guaranteed or binding price.

Live calling is implemented and reaches the CALL-E API. Going fully live end-to-end requires two things (verified against the real API on 2026-09-14): (a) a recipient number in a CALL-E-supported region and language (en-US is verified; English calls to some regions such as Nigeria are rejected with a 422), and (b) transcript-based extraction, because the current API tier does not accept result or recipient JSON schemas (it returns 400 "not supported"), so per-recipient results are derived deterministically from the returned summary and transcript (`src/lib/extract.ts`). Mock mode exercises the identical normalizer path, so correctness does not depend on placing a call.
