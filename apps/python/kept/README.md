# kept

**A promise made on a collections call is the only cash-flow asset that never reaches your ledger. `kept` writes it down, then checks whether the money actually arrived.**

`kept` is a Python accounts-receivable agent built on the CALL-E server SDK. It phones the
customers behind overdue B2B invoices, captures what they commit to as a **validated
financial record** — an amount, a calendar date, a method, and the sentence they said —
reconciles that record against the bank feed a week later, and re-calls only the promises
that broke.

The interesting part is not the call. It is everything that decides whether a call happens
at all, and everything that stands between a confident-sounding sentence and a number in
your ledger.

---

## The problem

Business-to-business invoices are not collected by email. They are collected by someone
picking up a phone and asking. That work fails in a specific way:

- A clerk phones, hears *"we'll get it to you next week"*, and writes `called 12/8` in a
  spreadsheet. The amount and the date are gone.
- Nobody checks the following week whether *next week* happened, so a customer who has
  broken four commitments is chased with the same script as one who has never been late.
- Escalation is driven by **days past due**, which is a property of the invoice. The signal
  that actually predicts payment is **whether this customer does what they said**, which
  nobody is recording.

So the outcome that matters — did the promise hold — is never captured, never verified,
and therefore never used.

## What `kept` does

```
overdue invoices ──► who may be called? ──► CALL-E call ──► does this become a record?
                            │                                        │
                     names every refusal                     promise │ dispute │ human
                                                                     │
                        bank feed ──► reconcile ──► kept │ partial │ broken
                                                            │
                                                    escalate only what broke
```

Each stage is a separate, testable decision:

| Stage | Module | What it owns |
| --- | --- | --- |
| Who may be called | `kept/policy.py` | Ten named suppression reasons; ranking; call budget |
| What is said | `kept/calls/scripts.py` | One wording per escalation cycle, plus hard boundaries |
| What comes back | `kept/calls/schema.py` | A closed CALL-E `result_schema` with an `unknown` for every field |
| Whether it counts | `kept/capture.py` | Eleven rejection reasons standing between a sentence and a debt |
| Whether it held | `kept/reconcile.py`, `kept/promises.py` | Payment allocation, then promise status |
| What it is worth | `kept/report.py` | Coverage, keep rate, calls avoided |

---

## Quick start — no calls, no API key

```bash
python -m venv .venv && . .venv/Scripts/activate   # Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"

cp -r examples demo
kept plan --data demo --as-of 2026-08-24T17:00:00Z --budget 3
```

```
CALL PLAN
---------
  calls to place : 3
    dial ***02  INV-1002    Kestrel Logistics         first_contact    USD 4,800.00
    dial ***07  INV-1007    Marlow Ceramics           first_contact    USD 1,500.00
    dial ***01  INV-1001    Bellweather Foods         first_contact    USD 1,250.00
  calls avoided  : 5
    skip INV-1006    no_phone                    No callable number on file.
    skip INV-1004    do_not_call                 Customer is flagged do-not-call.
    skip INV-1005    already_settled             Invoice is paid in full.
    skip INV-1008    quiet_hours                 Local time is outside calling hours in Pacific/Honolulu.
    skip INV-1003    not_yet_due                 Chase opens 2026-08-25.
```

`plan` opens no socket. Eight overdue invoices, three worth a call, and five refusals that
each name themselves. See [`DEMO.md`](DEMO.md) for the full two-week walkthrough.

---

## Simulation runs the real SDK

`kept run --simulate` is not a stubbed `CallPort`. It installs an `httpx.MockTransport`
**underneath the real `calle.CalleClient`**, so the SDK still builds the request body,
attaches the `Idempotency-Key` header, polls `GET /v1/calls/{id}` until the call is
terminal, and maps API errors to `CalleAPIError`. Only the wire is replaced.

```bash
kept run --data demo --scenario demo/scenarios/week1.json --as-of 2026-08-24T17:00:00Z --budget 3
```

That matters for two reasons. Twenty free calls do not survive iterating on a collections
policy, so all development happens here. And because the SDK is genuinely exercised, the
test suite can assert on what CALL-E would actually have received:

```python
post = simulator.posts()[0]
assert post.url.path == "/v1/calls"
assert post.headers["Idempotency-Key"].startswith("kept:INV-")
assert body["result_schema"]["additionalProperties"] is False
```

Scenario files are plain JSON keyed by invoice id, with `+7d` style relative dates so a
fixture stays valid whatever date you replay it on.

