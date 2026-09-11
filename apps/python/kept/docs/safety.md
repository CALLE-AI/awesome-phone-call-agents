# Safety model

`kept` places outbound calls to people about money they owe. That is a real-world side
effect with legal, financial and reputational consequences, so each requirement below names
the code that enforces it and the test that pins it.

## Explicit user intent

No call is placed without a human running a command that says so.

- `kept plan` and `kept report` open no socket at all.
- `kept run` defaults to `--simulate`, which requires an explicit `--scenario` file. Omitting
  it is an error rather than a silent no-op (`test_simulate_without_a_scenario_is_an_error_not_a_silent_no_op`).
- `kept run --live` requires **two independent gates**: the environment variable
  `KEPT_LIVE_CALLS_ENABLED=true` **and** the typed flag `--confirm PLACE-REAL-CALLS`.
  Either one alone is refused (`kept/cli.py::_guard_live`, `tests/test_cli.py`).
- `--budget N` is a hard ceiling on how many calls a single run may place. It is applied
  last, after every policy rule, so an exhausted budget always means capacity ran out rather
  than a rule fired.
- `--as-of` cannot be combined with `--live`. A real call is never placed against a
  simulated date.

## Who is never called

`kept/policy.py` refuses before it selects, and every refusal is written to the ledger with
a reason. Ten reasons exist and each has a test in `tests/test_policy.py`:

| Reason | Meaning |
| --- | --- |
| `do_not_call` | Customer flagged. Checked before anything else that could override it |
| `no_phone` | No callable number on file |
| `recipient_not_authorized` | The exact number is absent from `authorized_recipients.txt` in a live run |
| `dispute_open` | The customer contested the invoice on a previous call. Permanently human-owned |
| `promise_open` | A live commitment already covers the invoice |
| `already_settled` | The payments feed cleared it |
| `not_yet_due` | Still inside the post-due grace period |
| `quiet_hours` | Outside calling hours **in the customer's own timezone**, via `zoneinfo` |
| `contact_frequency_exceeded` | Contacted within `min_days_between_calls` |
| `call_budget_exhausted` | The run's call ceiling was reached |

## E.164 phone numbers

`Customer.__post_init__` rejects at load time anything that is not strict E.164 — `+`
followed by 7 to 15 digits and nothing else, so spaces, dashes, extensions and a missing
country code are all refused rather than handed to the provider as a destination it might
still try to route. `Organisation.callback_number` is held to the same rule because it is
read out to strangers. Error messages mask the offending number. Region and locale are
carried per customer and passed to CALL-E as `recipients[0].region` / `.locale`.

## Recipient authorization

A live run reads `authorized_recipients.txt` from its data directory and suppresses every
customer whose exact number is absent, with the reason `recipient_not_authorized`. A
missing, empty or malformed file refuses the run outright. `--confirm PLACE-REAL-CALLS`
authorises the run; this file authorises the destination, and adding a row to
`customers.csv` is deliberately not enough to make a phone ring.

Sample data uses the NANP fictional `555-01XX` block (`+1 202 555 01XX`) only.

## Masking

Phone numbers are reduced to `***` plus the last two digits (`kept/models.py::mask_phone`)
everywhere they leave the input files:

- the terminal call plan and run summary,
- the `call_placed` ledger entry,
- error messages raised during load,
- provider-derived free text — evidence quotes, dispute reasons, transcripts, summaries and
  failure messages are passed through `redact_phone_like` before they are persisted or
  rendered, so a number spoken on a call never reaches the ledger or the report.

The HTML report contains **no phone number in any form**, enforced by
`test_report_never_prints_a_phone_number`.

## Credential handling

- The API key is read from `CALLE_API_KEY` at the moment a live port is constructed, and is
  held only by the `httpx.Client` the SDK owns.
- It is never logged, never written to the ledger, and never included in a report.
- `.env.example` ships placeholders; `.env` is git-ignored.
- Missing credentials produce a refusal that points at `--simulate`, not a stack trace.
- `CALLE_BASE_URL` may only name `https://api.heycall-e.com`. Any other value raises
  `UntrustedBaseUrlError` before the key is attached to a request, so one environment
  variable cannot redirect a production credential to a host of someone else's choosing.
  The simulator uses its own transport and never passes through credential loading.

## No hidden schedules, no duplicate jobs

