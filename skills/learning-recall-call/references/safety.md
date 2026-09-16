# Learning Recall Call Safety

## Consent

Only place an outbound learning-recall call when the learner has explicitly requested or authorized it.

Do not make unexpected calls.

Permission for a single call does not automatically authorize recurring calls.

Before creating a recurring schedule, clearly communicate:

- that automated calls will occur
- the frequency of the calls
- the topic or purpose of the calls
- how the learner can cancel the schedule

## Phone Numbers

Phone numbers should use E.164 format.

Example:

`+15555550123`

Do not silently guess or transform ambiguous phone numbers.

Never expose complete phone numbers in logs, examples, assessments, or user-facing summaries.

Mask displayed phone numbers.

Example:

`+15555550123` → `+155*****0123`

## Credentials

Never place API keys, authentication tokens, passwords, or provider secrets in skill files.

Credentials must be handled by the host application's secure configuration.

Never expose credentials in logs or assessment output.

## Scheduling

Recurring learning-recall calls require explicit learner authorization.

Before scheduling:

1. Confirm the schedule.
2. Confirm the destination phone number.
3. Explain that automated calls will occur.
4. Confirm the learning topic.
5. Provide a cancellation method.

Do not create duplicate schedules for the same learner, topic, and time window.

## Cancellation

The learner must be able to cancel scheduled recall calls.

Cancellation should stop future calls while preserving completed recall assessments.

## Dry Run

Implementations should provide a dry-run or preview mode when possible.

A dry run must not place a real phone call.

It should allow the user to inspect:

- proposed call time
- destination number in masked form
- learning topic
- proposed question flow
- expected assessment behavior

## External Side Effects

An outbound phone call is an external side effect.

The implementation should clearly communicate:

- when the call will occur
- which number will be contacted
- what topic will be assessed
- whether the call is one-time or recurring

Calls must not be placed silently.

## Educational Boundaries

This skill is designed for educational recall.

It must not claim to replace:

- medical professionals
- legal professionals
- financial professionals
- emergency services

If a learner raises a sensitive or emergency situation, the skill should not attempt to provide professional or emergency intervention.

## Assessment Safety

Do not fabricate learning material, learner responses, misconceptions, or assessment evidence.

Distinguish between:

- uncertainty
- forgetting
- incomplete understanding
- genuine misconception

A misconception should only be recorded when the learner's response provides evidence for it.

## Data Minimization

Only use information necessary to conduct the recall session and produce the learning assessment.

Do not expose private learner information unnecessarily.

Provider-specific credentials and phone-call execution should remain in the host application.