---

## The result schema is checked before it costs a call

CALL-E accepts a deliberately narrow subset of JSON Schema. `$ref`, `oneOf`, `anyOf`,
`allOf`, recursive schemas and union types such as `"type": ["string", "null"]` are all
rejected by the API — which is how we learned it, on a live request that came back
`result_schema_invalid`.

Two things came out of that. Optional fields carry the literal string `"unknown"` instead of
a nullable type, so every property stays a plain `string` and `kept/capture.py` normalises
the sentinel back to `None` locally. And `assert_supported()` walks the schema before the
request is built, raising on any unsupported keyword, union type or open object. A schema
mistake now fails in a unit test rather than against your call budget.

---

## How a sentence becomes a debt — or doesn't

This is the part that has to be conservative. A voice model that is fluent and wrong is the
expensive failure in accounts receivable, so **CALL-E's answer alone never creates a
record**. Every condition below is checked locally, in `kept/capture.py`, after the call:

| Rejection | What triggers it |
| --- | --- |
| `result_not_bound` | The result omits, or disagrees with, the call id, recipient, task or metadata that was sent |
| `call_not_completed` | Status is not `completed`, or CALL-E reports `task_completed` as anything but true |
| `missing_structured_result` | Call completed with no structured result |
| `malformed_result` | A required field is absent or off-vocabulary |
| `wrong_party` | `right_party_reached` is not `yes` — a colleague taking a message is neither a commitment nor a dispute |
| `no_commitment` | No amount **and** date were stated and read back |
| `unreadable_amount` | `"most of it"`, `"1,25,000"` — anything not exactly parseable |
| `unreadable_date` | `"next Friday"` survived unresolved |
| `date_in_past` | The agreed date has already gone |
| `date_beyond_horizon` | Further out than `max_promise_horizon_days` |
| `low_confidence` | `completion_confidence.score` below the policy floor |

Everything rejected goes to a human **with the reason named** and the customer's own
sentence attached. Nothing is rounded up into a promise.

Two further rules:

- **Amounts never touch a float.** Every amount is parsed to integer minor units via
  `Decimal`, and ambiguous grouping (`1,25,000`) is refused rather than guessed.
- **Over-promises are clamped.** If someone commits to more than the invoice carries, the
  promise records the invoice balance and the ledger keeps `spoken_amount_minor` beside it.

Try it — three plausible-sounding answers, zero records:

```bash
kept run --data demo --scenario demo/scenarios/vague-answers.json --as-of 2026-08-24T17:00:00Z --budget 3
```
```
  calls placed     : 3
  promises recorded: 0
  disputes recorded: 0
  handed to human  : 3
  call failures    : 0
    no record INV-1002   no_commitment
    no record INV-1007   wrong_party
    no record INV-1001   unreadable_amount
```

---

## Escalation is driven by promise history, not by age

| Cycle | Earned by | How the call changes |
| --- | --- | --- |
| `first_contact` | No prior promise | Confirm the right person, ask what is blocking payment |
| `reminder` | Previous promise kept | Short and appreciative |
| `broken_promise` | One promise broken | States the broken commitment plainly, asks what changed, refuses a vague answer |
| `final_notice` | Two or more broken | Says a colleague will take the account over — and states no other consequence |

Ranking follows the same logic: a customer with a broken promise outranks a larger invoice
that has never been chased.

---

## Reconciliation

Cash arrives as bank lines, not as answers to invoices, so `kept/reconcile.py` matches them
deterministically:

1. A payment whose `reference` names an invoice clears that invoice first.
2. Whatever is left clears that customer's **oldest** unsettled invoices.
3. No unit of a payment is ever allocated twice, and no invoice absorbs more than it is worth.

A promise is then `kept` only if enough cash landed **between the call and the promise date
plus the grace period**. A payment that arrived *before* the conversation cannot prove
follow-through, and the test suite pins that.

`open` → `kept` · `partial` · `broken`, or `superseded` when a later call renegotiates the
same invoice. A superseded promise is excluded from the keep rate: the customer
renegotiated rather than defaulted, and counting it as a break would overstate risk.

---

## Safety and side effects

**This app can cause a real phone to ring about money someone owes.** Everything below is
enforced in code, not documentation.

*Before dialling:*

- `do_not_call` is honoured before anything else is considered.
- In live mode, the exact number must appear in `authorized_recipients.txt`. A run
  confirmation authorises the run; that file authorises the destination. Anyone else is
  suppressed as `recipient_not_authorized`.
