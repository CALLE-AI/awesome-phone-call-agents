# NoShowZero

Appointment reminder calls and waitlist refill over CALL-E.

Clinics lose booked revenue to no-shows, and the slots that are cancelled late are the hardest to
refill. NoShowZero calls each patient before their visit: a virtual receptionist that introduces
itself as AI confirms the appointment - or captures when the patient would rather come - and returns
a schema-validated result. When a patient reschedules or cancels, the released slot is offered by
phone to the first waitlisted patient whose service, preferred times and consent match. If they say
yes, the slot is booked; if they decline, the next matching patient can be offered it.

This directory is the reusable CALL-E core of the full NoShowZero app (FastAPI + Next.js dashboard,
Google Calendar sync, APScheduler reminders at 72h / 24h / 2h, Polar.sh billing).

## What it demonstrates

| Pattern | Where |
| --- | --- |
| Two closed `result_schema` contracts - reminder and waitlist offer - where every decision is a string enum with `unknown` | `noshowzero/schema.py` |
| Tasks that disclose the AI, speak the patient's language, keep appointment details from anyone but the patient, keep voicemail discreet, and never give medical advice | `noshowzero/task.py` |
| Appointment times spoken in the clinic's own timezone, and waitlist preferences read in it too | `noshowzero/task.py`, `noshowzero/waitlist.py` |
| Only a patient who was reached can confirm, cancel or reschedule - someone else answering changes nothing | `noshowzero/results.py` |
| An ambiguous offer result stops the cascade instead of offering the slot to a second patient | `noshowzero/results.py` |
| A deterministic waitlist match - oldest first, same service, `consent_to_call`, never the same slot twice - with a reason for every skip | `noshowzero/waitlist.py` |
| Stable `Idempotency-Key`s per appointment and reminder window, and per waitlist patient and slot | `noshowzero/client.py` |
| Polling that only ever reads, so a timeout cannot redial | `noshowzero/client.py` |
| An unsigned-webhook receiver: path token, event-id match, SQLite claim, an independent re-fetch, and a `next_action` instead of an automatic second call | `noshowzero/webhook.py` |
| Typed numbers normalized to E.164, an operator allowlist that fails closed, masking everywhere, and the key pinned to the official HTTPS origin | `noshowzero/phone.py`, `noshowzero/client.py` |

## Setup

Python 3.11+.

```bash
cd apps/python/noshowzero
python -m venv .venv
. .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## Preview - the default path

Preview builds the exact `POST /v1/calls` request for the reminder and prints the task, the
`result_schema`, the idempotency key and the masked recipient. It calls nobody and needs no API key:

```bash
python cli.py
python cli.py --appointment my_appointment.json --clinic my_clinic.json --window 2h
```

Preview the waitlist offer for the same appointment's slot - who would be called and why everyone
before them was skipped:

```bash
python cli.py --offer
```

```text
waitlist match for the Dental Cleaning slot at 4:30 PM on Friday, September 11
------------------------------------------------------------------------
  skip   Robert Chen        time outside preferred morning
  skip   Maya Torres        waiting for Consultation
  skip   Lena Fischer       no consent_to_call
  offer  Olivia Chen        first matching patient (oldest entry)
```

## Replay - decide offline

Decide on a saved terminal call snapshot, shaped like a `GET /v1/calls/{id}` response:

```bash
python cli.py --replay examples/fictional_reminder_call.json
```

```text
decision (reminder)
------------------------------------------------------------------------
call_status           completed
outcome               wants_reschedule
appointment_status    rescheduled
reminder_status       called
release_slot          True
reschedule_preference next Tuesday morning
```

A released slot prints the waitlist match and the command to preview the offer. Then:

```bash
python cli.py --replay examples/fictional_offer_call.json     # outcome accepted, book True
```

## Checking a key

`GET /v1/goals` is authenticated and has no side effects:

```bash
export CALLE_API_KEY="iams_live_..."
python cli.py --check
```

## Placing real calls

These dial real phones and spend CALL-E credits. Each call requires three independent confirmations:

```bash
export CALLE_API_KEY="iams_live_..."
export NOSHOWZERO_ALLOWED_DESTINATIONS="+12125550116,+12125550199"

