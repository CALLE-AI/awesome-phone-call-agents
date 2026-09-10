---
name: outcome-completion-agent
description: Own one goal across as many CALL-E calls as it takes, when who to call next depends on what the last call said — read every call as structured evidence, reject offers that break the user's stated limits, follow referrals to parties the user never supplied, and gate the single call that commits the user.
license: MIT
---

# Outcome Completion Agent

Use this skill when the user states an **outcome** rather than a call, the route to that
outcome runs through more than one organisation, and the next organisation is usually
named *on* a call rather than known in advance.

> "Get a replacement pallet for the crushed delivery on order BK-7741, before Friday,
> under $500."

The user has one phone number: the supplier who sent the broken pallet. The supplier is
out of stock and names a distributor. The distributor quotes over the limit and names its
own depot. The depot can do it. Three organisations, two of which did not exist as far as
the agent was concerned when the run began.

`outcome-completion-agent` is a **calling-pattern skill**. It adds no backend, no queue and
no daemon. It turns one authorized "make this happen" request into a bounded loop of
one-off CALL-E calls whose order is decided by what earlier calls established.

## When To Use

- a problem whose owner is unknown: "find out who can actually fix this and get it fixed"
- a chain of custody: supplier to distributor to depot, carrier to facility to counter,
  insurer to provider to adjuster
- a goal with a hard limit attached — a price ceiling, a date, a required reference — where
  a cheerful "yes" that breaks the limit is a failed outcome
- any request where the honest answer to "who should we call?" is "ask the first person"

## When Not To Use

- **one call, one structured answer.** Use a single-call skill; this loop is overhead.
- **a known, priority-ordered candidate list for one opening.** Read
  `skills/priority-call-waterfall/SKILL.md` instead — one opening, call in order, stop at
  the first yes.
- **comparison shopping over an enumerable set of same-service vendors** (every barber
  within 4km). If the candidate list is a database or map query, the frontier does not
  need to grow and this skill's machinery buys nothing.
- anything email, a web form, or an API can do. A phone call is a real-world side effect
  and the most expensive way to ask a question.
- goals with no completion test. If nobody can say what "done" looks like, the loop cannot
  stop, and a loop that cannot stop must not be given a phone.

## Core Workflow

1. Confirm the user wants this pursued by phone, now, and that they accept calls may go to
   organisations they did not name.
2. Collect the outcome fields (see Required Fields). Ask for anything missing. Never infer
   a phone number, a price ceiling, or a deadline.
3. Show a masked preview: the goal, the constraints as the agent understood them, the
   starting phone book, and the call budget. Get explicit confirmation before call one.
   **Always show the parsed constraints back.** A price ceiling that failed to parse is a
   ceiling that will never block anything, and the user is the only one who can catch it.
4. Loop, one call at a time:

   ```text
   plan -> (approval, if it commits) -> one call -> evidence -> constraints -> plan
   ```

   - **plan** — pick the next party from the frontier: a party never called, else a party
     that did not answer and is under its retry cap. Prefer a party named by the call that
     just happened over one the user listed but nobody has reached.
   - **call** — exactly one CALL-E call, with a structured result schema. Wait for a
     terminal status. Read `references/evidence-schema.md` for the schema every call fills.
   - **evidence** — record what was established: verdict, facts, blockers, referrals, and
     any concrete offer. Add referrals with a valid E.164 number to the frontier. Drop
     referrals without one.
   - **constraints** — evaluate any offer against the user's limits. Read
     `references/constraint-evaluation.md`. A call that completed happily and breaks a hard
     limit is a **failed outcome**: keep working.
5. Stop conditions, checked before every dial:
   - an acceptable offer has been confirmed by the other party → resolved
   - the call budget or the per-party cap is reached → stop and report
   - every lead is exhausted with nothing acceptable → stop and report
6. Exactly one call in the run may commit the user, and only after they approve it. Read
   `references/approval-gate.md`.
