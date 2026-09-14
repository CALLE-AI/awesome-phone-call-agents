# Lead Follow-Up Booking

This focused Python web app uses the CALL-E server SDK to call a lead who submitted a follow-up request, disclose that the caller is AI, offer only the free 30-minute slots computed from the company's Google Calendar, and book the chosen slot as a Google Calendar event only when the lead explicitly confirms a time during the call. A confirmation email is sent when a booking is made.

The default mode is a masked preview: with no `CALL_E_API_KEY`, the server returns simulated call results and never places a call. Live mode requires an explicit server-side opt-in (`CALLE_LIVE_CALLS_ENABLED`), a server-side API key, a completed Google OAuth connection, and a per-request confirmation header.

## Why this workflow

Sales and support teams often promise "someone will call you back" and then play phone tag: the caller does not know when the lead is free, and the lead misses the call. This app converts one outbound follow-up call into a confirmed calendar booking:

- the lead's timezone is derived from their phone number (with company-timezone and country-code fallbacks);
- the agent reads back times in a friendly label such as "IST (India Standard Time)";
- the agent offers only slots that are free on the company calendar, so a slot can never be double-booked;
- the event is created only when the lead picks a slot during the call, so a missed or refused call never creates a ghost appointment; and
- the booked slot is stored in the company timezone on the company calendar.

## Setup

Python 3.11 or later. Using a virtual environment:

```bash
cd apps/python/lead-follow-up-booking
python -m pip install -r requirements.txt
```

Windows also needs the `tzdata` package for IANA timezones; it is already in `requirements.txt`.

## Preview without a call

With no `CALL_E_API_KEY` and no `CALLE_LIVE_CALLS_ENABLED`, the app runs in preview mode - the documented, credential-free preview needs nothing else (no `APP_TOKEN`, no Google connection):

```bash
python app.py
```

Open `http://127.0.0.1:8080`. The form accepts a lead's name, email, company, phone (country code + number), and detects the lead's timezone from the phone number in the browser. Submitting returns a simulated call result; nothing is dialed, nothing is scheduled, and no Google connection is required. In the credential-free preview only the landing page and lead submission are open: call-result, OAuth, batch, and data routes still require `APP_TOKEN` authentication even when live mode is off (an operator may run a preview while a provider key is present). If an `APP_TOKEN` is configured, it is enforced everywhere, including in preview mode.

## Run one live call

API keys are server credentials. Keep them in a secret manager or environment variable, never in source control. Copy `.env.example` into your own secret configuration:

## Operator switches (fail closed)

Every route that can call, book, or read lead data requires `Authorization: Bearer <APP_TOKEN>` (the demo page collects the token once in the browser). The OAuth callback is authenticated by a per-browser state token plus PKCE instead of a bearer header. Exception: in the credential-free preview (live calls disabled and no `APP_TOKEN` set), only the landing page and the lead-submission route are open so the preview above actually runs - no live side effect is possible in that configuration. Call-result, OAuth, batch, and data routes require authentication unconditionally, even in preview mode.

Without `CALLE_LIVE_CALLS_ENABLED`, live calling is impossible no matter what keys are present: `place_call_e_call` returns a clearly marked `simulated` result (`status: "simulated"`, `simulated: true`, no SID) and no call is placed. When live mode is enabled, both the single-lead form and the batch upload additionally require the header `X-Confirm-Live-Call: I understand this places a real phone call` on every request - the final per-call opt-in before anything is dialed. `APP_TOKEN` must be at least 16 characters with no whitespace when live mode is on.

The Google OAuth token is stored per browser session in server memory. Disk persistence and `GOOGLE_TOKEN_JSON` restore happen only when `PERSIST_GOOGLE_TOKEN=true` is explicitly set, so an operator cannot leave credentials on disk by accident.

```bash
export CALL_E_API_KEY="<CALL_E_API_KEY>"
export APP_TOKEN="<16+ char secret>"          # required by every private route
export GOOGLE_CLIENT_ID="<your OAuth client id>"
export GOOGLE_CLIENT_SECRET="<your OAuth client secret>"
export FLASK_SECRET="<random value>"
export CALLE_LIVE_CALLS_ENABLED=1             # the ONLY switch that enables real calls
# export PERSIST_GOOGLE_TOKEN=1               # only if you want tokens written to disk
```

The Google OAuth client must list `http://localhost:8080/oauth2callback` as an authorized redirect URI (override with `GOOGLE_REDIRECT_URI` or `GOOGLE_REDIRECT_URI_LOCAL`).

1. Start the server and click **Connect Google Calendar & Gmail** to authorize.
2. Fill the lead form and submit. One CALL-E call task is created; the agent discloses it is AI, asks whether the lead is available tomorrow, and offers only the free slots read from the calendar.
3. The `/call_status` webhook (or a manual fetch) updates the lead record when the call finishes. If the lead chose a time, the event is inserted into the calendar; the lead's local time is converted into the company timezone.
4. The lead record and the event are matched by the CALL-E call id, and every lead record keeps its `time_confirmed` status.

