# Examples

All phone numbers below are fictional placeholders, not real numbers.

## 1. Confirm call — creating the call

`POST /v1/calls`

```http
POST /v1/calls HTTP/1.1
Host: api.heycall-e.com
Authorization: Bearer <CALLE_API_KEY>
Content-Type: application/json
Idempotency-Key: slotsaver-confirm-2026-09-14-a1-attempt1
```

```json
{
  "task": "You are Asha, the friendly phone assistant of Example Dental Clinic. Call Priya Sharma and confirm their appointment TOMORROW at 10:00 AM with Dr. Example. Introduce yourself as the clinic's assistant up front. You are talking to a person — never press any phone keys and never wait on hold. The moment you have the answer, thank them, say goodbye, and end the call; keep it under 45 seconds. Outcomes: they will come (confirmed); they cancel (cancelled) — thank them and say the slot will be offered to someone else; they ask to move it (reschedule).",
  "recipients": [
    { "phones": ["+15551234567"], "region": "US", "locale": "en-US" }
  ],
  "result_schema": {
    "type": "object",
    "required": ["outcome"],
    "properties": {
      "outcome": {
        "type": "string",
        "enum": ["confirmed", "cancelled", "reschedule", "no_answer"]
      },
      "notes": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

Response:

```json
{ "id": "call_01example" }
```

## 2. Polling for the outcome

`GET /v1/calls/{id}`

```json
{
  "id": "call_01example",
  "status": "completed",
  "result": { "outcome": "cancelled", "notes": "Patient has a conflict tomorrow." }
}
```

`status` is one of the in-flight states or `"completed"`; only read
`result` once `status === "completed"`.

## 3. Backfill offer call — after a cancellation frees a slot

```json
{
  "task": "You are Asha, the friendly phone assistant of Example Dental Clinic. Call Arjun Das, who asked us for an earlier appointment. A slot just opened TOMORROW at 10:00 AM with Dr. Example. Offer it to them. Introduce yourself as the clinic's assistant up front. You are talking to a person — never press any phone keys and never wait on hold. The moment you have the answer, thank them, say goodbye, and end the call; keep it under 45 seconds. Outcomes: they take the slot (accepted); they don't want it (declined).",
  "recipients": [
    { "phones": ["+15559876543"], "region": "US", "locale": "en-US" }
  ],
  "result_schema": {
    "type": "object",
    "required": ["outcome"],
    "properties": {
      "outcome": { "type": "string", "enum": ["accepted", "declined", "no_answer"] },
      "notes": { "type": "string" }
    },
    "additionalProperties": false
  }
}
```

## 4. One evening run, end to end (sample sequence)

| Step | Action | Outcome | Effect |
|------|--------|---------|--------|
| 1 | Confirm call → Priya Sharma, 9:00 AM | `confirmed` | mark CONFIRMED |
| 2 | Confirm call → Rohan Gupta, 10:00 AM | `no_answer` | retry once |
| 3 | Retry call → Rohan Gupta, 10:00 AM | `no_answer` | flag NEEDS-ATTENTION (no further retry) |
| 4 | Confirm call → Meera Iyer, 11:00 AM | `cancelled` | slot 11:00 AM freed → backfill |
| 5 | Offer call → Arjun Das (waitlist #1) | `declined` | try next waitlist entry |
| 6 | Offer call → Kavya Nair (waitlist #2) | `accepted` | slot 11:00 AM filled, stop backfilling |
| 7 | Run report | — | 1 confirmed, 1 needs-attention, 1 cancelled, 1 backfilled |

## Idempotency key pattern used above

`slotsaver-<kind>-<run-date>-<appointment-id>-attempt<N>` — unique per
attempt so a legitimate retry (attempt2) is never deduped against the
first attempt, while accidentally re-running the same step twice (same
key) is safely deduped by CALL-E.
