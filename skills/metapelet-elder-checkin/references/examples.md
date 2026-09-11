# Examples

These examples use fictional phone numbers. Do not commit live request files or API keys.

## Preview-only wellbeing check-in

Caregiver request:

```text
Run a friendly 5-minute check-in call preview for Demo in English. Use the demo profile. No live call yet.
```

Request file (`example_request.json` in the Python app):

```json
{
  "workflow_id": "demo-checkin-001",
  "phone": "+15550100000",
  "region": "US",
  "locale": "en-US",
  "recipient_consented": true,
  "user_name": "Demo",
  "language": "en",
  "max_minutes": 5,
  "include_demo_profile": true
}
```

Preview command (no network call):

```bash
cd apps/python/metapelet-checkin
python client.py --request example_request.json
```

Expected preview output includes masked phone only, no full E.164 in `task_preview`, warm AI disclosure instructions, and structured result schema fields (`mood`, `topics`, `wants_repeat_call`).

## Live call (supported CALL-E regions only)

1. Copy `example_request.json` to a local file such as `my-live-request.json` (gitignored).
2. Set a real E.164 number the recipient authorized, plus matching `region` and `locale` from CALL-E docs.
3. Export `CALLE_API_KEY` locally (never commit).
4. Run:

```bash
python client.py --request my-live-request.json --execute --confirm-recipient-opt-in --output call-result.json
```

Reuse the exact same request file on retry to hit the same idempotency fingerprint. Changing phone, locale, region, or task-shaping fields creates a new idempotency key.
