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

Loose input is normalised where the intent is unambiguous (`+1 555-555-0100`,
`0015555550100`, and a bare 10-digit number with `--country-code`). Anything
still not E.164 is **rejected, not guessed** — dialing a wrong number is worse
than skipping a row.

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

Applied in order — hard opt-outs beat everything else:

| Signal | Disposition |
|---|---|
| `do_not_call` | **needs_human** — suppress and log |
| `wants_human_callback` | **needs_human** |
| `frustration_signals` | **needs_human** |
| Negative sentiment, no frustration | **retry** — a bad time is not a bad mood |
| `busy` / `no_answer` / `voicemail` | **retry** |
| `failed` / `canceled` | **unreachable** |
| `completed`, no escalation signals | **auto_closed** |

---

## Safety

| Guard | Behaviour |
|---|---|
| Dry run by default | Calls happen only with an explicit `--live` |
| Explicit intent | `--live` refuses to run without `--allow` |
| Allowlist | Only listed E.164 numbers can be dialed |
| Per-run ceiling | `--max-calls` (default 5) caps one run |
| E.164 validation | Malformed numbers rejected before reaching CALL-E |
| Masking | Numbers are masked in all console output and results |
| Idempotency | Each call carries a unique key, so a retry cannot double-dial |

Masking always hides at least half the characters, so a malformed number
cannot leak most of a real one through an error message.

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

Covers E.164 validation, masking, the dial gate, triage precedence, CSV
parsing, and goal rendering. Exits non-zero on failure.

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
| `--country-code` | `1` | Assumed code for bare 10-digit numbers |
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
