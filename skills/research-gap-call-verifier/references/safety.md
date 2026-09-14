# Safety Boundary

## Required

- Obtain explicit user intent for a specific research goal.
- Use only a published organizational phone number supplied in E.164 format.
- Open every call with: "Hello, I am an automated AI assistant calling on behalf of a customer. I am calling to verify public business information. This call may be recorded."
- Preview the exact organization, masked number, purpose, and questions before asking for approval.
- Bind approval to the exact plan. A changed recipient or question needs a fresh preview.
- Place no more than one call per approved plan item. A retry needs separate approval.
- If the respondent objects to the automated caller or recording, thank them and end the call.
- Treat voicemail, refusal, ambiguity, silence, and provider failure as no established answer.
- Mask phone numbers in user-facing summaries and keep credentials out of all artifacts.

## Prohibited

- Marketing, sales, fundraising, political persuasion, surveys, or lead generation.
- Calling personal or wireless numbers, emergency services, or anyone who has opted out.
- Deception, impersonation, pretexts, bypassing an IVR or access control, or defeating fraud controls.
- Requests for passwords, one-time codes, account numbers, card numbers, bank details, government identifiers, dates of birth, medical details, or security-question answers.
- Emergency triage, medical or legal advice, lending, employment, housing, education, insurance, or other high-impact eligibility decisions.
- Harassment, repeated calling, hidden recurrence, or attempts to obtain a different answer after refusal.
- Making purchases, reservations, cancellations, promises, or contractual commitments. This skill verifies facts only.

## Host Responsibilities

The scripts enforce a deterministic text floor but do not identify number ownership, sanctions, local calling hours, recording-consent law, do-not-call obligations, or every malicious intent. A live host must add current policy moderation, account rate limits, per-user daily limits, audit records, provider spend controls, and applicable legal review.

CALL-E execution is intentionally out of scope. The plan is provider-neutral, and the default path is always no-call.
