# MetaPelet Check-in (Python)

One consent-based outbound CALL-E call using the **MetaPelet** warm-companion persona, returning structured **mood**, **topics**, and **wants_repeat_call**.

Default mode is **preview** (no network call, no API key).

## Setup

```bash
cd apps/python/metapelet-checkin
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

Copy repo-root `.env.example` to `apps/python/metapelet-checkin/.env` or export variables:

```bash
set CALLE_API_KEY=your_key
set CALLE_BASE_URL=https://api.heycall-e.com
```

## Preview (no call)

```bash
python client.py --request example_request.json
```

## Live call (one recipient, opt-in)

1. Copy `example_request.json` to a **local** file (e.g. `my-live-request.json`), not committed.
2. Set a real **E.164** number you are authorized to call and `recipient_consented: true`.
3. Run:

```bash
python client.py --request my-live-request.json --execute --confirm-recipient-opt-in --output call-result.json
```

## Side effects

- `--execute` places a **real call** and uses CALL-E credits.
- Idempotency key: `metapelet-<workflow_id>` — reuse the same `workflow_id` to avoid duplicate calls on retry.

## Safety

See `skills/metapelet-elder-checkin/references/safety.md`. Non-medical companionship only.

## Tests

```bash
python -m pytest -q
```

Tests use fakes only; they never place a phone call.
