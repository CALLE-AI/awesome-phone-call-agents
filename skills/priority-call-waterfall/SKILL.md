---
name: priority-call-waterfall
description: Fill one open opportunity by calling a priority-ordered candidate list with CALL-E, one candidate at a time, until someone accepts — waitlist backfill, shift coverage, on-call escalation, and service dispatch workflows.
license: MIT
---

# Priority Call Waterfall

Use this skill when the user has one concrete opportunity (an open appointment slot, an
uncovered shift, an unassigned job, an unacknowledged incident) and a priority-ordered
list of candidates, and wants each candidate called in order until one accepts.

`priority-call-waterfall` is a calling-pattern skill. It does not add a CALL-E backend
API, a queue service, or a daemon. It turns one authorized "fill this opening" request
into a strictly sequential series of one-off CALL-E calls with a hard stop at the first
acceptance.

## When To Use

Use this skill for:

- backfilling a freed appointment slot from a waitlist (a cancellation or no-show)
- finding coverage for an open shift from a ranked list of staff
- dispatching one job to the first available provider on a call-down list
- escalating an incident through an on-call chain until someone acknowledges
- any "call these people in order until one says yes" request with a single opening

## When Not To Use

Do not use this skill to:

- call multiple candidates in parallel or race candidates against each other
- continue calling after a candidate has accepted
- offer the same opening to more than one person at a time
- broadcast announcements, promotions, or anything that is not a real single opening
- build a recurring schedule (pair with a scheduler skill instead; each waterfall run
  is a one-shot workflow)
- guess phone numbers, priorities, consent, or the opening's details
- call third-party numbers unless the user states the candidates expect these calls
  (an existing waitlist, staff roster, or on-call rotation is that expectation)

## Core Workflow

1. Confirm the user explicitly wants the opening filled by phone now.
2. Collect the waterfall fields:
   - the opening: what it is, when it is, and any details a candidate needs to decide
   - the candidate list: name, E.164 phone number, and priority (lower calls first)
   - an optional per-run call cap (default: call every listed candidate at most once)
   - an optional deadline after which the waterfall must stop even without an acceptance
3. Ask for any missing required field. Do not infer phone numbers or priorities.
4. Validate the input with `scripts/validate-waterfall-input.mjs` when a structured
   payload is available. Reject duplicate phone numbers and duplicate priorities.
5. Show the user a masked preview: the opening, the calling order, and the cap. Get
   explicit confirmation before the first call.
6. Call candidates strictly one at a time, in priority order:
   - build a goal that names the business or requester, the candidate, the opening,
     and asks for a clear yes or no (see `references/goal-and-result.md`)
   - request a structured result with a required `accepted` field (`yes` or `no`)
   - place exactly one CALL-E call and wait for its terminal status
   - treat an ambiguous provider outcome (voicemail, no answer, unclear answer, timeout, or failed call) as a halt condition; it must not automatically start another call or conflicting side effect.
   - only a clear 'no' counts as a decline that allows moving to the next candidate.
7. Stop conditions, checked after every call:
   - a candidate accepted → record who, stop immediately, never call the rest
   - the list, cap, or deadline is exhausted → stop and report the opening unfilled
8. Report the outcome using the Output Format below.

Use this shape per candidate:

```text
build goal -> one call -> read structured result -> accept? stop : next candidate
```

## Required Fields

For each run, require:

- `opening` — a short human-readable description of the single thing being offered
- `candidates[]` — each with `name`, `phone` (E.164), and `priority` (unique integer;
  lower calls first)

Optional:

- `maxCalls` — cap the number of candidates called this run
- `deadline` — an instant after which no further calls may start
- `language` / `region` — passed through to CALL-E when the user provides them

Phone numbers must be E.164. Mask phone numbers in user-facing summaries and reports.

## Safety Rules

Read `references/safety.md` for the full safety contract.

Always follow these rules:

- Every call is a real-world side effect; the user confirms the run before call one.
- One opening, one acceptance: after a yes, the waterfall is over. Calling candidate
  N+1 after candidate N accepted is the one unforgivable failure of this pattern.
- Strictly sequential: never dial two candidates concurrently.
- At most one call per candidate per run. No retries within a run.
- An ambiguous provider outcome must halt the live run for reconciliation; it must not automatically start another call or conflicting side effect. Only a clear yes in the
  structured result books the opening.
- Do not expose credentials, and mask every phone number in output.
- Treat medical, legal, financial, and emergency openings as logistics only: offer
  the time and the service name, give no advice on the call.

## Output Format

After the run, report:

- the opening, restated
- per candidate attempted, in order: masked phone, terminal call status, and the
  structured `accepted` value (or the failure reason treated as a decline)
- the outcome: `filled by <name>` or `unfilled` with why the run stopped
  (list exhausted, cap reached, or deadline passed)
- candidates never called because the waterfall stopped early
- how the user can re-run with the remaining candidates if the opening is still open

Never report the opening as filled unless exactly one candidate's structured result
contains a clear acceptance.

## Reference Implementation

A full runnable implementation of this pattern (with a waitlist data model, a
dashboard, and tests that exercise the waterfall against a fake CALL-E server) lives
in this repository at `apps/typescript/ai-front-desk/` — see
`src/flows/backfill/backfillFlow.ts` for the waterfall loop itself.