The single-lead form and the batch upload (`.xlsx` or `.csv`, see `example_leads.xlsx`) share the same pipeline. Batch rows support `company_tz` so a multi-timezone team can convert lead times into each company timezone, and `consent` so only authorized recipients are called.

## Input contract

A lead row contains:

- `name`: lead's full name;
- `phone`: one E.164 phone number (the country-code dropdown helps build it);
- `email`: lead's email for the confirmation message;
- `company`: lead's company (optional);
- `your_company`: the caller's company name, disclosed during the call;
- `company_tz`: IANA timezone of the caller's calendar (optional, defaults to `UTC`); and
- `consent`: `yes` when the recipient authorized this follow-up call (required for live calls; recorded with a server-side timestamp).

`example_leads.xlsx` contains only clearly fictional identities and standards-reserved fictional phone numbers (NANP `555-01xx` range, RFC 2606-style), so it can never point at a real person. Do not put account numbers, health details, legal matters, payment data, credentials, or other sensitive information in lead rows.

## Safety and side effects

- Preview mode has no external side effects and needs no credentials.
- Live mode places one real outbound CALL-E call per submitted lead and requires the server-side API key, `CALLE_LIVE_CALLS_ENABLED`, the `X-Confirm-Live-Call` header on the request, a connected Google account, and a recorded `consent=yes` for that recipient (stamped with a server-side timestamp in the lead record and the batch export).
- The agent must begin the call by disclosing that it is an AI voice assistant, and must end the call if the lead objects.
- The agent offers only calendar-confirmed free slots; the server checks the calendar **before dialing** (a lookup failure or an empty slot list returns an error and no call is placed) and re-checks the calendar for conflicts immediately before inserting an event.
- Booking fails closed: if the availability lookup fails, or the confirmed slot is no longer free, the event is NOT booked - the app never silently moves a booking to a different time the lead did not confirm.
- An event is created only when the call result carries authoritative evidence: a real CALL-E call in the terminal `completed` state, a non-empty structured result, `wants_appointment: "yes"`, `time_confirmed: "yes"`, a bound `preferred_day` (today/tomorrow), a parseable `preferred_time` (HH:MM), and a non-`unknown` confirmed timezone. A "no", an unanswered call, an unknown outcome, or a simulated result never books an appointment.
- Calls carry a deterministic provider idempotency key (derived from the lead fields), so an exact retry cannot place a duplicate call.
- Every request requires `Authorization: Bearer <APP_TOKEN>` (unless live is disabled and no token is configured, in which case nothing real can happen); the OAuth callback instead validates a per-browser state token and uses PKCE, and tokens are stored per session with disk persistence gated behind `PERSIST_GOOGLE_TOKEN`.
- Phone numbers are strict E.164 (validated with `phonenumbers`), and numbers are masked (`+1•••• •••• 0100`) in batch status, exports, calendar event descriptions, and logs.
- Batch polling fails closed: a status-fetch error or a polling timeout marks the row `error` with the reason, no booking is attempted, and an ambiguous status is never treated as a success or silently skipped. An ambiguous provider outcome also **stops the batch**: the remaining rows are marked `stopped` and no further recipients are called until the operator resolves the unknown outcome.
- No duplicate jobs: each lead row creates at most one CALL-E call task, and the calendar insert is guarded against an already-booked slot.
- Phone numbers are used only for the call; the app creates no recurring schedule and no hidden follow-up call.
- This workflow is not for medical, legal, financial, emergency, collections, political, or unsolicited marketing calls.

## Cancellation and rollback

Without an API key or without connecting Google, nothing can be called or booked. After CALL-E accepts a call task, this app cannot guarantee cancellation; use the CALL-E dashboard or provider controls if cancellation is available. A created calendar event can be deleted from the calendar directly; the app keeps the `call_id` on the event description to make the matching event easy to find. No recurring job remains to disable.

## Tests

Tests run in a virtual environment and never dial a phone or contact Google; the availability test uses a fake Calendar service with canned events:

```bash
python -m pytest -q
```

The tests cover timezone derivation from phone numbers, lead-to-company time conversion (including the no-lead-timezone fallback), slot computation with conflicts and all-day events, slot display in the lead's timezone, the call-message text (AI disclosure plus free slots only), strict E.164 validation, phone masking, deterministic idempotency keys, the fail-closed booking decision (including simulated-result rejection), bearer-token enforcement, strict authentication on call-result/OAuth/batch/data routes even in the credential-free preview, fail-closed lead submission when the calendar lookup fails or no free slot exists (no call is placed), and batch stop on ambiguous provider outcomes (status-fetch error or polling timeout).

For repository submission, this directory lives at `apps/python/lead-follow-up-booking`, its entry is added to the root resource list, and the repository is validated with:

```bash
python3 scripts/validate_repository.py
```