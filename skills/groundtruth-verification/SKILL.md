---
name: groundtruth-verification
description: Run evidence-backed real-world verification by phone. Turn a fuzzy operational goal ("find a compatible part available today, held until 5 PM, under budget") into hard constraints, verify them with CALL-E phone calls that adapt to what each supplier actually says, and return claims with call-linked evidence — never promoting "probably" to verified. Use when an agent must confirm a real-world fact that only a human answering a phone knows (stock, compatibility, price, availability, holds, delivery windows), when a purchase or payment must NOT be made, and when the answer needs auditable evidence rather than a guess.
license: MIT
---

# GroundTruth Verification

An evidence-backed real-world verification protocol for phone-work agents.
CALL-E is the phone execution layer; this skill is the orchestration,
verification, and safety discipline around it.

## When to use this skill

Use it when ALL of these hold:

1. **The fact lives with a human, not a database.** Stock counts, exact-part
   compatibility, "can you actually come tomorrow", "is the quoted lead time
   real". Web search cannot settle it; calling can.
2. **The goal has checkable requirements.** You can name what counts as done:
   "compatible AND in stock AND ≤ ₹25,000 AND held until 5 PM".
3. **No commitment is needed.** GroundTruth verification is question-only.
   It may request a temporary hold when explicitly authorized. It never
   purchases, pays, accepts quotes, or reveals credentials.
4. **The answer must be auditable.** Every verified claim links to the CALL-E
   call that produced it, the supplier's own words, and a confidence score.

Do NOT use it for: appointment booking (use a scheduling skill), lead
qualification, surveys, emergencies, medical/legal/financial advice, or any
task whose success requires a transaction on the call.

## How to formulate a verification goal

Write the goal as: objective + item + hard constraints + soft preferences +
authorization.

- **Hard constraints** are gates: a candidate either passes or is rejected.
  Each one must be verifiable by asking a question on a phone call, and each
  maps to one structured-result field. Kinds: `availability`, `compatibility`,
  `price_max`, `quantity_min`, `distance_max`, `pickup_today`, `hold_until`,
  `deadline`, `custom`.
- **Soft preferences** only rank passing candidates (closer is better, cheaper
  is better). They never reject anyone.
- **Authorization** is explicit and structural: allowed actions
  (`ask_question`, `request_availability`, `request_pricing`,
  `request_delivery_estimate`, `request_pickup_window`, and only if the user
  said so, `request_hold`) and the mandatory prohibition list (`purchase`,
  `payment`, `contract_acceptance`, `legally_binding_commitment`,
  `disclose_credentials`, `disclose_payment_info`).

Example goal (the flagship):

```
Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km.
Hard: compatible with HVAC-200; in stock; pickup today; price ≤ ₹25,000;
      supplier holds one unit until 5 PM; distance ≤ 25 km.
Soft: prefer lower price; prefer closer.
Authorization: questions + hold request allowed; purchases prohibited.
```

Read `references/verification-protocol.md` before your first run. It defines
the plan → call → adapt → extract → verify → decide loop step by step.

## Setup

No credentials are needed to read this skill or to run its scripts against a
saved Goal document. To execute verifications you need one of:

- **The GroundTruth app** (recommended). `pnpm install`, then
  `MOCK_CALL_E=true pnpm dev` — deterministic mock CALL-E, no keys.
- **Direct CALL-E access.** `pnpm add @call-e/calle`, then set
  `CALLE_API_KEY` (server-side only; never in browser code) and optionally
  `CALLE_BASE_URL`. Keys are issued from the CALL-E dashboard.

The scripts in `scripts/` have no dependencies and run on plain Node:

```bash
node scripts/build-call-task.mjs goal.json
node scripts/check-goal-compatibility.mjs goal.json --spec published-goal.json
```

## Side effects and cancellation

**This skill places real phone calls to real people.** That is the whole
point of it, and it is the thing to be careful about.

| Effect | When | Reversible? |
| --- | --- | --- |
| An outbound phone call to a business | once per candidate, per attempt | No — a person's phone rings |
| A follow-up call to the same business | at most once more, when a constraint is resolvably unknown | No |
| A temporary hold requested on an item | only when `request_hold` is explicitly authorised | Yes — by calling back, which this skill does not do for you |
| Rows written to your own store | every call | Yes |

