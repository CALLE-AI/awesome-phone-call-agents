# Examples — BridgeCalle Active Listener

These examples use standards-reserved fictional phone number (`+15550100000` under NANP 555-0100..0199) and synthetic sample destination number (`+919876543210`).

## Example 1: Active Listening Check-In Call (India / en-IN)

Input parameters:

```json
{
  "phone": "+919876543210",
  "region": "IN",
  "locale": "en-IN",
  "user_name": "Human",
  "confirm_recipient_opt_in": true,
  "task": "Call +919876543210 in English (India). Ask gently if they drank water and ate food today. Then listen quietly with short nods like Mmhmm."
}
```

Expected CALL-E API request:

```bash
curl "https://api.heycall-e.com/v1/calls" \
  --request POST \
  --header "Authorization: Bearer $CALLE_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "task": "Call +919876543210 in English (India). Ask gently if they drank water and ate food today. Then listen quietly with short nods like Mmhmm.",
    "recipients": [
      {
        "phones": ["+919876543210"],
        "region": "IN",
        "locale": "en-IN"
      }
    ]
  }'
```

Expected output log entry (masked output):

```json
{
  "callNumber": 1,
  "startTime": "06:38 PM",
  "duration": "17s",
  "status": "COMPLETED",
  "targetPhone": "+91 ***** **210",
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
  "targetPhone": "+91 ***** **210",
  "points": [
    "Not connected / Not answered"
  ]
}
```
