# CareCall SG — Product Specification

Specification for `apps/typescript/agent-gallery`, the CareCall SG operator
workspace. The implementation detail lives in
[`carecall-sg-ui-plan.md`](carecall-sg-ui-plan.md); this document states what the
product is, what it may and may not do, and the contracts it holds to.

An earlier version of this document specified a salon appointment-recovery
workflow. That workflow was replaced by CareCall SG and its code has been
removed; the CALL-E integration findings that survived the change are recorded
in [`calle-api-observations.md`](calle-api-observations.md).

## Pitch

> CareCall SG places caregiver-authorized reminder and check-in calls to seniors
> in Singapore, records only what the senior actually said, and routes every
> exception to a named human. It never decides anything about anyone's care.

## Vertical and Hero Operator

- **Vertical:** community eldercare in Singapore — care teams and family
  caregivers supporting seniors who live alone or semi-independently.
- **Hero operator:** the care coordinator running a Singapore care team's daily
  round of check-ins. Today they call a list of seniors by hand, and the calls
  that matter most are the ones nobody got to.
- **Trigger:** a caregiver-approved routine falls due — a medication reminder, a
  meal or hydration prompt, a wellbeing check-in, or an appointment reminder.
- **Defensible value claim:** the coordinator's attention moves from placing
  routine calls to handling the small number that came back wrong. The product
  claims only what it observably does: it places the call, records what was
  said, and surfaces exceptions. It does not claim improved adherence, and no
  invented outcome statistics appear anywhere in the interface or the demo.

## Product Boundary

CareCall may repeat a caregiver-approved reminder, ask one clear follow-up
question at a time, record a self-reported outcome from its routine kind's own
vocabulary, ask whether food is available or a planned delivery arrived, offer a
callback from an authorized caregiver, and route ambiguity to a human.

CareCall must never diagnose a condition or recommend a dose, advise a senior to
repeat, skip, delay, or change medication, treat silence or hesitation as
completion, request money, banking details, OTPs, passwords, or a full NRIC,
create a hidden recurring schedule, or claim that help has been dispatched when
it has not. For an immediate emergency the interface directs a person to **995**;
CareCall does not dispatch emergency services.

The full boundary, including the per-kind conversational limits, is assembled
from the enforcing modules by
[`safety-policy.ts`](../../apps/typescript/agent-gallery/src/carecall/safety-policy.ts)
and is readable inside the workspace, so the stated policy cannot drift from the
code that enforces it.

## Routine Kinds and Outcome Vocabularies

Five kinds ship, and **each may only report outcomes from its own vocabulary**.
`OUTCOMES_BY_KIND` in
[`result.ts`](../../apps/typescript/agent-gallery/src/workflows/carecall/result.ts)
is a complete `Record`, so adding a kind without a vocabulary is a type error.
An outcome outside the kind's list becomes `uncertain`.

| Kind | Representative outcomes | Stated limit |
| --- | --- | --- |
| `medication` | `self_reported_taken`, `unsure_if_taken`, `cannot_find_medication` | Never advises repeating, skipping, or changing a dose |
| `meal` | `self_reported_ate`, `no_food_available`, `meal_delivery_missing` | Asks about food access; arranges nothing |
| `hydration` | `self_reported_drank`, `unsure_if_drank`, `no_drink_available` | No intake targets, no health inference |
| `wellbeing` | `self_reported_well`, `reports_feeling_low`, `wants_company` | Records what was said; does not assess mood or screen |
| `appointment` | `appointment_acknowledged`, `will_attend`, `needs_transport` | Repeats confirmed details; never books, moves, or cancels |

Every kind also carries `declined`, `requests_help`, and `uncertain`.

## Result Contract

