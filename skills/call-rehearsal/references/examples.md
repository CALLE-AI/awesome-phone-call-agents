# Worked example

A delivery confirmation call, before and after.

## Before

One boolean, and a rule that dispatches unless the customer said no.

```json
{
  "name": "delivery-confirmation",
  "task": "You are calling on behalf of Northwind Logistics about tomorrow's delivery. Ask whether the customer wants to keep the 09:00 to 12:00 window.",
  "result_schema": {
    "type": "object",
    "properties": {
      "confirmed": { "type": "boolean" },
      "notes": { "type": "string" }
    },
    "required": ["confirmed"]
  },
  "fields": { "decision": "confirmed" },
  "decision_rule": {
    "expression": "confirmed != false",
    "on_true": { "action": "dispatch the courier", "side_effect": true },
    "on_false": { "action": "hold the order", "side_effect": false }
  }
}
```

Ten of the twelve endings dispatch the courier:

```text
 !! Consent refused                        ->  dispatch the courier  (side effect)
 !! Wrong person answered and agreed       ->  dispatch the courier  (side effect)
 !! Voicemail answered                     ->  dispatch the courier  (side effect)
 !! Nobody answered                        ->  dispatch the courier  (side effect)

  CRITICAL [voicemail] 'dispatch the courier' runs when voicemail answered
      The result {} (nothing was extracted) still resolves the decision rule to
      'dispatch the courier', which changes the real world.
```

Exit code `20`.

## After

Two changes. Record what happened on the line, and require a confirmation rather
than the absence of a refusal.

```json
{
  "result_schema": {
    "type": "object",
    "properties": {
      "call_status": { "type": "string" },
      "identity_verified": { "type": "boolean" },
      "consent_given": { "type": "boolean" },
      "confirmed": { "type": "boolean" },
      "callback_requested": { "type": "boolean" }
    },
    "required": ["call_status"]
  },
  "fields": {
    "decision": "confirmed",
    "reachability": "call_status",
    "consent": "consent_given",
    "identity": "identity_verified",
    "deferral": "callback_requested"
  },
  "decision_rule": {
    "expression": "confirmed == true and identity_verified == true and consent_given == true",
    "on_true": { "action": "dispatch the courier", "side_effect": true },
    "on_false": { "action": "hold the order", "side_effect": false }
  }
}
```

The task text also gains the instructions the report asked for: confirm the
account holder is on the line, check that now is a good time, offer a callback
when the customer wants to decide later, and leave no order details on
voicemail.

```text
No findings. Every ending that is not a verified confirmation stays away from
the side-effecting branch.
```

Exit code `0`.

## What changed in the report

| Finding | Before | After |
| --- | --- | --- |
| `unsafe-side-effect` | 10 critical | none |
| `indistinguishable-from-confirmation` | wrong person matches a real yes | separated by `identity_verified` |
| `unrecordable-outcome` | reachability, identity, consent, deferral | none |
| `unsatisfiable-required-field` | `confirmed` required but not always established | `call_status` is always present |

Both plans are in
[`apps/python/call-rehearsal/examples`](../../../apps/python/call-rehearsal/examples).
Phone numbers do not appear in either: a call plan never contains one, because
the number belongs to the call request, not to the plan being rehearsed.
