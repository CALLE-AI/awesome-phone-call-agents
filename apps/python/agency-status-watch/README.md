# agency-status-watch

A CALL-E app for the waiting game: you filed a government or agency application (visa,
permit, license, claim, refund) and the only way to check it is calling the agency's
published status line, navigating the menu, and waiting on hold. This app does that for
you: CALL-E navigates the IVR (keypad tones and all), asks for the status of **your own**
application by reference number, reads it back, and returns it as structured JSON. If the
file is still in process, it re-checks on a decaying cadence (+1 day, +2 days, +4 days,
+8 days) until the outcome is terminal, an action with a deadline is required, or the
check budget is spent — then it stops calling, always.

**What this does over the phone (judge version):** one call to a public agency status
line. The assistant discloses it is an AI calling on the applicant's behalf about the
applicant's own application, navigates the automated menu, asks for the file by reference
number, reads the status back to confirm it heard correctly, and asks what the applicant
must do next and by when. It never negotiates, never requests expedited processing, and
never gives legal, financial, or immigration advice.

## Why an app and not a skill

The recurring watch loop needs durable per-watch state (checks done, next due time,
history) across separate runs, which is app-level, not invocation-level state.

## Modes

| Mode | Command | Side effects |
| --- | --- | --- |
| Preview (default) | `python3 status_watch.py --request req.json` | none — validates, prints masked parties, the call goal, the cadence plan, and the live commands |
| Fixture replay | `python3 status_watch.py --request req.json --fixture scripts/fixtures/watch_happy_path.json` | none — full state machine on canned CLI envelopes |
| Live check | `python3 status_watch.py --request req.json --execute --confirm-consent` | **places one real CALL-E call** to the agency line |
| Watch state | `python3 status_watch.py --request req.json --status` | none — prints stored watch state |
| Cancel | `python3 status_watch.py --request req.json --cancel` | none — marks the watch cancelled; later `--execute` runs refuse |

Standard library only; no third-party dependencies.

## Setup

1. Authenticate the CALL-E CLI once (brokered browser OAuth): `calle auth login`,
   verify with `calle auth status --json`. CLI parameters are documented in
   [`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md).
2. Copy `example-watch-request.json`, fill in your watch, and keep `"consent": true`
   (you are consenting to an AI calling the public line about your own application).

Request fields: `watch_id` (stable unique id — one watch per id), `topic`,
`timezone`, `reference_number`, `consent`, optional `max_checks` (1–10, default 5),
`applicant {name, language, region}`, `agency {name, phone (E.164), language, region}`.

## Example

Fixture (no network, no credentials):

```console
$ python3 status_watch.py --request example-watch-request.json \
    --fixture scripts/fixtures/watch_happy_path.json
{
  "watch_id": "watch-work-permit-2026-09-05",
  "reference_masked": "WP••••47-A",
  "check_number": 1,
  "watch": "watching",
  "next_check_due": "2026-09-06T11:45:24+00:00",
  "call": {
    "disposition": "completed",
    "run_id": "run_asw_7719",
    "answer": {
      "status_category": "in_process",
      "ivr_reached": true,
      "spoke_with": "Immigration Information Desk",
      "next_action": "none",
      "next_action_deadline": "",
      "confidence": 0.9,
      "notes": "Your application is still being processed; no action is needed."
    }
  },
  "needs_human_reason": null
}
```

Live check (real call): add `--execute --confirm-consent`. The structured report is the
same shape; `watch` becomes one of:

- `watching` — still in process (or a transient miss like no-answer); next check due
- `complete_approved` / `complete_denied` — terminal; no further calls
- `action_required` — the agency asked you to act (e.g. `more_info_needed` with a
  deadline); the cadence stops because more calls add nothing
- `needs_human` — fail-closed: schema drift, low confidence, `not_found`/`wrong_dept`,
  or an unrecoverable run outcome; never treated as a status
- `max_checks_reached` — budget spent while still in process

## State, idempotency, and cancellation

- State lives in `~/.cache/agency-status-watch/<sha256(watch_id)>.json`
  (override the directory with `AGENCY_STATUS_WATCH_STATE_DIR`).
- One active watch per `watch_id`. A check is recorded before it dials; if a previous
  run died mid-call (`status: started`), later `--execute` runs refuse with a manual
  recovery hint (`calle call recover`) instead of blind re-dialing.
- `--execute` refuses to dial before `next_check_due` — the decaying cadence protects
  both the agency line and your call budget.
- `--cancel` stops a `watching` watch permanently; finished watches (`complete_*`,
  `action_required`, `max_checks_reached`) refuse further calls. To watch something
  new, use a new `watch_id`.

## Safety and consent

- The request must carry explicit `consent: true`, and `--execute` additionally requires
  `--confirm-consent`. Nothing dials by default; preview and fixture modes are the
  default workflow.
- The call goes only to the agency phone in the request, validated E.164, and the goal
  script discloses the AI immediately to any human who answers.
- The watched file must be the applicant's own (their reference number); the script
  forbids negotiation, expedite requests, payment statements, and legal/financial/
  immigration advice.
- Phone numbers and the reference number are masked in all preview and report output
  (`+141••••0172`, `WP••••47-A`); `confirm_token` and other secrets are scrubbed.
  The unmasked reference number is sent to the agency only inside the live call goal —
  that is the point of the call.
- Boundaries: not for medical, legal, financial, or emergency matters; a `needs_human`
  verdict hands the case back to a person rather than guessing.

## Tests

```console
$ python3 -m unittest test_status_watch
Ran 22 tests ... OK
```

All tests run in fixture mode: no network, no CALL-E account, no credentials.

## Dedup note

Nearest existing entries: `permitdiff` (one-off portal-vs-staff discrepancy resolution,
not a recurring watch of a phone-only file), `call-on-behalf` (delegated errands inside
an authorized window), and `kanverse-human-api` (generic phone-only-service-to-API
layer). None runs an IVR-navigation status check as a recurring, budget-capped,
fail-closed watch loop, which is this app's core.
