# Evidence Model

Claims and evidence are first-class objects. A phone call that "went well" is
not a result; typed claims with attached evidence are.

## Claim

```json
{
  "id": "uuid",
  "taskId": "uuid",
  "candidateId": "uuid",
  "callId": "uuid",
  "type": "availability | compatibility | price | quantity | pickup | hold | deadline | service_area | other",
  "statement": "Metro Components availability of the requested item",
  "value": 2,
  "unit": null,
  "status": "unknown | pending | verified | contradicted | failed | expired",
  "confidence": 0.93,
  "evidenceIds": ["uuid"],
  "statusHistory": [
    { "from": "unknown", "to": "verified", "at": "ISO-8601", "reason": "Call mock_gt_... terminal result" }
  ],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Lifecycle rules:

- `unknown -> verified` requires evidence + sufficient completion confidence.
- `verified -> contradicted` is allowed and RECORDED (history is never
  rewritten). `verified -> verified` is a no-op.
- `failed` means an explicit negative from the supplier.
- Claims are immutable once evidence is attached; corrections are new
  transitions, not edits.

## Evidence

```json
{
  "id": "uuid",
  "claimId": "uuid",
  "callId": "uuid",
  "candidateId": "uuid",
  "source": "calle_call | calle_transcript | structured_result",
  "excerpt": "Supplier said: \"Yes, we have two units right now.\"",
  "confidence": 0.93,
  "capturedAt": "ISO-8601"
}
```

Every verified claim carries at least one `structured_result` evidence (the
schema-validated CALL-E result) and, when the transcript supports it, one
`calle_transcript` evidence quoting the supplier's own words. Transcript
excerpts are PII-redacted before storage.

## Structured result contract (CALL-E resultSchema)

```json
{
  "type": "object",
  "required": ["availability"],
  "properties": {
    "availability":   { "type": "string", "enum": ["confirmed", "not_available", "uncertain"] },
    "quantity":       { "type": "integer", "minimum": 0 },
    "compatibility":  { "type": "string", "enum": ["confirmed", "not_compatible", "uncertain"] },
    "price":          { "type": "number", "minimum": 0 },
    "currency":       { "type": "string", "enum": ["INR", "USD", "EUR"] },
    "pickup_available": { "type": "boolean" },
    "pickup_time":    { "type": "string" },
    "hold_available": { "type": "boolean" },
    "hold_confirmed": { "type": "boolean" },
    "hold_until":     { "type": "string" },
    "notes":          { "type": "string" }
  }
}
```

Design rules:

- `uncertain` is a first-class enum value — hedged answers survive
  end-to-end and keep constraints UNKNOWN.
- Missing optional fields are null-filled after validation so evaluators see
  explicit gaps instead of undefined.
- Adjust the schema per task when needed (e.g. a service-area check may swap
  `compatibility` for a `service_area` enum), but keep the pattern: enums for
  judgments, numbers for quantities/prices, booleans for yes/no facts, and a
  free-text `notes` field that never substitutes for a structured field.

## Confidence

- Claim confidence = the CALL-E `completionConfidence.score` of the call that
  produced it (mock mode reports a scripted value; the default floor is 0.8
  when CALL-E omits it).
- Claims below a 0.5 completion confidence cannot become verified even when
  the structured result looks positive.
- Decision confidence = the MINIMUM confidence across the winner's verified
  hard constraints — one weak leg lowers the whole verdict.
- Confidence never overrides a deterministic `fail`, and an ambiguous answer
  stays UNKNOWN even at high model confidence.