Nothing else. No purchase, payment, contract acceptance, or credential
disclosure is ever performed, and the prohibited-phrase gate blocks such
language from reaching a call task in the first place.

**Before running in real mode**, make sure the candidate list contains only
numbers you intend to dial. Demo or sample personas must never be dialled:
their numbers are fictional but well-formed, so a real run reaches a
stranger. Gate this structurally rather than by care — refuse to start unless
the pending candidate set is exactly what you nominated.

**Cancellation.** Stopping between calls is safe and immediate: the loop is
driven by discrete ticks, all state is persisted, and abandoning a run leaves
verified claims and their evidence intact. A call already in flight cannot be
recalled — the person has answered — and the correct response to an aborted
run is to let that call finish and ignore its result, not to redial.
Idempotency keys mean a retried create never produces a second call.

**Budgets.** `maxCalls` (default 8) and `maxCallsPerCandidate` (default 2)
bound how many times anyone can be dialled in one run. Lower them before you
raise them.

## Running a verification

### Option A — through the GroundTruth app (recommended)

```bash
# Start the app (demo mode, no credentials needed)
MOCK_CALL_E=true pnpm dev        # or pnpm build && pnpm start

# 1. Submit the goal
curl -s localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"input":"Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km. It must be compatible, available today, under ₹25,000, and the supplier must hold it until 5 PM. You may request a hold, but do not purchase anything."}'
# -> { "task": { "id": "...", "goal": { ... hardConstraints, authorization ... } } }

# 2. Start the run, then poll the tick endpoint until task.status = completed
curl -s -X POST localhost:3000/api/tasks/$TASK_ID/start
curl -s -X POST localhost:3000/api/tasks/$TASK_ID/tick   # repeat
# -> { "task", "candidates", "calls", "claims", "evidence", "decision", "audit" }
```

The final `decision` object contains `status` (`success` | `partial` |
`no_match`), the winning candidate, per-candidate reasons, and confidence.
Every verified claim carries `evidenceIds` pointing into the `evidence` array
(call ID, transcript excerpt, completion confidence).

### Option B — through a published CALL-E Goal

When a published Goal already encodes the verification questions, run that
instead of composing a call task. The Goal owns its `inputSchema` and
`resultSchema`; each run supplies a phone number, variables, and an
idempotency key.

```bash
MOCK_CALL_E=false CALLE_API_KEY=... CALLE_GOAL_ID=goal_... pnpm start
```

**Check the Goal before you dial.** A Goal can be healthy and still be
structurally unable to answer a hard constraint, because its result schema
declares no field for it. Running it anyway spends a real call on a human and
returns a constraint that can only ever be UNKNOWN.

```ts
const goal = await client.goals.get(goalId);
const fields = Object.keys(goal.publishedRunSpec.resultSchema.properties ?? {});
// Every phone-derived hard constraint must bind to one of `fields`.
// Every required input variable must be suppliable.
// Otherwise: refuse, and say which constraint the Goal cannot answer.
```

Two properties of the Goal path to carry into your own implementation:

1. **No transcript.** A Goal run returns a validated flat result, a `callId`,
   and a typed `error` — no turns. Claims from this path carry
   structured-result evidence and the call id. Do not imply a quote exists.
2. **Typed errors.** Branch on `error.code`: `no_answer`, `call_failed`,
   `declined`, `timed_out`, `canceled` mean the call did not happen (the
   candidate is unreachable); `result_invalid`, `result_unavailable`,
   `result_failed` mean it happened but produced nothing usable.

A `completed` run can briefly carry neither `result` nor `error` while CALL-E
parses. Keep polling — do not read it as an empty success.

### Option C — direct CALL-E calls following the protocol

If you cannot run the app, follow `references/verification-protocol.md`
against the official `@call-e/calle` SDK directly:

- Compose one call task per candidate with the opening disclosure, the
  per-constraint questions (plus fallback questions for hedged answers), and
  the safety footer. Run the text through the prohibited-phrase check BEFORE
  creating the call.
- Always pass a `resultSchema` (see `references/evidence-model.md`) and an
  idempotency key per logical call.
