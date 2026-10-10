# GetPaid

**A freelancer's polite invoice follow-up caller, built on CALL-E.**

Chasing a late invoice is awkward — you don't want to sound like a debt
collector, but email reminders get ignored. GetPaid places one warm,
disclosed-as-AI check-in call to the client on your behalf, asks whether the
invoice has been paid or what's holding it up, and comes back with a plain
answer: paid, a new date, a dispute you need to know about, or no answer.
If a client promises a new date and it passes, GetPaid automatically places
one polite follow-up call — anything that isn't a clean "promised" (a
dispute, a decline, a wrong number) is routed to a human instead of being
retried.

Runnable demo: `apps/python/getpaid/`

## Why this is different from a collections tool

This is the *freelancer's own voice*, not an ops team's collections
workbench. One person, one relationship, one invoice at a time. The task
script explicitly asks the calling agent to disclose it's an AI, never
imply the client is at fault on the first call, and never negotiate the
amount or make commitments — it only gathers information and reports back.

## Quick start

```bash
cd apps/python/getpaid
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # defaults to fixture mode — no credentials needed
uvicorn main:app --reload
```

Open `http://localhost:8000`, add an invoice, and click **Place first call**.
In fixture mode this returns a randomly sampled canned result after a short
simulated delay — no real call is placed and no CALL-E account is required.
This is the default so anyone can clone and try the app immediately.

## Placing real calls

1. Follow CALL-E's [install guide](https://github.com/CALLE-AI/call-e-integrations/blob/main/docs/install/install-guide.md)
   to get an API key (new accounts include 20 free calls).
2. In `.env`, set:
   ```
   CALLE_MODE=live
   CALLE_API_KEY=<your key>
   ```
3. Restart the server. The mode pill at the top of the page will switch to
   "live mode — real calls will be placed."

**A live call is a real phone call to a real person.** Only add invoices for
clients you actually intend to call, and consider testing against your own
number first.

**Known limitation:** live mode is implemented and was verified against
CALL-E's real REST API during development — the request/response schema was
corrected to match their actual `/v1/calls` contract, and a request built
this way is accepted and reaches CALL-E's call-readiness check. However, on
this hackathon account, CALL-E rejected the specific region/locale tested
(`CA` + English) as an unsupported combination for the account's tier,
independent of app code, and no supported number was available to confirm a
full call end-to-end before the deadline. Because of that, **this demo runs
and is judged in fixture mode**, which exercises the exact same code path
(`calle_client.py`, `main.py`, the frontend) minus the outbound network
call. Fixture mode is the default for that reason — not because live mode
wasn't built.

### Safeguards on live calls

If you do run this with `CALLE_MODE=live` (e.g. hosting a public demo),
three independent safeguards in `main.py` and `ratelimit.py` bound both
real-world impact and CALL-E credit spend, since a live call is a real
phone call and credits are limited:

- **Consent, enforced server-side**: each invoice card shows a checkbox —
  "I confirm I have permission to call this number" — and the call button
  stays disabled until it's checked. This isn't just UI decoration: the
  server rejects (`403`) any live-call request without `consent=true`
  regardless of how the request was made, so it can't be bypassed with a
  raw HTTP request.
- **Per-IP rate limit**: at most `MAX_LIVE_CALLS_PER_WINDOW` (1) live calls
  per IP per rolling 24 hours (`429` once exceeded), checked *before*
  consent so it also bounds bare, unconsented requests.
- **Global cap**: at most `MAX_TOTAL_LIVE_CALLS` (1, overridable via env
  var) real calls across *all* visitors combined, for the life of the
  process — a hard backstop against draining the CALL-E account no matter
  how many people try the demo. Once reached, every further attempt gets a
  `503` ("Demo credits exhausted, see the video instead") and the UI
  proactively hides the consent checkbox and disables the call button
  everywhere, rather than waiting for a failed click.

Automatic follow-ups (`POST /api/follow-ups/run`) are disabled entirely in
live mode, since a bulk action has no way to collect per-invoice consent —
only the individual per-card call button can ever place a live call.

## How it uses CALL-E

Each call is placed via `POST /v1/calls` with a structured
`recipient_result_schema` (`payment_status`, `promised_date`, `note` — named
`payment_status` on the wire since `status` is a reserved field in CALL-E's
schema, remapped back to this app's internal `status` field) so the response
is always machine-readable rather than free text — see `calle_client.py`.
The task prompt (`build_task`) is written to:

- identify the caller honestly as an AI assistant, never as a human
- stay non-accusatory on the first call, and only get firmer in tone on a
  follow-up (and only after a promised date has actually passed)
- ask for information only — no negotiating, no discounts, no commitments
- leave a short, specific voicemail if nobody answers

Follow-ups are decided by *this app*, not CALL-E, via
`Invoice.is_eligible_for_auto_follow_up()` in `models.py`: a `promised`
invoice is eligible once its promised date has passed; a `voicemail` or
`no_answer` invoice is eligible once `RETRY_AFTER_HOURS` (default 24,
overridable via env var for demoing) has elapsed since the last attempt.
`disputed`, `declined`, and `wrong_number` are terminal states that a human
has to look at — GetPaid will never re-call those automatically. Every
invoice also gets at most `MAX_AUTO_FOLLOW_UPS` (2) automatic follow-up
calls total; hitting that cap flags the invoice `needs_human_review` and
excludes it from all future automatic runs, shown in the UI as a warning
banner on its card.

## Side effects, credentials, and cancellation

- **Side effects**: in live mode, clicking "Place first call" or "Call
  again" (with consent checked) places one real outbound phone call
  immediately, subject to the rate limit and global cap above. "Check for
  overdue promises" is disabled entirely in live mode — see Safeguards.
- **Credentials**: `CALLE_API_KEY` is read from the environment only, never
  logged, and never sent to the frontend (`/api/mode` only reports whether
  a key is present, not its value).
- **Data**: invoices and call history are stored locally in
  `data/invoices.json` (gitignored). Delete the file to reset the demo.
- **Cancellation**: there is no recurring job — every call is triggered by
  an explicit click or by `POST /api/follow-ups/run`, which you control.
  Remove an invoice with the "Remove" button to stop any further calls
  against it.

## Tests

```bash
pytest
```

All tests run with `CALLE_MODE=fixture` (set automatically in
`tests/test_app.py`), so the suite never places a real call and needs no
credentials.

## Project layout

```
getpaid/
├── main.py            FastAPI app and routes
├── calle_client.py     CALL-E API wrapper (fixture + live modes)
├── models.py           Invoice / CallAttempt data models
├── storage.py           JSON-file persistence
├── ratelimit.py         per-IP + global live-call safeguards
├── static/              frontend (index.html, style.css, app.js)
├── fixtures/            sample structured call outcomes for fixture mode
├── scripts/seed_demo.py  optional: seed a few sample invoices for a demo
└── tests/               pytest suite (fixture mode only)
```
