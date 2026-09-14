# Safety

## Authorization and consent

- Require the learner's explicit consent for one AI practice call, the disclosed purpose, timing, destination, and transcript/result handling.
- Require fresh, human-visible approval immediately before the one live dispatch.
- Never hide an outbound call, batch it, schedule recurrence, or treat consent to one call as consent to another.
- Call only the approved destination. Do not obtain a number from unrelated contacts, lesson notes, search, or inferred identity.

## Phone and credentials

- Accept only canonical E.164: plus sign, country code, and 8–15 digits total.
- Never guess or silently normalize a country code, region, or locale.
- Display and log only a mask such as `+1415•••0100`. Send the full number only to the provider at dispatch.
- Keep credentials in the host's protected secret store. Never request a key in chat, place it in a skill file, command argument, preview, transcript, result, log, screenshot, or source control.
- Refuse live mode when provider authentication, supported region/locale, or authorized-number policy is not verifiably ready.

## Idempotency and no redial

- Reserve the operation and stable idempotency key before submission.
- Persist the provider call ID before polling or reconciliation.
- Reuse the same key and unchanged request only to recover the same accepted operation under a documented provider contract.
- Never create a new key or second call after a timeout, restart, network error, ambiguous result, failure, no answer, voicemail, wrong person, refusal, or cancellation.
- If neither the original request/key nor provider call ID is available, stop for human reconciliation.

## Duration, cancellation, and disable

- Bound the planned conversation to a roughly 30-second target and a 60-second maximum, one scenario, two or three lesson-plan phrases, one opportunity per phrase, and at most one contextual repair. Those phrases are the call aims; the teacher does not invent replacements in the task.
- Confirm whether the provider can enforce a hard duration and cancel an in-flight call. If it cannot, disclose that before approval.
- Cancel an unsubmitted preview/reservation locally. After submission, invoke only a documented cancel operation; otherwise disabling prevents future dispatch but does not promise to stop the active call.
- Never delete the run to make another call appear permissible.

## Evidence and data handling

- Treat structured output as a claim that must be checked against speaker-labelled transcript turns.
- Count only learner speech. Caller examples, voicemail, unknown speakers, summaries, confidence, and generic task-completed fields are not learning evidence.
- Fail closed on missing transcript, ambiguous endpoint, wrong person, unsupported target, duration outside the bound, or an observation without a learner turn.
- Minimize lesson context. Do not send names, unrelated history, grades, diagnoses, or sensitive records when the scenario and phrases suffice.
- State retention and deletion behavior before consent. Do not retain raw audio unless explicitly necessary, consented, secured, and governed.

## Sensitive and emergency boundaries

- Medical: language rehearsal only. Do not diagnose, triage, interpret symptoms/results, recommend treatment, or contact clinicians as if authorized.
- Legal: do not give legal advice, make legal representations, accept terms, waive rights, or contact parties as if authorized.
- Financial: do not take payment, disclose account data, authorize transactions, negotiate debt, or make purchase commitments.
- Emergency: do not use this workflow for emergency services or urgent safety response. Stop and direct the person to appropriate local emergency help or a trusted human.

## Formative-only boundary

- Report only performance on the frozen lesson-derived task.
- Never convert one call into a CEFR score, level, mastery, readiness, employment decision, credential, reward, points, badge, or progression change.
- Preserve `no_evidence` or `insufficient_evidence` when the transcript cannot support the required claim. A failed call is not a learning failure.
