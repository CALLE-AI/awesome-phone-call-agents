# Examples — confidence-gated results

Four traces. All phone numbers are fictional reserved samples. Field names follow the workflow's own
schema; nothing here is a CALL-E API guarantee.

---

## 1. Null result after a real conversation → REPAIR → COMMIT

The common case, and the one everyone gets wrong by reading `null` as "no".

**Original call**

```json
{
  "id": "call_a1",
  "status": "completed",
  "duration_seconds": 96,
  "structured_result": null
}
```

Requested schema asked for four things at once:

```json
{
  "required": ["appointment_confirmed", "preferred_date", "preferred_time", "contact_email"]
}
```

**Read the events first.** `GET /v1/calls/call_a1/events` shows 14 turns over 96 seconds. This is not
a hangup — the person talked. The extraction failed, not the call.

**Tier: REPAIR.** Decompose the composite schema. Instead of re-asking all four fields, ask for the
two that actually gate the workflow, one at a time:

```json
{
  "required": ["appointment_confirmed", "preferred_date"]
}
```

Task opens by referencing the first call:

> "Hello, we spoke a moment ago about your appointment. I just need to confirm two quick things.
> First, would you like to go ahead with the appointment? ... And which day suits you best?"

Idempotency key: `repair:call_a1`.

**Repair call**

```json
{
  "id": "call_a2",
  "status": "completed",
  "duration_seconds": 31,
  "structured_result": {
    "appointment_confirmed": true,
    "preferred_date": "2026-08-14"
  }
}
```

**Tier: COMMIT.** Final merged record, with provenance:

```json
{
  "appointment_confirmed": { "value": true,         "from": "call_a2" },
  "preferred_date":        { "value": "2026-08-14", "from": "call_a2" },
  "preferred_time":        { "value": null,         "from": null, "note": "not required to proceed" },
  "contact_email":         { "value": null,         "from": null, "note": "not required to proceed" },
  "calls": ["call_a1", "call_a2"],
  "tier_history": ["REPAIR", "COMMIT"]
}
```

Note what did **not** happen: the two non-blocking fields were dropped rather than chased. A repair
call asks only for what blocks the workflow.

---

## 2. Partial result, one missing field → REPAIR the gap only

```json
{
  "id": "call_b1",
  "status": "completed",
  "duration_seconds": 74,
  "structured_result": {
    "order_confirmed": true,
    "address_correct": false,
    "corrected_address": ""
  }
}
```

The person confirmed the order and said the address was wrong — but no corrected address was
captured. The workflow cannot ship to a known-bad address, so this field genuinely blocks.

**Tier: REPAIR**, schema narrowed to exactly one field:

```json
{ "required": ["corrected_address"] }
```

`order_confirmed` is **not** re-asked. It came back confidently the first time; asking again risks a
second, different answer with no principled way to choose between them.

---

## 3. Contradictory result → ESCALATE, do not repair

```json
{
  "id": "call_c1",
  "status": "completed",
  "duration_seconds": 112,
  "structured_result": {
    "order_confirmed": true,
    "cancel_requested": true
  }
}
```

The person both confirmed and asked to cancel. This is not a gap a narrower question fixes — the
underlying intent is genuinely unclear, and a repair call would be asking a confused person to
resolve a contradiction on the spot.

**Tier: ESCALATE.** Payload for the human:

```json
{
  "reason": "contradictory_result",
  "call_id": "call_c1",
  "conflict": ["order_confirmed=true", "cancel_requested=true"],
  "duration_seconds": 112,
  "recipient": "+150******01",
  "action_blocked": "dispatch"
}
```

No second call is placed. A human reads the transcript and decides.

---

## 4. Five-second hangup → NOT a repair case

```json
{
  "id": "call_d1",
  "status": "completed",
  "duration_seconds": 5,
  "structured_result": null
}
```

Same terminal status and same `null` as example 1 — and the correct action is the opposite.

`GET /v1/calls/call_d1/events` shows 1 turn. The person picked up and hung up. That is a soft
refusal, not an extraction failure.

**Tier: ESCALATE** (or hand back to the caller's own retry policy). **Do not repair-call**: it means
immediately calling back someone who just declined to talk.

This pair is the whole reason the skill reads the event stream before choosing a tier. The terminal
result alone cannot tell these two situations apart.

---

## Tier decision, condensed

```
terminal call
  ├── required fields all present and actionable ......... COMMIT
  ├── result contradicts itself ......................... ESCALATE
  ├── missing field is sensitive ........................ ESCALATE
  ├── a repair call was already placed .................. ESCALATE
  ├── conversation was substantial, extraction failed ... REPAIR (subset schema, one call)
  ├── conversation was trivially short .................. ESCALATE / caller's retry policy
  └── cannot classify ................................... ESCALATE
```
