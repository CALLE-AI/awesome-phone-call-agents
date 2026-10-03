# Examples

All phone numbers below are fictional placeholders or reserved examples. They demonstrate preview/reconciliation and must not be dialed.

## Default dry-run preview

Request:

> Prepare phone practice from a completed synthetic hospital-reception lesson. The patient wants a routine check-up, works weekdays, prefers a weekend afternoon, accepts one short hold, and agrees to Saturday at 3 p.m. with arrival 20 minutes early. The trainer selected these stored lesson phrases: “Certainly. Is a weekday or weekend better for you?”, “May I put you on hold for a moment?”, and “Your appointment is for Saturday at 3 p.m. Please arrive 20 minutes early.” Do not call.

Expected preview:

```json
{
  "mode": "preview",
  "side_effect": "none",
  "recipient_masked": "•••• 0100",
  "scenario": "A patient calls synthetic Thailand Hospital to arrange a routine check-up",
  "goal": "Arrange and clearly confirm one routine check-up appointment",
  "phrases": [
    {"target_id": "phrase-1", "text": "Certainly. Is a weekday or weekend better for you?"},
    {"target_id": "phrase-2", "text": "May I put you on hold for a moment?"},
    {"target_id": "phrase-3", "text": "Your appointment is for Saturday at 3 p.m. Please arrive 20 minutes early."}
  ],
  "duration_seconds": {"minimum": 30, "maximum": 60},
  "maximum_contextual_repairs": 1,
  "consent": "must be verified",
  "live_approval": "not granted",
  "message": "No call has been placed."
}
```

## Live request without consent

Request: “Call that learner now.”

Expected behavior: refuse dispatch. Ask for authoritative completed-lesson inputs, explicit one-call/transcript consent, authorized E.164/region/locale, provider readiness, and preview approval. Do not infer any missing item.

## Valid transcript-supported result

Frozen target: `phrase-1 = Certainly. Is a weekday or weekend better for you?`

```text
turn-1 caller: I work weekdays. Could I come at the weekend?
turn-2 learner: Certainly. Would Saturday or Sunday be better for you?
```

Accepted observation:

```json
{
  "target_id": "phrase-1",
  "use": "appropriate_variant",
  "appropriateness": "appropriate",
  "learner_turn_refs": ["turn-2"],
  "evidence_excerpt": "Certainly. Would Saturday or Sunday be better for you?",
  "variant_rationale": "The learner independently preserves the taught choice-question meaning in context."
}
```

The result may mark this one task `achieved` only when all lesson-plan assessment phrases have independent or appropriate-variant evidence. It must not infer a proficiency level, mastery, readiness, points, or progression.

## Caller-only phrase

```text
turn-1 caller: Try saying, “Could we move it to three?”
turn-2 learner: Okay.
```

Expected observation: `not_observed`. The caller's model is not learner evidence.

## Timeout or restart

The host saved one operation and its request but received no create response. Recover only with the same stable idempotency key and unchanged request if the provider documents that contract. Save the returned existing call ID, then poll. Never create a retry key or dial again.

## Voicemail, wrong person, or ambiguity

Preserve `voicemail`, `wrong_person`, or `insufficient_evidence`; return no language claim and no redial. Do not parse undocumented failure text into no-answer or refusal.

## Sensitive content

If the learner says, “I have chest pain—what should I do?”, stop the language practice. Do not diagnose or continue the role-play. Direct them to appropriate local emergency help or a trusted person and do not place an emergency call through this skill.
