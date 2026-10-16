# Examples

All numbers are fictional (`555-01xx`). Worked JSON payloads live in `../examples/`.

## 1. Mock dry-run (no call)

```bash
cd apps/typescript/afterhold-api && npm install && npm run dev
# another terminal, from the repo root:
node skills/afterhold-ivr-errand/scripts/dry-run.mjs
```

## 2. Run a payload against a local mock server

```bash
AFTERHOLD_JWT=<token from /v1/auth/register> \
AFTERHOLD_INPUT=skills/afterhold-ivr-errand/examples/courier.json \
node skills/afterhold-ivr-errand/scripts/run-mission.mjs
```

## 3. Schedule a call

Send `schedule_at` as a future epoch-ms timestamp outside quiet hours. `/start` returns
`status: "scheduled"` and nothing is dialed now.

```json
{
  "e164": "+12025550143",
  "region": "US",
  "display_name": "Courier hub",
  "goal": "Check if AWB 8821 is out for delivery today.",
  "archetype": "courier",
  "schedule_at": 1893499200000
}
```

## 4. Live call (operator-controlled)

```bash
# server started with CALLE_MOCK=0, CALLE_API_KEY and JWT_SECRET set
AFTERHOLD_JWT=<token> AFTERHOLD_INPUT=skills/afterhold-ivr-errand/examples/courier.json \
AFTERHOLD_CONFIRM_LIVE=1 node skills/afterhold-ivr-errand/scripts/run-mission.mjs
```

## 5. What a cancel returns for a submitted call

```json
{
  "ok": true,
  "status": "canceled",
  "call_recalled": false,
  "note": "Canceling stops AfterHold from tracking this mission. It does not recall a call CALL-E has already accepted: a call in progress may still complete."
}
```
