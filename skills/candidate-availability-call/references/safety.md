# Candidate Availability Call Safety

Candidate availability calls affect real people and hiring processes. Keep the workflow narrow, disclosed, and reversible.

## Disclosure

The call must start with:

- the caller is an AI phone assistant
- the call is on behalf of the named company or coordinator
- the call is only for interview availability coordination
- the candidate can decline, ask for email follow-up, or stop the call
- when recording or transcription is enabled by the configured provider workflow, the call may be recorded or transcribed into a scheduling note for human review

Do not imply that the candidate is speaking with a recruiter or hiring manager directly.

## Allowed Questions

Allowed:

- which coordinator-supported windows work
- candidate timezone
- scheduling constraints
- preferred follow-up channel from the allowed list
- consent for follow-up about this scheduling request

Not allowed:

- interview screening or scoring
- compensation, benefits negotiation, or salary expectations
- protected-class, immigration, disability, health, family, age, religion, race, or background-check topics
- pressure to accept a time
- claims that an interview is confirmed before a human sends the invite

## Phone Numbers

Use only E.164 numbers provided by the candidate, recruiter, ATS, or authorized intake. Mask phone numbers in logs and summaries. Use fictional reserved phone numbers in samples.

## Voicemail

Leave voicemail only when `voicemail_allowed` is true and an approved message is supplied. The voicemail must disclose the AI caller and give an approved callback or written follow-up route. Do not include sensitive recruiting details beyond the scheduling purpose.

## Evidence

Every availability window and consent claim must be backed by a transcript span. If a response is unclear, set `needs_human_review` to true and do not infer consent or availability.

Store the minimum useful record: the structured scheduling result, evidence spans needed for review, and the call identifier if the recruiting team has a documented retention basis. Do not copy full transcripts into broad logs or summaries by default.

## Human Review

This skill never books, reschedules, cancels, rejects, advances, or evaluates a candidate. A human coordinator must make all calendar and ATS changes.

## Retries

No automatic repeated calls. If the result is no-answer, voicemail, ambiguous, or wrong number, the coordinator decides the next step.
