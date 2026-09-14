# LeadPulse

Speed-to-lead qualification calls over CALL-E.

When someone fills in a quote form, the business that calls back first usually wins
the job. LeadPulse turns one web form submission into one CALL-E call placed within
seconds: a virtual assistant introduces itself as AI, asks the business's own
qualification questions conversationally, and returns a schema-validated result.
LeadPulse turns that result into a fixed, explainable 0-100 score and one routing
decision - qualified, hot lead, send a booking link, or no answer.

This directory is the reusable CALL-E core of the full LeadPulse app (FastAPI + Next.js
dashboard, hosted form, SMS and Slack follow-up), which lives at
[github.com/HectorTa1989/leadpulse](https://github.com/HectorTa1989/leadpulse).

## What it demonstrates

| Pattern | Where |
| --- | --- |
| A form submission compiled into an outcome-oriented `task` that discloses the agent is AI and never reads contact details aloud | `leadpulse/task.py` |
| A closed `result_schema` where every business decision is a string enum with `unknown`, and selection rules live in `description` | `leadpulse/schema.py` |
| A deterministic score from validated enums - no model is asked for a number, and every point is traceable to one field | `leadpulse/scoring.py` |
| Refusing to infer "no answer" from `failure_code`; only the validated `reached_lead` field can say the lead was not reached | `leadpulse/results.py` |
| A stable `Idempotency-Key` per lead, so a retried dispatch never places a second call | `leadpulse/client.py` |
| Polling that only ever reads, so a timeout cannot redial | `leadpulse/client.py` |
| An unsigned-webhook receiver: path token, event-id match, SQLite claim, and an independent re-fetch | `leadpulse/webhook.py` |
| Form-typed numbers normalized to E.164, an operator allowlist that fails closed, and masking everywhere | `leadpulse/phone.py` |
| The bearer token pinned to the official HTTPS CALL-E origin | `leadpulse/client.py` |

## Setup

Python 3.11+.

```bash
cd apps/python/leadpulse
python -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Preview - the default path

Preview builds the exact `POST /v1/calls` request for a form submission and prints the
task, the `result_schema`, the idempotency key and the masked recipient. It calls
nobody and needs no API key:

```bash
python cli.py
python cli.py --form examples/form_submission.json --business examples/business.json
```

## Replay - score a call offline

Decide on a saved terminal call snapshot, shaped like a `GET /v1/calls/{id}` response:

```bash
python cli.py --replay examples/fictional_completed_call.json
```

```text
outcome            qualified
score              89 / 100
  interest_level   +35
  timeline_urgency +18
  budget_clarity   +20
  decision_maker   +11
  sentiment        +5
hot lead           yes
send booking link  yes
```

## Checking a key

`GET /v1/goals` is authenticated and has no side effects:

```bash
export CALLE_API_KEY="iams_live_..."
python cli.py --check
```

## Placing a real call

This dials a real phone and spends CALL-E credits. It requires three independent
confirmations:

```bash
export CALLE_API_KEY="iams_live_..."
export LEADPULSE_ALLOWED_DESTINATIONS="+14155550142"

python cli.py --execute --i-have-consent --form my_lead.json
```

- **`LEADPULSE_ALLOWED_DESTINATIONS`** - the operator asserting they own or are
  authorized to call each number. Comma-separated strict E.164. An unset or empty list
  authorizes nothing, and a number not on the list is refused before any client is
  built.
- **`consent_to_call: true`** in the form submission - the lead ticked the "you may call
  and text me about this request" box.
- **`--i-have-consent`** on this run - the operator's per-run confirmation.

Any one missing exits non-zero and places no call. Without `--webhook-url`, the CLI
polls `GET /v1/calls/{id}` until the call is terminal and prints the decision and the
masked transcript.

### Phone numbers

Leads type numbers the way people do, so `(415) 555-0142`, `415-555-0142` and
`+1 415 555 0142` all normalize to `+14155550142` (a bare 10-digit number is read as
NANP). Letters, extensions, a misplaced `+`, and non-ASCII digits (Arabic-Indic,
fullwidth) are refused rather than transliterated - a confusable digit is a different
destination. Allowlist entries must already be strict E.164.

Numbers are masked wherever this app prints them: `+14155550142` renders as
`+1******0142`, and phone-like runs inside transcripts and notes are masked too.

## Receiving results by webhook

```bash
export CALLE_API_KEY="iams_live_..."
export LEADPULSE_WEBHOOK_TOKEN="$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"
uvicorn leadpulse.webhook:app --port 8000

python cli.py --execute --i-have-consent --form my_lead.json \
    --webhook-url "https://your-host/calle/webhook/$LEADPULSE_WEBHOOK_TOKEN"
```

**CALL-E webhooks are not signed**, so the receiver treats every delivery as untrusted:

1. it serves on an unguessable path token, compared in constant time;
2. it requires `CALL-E-Event-Id` to match the body's `id`;
3. it claims the event id in SQLite before doing anything, so an at-least-once
   duplicate is answered `200` without reprocessing;
4. it re-fetches `GET /v1/calls/{call_id}` with the API key and decides on **that**
   snapshot. A forged body cannot change the score.

A failed re-fetch, or a snapshot that is not terminal yet, releases the claim and
returns `5xx`/`409`, so CALL-E's retry is not swallowed.

## Result handling

| CALL-E call task | Decision |
| --- | --- |
| `completed`, `reached_lead: yes`, score >= 50 | `qualified` (`hot_lead` at >= 80) |
| `completed`, `reached_lead: yes`, score < 50 | `not_qualified` |
| `completed`, `reached_lead: no` or `unknown` | `no_answer`, no score |
| `completed` with no `structured_result` | `result_validation_failed` |
| `failed` or `canceled` | `failed`, with CALL-E's raw `failure_code: failure_message` |

`send_booking_link` is true only when the lead's interest is `strong` or `moderate`
and `wants_booking_link` is `yes`. It is a recommendation: this reference app does not
send SMS or post anywhere. The score is a sales-prioritization aid, not a credit,
employment, or eligibility decision.

## Side effects

- `--execute` places **one outbound phone call** to one allowlisted number and is
  billed against your CALL-E credits.
- The webhook receiver writes to a local SQLite file (`LEADPULSE_DB`, default
  `leadpulse.db`): the event ledger and one decision row per call. It does not store
  the transcript or the phone number.
- Nothing else leaves the machine. Preview, replay and `--check` place no calls.
- No recurring jobs are created.

## Cancellation

The Calls API does not expose a client-side cancel. Once `--execute` creates a call it
may run to completion, and pressing Ctrl+C only stops the local polling. Practical
consequences:

- Preview first; treat `--execute` as the point of no return.
- Re-running for the same `lead_id` reuses the same `Idempotency-Key`, so a retry after
  a crash or timeout does not place a second call.
- To stop consuming results, stop the receiver or rotate `LEADPULSE_WEBHOOK_TOKEN`;
  calls already in flight still complete.

## Credential handling

- `CALLE_API_KEY` is read from the environment only. It is never written to SQLite,
  logged, or printed.
- `CALLE_BASE_URL` is parsed, not string-matched, and must resolve to exactly
  `https://api.heycall-e.com`. Plain HTTP, userinfo, a path or query, another port, and
  look-alikes such as `https://api.heycall-e.com.example` are refused.
- `LEADPULSE_WEBHOOK_TOKEN` is the webhook path secret. Generate it randomly; anyone
  holding it can post events, but cannot inject results because of the re-fetch.
- Server-side use only. Neither value belongs in a browser.

## Tests

58 offline tests, no credentials and no network (CALL-E is faked at the HTTP layer):

```bash
python -m pytest tests -q
```

They cover the schema staying inside CALL-E's supported JSON Schema subset, every enum
carrying `unknown` and matching the scoring table, the task never containing contact
details, every routing outcome, the idempotency key surviving a retry, polling never
posting, the allowlist and form consent refusing before any request, E.164
normalization including non-ASCII confusables, masking, origin pinning, and the webhook
trust boundary (wrong token, mismatched event id, forged body, duplicate delivery,
failed or early re-fetch and retry).

## Files

```text
leadpulse/
├── cli.py                  # preview by default; --replay, --check, --execute --i-have-consent
├── leadpulse/
│   ├── phone.py            # E.164 normalization, allowlist, masking
│   ├── task.py             # form submission -> CALL-E task
│   ├── schema.py           # result_schema and the supported-keyword check
│   ├── scoring.py          # fixed 0-100 rubric
│   ├── results.py          # reading a terminal call task, one decision per call
│   ├── client.py           # origin pinning, idempotency, create / get / poll
│   └── webhook.py          # unsigned-webhook receiver, SQLite ledger
├── examples/               # fictional business, form submission, terminal call
└── tests/
```

Everything in `examples/` and `tests/` is fictional: numbers come from the NANP
`555-0100`-`555-0199` block and the UK `020 7946 0xxx` drama range, and emails use
`example.com`.

## License

MIT, matching this repository.
