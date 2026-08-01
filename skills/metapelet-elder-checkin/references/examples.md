# Examples

These examples use fictional phone numbers. Do not commit live request files or API keys.

## Preview-only wellbeing check-in

Caregiver request:

```text
Run a friendly 5-minute check-in call preview for Demo in Russian. Use the demo profile. No live call yet.
```

Request file (`example_request.json` in the Python app):

```json
{
  "workflow_id": "demo-checkin-001",
  "phone": "+15550100000",
  "recipient_consented": true,
  "user_name": "Demo",
  "language": "ru",
  "max_minutes": 5,
  "include_demo_profile": true
}
```

Preview command (no network call):

```bash
cd apps/python/metapelet-checkin
python client.py --request example_request.json
```

Expected preview output includes masked phone (`+1******0000`), task text with warm AI disclosure, and the structured result schema fields (`mood`, `topics`, `wants_repeat_call`).

## Live call (supported CALL-E regions only)

1. Copy `example_request.json` to a local file such as `my-live-request.json` (gitignored).
2. Set a real E.164 number the recipient authorized and `recipient_consented: true`.
3. Export `CALLE_API_KEY` locally (never commit).
4. Run:

```bash
python client.py --request my-live-request.json --execute --confirm-recipient-opt-in --output call-result.json
```

Use the same `workflow_id` on retry to respect idempotency (`metapelet-<workflow_id>`).