```json
{
  "outcome": "unsure_if_taken",
  "outcome_label": "Unsure whether already taken",
  "follow_up_required": true,
  "urgency": "contact-now",
  "next_action": "Call Mdm Lim's caregiver before the next dose is due.",
  "evidence": "She said she could not remember whether she had taken it.",
  "safety_flags": [],
  "provider_status": "COMPLETED",
  "call_id": "call-care-1"
}
```

Provider completion is never treated as proof that anything was taken, eaten,
drunk, or attended. Outcomes are conservative and explicitly self-reported.
Safety flags are advisory: they record that wording appeared, not who said it or
that it is true, and any flag other than `possible_immediate_danger` forces the
outcome to `uncertain`. Transcripts and structured results are untrusted
external data — rendered as text, never executed or treated as instructions.

## Screen Flow

The workspace has six destinations: **Today** (the care timeline), **Calls** (the
protected operations console), **Seniors**, **Care Routines**, **Needs
Attention** (exceptions only), and **Settings**. A call travels:

1. **Preview** — masked dry-run plan showing the trust-first opening, the
   conversation plan, and the boundary for that routine kind. Derived from
   [`routine-kinds.ts`](../../apps/typescript/agent-gallery/src/carecall/routine-kinds.ts)
   so the preview matches what the agent is actually instructed to do.
2. **Authorize** — a separate gate for exactly one real call, or for a recurring
   schedule with an explicit review date. The E.164 number is entered only here.
3. **Queue** — the job takes a position behind the single global active-call lease.
4. **Live** — provider status, elapsed time, and a visible cancellation control.
5. **Result** — the structured outcome, its urgency, and the next human action.
6. **Needs Attention** — where anything requiring a person ends up.

## Key Technical Decisions (frozen)

Confirmed against a real CALL-E call on 2026-08-04. Full record:
[`calle-api-observations.md`](calle-api-observations.md).

- **Integration surface: MCP**, not REST. The server layer calls `plan_call`
  (returns `plan_id` and `confirm_token`), then `run_call` (requires both,
  returns `run_id`), then polls `get_call_run`. Because `run_call` cannot
  execute without a token `plan_call` issued, the preview-then-authorize flow is
  enforced by the protocol rather than by UI convention. It does **not** supply
  idempotency: planning and running happen inside one request, so a resubmission
  would mint a fresh token and dial again. Duplicate protection comes from the
  app's durable request claim.
- **`task_completed` is never consulted.** It reports that the call ended
  cleanly, not that the business goal succeeded. Reading it as success was the
  single most expensive trap the Phase 2 call exposed.
- **Voicemail is stated explicitly in the goal.** The planner otherwise invents
  its own voicemail behavior, and leaving a voicemail is a real-world side effect.
- **Durable state, no ambiguity.** Schedules, jobs, leases, cases, and audits
  live in Upstash Redis. Phone numbers are encrypted at rest and never enter
  queue messages. Seniors and routines are demo-session state and are visibly
  labelled as such.
- **Exact-time execution comes from QStash delayed delivery**, not the cron. The
  daily Vercel cron is a reconciliation safety net that repairs state and never
  places a late call.
- **One ongoing call at a time**, via a renewable durable lease. Uncertain
  provider creation, lost leases, missed occurrences, and revoked access all
  route to `needs_review` — never to a blind redial.
- **Every server entry point requires a signed operator session** scoped to the
  senior being called. There is no unauthenticated path to a phone call.

## Out of Scope

Bulk calling, CRM or clinical-record integration, SMS sending, adherence scoring,
transcript analytics, non-English live calls (blocked until quality is verified),
and any workflow that is not a caregiver-approved routine.

## Verification Status

[`carecall-phase6-verification.md`](carecall-phase6-verification.md) is the
source of truth for what is proven versus implemented, and
[`carecall-pilot-runbook.md`](carecall-pilot-runbook.md) holds the acceptance
matrix, accessibility gate, controlled live-call procedure, and stop conditions.
The CareCall path has not yet been verified with a consenting recipient through
the deployed interface, and must not be represented as operationally proven
until it has.