- Every number is validated as strict E.164 at load time — a leading `+` is not enough.
- Quiet hours are evaluated in **the customer's own timezone** (`zoneinfo`), not the server's.
- A customer contacted inside `min_days_between_calls` is not contacted again.
- An open dispute permanently removes the invoice from calling and routes it to a human.
- An open promise removes the call entirely — the cheapest call is the one not placed.

*On the call* (encoded in the task text sent to CALL-E, and asserted in tests):

- The agent opens by stating it is an automated assistant and naming the creditor.
- It must **refuse card numbers, CVV codes, bank credentials and one-time passcodes.** Taking
  a payment detail on this call would pull the operator into PCI scope; there is no path in
  this codebase that accepts one.
- No threats of legal action, credit reporting or service suspension.
- No discounts, waivers, settlements or new terms — it may only record what the customer proposes.
- A stated dispute ends the collection attempt immediately.
- A request not to be called again is agreed to and confirmed.
- Voicemail gets the creditor name and a callback number, **never the invoice or the amount**.

*After the call:*

- A result is bound to the call that produced it before it means anything: the call id,
  the recipient, the task and the `invoice_id` / `customer_id` / `cycle` metadata must all
  be present and agree with what was sent; a result that omits any of them is refused.
  The `call_dispatched` record carries a digest of the task, so a call recovered after a
  crash is held to the same proof.
- Phone numbers are masked to their last two digits everywhere they are persisted or
  displayed, including inside provider-derived text — an evidence quote or a failure
  message that contains a number is masked before it is written. The HTML report contains
  no phone number at all, and a test enforces that.
- An ambiguous outcome stops the run. A timeout or a dropped connection leaves it unknown
  whether a phone is ringing, so no further call is started; `kept recover` settles it.
- The ledger is append-only and hash-chained; `kept verify` detects any edited or removed entry.
- Nothing is written to the operator's accounting system. `kept` reads invoices and payments
  and writes only its own ledger.

*Recurring jobs and cancellation:* `kept` has no scheduler and no daemon. Every run is one
command that terminates. There is nothing to cancel between runs, and no state that keeps
dialling on its own. If you schedule it externally (cron, Task Scheduler), removing that
entry is the whole cancellation path. Deleting `ledger.jsonl` resets promise history without
touching your invoices or payments.

---

## Live calling

Live mode is behind **two independent gates**, so neither a stray flag nor a stray
environment variable is enough on its own:

```bash
export CALLE_API_KEY="calle_live_..."      # from dashboard.heycall-e.com/account/api-keys
export KEPT_LIVE_CALLS_ENABLED=true        # gate 1

kept run --data demo/live --budget 1 --live --confirm PLACE-REAL-CALLS   # gate 2
```

- Without the key: refused, with a pointer to `--simulate`.
- Without `KEPT_LIVE_CALLS_ENABLED`: refused.
- Without the exact `--confirm PLACE-REAL-CALLS`: refused.
- Without `authorized_recipients.txt` in the data directory: refused. Numbers absent from
  it are suppressed individually, so one signed-off recipient never authorises the rest.
- `CALLE_BASE_URL` may only name `https://api.heycall-e.com`. The key is never attached to
  a request bound anywhere else.
- `--as-of` is rejected outright with `--live`. A real call is never made against a pretend date.
- `--budget` is the hard ceiling on calls a run may place. `--budget 1` is the recommended
  first live run.

Every request carries
`Idempotency-Key: kept:{invoice_id}:{cycle}:{attempt}:{payload_digest}`, derived from
durable business identity rather than run time. If the process dies between placing a call
and writing the ledger, the next run rebuilds the same key and CALL-E returns the original
call instead of dialling the customer again. There is a test for exactly that. The digest
covers the task, recipient, region, locale and schema, so a reused key can only ever return
a call placed with exactly the instructions being asked for now; `run_id` is excluded from
it because a key that changed every run would stop deduplicating the crash it exists for.

Use numbers you own. The bundled samples use the NANP fictional `555-01XX` block (`+1 202 555 01XX`).

---

## What live verification changed

Simulation proves the pipeline. It cannot prove the conversation. Verification calls to a
number we own and authorised surfaced six failure modes no mock would have produced. Each
is now a rule in `kept/calls/scripts.py` with a test in `tests/test_scripts.py`, and each
is reproduced below as a generalised case rather than a transcript:

