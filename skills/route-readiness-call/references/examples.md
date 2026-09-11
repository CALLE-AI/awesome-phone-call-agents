# Route Readiness Call Examples

All phone numbers are fictional `+1 555-01xx` numbers, shown masked.

## Preview before a live call

```text
Stop:            s2 (Rahim, House 12, Road 5)
To:              +155****0102  region=US
Idempotency key: routeready:2026-09-12-demo:s2
Told arrival:    33 minutes
Task:            (the template from SKILL.md with order RR-S2 and cash 1,250 taka)
```

## 1. The customer needs fifteen minutes

Customer: "I'm at the market, I need about fifteen more minutes."

```json
{
  "reached_recipient": "yes",
  "readiness": "within_15_min",
  "ready_clock_time": "",
  "handoff": "in_person",
  "cod_cash_ready": "yes",
  "landmark": "Opposite the pharmacy",
  "customer_quote": "I'm at the market, I need about fifteen more minutes.",
  "quote_in_english": "I'm at the market, I need about fifteen more minutes."
}
```

Gate: verified. Route: earliest delivery is the told arrival plus 15 minutes. On the reference demo day the re-plan moved three ready customers ahead of this stop and saved 12 minutes.

## 2. The customer is out until one o'clock

Customer: "I'm out until one o'clock, please come after that."

```json
{
  "reached_recipient": "yes",
  "readiness": "later_today",
  "ready_clock_time": "13:00",
  "handoff": "in_person",
  "cod_cash_ready": "yes",
  "landmark": "",
  "customer_quote": "I'm out until one o'clock, please come after that.",
  "quote_in_english": "I'm out until one o'clock, please come after that."
}
```

Gate: verified. Route: taken off this loop and listed as a revisit after 13:00, instead of a trip to a door where nobody is home.

## 3. Nobody answers

CALL-E returns `status: "failed"`, `failure_code: "no_answer"` and a null recipient result.

Gate: unverified, "call failed (no answer)". Route: unchanged. The customer is not called again that day; the rider tries the door as usual.

## 4. An automated receptionist answers

A real test call to CALL-E's US test hotline, which answers with an AI receptionist, returned:

```json
{
  "task_completed": true,
  "completion_confidence": { "score": 0.86, "label": "high" },
  "recipient_structured_result": {
    "reached_recipient": "no",
    "readiness": "unknown",
    "ready_clock_time": "",
    "handoff": "unknown",
    "cod_cash_ready": "unknown",
    "landmark": "",
    "customer_quote": "",
    "quote_in_english": ""
  }
}
```

Gate: unverified, "customer not reached". Route: unchanged. This is why the gate reads `reached_recipient` and the quote rather than `task_completed`.
