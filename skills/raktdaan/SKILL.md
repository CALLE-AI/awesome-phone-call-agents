---
name: raktdaan
description: Recall blood donors for a specific component shortage — calling only the people who are eligible and group-compatible today, refusing to count a polite yes, and stopping the moment the need is met. Use when a blood bank is short of a component and has a consented donor register.
license: MIT
---

# raktdaan

Get a shortage of a specific blood component covered by calling as few donors as
possible, and account for everyone who was deliberately not called.

`raktdaan` is Hindi for blood donation.

## The problem this exists for

India does not have an aggregate blood shortage any more. Collection roughly
meets national requirement, and yet 1.74 million components are discarded a
year, with expiry causing 42–51% of it and platelets making up as much as 91.6%
of discarded components. The failure is timing and matching, not volume.

The recall step is where it breaks. A published tele-recruitment programme in
Dehradun placed 62,762 manual calls, reached 43%, and got a "yes" from 75.8% of
answered calls — of which **9.18% actually donated**. Three of every five
in-house donations still came from that programme, so calling works. It is just
that a blood bank cannot tell a real yes from a courteous one, and cannot tell
who was ever able to donate that day in the first place.

Both halves of that are computable from a register the blood bank already holds.
Nobody computes them. That is the whole opportunity.

## What it does

1. **Screens the register before dialling.** Interdonation interval for the
   component asked for, deferral windows, age, weight, last haemoglobin,
   permanent deferrals, consent, opt-out and a per-donor call budget. Unknown
   data suppresses the call: a register gap is not permission.
2. **Widens on compatibility instead of matching exactly.** An A+ red cell
   shortage is servable by A+, A-, O+ and O-. Searching the register for "A+"
   throws away three quarters of the callable pool.
3. **Orders by scarcity.** The least substitutable donor is called last, so an
   O- donor is never rung for an A+ request while any A+, A- or O+ donor is
   still uncalled.
4. **Calls one person at a time and stops when the need is met.** No waves, no
   speculative parallel dialling, no second attempt at somebody who already
   said no.
5. **Refuses to count a hedge.** A confirmation requires a specific arrival
   window. "Yes, I'll try to come" is recorded as unclear, and unclear does not
   fill a unit.
6. **Reports what it did not do.** The headline output is the suppression
   histogram — how many people it left alone, and why.

## When to use it

Use it when a blood bank has a named shortage of a component, and a donor
register those donors consented to be recalled from.

Do not use it to recruit strangers, to run a donation drive, or to find donors
for a named patient's family. It is a recall tool for an existing consented
register, and it is not a substitute for a hospital's own blood requisition
process.

## Inputs

A **request** — the shortage, as the blood bank states it:

| Field | Meaning |
| --- | --- |
| `ref` | The bank's own request id, echoed back in the report |
| `need_group` | One of `O-` `O+` `A-` `A+` `B-` `B+` `AB-` `AB+` |
| `component` | `red_cells`, `platelets`, `plasma` or `whole_blood` |
| `units_needed` | How many units. The run stops here, not later |

A **register** — entries from the blood bank's own records. Every field is
optional except `ref`, `phone` and `group`, and every missing field makes the
donor less callable, never more:

```
ref, phone (E.164), group, sex, date_of_birth, weight_kg, last_hb_g_dl,
last_whole_blood, last_plateletpheresis, plateletpheresis_in_last_year,
deferrals[{reason, started_on, permanent}], consent{recall_consent, opted_out},
language, recent_call_dates[], first_time_donor
```

Register entries hold no name. `ref` is enough to report an outcome back, and a
name in a call plan is a name that can leak into a transcript.

A **policy** — every threshold, overridable. The defaults follow Indian national
guidance (NBTC/DGHS, Schedule F Part XIIB as amended 2020), which differs from
Western guidance and between states. A blood bank running its own SOP overrides
the table rather than forking the skill. See `references/eligibility-policy.md`
for the citation behind each default.

## Outputs

| Field | Meaning |
| --- | --- |
| `filled` | Whether `units_needed` was confirmed |
| `units_confirmed` | Units backed by a specific arrival window |
| `roster_size` → `eligible_count` → `calls_placed` | The funnel, in that order |
| `calls_not_placed` | Suppressed plus eligible-but-never-rung |
| `suppressed_histogram` | Counts per reason code — the headline number |
| `confirmed` / `declined` / `unclear` / `no_answer` | Outcomes, kept separate |
| `never_called` | Eligible donors the run did not need |
| `scarce_spared` | Uncalled donors whose group is more broadly useful than the need |

`unclear` is reported separately from `declined` on purpose. An unclear answer is
not a refusal — the donor stays in the register, uncounted, and is not marked as
having said no.

## The rules

**One call in flight.** Enforced, not advised. The queue is built long and
consumed short.