| Failure mode | Fix |
| --- | --- |
| An invoice reference was read aloud with its punctuation and casing narrated, so the recipient could not match it to their copy | `spoken_reference()` renders `INV-1001` as `I N V one zero zero one`, the way it is read off a document |
| An `en-IN` call switched language mid-sentence to say it had not understood | The task text names the language explicitly and forbids switching, even to apologise |
| A vague quantity offered in place of a figure was acknowledged as though it were an amount | A vague amount is named as not-an-amount and the agent may not move on to the date without an exact figure |
| A call closed having agreed a date with no amount attached | A date alone is stated to be no commitment |
| A read-back contained an amount and a date the customer had never stated, presented for confirmation | A read-back may contain only values the customer stated |
| Asked what the date was, the agent said it could not access it — with the date in its own prompt | The date is stated up front and the agent is told it knows it |

The first four are confirmed fixed on a later verification call. The last two are fixed and
tested but not yet re-verified on the wire.

Two of our own bugs surfaced the same way:

- **A crash between `POST /v1/calls` and the first poll left a dialled customer with no
  ledger record at all.** Placing a call is now two steps — `dispatch()` writes
  `call_dispatched` with the call id *before* polling begins, and `kept recover` finishes
  any call that was dialled but never collected. It reads the outcome; it never re-dials.
- **The idempotency `attempt` counter derived from `call_placed` events**, so a call that
  was dispatched but never completed regenerated a key CALL-E had already spent, and the
  API rejected it. `keys_consumed()` now counts a key as burned the moment CALL-E accepts
  it. Over-counting skips a number; under-counting reuses a spent one — so it over-counts.

---

## Data files

`--data` points at one directory:

| File | Owner | Purpose |
| --- | --- | --- |
| `customers.csv` | you | `id,name,phones,region,locale,timezone,do_not_call` (phones `\|`-separated, E.164) |
| `invoices.csv` | you | `id,customer_id,currency,amount,due_date` |
| `payments/*.csv` | you | Bank feeds: `id,customer_id,amount,value_date,reference`. Drop a new file in; all are read |
| `organisation.json` | you | Creditor name and E.164 callback number, read out on every call |
| `policy.json` | you | Grace days, quiet hours, contact frequency, confidence floor, call budget |
| `authorized_recipients.txt` | you | One E.164 number per line. Required for `--live`; anyone absent is suppressed |
| `ledger.jsonl` | `kept` | Append-only, hash-chained. Promises, disputes and contact history replay from here |

There is no second copy of state. Promises, disputes and contact history are rebuilt from
the ledger on every run, so the report can never disagree with the audit trail.

## Commands

| Command | Network | What it does |
| --- | --- | --- |
| `kept plan` | none | Who would be called today, and why everyone else was not |
| `kept run --simulate --scenario F` | none | Full pipeline through the real SDK against scripted answers |
| `kept run --live --confirm …` | CALL-E | Places real calls, subject to both gates and the budget |
| `kept report [--html F]` | none | Promise ledger, coverage, keep rate, calls avoided |
| `kept verify` | none | Re-hashes the ledger chain and reports any tampering |
| `kept recover` | CALL-E | Collects outcomes for calls that were dialled but never recorded |
| `kept doctor` | CALL-E | Checks the API key and both live gates without placing a call |

`kept doctor` authenticates by requesting a call id that cannot exist. A `not_found` answer
proves the key is good; a `401` proves it is not. Neither spends a call.

## Tests

```bash
pytest
```

159 tests, no network, no credentials. They cover money parsing, allocation invariants
(no payment spent twice), every promise transition, every suppression reason, every capture
rejection, ledger tamper detection, both live gates, crash recovery mid-poll, the
`result_schema` pre-flight check, the spoken form of every identifier, and end-to-end runs
asserting on the bytes the CALL-E SDK actually put on the wire.

## Requirements

Python 3.11+ · `calle-ai>=0.7.0` · `httpx` · `tzdata` on Windows. Nothing else.

## What this is not

- Not consumer debt collection. The scripts, tone and escalation ladder are written for
  business-to-business receivables; consumer collections carry statutory requirements this
  codebase does not implement.
- Not a payment processor. It never accepts, stores or transmits a payment instrument.
- Not a bookkeeping system. It reads your invoices and payments; it writes only its own ledger.
- Not a dialler. It is a decision engine that occasionally concludes a call is warranted, and
  far more often concludes one is not.

## License

MIT. See [`LICENSE`](LICENSE).