python cli.py --execute --i-have-consent --appointment my_appointment.json            # the reminder
python cli.py --offer --execute --i-have-consent --appointment my_appointment.json    # the waitlist offer
```

- **`NOSHOWZERO_ALLOWED_DESTINATIONS`** - the operator asserting they are authorized to call each
  number. Comma-separated strict E.164. An unset or empty list authorizes nothing, and a number not on
  the list is refused before any client is built.
- **`consent_to_call: true`** on the appointment or waitlist record - the patient agreed to reminder
  calls when booking, or to be called about openings when joining the waitlist.
- **`--i-have-consent`** on this run - the operator's per-run confirmation.

Any one missing exits non-zero and places no call. The waitlist offer is always its own explicit run:
a reminder that releases a slot prints the command to offer it, and never dials the next patient by
itself. Without `--webhook-url`, the CLI polls `GET /v1/calls/{id}` until the call is terminal and
prints the decision and the masked transcript.

For a real run, record the patient in `offered_slots` of their waitlist entry after an offer, so the
same slot is never offered to them twice (the full app does this in its database).

### Phone numbers

`(212) 555-0116`, `212-555-0116` and `+1 212 555 0116` all normalize to `+12125550116` (a bare
10-digit number is read as NANP). Letters, extensions, a misplaced `+`, and non-ASCII digits are
refused rather than transliterated - a confusable digit is a different destination. Allowlist entries
must already be strict E.164. Numbers are masked wherever this app prints them (`+1******0116`),
including phone-like runs inside transcripts and notes.

## Receiving results by webhook

```bash
export CALLE_API_KEY="iams_live_..."
export NOSHOWZERO_WEBHOOK_TOKEN="$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"
uvicorn noshowzero.webhook:app --port 8000

python cli.py --execute --i-have-consent --appointment my_appointment.json \
    --webhook-url "https://your-host/calle/webhook/$NOSHOWZERO_WEBHOOK_TOKEN"
```

**CALL-E webhooks are not signed**, so the receiver treats every delivery as untrusted:

1. it serves on an unguessable path token, compared in constant time;
2. it requires `CALL-E-Event-Id` to match the body's `id`;
3. it claims the event id in SQLite before doing anything, so an at-least-once duplicate is answered
   `200` without reprocessing;
4. it re-fetches `GET /v1/calls/{call_id}` with the API key and decides on **that** snapshot. A forged
   body cannot confirm or cancel an appointment.

A failed re-fetch, or a snapshot that is not terminal yet, releases the claim and returns `5xx`/`409`,
so CALL-E's retry is not swallowed. The receiver stores one decision row per call with a
`next_action` - `offer_slot_to_waitlist`, `book_slot_for_waitlist_patient`,
`offer_slot_to_next_waitlist_patient` or `front_desk_review` - and places no calls itself.

## Result handling

Reminder call (`metadata.kind: reminder`):

| CALL-E call task | Decision |
| --- | --- |
| `completed`, `reached_patient: yes`, `outcome: confirmed` | appointment `confirmed` |
| `completed`, `reached_patient: yes`, `outcome: wants_reschedule` | appointment `rescheduled`, preference kept, **slot released** |
| `completed`, `reached_patient: yes`, `outcome: cancelled` | appointment `cancelled`, **slot released** |
| `completed`, `outcome: voicemail` or `no_answer` | appointment unchanged |
| `completed`, a decision without `reached_patient: yes`, or `outcome: unknown` | `unclear`, appointment unchanged |
| `completed` with no `structured_result` | `result_validation_failed`, appointment unchanged |
| `failed` or `canceled` | `failed`, with CALL-E's raw `failure_code: failure_message` |

Waitlist offer (`metadata.kind: waitlist_offer`):

| CALL-E call task | Decision |
| --- | --- |
| `reached_patient: yes`, `accepted: yes` | `accepted` - book the slot |
| `reached_patient: yes`, `accepted: no` | `declined` - offer the next patient (removed from the waitlist if they asked) |
| `reached_patient` not `yes` | `no_answer` - offer the next patient |
| `accepted: unknown`, or no `structured_result` | `needs_review` - the cascade stops; nobody else is offered the slot |
| `failed` or `canceled` | `failed` - offer the next patient |

Decisions are scheduling actions only. The agent gives no medical advice, and no decision is medical.

## Side effects

- `--execute` places **one outbound phone call** to one allowlisted number and is billed against your
  CALL-E credits. The reminder and the waitlist offer are separate runs.
- The webhook receiver writes to a local SQLite file (`NOSHOWZERO_DB`, default `noshowzero.db`): the
  event ledger and one decision row per call. It does not store transcripts or phone numbers.
- Nothing else leaves the machine. Preview, `--offer` without `--execute`, replay and `--check` place
  no calls.
- No recurring jobs are created. In the full app the host scheduler (APScheduler) fires one reminder
  per window, and each run places exactly one call.

## Cancellation

The Calls API does not expose a client-side cancel. Once `--execute` creates a call it may run to
completion, and pressing Ctrl+C only stops the local polling. Practical consequences:

- Preview first; treat `--execute` as the point of no return.
- Re-running for the same appointment and window (or the same waitlist patient and slot) reuses the
  same `Idempotency-Key`, so a retry after a crash or timeout does not place a second call.
- To stop consuming results, stop the receiver or rotate `NOSHOWZERO_WEBHOOK_TOKEN`; calls already in
  flight still complete.

## Credential handling

- `CALLE_API_KEY` is read from the environment only. It is never written to SQLite, logged, or printed.
- `CALLE_BASE_URL` is parsed, not string-matched, and must resolve to exactly
  `https://api.heycall-e.com`. Plain HTTP, userinfo, a path or query, another port, and look-alikes
  such as `https://api.heycall-e.com.example` are refused.
