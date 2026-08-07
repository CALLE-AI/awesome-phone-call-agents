# QuoteRunner

Find out who is worth calling, call them, and put the answers in one table.

Every call app in this repository starts from a list somebody already had — a
fixture, a CSV, a study file, a hand-written plan. None of them answer the
question that comes first: **who should I even call?**

QuoteRunner answers it, then acts on the answer. Give it a job and a set of
candidates; it keeps the ones that publish a number, are open right now, and can
be reached — each with the calling window taken from their published opening
hours rather than configured by hand — calls them through CALL-E with a typed
`result_schema`, and sorts what they said by price.

The example is a windscreen quote. The pattern is not: three plumbers with a
free slot this week, five suppliers who stock the part, the clinics within range
that are open on a Saturday. Same mechanism, different subject.

## Setup

Python 3.11 or newer.

```bash
cd apps/python/quoterunner
python quoterunner.py --fixture example-candidates.json
```

That runs the preview, which needs no dependencies and no credentials. Only
`--execute` needs the SDK:

```bash
pip install calle-ai
```

## Three modes, and only one of them dials

| | places calls | needs credentials | what it is for |
|---|---|---|---|
| preview *(default)* | no | no | see who would be called, and why the rest would not |
| `--simulate` | no | no | the whole pipeline against canned answers |
| `--execute` | **yes** | yes | the real thing |

### Preview

```text
PREVIEW -- NO CALL PLACED
Nothing was dialed. No credentials were read and no request was sent.

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

Read that list. If it is who you meant to call:

    --simulate                    see the comparison, no calls
    --execute --confirm cd284eb519d6   place the calls
```

Three exclusions, three different reasons: a business whose opening hours do not
cover today, one that publishes no hours at all, and one whose number is local
rather than E.164.

### Simulate

```bash
python quoterunner.py --fixture example-candidates.json --simulate
```

```text
SIMULATED -- no call was placed

Job: Replace the windscreen on a 2019 Honda Civic

       price  available    warranty   business
------------  ------------ ---------- ----------------------------
  199.50 USD  2026-08-14   6 mo       Riverside Motors
     245 USD  2026-08-11   12 mo      Northgate Auto Glass
 280-320 USD  2026-08-10   24 mo      Halloran & Sons Bodyshop

Cheapest: Riverside Motors

Answered, no price given:
   - Quickfit Windscreens  ->  Service manager was out; asked to be called back tomorrow morning.
```

That is the output the whole app exists to produce. `--simulate` runs the real
code path — create, wait, validate against the schema, sanitise, compare — with
the transport swapped for canned answers, so the pipeline is demonstrable and
testable without a telephone.

### Execute

```bash
export CALLE_LIVE_CALLS_ENABLED=true
export CALLE_API_KEY=...
python quoterunner.py --fixture example-candidates.json \
    --execute --confirm cd284eb519d6
```

**This dials real businesses.** Four independent gates stand in front of it, and
any one of them alone stops the call:

1. `CALLE_LIVE_CALLS_ENABLED=true` in the environment
2. `CALLE_API_KEY` in the environment
3. `--confirm <token>` — a token bound to this exact candidate list
4. every candidate is re-checked against its opening hours **at dial time**

## The confirmation token

Gate 3 is the one worth explaining.

The token is a hash of the job plus the sorted list of numbers. A token you got
by reviewing one list will not authorise a different list. Re-run the plan an
hour later, get different candidates because a shop closed, and the old token
stops working:

```text
The confirmation token does not match this batch.
That happens when the candidate list changed after you reviewed it -- a shop
closed, the search returned something else. Review the plan again.
Token for the batch above: 7f2a91c04e13
```

A confirmation that survives a change in what it confirms is not a
confirmation. This is the same gap we reported through the hackathon's feedback
form: `call start` has no machine-enforced confirmation, so the only thing
between an agent and a live call is a sentence in a markdown file that a model
is free to skip. A hash the operator has to paste back cannot be skipped by a
model that is feeling confident.

## What comes back

`result_schema` asks for nine fields, every one of them a string with an
explicit `unknown`, including the price. A receptionist who says *"depends on
the glass, call back Tuesday"* is a normal outcome, not an error — and a numeric
price field would force the model to invent a number to satisfy the type.

