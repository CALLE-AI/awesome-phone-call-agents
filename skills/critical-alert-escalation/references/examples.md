# Examples

All numbers below are fictional (`+1555…`). Use test numbers while developing.

## Two-leg readiness escalation (chain advances, then acknowledges)

```
alert: { title: "Athlete flagged RED", detail: "HRV 33, load +54%, 3-day strain",
         recommendation: "hold from recovery" }
chain: [ { role: "trainer",   phone_e164: "+15550101234", order: 1 },
         { role: "physician", phone_e164: "+15550105678", order: 2 } ]
disclosure: "This is an automated readiness assistant calling on behalf of Example Org."

Leg 1 → trainer (+15550101234): no answer / declined  → not acknowledged → escalate
Leg 2 → physician (+15550105678): "Got it, I'll hold him for recovery."
        → { reached: true, acknowledged: true, responder_role: "physician",
            action_taken: "hold from recovery", notes: "confirmed by physician" }
        → alert closed, both attempts logged.
```

## Single responder acknowledges immediately

```
alert: { title: "Deploy approval needed", detail: "prod release blocked on sign-off",
         recommendation: "approve or hold the 3pm deploy" }
chain: [ { role: "on-call-lead", phone_e164: "+15550100000", order: 1 } ]

Leg 1 → on-call-lead: "Approved, ship it."
        → { reached: true, acknowledged: true, action_taken: "approve deploy" }
        → alert closed after one call.
```

## Chain exhausted (nobody acknowledges → owner notified)

```
chain: [ { role: "trainer", phone_e164: "+15550101234", order: 1 } ]

Leg 1 → trainer: voicemail → not acknowledged
        → chain exhausted → owner notified out-of-band; alert left OPEN, all attempts logged.
```

## Running the reference

```bash
# unit-test the acknowledgment evaluation (no calls placed)
node --test --experimental-strip-types scripts/run_escalation.test.ts
```

See [`../scripts/run_escalation.ts`](../scripts/run_escalation.ts) for the guarded
orchestration and [`acknowledgment-schema.json`](acknowledgment-schema.json) for the
structured result CALL-E returns.
