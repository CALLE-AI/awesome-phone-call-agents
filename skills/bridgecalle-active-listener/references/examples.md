# Examples — BridgeCalle Active Listener

These examples use standards-reserved fictional phone numbers (`+919265408610`, `+15550100000`).

## Example 1: Active Listening Check-In Call (India / en-IN)

Input parameters:

```json
{
  "phone": "+919265408610",
  "region": "IN",
  "locale": "en-IN",
  "user_name": "Human",
  "task": "Call +919265408610 in English (India). Ask gently if they drank water and ate food today. Then listen quietly with short nods like Mmhmm."
}
```

Expected CALL-E API request:

```bash
curl "https://api.heycall-e.com/v1/calls" \
  --request POST \
  --header "Authorization: Bearer $CALLE_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "task": "Call +919265408610 in English (India). Ask gently if they drank water and ate food today. Then listen quietly with short nods like Mmhmm.",
    "recipients": [
      {
        "phones": ["+919265408610"],
        "region": "IN",
        "locale": "en-IN"
      }
    ]
  }'
```

Expected output log entry:

```json
{
  "callNumber": 1,
  "startTime": "06:38 PM",
  "duration": "17s",
  "status": "COMPLETED",
  "points": [
    "Call connected successfully.",
    "AI greeted Human gently asking about water intake & food status.",
    "User responded briefly and ended call."
  ]
}
```

## Example 2: Unplaced or Unanswered Call

If the call fails to connect or recipient does not answer:

```json
{
  "callNumber": 2,
  "startTime": "08:01 PM",
  "duration": "0s",
  "status": "NOT CONNECTED",
  "points": [
    "Not connected / Not answered"
  ]
}
```