`does_this_job`, `quoted_price`, `currency`, `price_covers`, `earliest_date`,
`job_duration`, `warranty_months`, `callback_required`, `evidence_summary`.

Answers are constrained before they are stored. The narrow fields have to match
their shape — an ISO date, digits, a three-letter currency — or they become
`unknown`. The two free-text fields are redacted for numbers and emails, because
`evidence_summary` is model-written prose repeating what a person said out loud,
and it can contain whatever they read out.

Sorting is by the low end of the price, and quotes in different currencies are
**not** ranked against each other. Converting them here would invent an exchange
rate nobody quoted.

## Relationship to consent-gate

[`consent-gate`](../consent-gate/) requires the caller to supply *"a recipient
timezone and permitted calling window"* in the plan. QuoteRunner derives that
window from open data instead. The two compose: QuoteRunner decides who is
callable and when; ConsentGate decides whether this particular call is
permitted. This app does not duplicate its consent, do-not-call or idempotency
machinery, and is not a substitute for it.

## Safety

- **Preview is the default.** Nothing dials unless `--execute` is passed and all
  four gates open.
- **Numbers are validated as E.164 before processing** and masked in every
  output path — report, JSON and error message alike. A test asserts that no
  full number from the fixture appears in any of them.
- **A local or ambiguous number is rejected, never reformatted.** Guessing a
  country code is how you call a stranger in another country.
- **One call per business per job.** The idempotency key is derived from the
  number and the job, not from a timestamp, so re-running the same batch
  collapses into the same call rather than dialling twice.
- **Nothing is redialled automatically.** Busy, no answer and voicemail are
  recorded and left alone. A redial the operator did not ask for is a second
  call to a real business.
- **Calls go out one at a time.** Twelve simultaneous calls from one number is
  what an autodialer looks like from the receiving end.
- **The base URL is pinned** to the official origin, or an explicit loopback
  address for a fake server in tests. A base URL read from the environment is a
  place where a live call can be silently redirected.
- **The script forbids the agent from agreeing to anything.** It gathers
  answers. Booking, buying and negotiating are out of scope by construction, and
  it must say plainly that it is an AI if asked.
- **Fictional data only in the fixture.** The `+1 555-0100..555-0199` range is
  reserved for fiction and belongs to nobody.
- **Cancellation.** Stopping the process stops it. Calls already placed are
  listed with their call id; nothing is scheduled to run later.
- Not for medical, legal, financial or emergency workflows.

## Deliberate limits

- **Opening hours that cannot be parsed read as closed**, not open. An
  optimistic parse here calls a real person at an hour nobody agreed to.
- **A business with no published hours is excluded**, even when it publishes a
  number. Reachable is not the same as callable.
- **Exclusions are output, not a silent filter.** A run that quietly dropped
  half its candidates looks identical to one that found nothing worth calling,
  and the difference matters to whoever reads the result.
- **Twelve candidates per run, and the cap is not a flag.** A limit the caller
  can raise mid-run is not a limit. The overflow is reported, not dropped.
- **A create that returns no call id is never retried.** The call may be live
  and there is nothing to reconcile it by, so it is recorded loudly instead.
- **An unparseable price does not become zero.** It sorts last as "no price
  given", rather than winning the comparison.

## Tests

```bash
cd apps/python/quoterunner
python -m unittest discover -p "test_*.py"
```

```text
Ran 91 tests in 0.011s
OK
```

No test places a call or reads a credential. The CallsAPI is a fake, which is
the point: the gates that stop a real call have to be testable without placing
one.

`test_quoterunner.py` covers the screening layer — a weekday range that does not
include today, a split-hours gap at lunchtime, hours that cannot be parsed, a
missing `opening_hours` value, a local number that must not be reformatted into
a different country, the per-run cap, every candidate landing in exactly one
bucket, and no full number reaching the report, the JSON or an error string.

`test_execution.py` covers the calling layer — each of the four gates
independently, a base URL pointing at somebody else's host, a shop that closed
between planning and dialling, a create that raises, a create with no id, a lost
result, a no-answer that must not be redialled, a result that does not match the
schema, a phone number smuggled into a date field, and a price range ranked on
its low end.
