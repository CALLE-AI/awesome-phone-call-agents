---
name: lesson-language-phone-practice
description: Preview and, only after explicit consent and approval, run one bounded phone role-play derived from language actually taught in a completed lesson, then return transcript-supported structured formative observations.
---

# Lesson Language Phone Practice

Create one target-language phone role-play from a completed lesson, aiming for about 30 seconds and ending by 60 seconds. Default to preview only. Do not place a live call unless learner consent, destination, exact call plan, provider readiness, and one-call approval are all explicit in the current workflow.

Read `references/safety.md` before preparing any live path. Read `references/examples.md` when shaping a preview or interpreting a result.

## Required inputs

Require all of these from an authoritative lesson or trainer-owned record:

- completed lesson/activity reference;
- lesson aim, stage aim, Can-do objective, and grammar target;
- one scenario; the lesson-plan phrases themselves are the narrow communication goals and assessment targets;
- two or three exact taught phrases selected from the lesson record;
- optional learner support or caller wording;
- trainer note or observed practice need;
- learner consent covering an AI call and transcript/result handling;
- one authorized E.164 destination, its supported region, and locale;
- a configured phone provider whose credentials stay in the host secret store.

Do not invent taught phrases, use unrelated learner data, scrape a number, infer a country code, or accept a browser/client result as evidence.

## Workflow

1. Freeze a preview containing the lesson reference, aims, Can-do, grammar, scenario, exact lesson-plan phrases, support, roughly 30-second target, 60-second maximum, one opportunity per phrase, and at most one contextual repair. Never ask the teacher to invent or replace assessment phrases in the phone task.
2. Show the complete generated brief and success conditions to the trainer. Permit edits to the scenario, fixed facts and learner support, but never to provenance, lesson-plan phrases, call aims or phrase-derived success evidence. Require explicit trainer approval before assignment.
3. Validate the destination against canonical E.164: a plus sign followed by a nonzero country code and 8–15 digits total. Validate region and locale against the provider's current supported list. Mask the destination in output, for example `+1415•••0100`.
4. Confirm the learner explicitly consented to this purpose, destination, AI caller, timing, and transcript/result retention. One lesson or earlier call does not imply consent now.
5. Produce the dry-run preview. State clearly: **No call has been placed.**
6. Before live dispatch, show the exact masked recipient, purpose, phrases, provider, timing, data handling, one-call rule, and disable behavior. Wait for fresh approval for exactly one call.
7. Reserve a durable operation before calling. Derive one stable idempotency key from the lesson-practice authorization, not a click, timestamp, retry counter, or random value. Persist the provider call ID immediately when returned.
8. Submit once. A timeout, restart, ambiguous response, failure, voicemail, wrong person, or no answer never authorizes a new key or redial. Recover only the same operation through documented idempotent replay or the stored call ID.
9. Poll the stored call ID to a documented terminal state. Do not treat provider task completion as proof that the language goal was demonstrated.
10. Reconcile structured output against speaker-labelled transcript turns. Only learner speech may support phrase use or appropriateness. Unknown speakers, missing transcript, unsupported phrases, out-of-window duration, or ambiguous endpoint must return insufficient evidence.
11. Return the bounded result and masked operation summary. Do not turn it into a generic score, proficiency level, mastery claim, credential, reward, readiness decision, or progression change.

## Caller behavior

- Disclose that this is an AI-assisted practice call.
- Use only the previewed scenario and target phrases.
- Give one opportunity for each selected target phrase and no more than one contextual repair.
- Aim for about 30 seconds, end the exchange by 60 seconds, and end politely.
- Do not schedule, sell, diagnose, advise, take payment, make commitments, or call another number.
- Stop if the recipient refuses, withdraws consent, is the wrong person, or raises a sensitive/emergency issue.

## Structured result

Request and validate a strict result with no undeclared fields:

```json
{
  "task_outcome": "achieved|needs_practice|no_evidence",
  "communication_goal_met": true,
  "goal_observation": "demonstrated|demonstrated_with_support|not_yet_demonstrated|insufficient_evidence",
  "phrase_observations": [
    {
      "target_id": "phrase-1",
      "use": "independent|appropriate_variant|prompted|not_observed",
      "appropriateness": "appropriate|needs_correction|uncertain|not_observed",
      "learner_turn_refs": ["turn-2"],
      "evidence_excerpt": "learner words",
      "variant_rationale": "short explanation when use is appropriate_variant"
    }
  ],
  "correction": {"learner_text": "", "note": "", "suggested": ""},
  "next_step": "",
  "duration_seconds": 0
}
```

Require exactly one observation per frozen phrase and exactly one correction or explicit no-correction note. `achieved` requires independent or appropriate-variant evidence for every lesson-plan phrase. Verify every learner turn reference and phrase claim against the transcript. Preserve uncertainty instead of guessing. This is a formative result for this task, never a CEFR assessment or global learner judgement.

## Cancellation and disable behavior

- Preview: discard it; no side effect exists.
- Approved but not submitted: cancel the reservation and do not call.
- Submitted: stop creating anything else, retain the operation record, and use a documented provider cancel action only if one exists. Disabling may stop future submissions and polling but may not stop an in-flight call.
- Terminal: keep the audit/result record and never redial. A new lesson practice requires a new trainer-reviewed authorization and fresh consent; it is not a retry of this operation.

## Output

For previews, return the masked recipient, scenario, goal, phrases, support, duration, repair limit, consent state, provider readiness, stable operation label, and explicit no-call status.

For completed operations, return the masked recipient, provider call ID, terminal state, transcript-supported phrase observations, goal observation, one correction, next step, and uncertainty. Never print credentials or a full phone number.
