# QuoteRunner

Build a vetted call list before anyone dials.

Every call app in this repository starts from a list somebody already had — a
fixture, a CSV, a study file, a hand-written plan. None of them answer the
question that comes first: **who should I even call?**

QuoteRunner answers it. Give it a job and a set of candidates; it returns the
ones that publish a number, are open right now, and can be reached — each with
the calling window taken from their published opening hours rather than
configured by hand.

The example is a windscreen quote. The pattern is not: three plumbers with a
free slot this week, five suppliers who stock the part, the clinics within
range that are open on a Saturday. Same mechanism, different subject.

## Setup

Python 3.11 or newer. No dependencies.

```bash
cd apps/python/quoterunner
python quoterunner.py --fixture example-candidates.json
```

## What it prints

```text
FIXTURE RUN -- NO CALL PLACED
No transport, no telephone, no credentials. This edition cannot dial.

Job: Replace the windscreen on a 2019 Honda Civic
Callable now: 4    Excluded: 3

1. Northgate Auto Glass  +15****00
     open today: 08:00-18:00
2. Riverside Motors  +15****01
     open today: 07:30-19:00
3. Halloran & Sons Bodyshop  +15****02
     open today: 09:00-13:00, 15:00-19:00
4. Quickfit Windscreens  +15****03
     open today: 00:00-23:59

Not called:
   - Bellweather Garage  +15****04  ->  closed today
   - Corner Tyre & Glass  +15****05  ->  no published opening hours -- we do not call blind
   - Old Forge Repairs  555**06  ->  Not a valid E.164 number: 555**06
```

Three exclusions, three different reasons: a business whose opening hours do not
cover today, one that publishes no hours at all, and one whose number is local
rather than E.164. `--json` emits the same result as structured output, with a
ready-to-use script per call.

## Why opening hours are the interesting part

`opening_hours` is an ordinary OpenStreetMap tag. Treated as decoration it tells
you when a shop is open. Treated as a control it decides whether a call may be
placed at all — and it is already published, for millions of businesses, in a
machine-readable format nobody has to fill in.

That matters here because it removes a manual step from the safety layer.
[`consent-gate`](../consent-gate/) requires the caller to supply "a recipient
timezone and permitted calling window" in the plan. QuoteRunner derives that
window from open data instead. The two compose: QuoteRunner decides who is
callable and when; ConsentGate decides whether this particular call is
permitted. This app does not duplicate its consent, do-not-call or idempotency
machinery, and is not a substitute for it.

## Safety

- **No calls.** There is no live transport and no `--live` flag in this
  edition. It cannot dial even if configured to.
- **No credentials.** No account, no API key, no network request of any kind.
- **No scheduler, no retry.** One pass. Nothing runs later or repeats by itself.
- **Numbers are validated as E.164 before processing** and masked in every
  output path — report, JSON and error message alike. A test asserts that no
  full number from the fixture appears in any of them.
- **A local or ambiguous number is rejected, never reformatted.** Guessing a
  country code is how you call a stranger in another country.
- **Fictional data only.** The fixture uses the `+1 555-0100..555-0199` range,
  reserved for fiction and belonging to nobody.
- **Cancellation.** Stopping the process stops it. Nothing was dispatched, so
  nothing needs recalling.
- Not for medical, legal, financial or emergency workflows.

## Deliberate limits

- **Opening hours that cannot be parsed read as closed**, not open. An
  optimistic parse here calls a real person at an hour nobody agreed to. A test
  covers the unparseable case explicitly.
- **A business with no published hours is excluded**, even when it publishes a
  number. Reachable is not the same as callable.
- **Exclusions are output, not a silent filter.** Every excluded candidate is
  listed with its reason. A run that quietly dropped half its candidates looks
  identical to one that found nothing worth calling, and the difference matters
  to whoever reads the result.
- **Twelve candidates per run, and the cap is not a flag.** A limit the caller
  can raise mid-run is not a limit. The overflow is reported, not dropped.
- **The script forbids the agent from agreeing to anything.** It gathers
  answers. Booking, buying and negotiating are out of scope by construction, and
  it must say plainly that it is an AI if asked.

## Tests

```bash
cd apps/python/quoterunner
python -m unittest test_quoterunner -v
```

```text
Ran 34 tests in 0.005s
OK
```

The regressions guard the ways a call list goes wrong: a weekday range that
does not include today, a split-hours gap at lunchtime, hours that cannot be
parsed, a missing `opening_hours` value, a local number that must not be
reformatted into a different country, the per-run cap, every candidate landing
in exactly one bucket, and no full number reaching the report, the JSON or an
error string.