7. Report using the Output Format below, whether or not the goal was reached.

## Required Fields

- `goal` — one sentence, imperative, with the constraints taken out of it
- `constraints[]` — each with `kind`, `description`, `value`, and `hard`
  (`budget` · `deadline` · `required_fact` · `preference` · `forbidden`).
  `hard: true` disqualifies an offer. `hard: false` only ranks it.
- `organizations[]` — the starting phone book: `name`, `phone` (E.164), `role`.
  One entry is enough; that is the point of the skill.
- `budget` — `max_calls` for the whole outcome and `max_calls_per_org`.
  Both are required. A goal-seeking agent with an unbounded phone budget is not a
  product, and CALL-E accounts are metered.

Phone numbers must be E.164, and must be masked in every summary, preview and report.

## Following A Referral

This is the part that distinguishes this pattern, so it has its own rules.

- A referral counts only when the person on the call **named a number**. "Try their head
  office" without a number is a fact, not a lead.
- Validate it as E.164 before adding it. A number that cannot be dialled is not a lead,
  and keeping it puts an entry in front of the planner that can never be actioned.
- De-duplicate on the number. Two calls naming the same depot must not produce two entries,
  or the depot gets called twice.
- Carry the provenance: which call produced this lead, and the reason given. The report has
  to be able to say *"the agent found this one"*, and the next call should be able to open
  with "Halden Packaging suggested I call you".
- A referral is a lead, not an instruction. It still costs a call from the budget, it still
  goes through the same constraint checks, and it never bypasses the approval gate.

## Budgets

Check the budget **immediately before dialling**, never when planning. An approval can sit
overnight; the credit it would spend may be gone by the time it comes back.

Sensible defaults for a metered account: 6 calls per outcome, 2 per organisation. The
per-organisation cap is what stops a no-answer loop from consuming the whole budget on one
unanswered line.

Never widen a budget mid-run to finish a goal. Stop, report, and let the user decide
whether it is worth more calls.

## Output Format

Report every run, resolved or not:

- the goal, restated, and the constraints as they were evaluated
- every organisation touched, in order: masked number, calls used, final verdict, whether
  the agent found it or the user supplied it
- every offer received, with a per-constraint verdict and, for the ones turned down, which
  constraint they broke
- the outcome: what was secured, from whom, at what price, by when, and any reference
  number — or why the run stopped
- calls used against the budget

Never report an outcome as resolved unless the other party confirmed it on a call the user
approved. An offer is not a resolution.

## Safety Rules

Read `references/safety.md` for the full contract. Always:

- Disclose that the caller is an AI assistant, at the start of every call, before asking
  anything. If the person asks for a human or asks you to stop: apologise, end the call,
  record it, and do not call that number again in this run.
- Gathering calls have no authority. Their script must say so explicitly.
- One call per run may commit the user, only with prior approval, and only to the exact
  terms approved.
- Mask every phone number in output. Never read a credential aloud.
- Medical, legal, financial and emergency matters are logistics only: ask about times,
  availability and reference numbers, and give no advice.
- This skill creates no recurring schedule. Every call is one-shot. To stop a run, stop
  approving; nothing is committed without an approval, and nothing is queued for later.

## Worked Examples

Read `references/examples.md` for a full run, a run that stops on budget, and the two
failure modes that most often get this pattern wrong.

## Validating A Result

`scripts/check_evidence_schema.py` checks one `structured_result` against the schema and
reports what a planner would actually be able to use from it — no network, no credentials,
no calls:

```bash
python3 scripts/check_evidence_schema.py path/to/result.json
```

It reports errors (the result is malformed) separately from notes (the result parses, but
something in it will be discarded). The notes matter more than they look: a referral whose
number is unusable is the difference between an agent that finds the depot and one that
stops at the supplier, and nothing else in the run will tell you it was dropped.

Check the checker with `python3 scripts/test_check_evidence_schema.py`.