**Stop at the number.** Once `units_needed` is confirmed, nobody new is called.
A call already connected is allowed to finish — CALL-E has no operation to
cancel an in-flight call, so the design accounts for that rather than pretending
otherwise.

**Fail closed on data.** No last-donation date means no call, unless the register
explicitly says `first_time_donor`. An undated deferral never expires. An
unrecognised deferral reason is honoured indefinitely rather than ignored.

**Fail closed on answers.** Anything that is not a clear commitment is not a
commitment, and it is not a refusal either. Hedges outrank agreement: "yes,
maybe" is unclear. See `references/reading-the-answer.md`.

**Platelets do not widen by default.** Platelet concentrates carry donor plasma
and residual red cells, so compatibility runs both ways at once and Rh matters
for Rh-negative recipients of childbearing age. Widening is a clinical judgement
belonging to the blood bank, so the default is ABO/Rh identical and widening
requires an explicit allowlist.

**Whom to call, never what to transfuse.** No output of this skill is a clinical
statement. Last recorded haemoglobin orders the call list; it never clears
anyone. Screening happens at the centre, on a fresh sample.

## On the call

Every call discloses it is an AI in the opening line, before anything else.

The call asks for one thing: whether the donor can come in, and if so, a specific
arrival window. It reads the window back before ending.

Things the call never does, each for a concrete reason:

- **Never offers compensation.** Paid donation is illegal in India under the
  Drugs & Cosmetics Act. Not money, not vouchers, not reimbursement, not "we'll
  look after you".
- **Never names a patient, and never says anyone will die.** Emotional coercion
  produces a yes that does not arrive, and it burns the register for next time.
  The donor's decision has to survive the phone call ending.
- **Never says the donor is cleared to donate.** It says screening happens at the
  centre.
- **Never presses after an unclear answer.** It asks once more for a window, and
  if that is still unclear it thanks them and ends.
- **Never re-rings someone who declined** for the same request.

An explicit opt-out heard on a call is written back to the register before the
run continues, and it outranks an active shortage.

## Language

CALL-E supports English, Hindi and Tamil for Indian numbers. `language` is a
per-donor field, because a recall call in a language the donor does not speak
comfortably is a call that fails for reasons unrelated to their willingness.

Indian numbers currently route over CALL-E's international lines, which the
platform documents as intended for testing. A production deployment requests a
local Indian line from CALL-E. Until then the caller ID is a foreign number,
which is a real limitation on answer rates and is stated rather than hidden.

## Recall mode

`becoming_eligible_between(register, need_group, component, start, end)` returns
the donors whose blockers lift inside a window — deferral expiring, interdonation
interval completing, an eighteenth birthday arriving.

This is the highest-yield untapped moment in the literature and essentially
nobody acts on it: the register already knows the exact day each deferred donor
becomes donatable again, and no one calls them on it. It costs nothing to
compute and it is the difference between a register that decays and one that
compounds.

## Try it without a CALL-E account

The dialler is injected, so the fixture harness and a live run share one runner.
What the simulation demonstrates is what executes on the phone.

```bash
cd skills/raktdaan/scripts
python3 -m raktdaan.sim.harness
```

Forty synthetic register entries, three shortages, deterministic output. Every
fixture number begins `+910000`, which no Indian mobile number does — Indian
mobiles are ten digits starting 6, 7, 8 or 9 — so nothing in the fixtures can be
dialled by accident.

```
register 40 -> eligible 9 -> called 5
FILLED (2/2 confirmed)
calls deliberately not placed: 35
  interdonation_interval: 12
  deferral_active: 8
  group_incompatible: 6
  deferral_permanent: 2
  ...
scarce donors left uncalled: A-x2, O+x1, O-x1
```

Tests:

```bash
python3 tests/test_compat.py    # compatibility matrices
python3 tests/test_policy.py    # eligibility, fail-closed behaviour
python3 tests/test_order.py     # dispatch, budgets, answer grading
```

## Files

| Path | What it holds |
| --- | --- |
| `scripts/raktdaan/compat.py` | Per-component compatibility and scarcity ordering |
| `scripts/raktdaan/policy.py` | Eligibility gate, deferral arithmetic, recall queries |
| `scripts/raktdaan/order.py` | Queue construction, dispatch, run report |
| `scripts/raktdaan/commitment.py` | Answer grading — the reference implementation |
| `scripts/raktdaan/sim/harness.py` | Fixture mode |
| `references/eligibility-policy.md` | Every threshold and its citation |
| `references/compatibility.md` | The matrices, and why platelets fail closed |
| `references/reading-the-answer.md` | How to grade a reply, and why the bar is a window |
| `references/safety.md` | Legal and ethical constraints, and the reasons |
| `references/examples.md` | Worked runs, and how to read the suppression histogram |
| `references/reference-implementation.md` | Wiring it to CALL-E over MCP or the SDK |

The first four modules in that table are pure functions with no I/O, so the logic
can be read and checked without a network, an account, or trust.
