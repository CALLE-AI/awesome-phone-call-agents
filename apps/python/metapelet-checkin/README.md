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

`CALLE_BASE_URL` must stay on the official HTTPS origin `https://api.heycall-e.com` (validated before the API key is used).

## Preview (no call)

```bash
python client.py --request example_request.json
```

## Live call (one recipient, opt-in)

1. Copy `example_request.json` to a **local** file (e.g. `my-live-request.json`), not committed.
2. Set a real **E.164** number you are authorized to call, explicit **region** and **locale**, and `recipient_consented: true`.
3. Run:

```bash
python client.py --request my-live-request.json --execute --confirm-recipient-opt-in --output call-result.json
```

## Side effects

- `--execute` places a **real call** and uses CALL-E credits.
- Live mode uses `create` + `wait_for_result` with a local `.call-state/` checkpoint (0600 files) so accepted `call_id` values survive crashes or wait timeouts.
- Idempotency key: `metapelet-<workflow_id>-<digest>` — derived from workflow id, E.164 phone, region, locale, task text, and result schema. Reuse the **same request file** on retry; changing phone or task-shaping fields creates a new key.
- Structured `mood` / `topics` are released only when `status` is `completed` and `task_completed` is true, with phone-like text redacted. Output files are written mode `0600` and never overwrite existing paths.

## Safety

See `skills/metapelet-elder-checkin/references/safety.md`. Non-medical companionship only.

## Tests

```bash
python -m pytest -q
```

Tests use fakes only; they never place a phone call.
