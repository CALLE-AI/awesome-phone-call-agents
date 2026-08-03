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
python runner.py --campaign travel --contacts contacts.csv --country-code 91
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
| `busy` / `no_answer` / `voicemail` | **retry** — nobody answered, nothing consented to |
| `failed` / `canceled` | **unreachable** |
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
| Explicit intent | `--live` refuses to run without `--allow` |
| Allowlist | Only listed E.164 numbers can be dialed |
| Per-run ceiling | `--max-calls` (default 5) caps one run |
| E.164 validation | Malformed numbers, and numbers with no country code, rejected before reaching CALL-E |
| Masking | Numbers are masked in all console output and results |
| Idempotency | Key binds campaign, number, batch, rendered task, and schema |
| Dispatch ledger | Every requested call is recorded before the API call, so a crash cannot cause a re-dial |
| Suppression | `do_not_call` is written to disk immediately and checked before every future call |
| Redaction | Numbers, emails, and long digit runs are stripped from stored summaries |

Masking always hides at least half the characters, so a malformed number
cannot leak most of a real one through an error message.

**Reruns are safe.** The idempotency key hashes `campaign + number + batch-id
+ rendered task + result schema`, never a random value. Re-running the same
batch returns the original calls instead of placing new ones. Editing a goal
changes the key, because the contact would hear something different — reusing
a call placed under the old wording would return a result for a conversation
that never happened. Pass a different `--batch-id` to deliberately call the
same people again.

**A crash cannot cause a double call.** Every call is written to
`--dispatch-file` *before* the request is sent and flushed to disk. If the
process dies after CALL-E accepts a call but before the result is read, that
call still happened — the phone rang. The next run sees the key, counts it
against `--max-calls`, and flags it for reconciliation rather than dialing
again.

**Stored text is redacted.** Summaries are model-generated prose and can quote
whatever the contact said aloud — a phone number, an email, card digits.
Masking the `phone` column while writing the summary verbatim would leak the
same data one column over, so free-text values are redacted before they are
written.

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
  in progress continues on CALL-E's side; end it by hanging up.
- **Undo** — nothing is written outside the results file, so deleting that file
  removes all local state.
- **Stop everything immediately** — unset `CALLE_API_KEY`, or omit `--live`.

---

## Verification

Verify without spending credits or dialing anyone:

```bash
python test_runner.py
```

101 checks covering E.164 validation, masking, the dial gate, trusted-field
validation, triage precedence, idempotency, dispatch durability, suppression,
redaction, CSV parsing, and goal rendering. Exits non-zero on failure.

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
| `--suppression-file` | `results/do_not_call.txt` | Durable opt-out list |
| `--dispatch-file` | `results/dispatched.txt` | Ledger of requested calls |
| `--poll-interval` | `5.0` | Seconds between status checks |
| `--timeout` | `600` | Seconds to wait for a call to finish |
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
