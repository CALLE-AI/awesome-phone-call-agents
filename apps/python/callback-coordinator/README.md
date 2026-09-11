# Callback Coordinator
A consent-first **callback triage and routing** engine built on the CALL-E Python
SDK. It turns a callback request — a web "request a callback" submission or a
missed-call log entry — into one structured CALL-E call that learns *why* the
person needs a callback, classifies the outcome into a **fail-closed
disposition**, and routes it to the right team.
This is a *workflow plugin*: a small, reusable component a service desk or
automation workflow can call for every incoming callback request, rather than a
full app.
## Why this workflow
Service teams routinely collect callback requests without knowing the reason,
then burn staff time triaging each one by hand (or miss them entirely). This
engine does the triage automatically and safely:
- **Gates before dialing** — skips calls during quiet hours (in the recipient's
  local timezone) and for `do_not_call` intakes.
- **Learns the reason over the phone** — one CALL-E call asks why the person
  needs a callback and classifies it as `billing`, `sales`,
  `technical_support`, `service_coordination`, `other`, or `declined`.
- **Routes to a team** — maps the classified reason to a team and next action.
- **Fails closed** — any ambiguous, low-confidence, wrong-person, unconfirmed,
  or error outcome is routed to a human. Uncertainty is never read as a success.
- **Is idempotent** — a stable key prevents a retry from creating a second call.
### How it differs from `callback-window-coordinator`
That app books a callback *window* for someone who already chose to be called.
This plugin starts one step earlier: it **takes an open-ended callback request**,
calls back to **find out why**, and **routes** it — while enforcing quiet hours,
do-not-call flags, and fail-closed dispositions. The two compose: this plugin
routes the reason, and a later window-coordination call can book the time.
## Setup
Python 3.11+ and `uv` are recommended:
```bash
cd apps/python/callback-coordinator
uv sync --dev
```
Copy an example request and replace the fictional reserved phone number with an
E.164 number you own or are authorized to call.
## Preview without a call
Preview is the default and needs no credentials:
```bash
uv run python client.py --request example_request_web_form.json
```
The printed plan masks the phone and reports the quiet-hours / do-not-call gate
for the current time. Add `--now "2026-08-10T22:00:00-04:00"` to test the gate at
a specific time. Add `--output plan.json` to write a private, mode-`0600` file
(existing files are never overwritten).
## Run one live call
API keys are server credentials. Keep them in a secret manager or environment
variable, never in request files or source control.
```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"
uv run python client.py \
  --request your-authorized-request.json \
  --execute \
  --confirm-consent \
  --output ticket.json
```
Live mode creates exactly one CALL-E call task and waits for its terminal
result. A stable `callback-triage-<workflow_id>` idempotency key prevents a
retry from creating a second call for the same workflow.
## Input contract
The intake JSON must contain:
- `workflow_id` — a stable, non-secret identifier (letters, numbers, `.`, `_`,
  `:`, `-`).
- `phone` — one E.164 number you are authorized to call (must be `+` followed
  by 1-9 then 7-14 digits; `+0` prefixes are rejected).
- `source` — `web_form` or `missed_call`.
- `business_display_name` — the name disclosed during the call.
- `request_reason_hint` — optional short note from the web form (may be empty).
- `timezone` — the recipient's IANA timezone, e.g. `America/New_York`.
- `locale` — a locale such as `en-US`.
- `consent` — **required boolean true** – records that the recipient explicitly
  requested this callback. The parser rejects missing or false consent.
- `do_not_call` — boolean; `true` prevents any call.
- `quiet_hours` — `{ "start", "end" }` 24-hour window (in the recipient's
  timezone) during which the engine will not call. Defaults to `20:00`–`08:00`.
- `routing_rules` — optional list of `{ category, team, action }` used to route
  each classified reason.
Do not put names, account numbers, health details, legal matters, payment data,
credentials, or other sensitive information in this file.
## Output
A ticket with `mode`, `workflow_id`, the gate outcome, the CALL-E `status`,
`task_completed`, `completion_confidence`, and a **fail-closed disposition**:
| Disposition | Meaning | Routed to |
|---|---|---|
| `scheduled` | Reason classified, routed, confident | The matched team |
| `declined` | Recipient opted out or wants no callback | (closed) |
| `skipped` | Gate blocked the call (quiet hours / do-not-call) | (no call) |
| `needs_human` | Ambiguous / low-confidence / wrong person / error | Human review |
`needs_human` tickets keep the matched team when the reason is confident enough
to target a specialist, otherwise they land in "General Intake (human review)".
Phone numbers are masked and phone-like text (including formatted forms like
`(202) 555-0123`, `202-555-0123`, `202.555.0123`, `+1 (202) 555-0123`,
`+44 20 7123 4567`) is removed from evidence via fail-closed redaction.

## Side effects and safety

- A live run places a real outbound phone call. Use it only when the intake
  records `consent: true` **and** you pass `--confirm-consent`.
- The agent discloses it is AI and ends immediately after a wrong-person
  response or opt-out. It never offers to book a specific callback time – the
  schema cannot return a time, so this is explicitly out-of-scope.
- The engine creates no recurring schedule; it processes one recipient per run.
- Quiet hours, `do_not_call`, and missing/false `consent` are enforced in the
  recipient's timezone and fail-closed (gate blocks the call).
- `--base-url` and `CALLE_BASE_URL` are locked to `https://api.heycall-e.com`
  – any other origin is rejected before the bearer token is used.
- Result binding is strict fail-closed: every field must be present and match exact approved CALL-E payload – `id` == created call id (missing id when expected exists → `binding_call_id_mismatch`), `task` == approved task, `metadata` exact (`workflow_id`, `workflow_type=callback_triage`, `source`), `recipients` exact (len==1, `phones==[intake.phone]`, `locale==intake.locale`), optional `result_schema` == approved schema – otherwise `binding_*` → `needs_human`, preventing any stale/mismatched result from being accepted as `scheduled`.
- Result classification is fail-closed: `status` must be `completed` and
  `task_completed` must be `true`; otherwise the ticket becomes `needs_human`.
  Unbound enum values in `structured_result` also become `needs_human`.
- See [`docs/fail-closed-dispositions.md`](docs/fail-closed-dispositions.md)
  for the disposition matrix and [`docs/safety.md`](docs/safety.md) for
  credential and boundary guidance.
- Not for medical, legal, financial, emergency, collections, political, or
  unsolicited marketing calls.
## Tests
```bash
uv run pytest
```
All tests run with no CALL-E credentials and no network — the execute path is
exercised through a fake client and through the SDK's injected
`http_client` hook.