`kept` has **no scheduler, no daemon and no background thread**. Each command runs once and
exits. There is no state that continues dialling.

Duplicate calls are prevented by a business-derived idempotency key:

```
Idempotency-Key: kept:{invoice_id}:{cycle}:{attempt}:{payload_digest}
```

`attempt` is the number of calls the ledger already records for that invoice, so the key is
stable across retries, restarts and crashes. If the process dies between placing a call and
writing the ledger, the next run rebuilds the *same* key and CALL-E returns the original
call rather than dialling again. Pinned by
`test_replaying_a_run_after_a_lost_ledger_write_does_not_dial_again`.

## Ambiguous outcomes stop the run

A rejected request is a fact; a timeout or a dropped connection is not. Either leaves it
unknown whether a phone is ringing, so `CallPlacementError.is_ambiguous` is true for both
and the run stops where it stands rather than starting another call on top of one nobody
can account for. The ledger records the failure with `"ambiguous": true`, the CLI says so
on stderr, and `kept recover` reads the outcome of any call that was dialled but never
collected — without dialling anyone again.

## Results are bound to the call that produced them

A structured result is only allowed to settle the invoice it was raised for. Before
`kept/capture.py` reads a single field, the answer must agree with the request: the call
id, the recipient CALL-E says it dialled, the task text, and the `invoice_id`,
`customer_id` and `cycle` metadata. CALL-E echoes all three on every call, so each is
required: a result that omits any of them is `result_not_bound`, and so is any
disagreement. The `call_dispatched` ledger record carries a digest of the task text, so a
call recovered after a crash is bound to the same instructions rather than to whatever
the ledger happens to remember. A completed call whose `task_completed`
is not true is `call_not_completed`: the call ending and the job being done are two
different facts and CALL-E reports them separately.

## Cancellation and rollback

- Between runs there is nothing to cancel — no job exists.
- If `kept` is scheduled externally (cron, Task Scheduler), removing that entry is the entire
  cancellation path.
- Setting `do_not_call` on a customer stops all future calls to them immediately.
- Deleting `ledger.jsonl` clears promise, dispute and contact history without touching
  invoices or payments. Nothing in `kept` writes to the operator's accounting data.
- A call already in progress cannot be recalled by this app; CALL-E owns the live call.

## Financial boundaries on the call itself

The task text sent to CALL-E carries these as hard rules
(`kept/calls/scripts.py`, asserted in `test_the_task_text_carries_the_boundaries_the_agent_must_respect`):

- Identify as an automated assistant and name the creditor, on every call.
- **Never accept card numbers, CVV codes, bank credentials or one-time passcodes.** There is
  no code path in this repository that accepts a payment instrument; taking one on this call
  would place the operator inside PCI scope.
- **Never threaten** legal action, credit reporting, service suspension or any other
  consequence.
- **Never offer** a discount, waiver, settlement, instalment plan or new terms. The agent may
  only record what the customer proposes; it has no authority to agree to it.
- A stated dispute ends the collection attempt on that call and permanently thereafter.
- A request not to be called again is agreed to and confirmed.
- Voicemail receives the creditor name and callback number only — never the invoice number
  or the amount.

## Medical, legal and emergency content

Out of scope by construction. The result schema has no field for any of it, and the task
text confines the conversation to one invoice. If a customer raises a legal matter it
surfaces as a dispute, which ends collection and hands the account to a person.

## Nothing the model says is trusted with money

CALL-E's structured result is a *claim*, never a record. `kept/capture.py` re-checks the
right party, an exactly parseable amount, a readable future date inside the horizon, an
amount the invoice can carry, and the completion-confidence floor. Eleven named rejection
reasons exist and every one has a test in `tests/test_capture.py`. Amounts are integer minor
units parsed with `Decimal`; ambiguous grouping is refused rather than guessed.

## Audit

`ledger.jsonl` is append-only and hash-chained: each entry commits to its predecessor's
hash. `kept verify` re-hashes the chain and fails on any edited, reordered or removed entry
(`tests/test_ledger.py`). Every call **and every decision not to call** is in it.

## Consumer collections

Out of scope. The scripts, escalation ladder and tone are written for business-to-business
receivables. Consumer debt collection carries statutory requirements — disclosure scripts,
validation notices, contact-frequency caps, dispute handling timelines — that this codebase
does not implement, and it should not be used for that without them.