- `NOSHOWZERO_WEBHOOK_TOKEN` is the webhook path secret. Generate it randomly; anyone holding it can
  post events, but cannot inject results because of the re-fetch.
- Server-side use only. Neither value belongs in a browser.

## Verification

- **Offline:** 83 tests, no credentials and no network (CALL-E is faked at the HTTP layer):

  ```bash
  python -m pytest tests -q
  ```

  They cover both schemas staying inside CALL-E's supported JSON Schema subset, every enum carrying
  `unknown`, the tasks (AI disclosure, language, discreet voicemail, clinic timezone, no patient
  number), every reminder and offer outcome, the waitlist rules and their skip reasons, idempotency
  keys, polling never posting, the allowlist and consent refusing before any request, E.164
  normalization including non-ASCII confusables, masking, origin pinning, and the webhook trust
  boundary (wrong token, mismatched event id, forged body, duplicate delivery, failed or early
  re-fetch and retry, nothing sensitive stored).
- **Against the live API, without dialing:** the author sent both requests built by this package to
  `https://api.heycall-e.com` with the invalid number `+1555`. Both were rejected only with
  `400 invalid_phone`, after CALL-E's request-shape and schema checks, so the task, recipients, both
  `result_schema`s and metadata are accepted by the API. No real call has been placed from this
  directory.

## Files

```text
noshowzero/
├── cli.py                  # preview by default; --offer, --replay, --check, --execute --i-have-consent
├── noshowzero/
│   ├── phone.py            # E.164 normalization, allowlist, masking
│   ├── schema.py           # reminder and offer result_schemas, supported-keyword check
│   ├── task.py             # reminder and waitlist-offer tasks, clinic-timezone times
│   ├── waitlist.py         # who is offered a released slot, and why the others were skipped
│   ├── results.py          # reading a terminal call task, one decision per call
│   ├── client.py           # origin pinning, idempotency, create / get / poll
│   └── webhook.py          # unsigned-webhook receiver, SQLite ledger, next_action
├── examples/               # fictional clinic, appointment, waitlist, two terminal calls
└── tests/
```

Everything in `examples/` and `tests/` is fictional: numbers come from the NANP `555-0100`-`555-0199`
block, and the clinic, patients and calls are invented.

## License

MIT, matching this repository.
