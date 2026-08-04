# CallFlow Campaign Runner

Run an outbound calling campaign through CALL-E and get back typed outcomes
sorted into **auto-closed**, **retry**, and **needs-human**.

A single-file CLI. Feed it a CSV of contacts and a campaign, and it renders a
goal per contact, places the calls, and triages the results so a person only
reviews the calls that actually need attention.

**Host / provider:** CALL-E only, via the `calle-ai` Python SDK
(`POST /v1/calls`). No other telephony provider is supported.

---

## Side effects

> **This app places real phone calls that cost CALL-E credits and ring real
> people.**

| Mode | Behaviour |
|---|---|
| **Default (no flags)** | Dry run. Renders goals, validates numbers, runs the safety gate. **No calls placed, no credits spent.** |
| `--live` | Places real outbound calls. Requires `--allow` listing the numbers you may dial. |

The app creates **no recurring schedules and no background jobs**. Every run is
a one-shot foreground process that exits when the batch finishes — see
[Cancellation](#cancellation) below.

Only call numbers you own or have documented permission to call.

---

## Setup

```bash
pip install calle-ai
export CALLE_API_KEY="your-key"     # Windows: setx CALLE_API_KEY "your-key"
```

Get a key at [dashboard.heycall-e.com](https://dashboard.heycall-e.com).
The key is read from the environment only — it is never written to disk, never
logged, and never included in the results file.

---

## Usage

List the built-in campaigns:

```bash
python runner.py --list-campaigns
```

**Dry run** — the default, and the recommended first step:

```bash
python runner.py --campaign travel --contacts example_contacts.csv
```

```
Travel enquiry follow-up  ·  3 contacts  ·  DRY RUN — nothing is dialed

  DRY RUN   Aditi Sharma       +15******100     goal rendered (884 chars)
  DRY RUN   Rahul Verma        +15******101     goal rendered (871 chars)
  BLOCKED   Bad Number         55*****10        not a valid E.164 number

  skipped=3
  results → results/campaign_results.jsonl
```

**Live run** — requires an explicit allowlist:

```bash
python runner.py --campaign travel --contacts example_contacts.csv \
  --live --allow +15555550100
```

Without `--allow`, `--live` refuses to start. This is deliberate: it makes
dialing an unintended number take a second, conscious step.

---

## Input format

CSV with `name`, `phone`, `note`. A header row is optional; without one the
columns are read positionally.

```csv
name,phone,note
Aditi Sharma,+15555550100,asked about Bali in December
Rahul Verma,+15555550101,honeymoon package enquiry
```

| Column | Used for |
|---|---|
| `name` | `{name}` in the goal template, and the results row |
| `phone` | The number to dial. Normalised to E.164, then validated |
| `note` | `{note}` in the goal template — context the agent mentions |

Formatting is stripped and an explicit `00` prefix is converted
(`0015555550100` → `+15555550100`). A number with **no country code is
rejected, not guessed** — the same digits are a valid subscriber number in
several countries, and picking one reaches a stranger.

If a list is known to be single-country, opt in explicitly:

```bash
python runner.py --campaign travel --contacts example_contacts.csv --country-code 91
```

---

## Campaigns

| ID | Purpose | Extra fields extracted |
|---|---|---|
| `travel` | Follow up on a holiday enquiry | `destination`, `travel_date`, `party_size` |
| `appointment` | Confirm or reschedule an appointment | `confirmed`, `reschedule_to` |

A campaign is a **goal template** plus a **result schema**. Add one by
appending to `CAMPAIGNS` in `runner.py`:

```python
"renewal": Campaign(
    id="renewal",
    name="Subscription renewal",
    goal_template=(
        "You are calling {name} about their upcoming renewal.\n\n"
        "Greet them by name and confirm this is a good time. Ask whether they "
        "intend to continue. If they want to cancel, accept it gracefully.\n\n"
        "Known context: {note}"
    ),
    extra_fields={
        "will_renew": {"type": "boolean", "description": "Do they intend to renew"},
    },
),
```

Note that CALL-E rejects thin instructions with `call_not_ready` — the goal
must say what to ask and what to do on success or failure.

---

## Output

Every campaign passes a `result_schema` to CALL-E, which returns
schema-validated JSON. **Transcripts are never parsed or scraped.**

```json
{
  "outcome": "interested",
  "sentiment": "positive",
  "frustration_signals": false,
  "wants_human_callback": false,
  "do_not_call": false,
  "destination": "Bali",
  "travel_date": "2026-12-18",
  "party_size": 4,
  "summary": "Wants a 4-person Bali package in mid-December."
}
```

Results are written as JSONL to `results/campaign_results.jsonl`
(`--out` to change). **Phone numbers in the file are masked.**

An existing file is never overwritten — a results file is the only local record
of who was called and what they said. If `--out` already exists, a timestamped
name is used instead (with a counter, so two runs finishing in the same second
cannot collide).

If the file cannot be written at all — a full disk, a read-only directory, an
`--out` that is itself a directory — the run **prints every record to stderr
instead of failing**. By that point the calls have really been placed, so
discarding the record is not an option. Redirect stderr if you want to keep it:

```bash
python runner.py ... --live --allow +15555550100 2> run-record.txt
```

### Triage rules

Applied in order, and **fails closed** — an absent or malformed field is
unknown, never permission.

| Signal | Disposition |
|---|---|
| Required field missing or wrongly typed | **needs_human** — result not trustworthy |
| `task_completed` not `true` (including absent) | **needs_human** — goal unconfirmed |
| Confidence absent, malformed, or below 0.6 | **needs_human** — result unreliable |
| `do_not_call` | **needs_human** — and written to the suppression list |
| `wants_human_callback` | **needs_human** |
| `frustration_signals` | **needs_human** |
| Negative sentiment, no callback agreed | **needs_human** — a person decides |
| Negative sentiment, `callback_agreed: true` | **retry** — they said yes |
| `busy` / `no_answer` / `voicemail`, **no** extraction | **retry** — nobody answered, nothing consented to |
| Any non-completed status **with** extraction | **needs_human** — someone engaged; status alone is not evidence |
| `failed` / `canceled`, no extraction | **unreachable** |
| Unrecognised provider status | **needs_human** — never actioned on a guess |
| Polling gave up before a terminal status | **needs_human** — the call may still be live |
| Everything above satisfied | **auto_closed** |

**Trusted fields.** `outcome`, `sentiment`, `summary`, `frustration_signals`,
`wants_human_callback`, and `do_not_call` must all be present *and* the right
type before a call can auto-close. Type matters as much as presence:
`{"do_not_call": "no"}` is truthy in Python and would otherwise read as an
opt-out.

**Retry needs consent.** A negative call is not re-dialled on the runner's
judgement. Unless the contact explicitly agreed to a callback
(`callback_agreed: true`), a person decides whether to try again. Unanswered
calls are different — there was no conversation, so there was nothing to
consent to.

---

## Safety

| Guard | Behaviour |
|---|---|
| Dry run by default | Calls happen only with an explicit `--live` |
| Explicit intent | `--live` refuses to run without `--allow`. **There is no override** |
| Allowlist | Only listed E.164 numbers can be dialed; the entries are themselves validated |
| Timeout is not an outcome | Giving up on polling escalates and leaves the reservation open |
| Corruption fails closed | An unparseable ledger line stops the run rather than being skipped |
| Untrusted provider values | Confidence must be finite and within 0.0-1.0; NaN and infinity escalate |
| Untrusted CSV cells | Control characters stripped, lengths capped, alterations reported |
| Recursive redaction | Nested lists and objects in a result are redacted, not just top-level strings |
| Results never overwritten | A second run writes a timestamped file rather than destroying the first |
| Per-run ceiling | `--max-calls` (default 5) caps one run |
| E.164 validation | Malformed numbers, and numbers with no country code, rejected before reaching CALL-E |
| Masking | Numbers are masked in all console output and results |
| Idempotency | Key binds campaign, number, batch, rendered task, and schema |
| Reservation ledger | One locked, per-recipient claim before any API call; a crash cannot cause a re-dial |
| One call per person per run | A duplicate number in the input is called once, whatever the name or note says |
| Suppression | `do_not_call` is written to disk *and* held in memory for the rest of the run |
| Redaction | Numbers, emails, digit runs, and credentials stripped from stored results **and errors**, at any nesting depth |
| No guessing | Region and locale are never inferred; state them with `--region` / `--locale` or omit them |
| Prompt boundaries | Every goal is prefixed with AI disclosure, secret refusal, and sensitive-domain limits |
| File modes | The results file is written `0600` |

Masking always hides at least half the characters, so a malformed number
cannot leak most of a real one through an error message.

**Reruns are safe.** The idempotency key hashes `campaign + number + batch-id
+ rendered task + result schema`, never a random value. Re-running the same
batch returns the original calls instead of placing new ones. Editing a goal
changes the key, because the contact would hear something different — reusing
a call placed under the old wording would return a result for a conversation
that never happened. Pass a different `--batch-id` to deliberately call the
same people again.

**A crash cannot cause a double call.** Before any API request, the runner
takes an exclusive lock and claims the **recipient** in `--dispatch-file`.
Reservations are keyed on the person, not the request: a second CSV row for the
same number with a different name or note produces a different content key, and
must still not reach them twice.

The ledger records three states per recipient:

| State | Meaning |
|---|---|
| `reserved` | The runner intends to call. Written before the request. |
| `accepted` | CALL-E accepted and returned a call ID, now bound to the reservation. |
| `resolved:<status>` | The provider reached a terminal status. |

Anything not `resolved` blocks a re-dial, counts against `--max-calls`, and is
reported with its state and call ID so it can be reconciled in the CALL-E
dashboard. A failed create also leaves the reservation open — the request may
have reached the provider before the error, so a person confirms it did not
connect before that number is dialed again.

The lock is an atomic `O_CREAT | O_EXCL` file, so two runners sharing a ledger
cannot both claim the same recipient. A stale lock names the process that holds
it and can be deleted if no run is active.

**Provider values are validated, not trusted.** `confidence` must be a finite
number within `0.0-1.0`. A one-sided `< 0.6` test is not enough: every
comparison against `NaN` returns False, so a `NaN` score would slip past it and
auto-close the call. The valid range is asserted rather than the invalid one
tested. A create response with no usable call ID raises rather than proceeding,
because a call that cannot be identified cannot be reconciled.

**CSV cells are cleaned at the boundary.** Control characters — NUL, ANSI
escapes, zero-width spaces, bidi overrides — are stripped, and names and notes
are length-capped, before any value reaches a terminal, a log, or the agent's
prompt. When cleaning changes a phone number, the run says so on stderr: an
invisible character removed from a number changes who is dialed, and that must
never be silent.

**Results files are never overwritten.** A results file is the only local record
of who was called and what they said. A second run with the same `--out` writes
a timestamped sibling instead of destroying the first run's evidence.

**A timeout is not an outcome.** If polling gives up before the provider
reports a terminal status, the call may still be ringing, in progress, or
already finished — we simply stopped looking. That escalates to a human and the
reservation is left open, because marking it resolved would free the recipient
for a redial while the original attempt is unaccounted for.

**Ledger corruption stops the run.** An unparseable line is refused rather than
skipped: a corrupt entry may be the only record of an in-flight call, and
ignoring it would permit a duplicate. The error names the offending line numbers
so they can be repaired deliberately.

**Opt-outs are written before the reservation closes.** `do_not_call` is
fsynced to `--suppression-file` under a lock *before* the reservation is marked
resolved. Resolving first would free the recipient, so a crash in between would
lose the opt-out and leave them callable.

**One call per person per run.** Separately from the ledger, the runner tracks
numbers already handled in the current run. A resolved reservation frees a
recipient for a *future* batch, so without this a duplicate row inside one CSV
would be dialled twice — the rows differ in name or note, so they hash to
different content keys, but the same phone rings. Duplicates are reported as
`DUPLICATE_IN_RUN` and skipped.

**Stored text is redacted.** Summaries are model-generated prose and can quote
whatever the contact said aloud — a phone number, an email, card digits.
Masking the `phone` column while writing the summary verbatim would leak the
same data one column over, so free-text values are redacted before they are
written. The results file is created mode `0600`.

**Errors are redacted too.** Provider exceptions echo the request back: the
destination number, the rendered task, sometimes an `Authorization` header.
Error text is stripped of numbers, emails, credential-shaped tokens, and long
opaque strings before it is printed or stored. The exception type is kept, so
failures stay diagnosable.

**Opt-outs apply immediately.** `do_not_call` is written to disk *and* added to
the in-memory suppression set, so a later CSV row for the same number is
blocked within the same run — not just on the next one.

**Nothing critical is guessed.** Region and locale are never inferred from the
number, the CSV, or the host environment, per
[`docs/design-principles.md`](../../../docs/design-principles.md) Principle 3.
Pass `--region` and `--locale` explicitly, or omit them and let the provider
decide.

### Prompt boundaries

Every campaign goal is prefixed with a fixed preamble, so a new campaign cannot
forget it. It requires the agent to disclose that it is an AI, refuse OTPs,
PINs, card and bank details, give no medical, legal, financial, or emergency
advice, honour an opt-out without arguing, and promise no prices or outcomes.

The `note` column is operator-supplied and interpolated into the prompt, so it
is treated as untrusted: newlines are collapsed (a note cannot fake a new
instruction block), redirection phrases such as "ignore the previous
instructions" are stripped, the value is length-capped, and the boundaries are
stated *above* it so later text cannot widen them.

**Opt-outs are durable.** When CALL-E reports `do_not_call`, the number is
appended to `--suppression-file` (default `results/do_not_call.txt`) before
anything else can fail, and checked ahead of the allowlist on every later run.
Numbers are stored as SHA-256 hashes, so the file holds no personal data.
Deleting that file re-enables calling people who asked you to stop.

**Content boundaries.** The built-in campaigns instruct the agent to give no
medical, legal, or financial advice and to defer to a human colleague. Keep
that boundary in any campaign you add, and never use this for emergency
contact — it cannot escalate to emergency services.

### Cancellation

There are **no recurring schedules, no daemons, and no queued jobs** to cancel.
Each run is a foreground process:

- **Stop a run** — `Ctrl+C`. Calls not yet started never begin. A call already
  in progress continues on CALL-E's side; end it by hanging up. Once the
  provider has accepted a call this app cannot cancel it; use the CALL-E
  dashboard if it exposes a cancel action.
- **Stop everything immediately** — omit `--live`, or unset `CALLE_API_KEY`.

### Local state, and what not to delete

| File | Safe to delete? |
|---|---|
| `--out` results | Yes. Output only. |
| `--dispatch-file` reservations | **No.** Deleting it permits re-dialing recipients whose calls were never reconciled. |
| `--suppression-file` opt-outs | **Never.** Deleting it re-enables calling people who asked you to stop. |

### Reconciling an unresolved reservation

A recipient stuck in `reserved` or `accepted` blocks further calls by design.
To clear one:

1. Find the entry — `grep <phone-hash> results/reservations.txt`. The line
   holds the campaign, idempotency key, call ID, state, and batch.
2. Look the call ID up in the CALL-E dashboard to see whether it connected.
3. Append a resolving line yourself, or start a new `--batch-id` once you are
   satisfied the prior attempt is accounted for.

The ledger is append-only and the last line for a recipient wins, so history is
preserved.

#### Ledger line format

If you hand-edit, match this exactly — the runner refuses to read a line it
would not itself have written, and stops rather than risk a duplicate call:

```text
phone_hash,campaign,idempotency_key,call_id,state,batch
```

| Column | Must be |
|---|---|
| `phone_hash` | 64 lowercase hex characters (SHA-256 of the E.164 number) |
| `campaign` | non-empty; no comma, line break, or NUL |
| `idempotency_key` | non-empty; no comma, line break, or NUL |
| `call_id` | the provider's call ID, or `-` if none yet |
| `state` | exactly `reserved`, `accepted`, or `resolved:<status>` |
| `batch` | the `--batch-id` it belongs to, or `-` |

`<status>` must be one CALL-E reports: `completed`, `failed`, `canceled`,
`busy`, `no_answer`, `voicemail`, `timeout`, or `unknown`. A bare `resolved` is
rejected — it would read as terminal and free a claim on a call that may still
be live.

States only move forward: `reserved` → `accepted` → `resolved:<status>`. A line
walking a recipient backwards is refused, and a new `--batch-id` may only begin
from a resolved state and only at `reserved`.

Fields are refused rather than escaped if they contain a comma, any line
terminator, or NUL. Both records are one row per line with no quoting, so a
smuggled delimiter could forge an entire extra row — including a `resolved` row
for a *different* recipient, which is exactly the duplicate call the ledger
exists to prevent. Silently rewriting the value would be worse: the reservation
would no longer match the batch the operator passed.

The opt-out file is `phone_hash,campaign`. Lines whose first field is not a
SHA-256 digest are reported and ignored — they cannot match any number, and
keeping them would give the appearance of an opt-out list without the effect.

---

## Verification

Verify without spending credits or dialing anyone:

```bash
python test_runner.py      # guards in isolation
python test_live_path.py   # the whole live loop, with an injected fake client
```

`test_runner.py` runs 245 checks over E.164 validation, masking, the dial gate,
trusted-field validation, triage precedence (including non-finite and
out-of-range confidence scores), provider-status normalisation,
non-completed-status handling, idempotency, per-recipient reservations
(including a 12-thread contention race), ledger corruption and exact state
validation, forward-only state transitions, the batch completion guard,
suppression re-checked at claim time, delimiter injection into both on-disk
records, result and error redaction, prompt boundaries, note sanitisation, CSV
parsing, and goal rendering.

`test_live_path.py` drives the full live loop against an injected fake client
across 42 checks: a completed call, a duplicate number in one file, an opt-out
mid-run, a provider error, a poll timeout, an empty allowlist, region/locale
handling, a batch-id reuse that must not re-dial, an unwritable `--out`, and an
unreadable contacts file. Isolated tests missed a real duplicate-call bug that
this caught — the first call had already resolved by the time the second row was
read, freeing the reservation.

Both exit non-zero on failure and place no calls.

Also worth reading: the default dry run (any invocation without `--live`) is the
same pipeline minus the dial, so a preview shows exactly which rows a live run
would skip and why.

To verify the live path end to end, run with `--live --allow <your-own-number>`
and answer the phone. One call costs one credit.

---

## Options

| Flag | Default | Purpose |
|---|---|---|
| `--campaign` | *required* | Campaign ID (`--list-campaigns` to see them) |
| `--contacts` | *required* | Path to the CSV |
| `--live` | off | Place real calls |
| `--allow` | — | Comma-separated E.164 numbers that may be dialed |
| `--max-calls` | `5` | Per-run call ceiling |
| `--country-code` | *(off)* | Opt in to prefixing numbers with no country code |
| `--batch-id` | `default` | Groups calls for idempotency; change it to re-dial |
| `--region` | *(off)* | Provider region hint. Never inferred |
| `--locale` | *(off)* | Conversation locale. Never inferred |
| `--suppression-file` | `results/do_not_call.txt` | Durable opt-out list |
| `--dispatch-file` | `results/reservations.txt` | Per-recipient reservation ledger |
| `--poll-interval` | `5.0` | Seconds between status checks |
| `--timeout` | `600.0` | Seconds to wait for a call to finish |
| `--out` | `results/campaign_results.jsonl` | Results path |

---

## Notes

**The recipient field is `locale`, not `language`.** CALL-E rejects `language`
with `422 extra_forbidden`, and the error only names the offending path.

**Sample numbers are fictional.** `+1 555 0100`–`0199` is reserved for
fiction and cannot connect to a real person, so the example CSV is safe to run
live by accident.

Part of [CallFlow AI](https://github.com/mohdcodes/CallFlow-AI), a 24×7 AI
calling desk built on CALL-E.
