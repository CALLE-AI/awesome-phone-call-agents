# Examples

Worked runs of `raktdaan`, end to end. Every phone number here begins `+910000`.
Indian mobile numbers are ten digits beginning 6, 7, 8 or 9, so nothing in these
examples is a dialable number — the safety property is checkable by looking at
it. No real donor record, number or transcript appears anywhere in this skill.

## Fixture run — no CALL-E account, no credits, no calls

The dialler is injected, so the fixture harness and a live run execute the same
runner. What the simulation shows is what happens on the phone.

```bash
cd skills/raktdaan/scripts
python3 -m raktdaan.sim.harness
```

Forty synthetic register entries, three shortages, deterministic output:

```text
register: 40 entries, as of 2026-09-03

=== 2 units A+ red cells ===
  call order: RD-1001 -> RD-1002 -> RD-1008 -> RD-1006 -> RD-1007 -> RD-1003
              -> RD-1004 -> RD-1009 -> RD-1005
  dialled RD-1001: CONFIRMED (agreement with window: i can come)
  dialled RD-1002: UNCLEAR (agreement without a specific arrival window: yes)
  dialled RD-1008: DECLINED (opt-out: remove me)
  dialled RD-1006: DECLINED (decline: out of town)
  dialled RD-1007: CONFIRMED (agreement with window: ok)
request REQ-A: 2 unit(s) A+ red_cells
  register 40 -> eligible 9 -> called 5
  FILLED (2/2 confirmed)
  calls deliberately not placed: 35
    interdonation_interval: 12
    deferral_active: 8
    group_incompatible: 6
    deferral_permanent: 2
    no_consent: 1
    opted_out: 1
    unknown_weight: 1
    unknown_last_donation: 1
    fatigue_budget: 1
  scarce donors left uncalled: A-x2, O+x1, O-x1
```

## How to read that output

Five lines of it are the whole argument for the skill.

**`register 40 -> eligible 9 -> called 5`.** Thirty-one of forty were never
callable today. A blood bank that queries its register for "A+" and dials the
result places thirty-one calls that could not have produced a unit.

**`RD-1002: UNCLEAR (agreement without a specific arrival window: yes)`.** This
donor said yes. A yes/no caller books them and staffs for them. Here the yes is
recorded, the donor stays in the register unmarked, and the cascade moves on —
because a yes without a clock time converts at roughly the published 9.18%.

**`RD-1008: DECLINED (opt-out: remove me)`.** The opt-out is written back to the
register before the next dispatch, not at the end of the run. It outranks the
active shortage permanently.

**`calls deliberately not placed: 35`** with a reason for each. Not one silent
skip — a suppression with no reason code is indistinguishable from a bug.

**`scarce donors left uncalled: A-x2, O+x1, O-x1`.** An O- donor was in the
eligible pool and was deliberately called last. Their unit is the only thing
that can cover an O- need; spending it on an A+ shortage that three other groups
could serve is how a bank ends up short on the group with no substitute.

## One request, in code

```python
from datetime import date
from raktdaan import compat, order
from raktdaan.policy import Policy

request = order.Request(
    ref="REQ-2026-0914",
    need_group="A+",
    component=compat.RED_CELLS,
    units_needed=2,
)

plan = order.build_plan(register, request, date.today(), Policy())
print(plan.eligible_count, plan.histogram)

report = order.run(plan, dial, max_calls=12)   # dial: see reference-implementation.md
for line in report.summary_lines():
    print(line)
```

`build_plan` screens and orders but places nothing. Inspect `plan.queue` and
`plan.histogram` before `run` — the plan is the reviewable artefact.

## Platelets: the same request, before and after the bank widens it

Platelets default to ABO/Rh identical, because compatibility runs in both
directions at once. Widening is the blood bank's clinical judgement, so it is an
explicit allowlist rather than a default:

```text
=== 1 unit B+ plateletpheresis (identical only) ===
  register 40 -> eligible 2 -> called 1
    group_incompatible: 38

=== 1 unit B+ plateletpheresis (bank allows B- and O+) ===
  register 40 -> eligible 6 -> called 1
    group_incompatible: 29
```

```python
Policy(platelet_allowlist={"B+": frozenset({"B+", "B-", "O+"})})
```

The allowlist is additive to identical and keyed per need group, so a bank can
widen B+ without widening anything else. Identical donors are still spent first.

## Recall mode — the query nobody runs

```python
from raktdaan.policy import becoming_eligible_between

soon = becoming_eligible_between(
    register, "A+", compat.RED_CELLS,
    start=date(2026, 9, 3), end=date(2026, 10, 3),
)
```

```text
=== donors becoming eligible in the next 30 days ===
  RD-1017: eligible 2026-09-04 (currently interdonation_interval)
  RD-1021: eligible 2026-09-04 (currently interdonation_interval)
  RD-1013: eligible 2026-09-05 (currently interdonation_interval)
  RD-1028: eligible 2026-09-14 (currently deferral_active)
  RD-1014: eligible 2026-09-23 (currently interdonation_interval)
  RD-1018: eligible 2026-09-23 (currently interdonation_interval)
  RD-1011: eligible 2026-10-02 (currently interdonation_interval)
  7 donors nobody is currently planning to call
```

The register already knows the exact day each deferred donor becomes donatable
again. Computing it costs nothing. It is the difference between a register that
decays and one that compounds.

## Grading replies

The bar is a clock time, not agreement. Full rules and the precedence order are
in `references/reading-the-answer.md`.

```python
from raktdaan import commitment

commitment.grade("Yes, I can come 10 to 12 tomorrow")   # ('confirmed', ...)
commitment.grade("haan, 4 baje aa jaunga")              # ('confirmed', ...)
commitment.grade("Yes of course, I'll come this week")  # ('unclear', ...)
commitment.grade("Sure sure, koshish karunga")          # ('unclear', ...)
commitment.grade("it is 4 pm here")                     # ('unclear', ...)
commitment.grade("No, I'm travelling")                  # ('declined', ...)
commitment.grade(None, answered=False)                  # ('no_answer', ...)

commitment.wants_opt_out("please remove me from your list")   # True
```

The second return value is the deciding phrase, so a graded outcome can always be
explained back to the blood bank.

## Tests

```bash
cd skills/raktdaan/scripts
python3 tests/test_compat.py    # compatibility matrices, scarcity ordering
python3 tests/test_policy.py    # eligibility gate, fail-closed behaviour
python3 tests/test_order.py     # dispatch, budgets, answer grading
```

Each file runs standalone on the standard library and exits nonzero on failure.
The behaviours they lock down are the refusals: stop the instant the need is met,
never count a hedge, never exceed the call budget, never call the scarce donor
first, never credit an outcome to a donor that was not dialled.

## Placing real calls

See `references/reference-implementation.md` for the CALL-E wiring — the
`plan_call` → `run_call` → `get_call_run` sequence, what the MCP path does and
does not return, and the adapter that turns a transcript into a `CallOutcome`.
Read `references/safety.md` first; every constraint there has a reason attached,
and the reasons are the part that stops them being relaxed later.