- Treat `uncertain` as an answer. Re-ask once with the fallback question; if
  the supplier still cannot confirm, the constraint stays UNKNOWN — that is a
  result, not a failure of the process.

## Non-negotiable rules

1. **UNKNOWN never becomes VERIFIED.** "Probably", "I think", "we usually
   have it" are `uncertain`, and an uncertain answer is an unresolved
   constraint. One polite follow-up ("could you check for me?") is allowed;
   after that, move on.
2. **No evidence, no verified claim.** A claim is verified only when the
   structured result supports it AND provenance is stored alongside it. On
   the call path that provenance includes the supplier's own words — store
   both. On the Goal path no transcript exists, so store the run id, the
   pinned RunSpec version and the correlated call id, and say plainly that no
   quote is available. Never synthesise a quote to fill the gap.
3. **Purchase language never enters a call task.** The side-effect scanner
   blocks purchase/payment/commitment/credential phrases at the orchestration
   layer. The structural prohibition ("we will not purchase") is fine;
   affirmative side-effect language is not.
4. **Never dial a question the contract cannot answer.** Whether the result
   shape is your own `resultSchema` or a published Goal's, check that every
   hard constraint maps to a declared field *before* the call is created. A
   constraint with nowhere to land is a configuration error, not a supplier
   outcome — refuse it loudly rather than spending someone's time on it.
5. **Stop when done.** Stop early when one candidate satisfies every hard
   constraint (with a follow-up for a pending hold). Stop when no candidate
   remains. Report failure honestly with per-candidate reasons — the failure
   report IS a result.
6. **Mask phone numbers and redact PII** in anything shown or stored beyond
   the working state. Never log API keys, codes, or card-like digit strings.

Read `references/safety.md` before composing your first call task. It is
short, and violating it is the difference between a verification agent and a
prank caller with a budget.

## Verification states

| State        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `unknown`    | Not asked yet, or the answer was hedged/refused                |
| `pending`    | On a call now, or awaiting a scheduled follow-up               |
| `verified`   | Concrete answer + attached evidence + sufficient confidence    |
| `contradicted` | A later call contradicted an earlier verified claim (recorded, never deleted) |
| `failed`     | Explicitly negative (out of stock, not compatible, cannot hold) |
| `expired`    | Was verified, but past its validity horizon (stock and holds go stale) |

## Stopping rules

Stop when ANY of: a candidate fully verified (preferred), all candidates
exhausted, the call budget (`maxCalls`, default 8; `maxCallsPerCandidate`,
default 2) is spent, or the only remaining unknowns are provably
unresolvable by phone. Continue when: a hard constraint is still unknown AND
a follow-up or another candidate could resolve it. Prefer candidates by
distance to the geography constraint, then by expected match.

## Failure handling

- **No answer / voicemail / hangup**: mark the candidate `unreachable`, move
  to the next candidate. Do not redial the same number in the same run.
- **API failure or timeout**: retry the CALL-E create with the SAME
  idempotency key (never double-dial); after repeated failures, mark the
  candidate unknown and continue.
- **Duplicate webhook deliveries**: deduplicate by webhook event id.
- **Ambiguous final state** (a hold was requested but not confirmed): report
  the candidate as partial with the specific unresolved constraint. Offer the
  operator the honest options: relax a constraint, expand the search, or stop.

## Further reading

- `references/verification-protocol.md` — the full plan → call → adapt →
  extract → verify → decide loop with pseudo-code.
- `references/evidence-model.md` — claims, evidence, confidence, schemas.
- `references/safety.md` — authorization boundaries and prohibited actions.
- `scripts/build-call-task.mjs` — compose a protocol-compliant CALL-E call
  task + result schema from a goal JSON (no dependencies).
- `scripts/check-goal-compatibility.mjs` — decide whether a published CALL-E
  Goal can answer a verification goal, before you run it. Works offline
  against a saved Goal document, or live via `goals.get` (read-only; places
  no call). Exit code 2 means "do not run this Goal".

```bash
# Offline, against a saved Goal document
node scripts/check-goal-compatibility.mjs goal.json --spec published-goal.json

# Live (read-only)
CALLE_API_KEY=... node scripts/check-goal-compatibility.mjs goal.json --goal-id goal_abc
```
