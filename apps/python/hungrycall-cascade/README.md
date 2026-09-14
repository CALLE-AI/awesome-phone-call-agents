# Sequential call cascade

Phone several candidates in order until one meets every condition — and stop there.

A single call has one target. This is a search: candidates that must first be ordered,
criteria that are only settled during the conversation, a verdict per call, and a state
that carries across calls — who was asked, and what it failed on.

The example is dinner. The pattern is not: a dentist appointment within 30 km, a tradesman
with a free slot, a spare part in stock, a garage with capacity. Same mechanism, different
subject.

## The four kinds of condition

| Kind | Meaning | Example |
| --- | --- | --- |
| `must` | without it there is no deal | delivers tonight |
| `boundary` | up to here and no further | 45 euros at most, all in |
| `concession` | available, but staged | collect it ourselves — but not offered first |
| `wish` | improves the ranking, blocks nothing | preferably above four stars |

**A concession is an authorisation, not a hint.** The caller may only spend what the user
handed over, and only in the order the user set. A result that used a tier nobody granted
is rejected — exactly like an offer above the boundary. An agent that bought the table with
money it was never given exceeded its mandate, and its yes does not count.

That is why concessions are checked *after* the call rather than trusted before it, and why
the run reports which tier was played.

## Setup

Python 3.11 or newer. No dependencies.

```bash
cd apps/python/hungrycall-cascade
python cascade.py --fixture example-restaurants.json
```

## What it prints

```text
FIXTURE RUN -- SIMULATED, NO CALL PLACED
No network, no telephone, no credentials. Responses come from the fixture file.

Subject: Dinner for two, delivered tonight

1. Trattoria Verde  +15*******11  ->  declined
     - candidate declined
     - intent key: 51d7151ac5a78e35
2. Golden Wok  +15*******22  ->  rejected_boundary_exceeded
     - Total price: 52.0 exceeds the limit of 45.0
     - intent key: 9f9ebc40b61835ed
3. Pizzeria Nord  +15*******33  ->  accepted
     - Delivers tonight: met
     - At least one vegetarian main: met
     - Total price: 41.0 within 45.0
     - Rated above four stars: not met (wish)
     - concessions played: pickup_ok
     - intent key: 52b03a8ce3990f4c
4. Curry Haus  +15*******44  ->  not_called

Closed by: Pizzeria Nord. Remaining candidates were not called.
```

Four lines, four different things: a refusal, a yes that broke the budget, a match that
needed the first concession tier, and a candidate that was never called because the search
was already answered. `--json` emits the same result as structured output.

## Safety

- **No calls.** There is no live transport and no `--live` flag in this edition. It cannot
  dial even if configured to. Every response comes from the fixture file.
- **No credentials.** No account, no API key, no network request of any kind.
- **No scheduler, no retry.** One pass, in order. Nothing runs later or repeats by itself.
- **Numbers are validated as E.164 before processing** and masked in every output path —
  report, structured result and error message alike. A test asserts that no full number
  appears anywhere in either.
- **Fictional data only.** The fixture uses the `+1 555-0100…555-0199` range, reserved for
  fiction and belonging to nobody.
- **Cancellation.** Stopping the process stops it before the next candidate. Nothing was
  dispatched, so nothing needs recalling.

## Deliberate limits

- **An unknown outcome halts the cascade** instead of being read as a refusal, an
  acceptance or an unreachable line. The next call would otherwise be built on a guess, and
  a cascade that guesses spends the user's remaining candidates on a mistake.
- **`no_answer` and `declined` stay apart.** They mean different things for a follow-up.
- **The idempotency key binds the canonical intent** — subject, candidate, every criterion,
  every granted concession — not a time window. A key derived from a time window collides
  whenever two different intents share a minute, and differs whenever the same intent is
  retried a minute later.
- **Candidates that were not called carry no verdict**, not even a favourable one. The
  regression test uses a candidate that *would* have been rejected to prove the run did not
  quietly evaluate it.
- Not for medical, legal, financial or emergency workflows.

## Tests

```bash
cd apps/python/hungrycall-cascade
python -m pytest -q
```

```text
........................                                                 [100%]
24 passed in 0.17s
```

The regressions guard the ways the search could go wrong: stopping at the first match,
refusing an unauthorised concession, refusing a later tier played before an earlier one,
the hard boundary, an unknown status halting the run, remaining candidates staying
untouched, and no full number reaching any output.

## The full application

This is a focused, self-contained proof of the orchestration. The complete application —
restaurant lookup, a second branch for table reservations, ordering chains, web interface
and the live CALL-E transport — lives at <https://github.com/ellmos-ai/hungrycall>. It has
since been field-tested twice against the real CALL-E service (2026-08-11 and 2026-08-22),
each call played out live by a human on the other end of the phone; its README carries a
"How We Tested" section describing what was run, what broke, and what got fixed, and its
test suite currently stands at 407 passing.
