# Appointment Confirm

Consent-first **appointment confirmation** runner for CALL-E. It places (or mocks) one disclosed phone call, captures **yes/no + time**, and returns fail-closed structured JSON. A human still owns calendar changes.

This is a runnable demo app, not a CALL-E SDK.

## Setup

Python 3.11+. No packages required for preview or mock.

```bash
cd apps/python/appointment-confirm
python3 client.py --request fixtures/sample_appointment.json
```

Optional live SDK (only needed for a real call):

```bash
pip install 'calle-ai>=0.7.0'
```

## Preview without a call

Default. No credentials, no network.

```bash
python3 client.py --request fixtures/sample_appointment.json
```

Prints a masked plan, the CALL-E task text, result schemas, and the idempotency key.

## Mock / dev path (still no call)

Replays a conversation fixture through the same schema and fail-closed classifier:

```bash
python3 client.py --request fixtures/sample_appointment.json --mock
python3 client.py --request fixtures/sample_appointment.json \
  --mock --fixture fixtures/conversation_reschedule.json
```

Fixtures:

| File | Outcome |
| --- | --- |
| `conversation_confirm_yes.json` | `can_attend=yes`, confirmed 10:00 |
| `conversation_reschedule.json` | `no` + requested 14:00, needs a human to rebook |
| `conversation_decline.json` | `no` / declined |
| `conversation_voicemail.json` | `unknown` / voicemail |
| `conversation_ambiguous.json` | low confidence → `needs_human` |

## One live CALL-E call

```bash
export CALLE_API_KEY="<your key from dashboard.heycall-e.com/account/api-keys>"
export CALLE_BASE_URL="https://api.heycall-e.com"
# Replace the fixture phone with an E.164 number you are authorized to call.
python3 client.py --request your-authorized-appointment.json \
  --execute --confirm-consent --output ../../tickets/live.json
```

`--execute` without `--confirm-consent` or without `CALLE_API_KEY` is refused. New CALL-E accounts include 20 free calls after signup at [heycall-e.com](https://www.heycall-e.com/).


## Sample phone number

Fixtures use the UK drama number `+447700900123` (Ofcom reserved). Do not replace it with a real number unless you are authorized to call that number.

## Output

```json
{
  "mode": "mock",
  "creates_phone_call": false,
  "can_attend": "yes",
  "confirmed_time": "2026-09-03T10:00:00+01:00",
  "requested_time": "",
  "disposition": "confirmed",
  "needs_human": false,
  "phone_masked": "+44******0123"
}
```

`can_attend` is `yes` / `no` / `unknown`. Time is ISO-8601 or empty. `reschedule_requested` always sets `needs_human: true`.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

All tests are offline. They never need `CALLE_API_KEY`.


## Cancellation

This is a one-shot call, not a recurring job. If you have not run `--execute`, do not execute. If a live call already ran, reuse the same `idempotency_key` (`appointment_confirm:{request_id}:{starts_at}`) so CALL-E does not create a second task. Do not retry an ambiguous result by dialing again; route it to a human. There is no cancel-task API in the current Developer API release.

## Side effects

See [docs/safety.md](docs/safety.md). Live mode places exactly one outbound call. Preview and mock place none. This app does not create recurring jobs and does not write calendars.
