# Verification Protocol

The GroundTruth loop:

```
PLAN -> CALL -> ADAPT -> EXTRACT -> VERIFY -> DECIDE
```

## 0. Inputs

- A natural-language goal (from an operator or an agent).
- A candidate list (demo provider, manual list, or a discovery provider).
- Explicit authorization (allowed + prohibited actions).

## 1. PLAN

Produce a `VerificationGoal` and a `VerificationPlan`.

Goal extraction rules:

- **Item** — the thing to verify, with its exact identity (model code, revision).
  "A compressor" is not verifiable; "XZ-420 compressor, genuine/OEM" is.
- **Hard constraints** — each has: kind, human label, parameters
  (e.g. `{max: 25000}`), the exact phone question, and the structured-result
  field it maps to.
- **Soft preferences** — ranking only.
- **Authorization** — validate BEFORE planning calls. The prohibition list is
  mandatory and constant. If the user's request implies a purchase, reject the
  goal or downgrade it to verification.

Plan rules:

- One primary question per hard constraint. Constraints whose answers are
  likely to be hedged (compatibility checks, holds needing approval) get a
  **fallback question** ("could you check the model compatibility for me?").
- Candidate order: within the geography constraint first (nearest first),
  then the rest.
- Stopping rules: `stopOnFirstFullyVerified: true`, `maxCalls: 8`,
  `maxCallsPerCandidate: 2` (the second call is a targeted follow-up, not a
  repeat).

## 2. CALL

For each candidate (in priority order):

1. Compose the call task text:
   - Opening disclosure: who is calling (automated assistant), on whose
     behalf, and that no commitment will be made.
   - The questions, in order. If a prior call to this candidate left context
     (e.g. "you were going to check with your manager"), reference it.
   - The safety footer (verification-only; decline commitments; never reveal
     codes or credentials).
2. Run the composed text through the side-effect gate. Violations abort the
   call BEFORE creation.
3. Create the CALL-E call with:
   - `task` — the composed text.
   - `recipient` — `{ phone, region, locale }` in E.164.
   - `resultSchema` — the structured result contract (see
     `references/evidence-model.md`).
   - `metadata` — `{ taskId, candidateId, purpose, attempt }` for tracing.
   - `idempotencyKey` — derived from `(taskId, candidateId, purpose, attempt)`.
     Retries reuse the same key; CALL-E will not double-dial.
   - `webhookUrl` — registered terminal-result receiver, when available.
4. Track status. On terminal state, go to EXTRACT.

## 3. ADAPT

After each terminal call, inspect the state and choose exactly one action:

- **follow_up** — a hard constraint is UNKNOWN and resolvable with one more
  question:
  - a hold was requested and the supplier did not refuse it — typically
    "I can hold it, but I need to check with my manager first";
  - compatibility answered as `uncertain` but the supplier engaged.
  The follow-up call must be shorter than the first (one focused question)
  and must state that it is a follow-up.

  **Key the trigger on refusal, not on a positive flag.** It is tempting to
  require something like `hold_available: true` before following up. Do not:
  on a live call that sentence came back as `hold_available: null,
  hold_confirmed: false`, and only a deterministic mock ever produced the
  positive flag — so the follow-up silently never fired against real
  conversations while passing every test. An explicit refusal closes the
  door; anything short of it is unresolved, and unresolved is what a
  follow-up is for.

  **Leave a gap before redialling.** The supplier was just asked to go and
  check with someone. Calling back within seconds is both socially wrong and
  technically fragile — a live redial ~90s after hang-up failed with a
  zero-duration provider error. Wait, and make the wait configurable. A mock
  has no wall clock, so this failure mode cannot surface in a demo.
- **next_candidate** — the candidate failed a hard requirement, or its
  remaining unknowns are not resolvable by phone (the supplier cannot check,
  "call back tomorrow", no answer), or the per-candidate call budget is spent.
- **stop** — one candidate fully verified; or no candidates remain; or the
  global call budget is spent.

Never follow up on: explicit failures, refusals, unreachable lines. Never
follow up twice for the same constraint.

## 4. EXTRACT

From the terminal CALL-E call, build claims:

- Validate `structuredResult` against the strict schema; missing optional
  fields are null-filled so evaluation sees explicit gaps.
- Merge results across attempts for the same candidate: a later call's
  non-null fields override earlier ones (the follow-up's `hold_confirmed: true`
  lands on top of the first call's availability/price).
- One claim per phone-derived constraint type: availability, compatibility,
  price, quantity, pickup, hold.

## 5. VERIFY

For each hard constraint, evaluate deterministically:

- `pass` — the structured field says exactly the required thing (confirmed /
  not_compatible / number ≤ max / hold_confirmed true ...).
- `fail` — the field explicitly negates it.
- `unknown` — null, hedged (`uncertain`), or unevaluatable. UNKNOWN IS A
  RESULT. It is never rounded up to pass and never counted as failure
  without an explicit negative.

Promotion to `verified` requires ALL of:

1. The deterministic evaluation is `pass`.
2. The CALL-E call's `completionConfidence` is ≥ 0.5.
3. Evidence is attached (structured result + the supplier's words from the
   transcript).

Anything else keeps the claim `unknown` — regardless of how good the overall
call felt. A verified claim is immutable; a later call can only confirm it
(no-op) or contradict it (recorded in status history, never erased).

## 6. DECIDE

- Rank candidates: every hard constraint satisfied ⇒ viable. Failures and
  unknowns make a candidate non-viable. Soft preferences break ties.
- One viable candidate ⇒ `success` with that candidate, confidence = the
  minimum confidence across its verified hard constraints (the weakest leg).
- Some constraints verified but no fully viable candidate ⇒ `partial`, with
  per-candidate reasons and the unresolved constraint list.
- Nothing verified ⇒ `no_match` with the full breakdown.

Report the decision with: the winner (if any), the alternatives, the rejected
candidates WITH reasons, the unresolved constraints, and the confidence. The
honest failure report is a first-class output — "6 suppliers contacted, 2 out
of stock, 1 incompatible, 2 over budget, 1 availability uncertain" is a
usable operational answer, and it is more valuable than a soft success.

## Pseudo-code

```
task   = analyze(goalText)          # + authorization validation
plan   = buildPlan(task.goal)       # throws on authorization violation
cands  = discover(goal, plan.limit) # ranked
for cand in cands:
    call = createCall(composeCallTask(cand, plan.questions), schema, idemKey)
    result = awaitTerminal(call)    # poll or webhook
    mergeResults(cand, result)
    extractClaims(cand, result)     # + evidence + confidence
    evaluateConstraints(cand)       # deterministic
    if fullyVerified(cand): break
    elif resolvableUnknown(cand) and budgetRemaining(cand):
        followUp(cand)              # targeted second call
    else: continue                  # next candidate
decision = decide(cands)            # success | partial | no_match
auditLog.append(decision)
```
