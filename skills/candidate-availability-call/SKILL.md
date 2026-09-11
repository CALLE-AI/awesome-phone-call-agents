---
name: candidate-availability-call
description: Recruiting coordination phone-call skill that confirms candidate interview availability, captures evidence-backed time windows, and keeps final scheduling under human control.
license: MIT
---
# Candidate Availability Call

Use this skill when a recruiter, hiring coordinator, founder, or talent team has explicit authority to place one disclosed phone call to a candidate for interview availability. The call asks for available time windows, confirms timezone and constraints, and records whether the candidate consents to follow-up through phone, SMS, or email.

This skill does not book, reschedule, cancel, or confirm an interview. It returns a structured availability result for a human coordinator to review before any calendar invite or ATS update is sent.

## When To Use

Use this skill for:

- confirming 2-3 candidate interview availability windows
- clarifying candidate timezone and scheduling constraints
- asking whether the candidate prefers phone, SMS, or email follow-up
- leaving a short voicemail that asks the candidate to reply through an approved channel
- creating an evidence-backed disposition for a recruiting coordinator

## When Not To Use

Do not use this skill to:

- screen the candidate or ask interview questions
- discuss compensation, immigration, health, family status, disability, protected characteristics, or background-check topics
- make employment promises or imply that an interview is already scheduled
- call a candidate without authority from the recruiting team
- call a private number that the user did not provide or authorize
- place repeated retries, recurring calls, or hidden follow-ups
- update calendars, ATS records, or CRM records without human review

## Required Inputs

- `request_id`: stable local request identifier
- `candidate_name`: candidate name as provided by the recruiter
- `to_phone_e164`: candidate phone number in E.164 format
- `role_label`: role or interview label the candidate already knows
- `company_name`: company or recruiting organization to disclose
- `coordinator_name`: human coordinator responsible for the request
- `authorized_contact_reason`: why this call is authorized
- `interview_duration_minutes`: expected interview duration
- `allowed_windows`: list of candidate-selectable windows the coordinator can support
- `timezone`: IANA timezone to use when presenting windows
- `followup_channels`: allowed follow-up channels, such as `phone`, `sms`, or `email`

Optional inputs:

- `voicemail_allowed`
- `voicemail_message`
- `language`
- `region`
- `candidate_context`
- `do_not_discuss`

## Preflight

Before planning a call:

1. Confirm the user explicitly authorized this one candidate availability call.
2. Confirm the phone number is E.164 and was supplied by the recruiting workflow or candidate.
3. Confirm the call purpose is availability coordination only.
4. Confirm `allowed_windows` are real coordinator-supported options.
5. Refuse compensation, screening, protected-class, legal, medical, or background-check questions.
6. Prepare a dry-run preview before any CALL-E plan.

## CALL-E Goal Template

Use this as the CALL-E `--goal` body after filling the inputs:

```text
You are an AI phone assistant calling on behalf of {company_name}. Disclose that immediately and say that {coordinator_name} authorized this one scheduling-coordination call.

Purpose: ask {candidate_name} about availability for {role_label}. This call is only for scheduling coordination. Do not interview, screen, discuss compensation, make employment promises, or confirm that an interview is booked.

If the configured CALL-E workflow records or transcribes calls, disclose that before asking scheduling questions and say the transcript is used only to create a scheduling note for human review.

Interview duration: {interview_duration_minutes} minutes.
Timezone to use: {timezone}.
Coordinator-supported windows:
{allowed_windows}

Ask:
1. Which of these windows, if any, work for the candidate?
2. What timezone should the coordinator use?
3. Are there scheduling constraints the coordinator should know?
4. Which allowed follow-up channel does the candidate prefer: {followup_channels}?
5. Does the candidate consent to a follow-up through that channel about this interview scheduling request?

If voicemail answers and voicemail is authorized, leave the approved voicemail message. If the candidate declines, is uncertain, or asks a question outside scheduling, thank them and mark the result for human review.

Return a structured result with disposition, availability_windows, timezone_confirmed, constraints, preferred_followup_channel, consent_to_followup, voicemail_left, needs_human_review, and evidence. Do not infer availability or consent from silence.
```

## Structured Result

```json
{
  "disposition": "available | unavailable | voicemail | no_answer | wrong_number | declined | needs_human_review",
  "request_id": "string",
  "candidate_name": "string",
  "availability_windows": [
    {
      "start": "string",
      "end": "string",
      "timezone": "string",
      "evidence": "string"
    }
  ],
  "timezone_confirmed": "string",
  "constraints": [
    "string"
  ],
  "preferred_followup_channel": "phone | sms | email | none | unknown",
  "consent_to_followup": "boolean; true only when the candidate explicitly consents",
  "voicemail_left": false,
  "needs_human_review": true,
  "evidence": [
    {
      "claim": "string",
      "transcript_span": "string"
    }
  ],
  "do_not_rely_on": [
    "string"
  ],
  "notes": "string"
}
```

## Dry-Run Preview

Run the local preview script before any live CALL-E action:

```bash
node scripts/validate-candidate-input.mjs assets/sample-candidate-request.json
node scripts/preview-candidate-call.mjs assets/sample-candidate-request.json
```

The preview prints a masked phone number, a redacted CALL-E planning command, and the structured result schema. It does not place a call and does not contact CALL-E.

## Live Planning

Only after explicit user authorization and CALL-E authentication, copy the generated goal into a CALL-E planning command:

```bash
calle call plan --to-phone <E164_PHONE> --goal "<reviewed goal text>" --timezone America/New_York --language English --region US
```

Planning is not execution. Do not run `calle call start` or `calle call run` unless the user separately confirms the provider's plan details and confirmation token.

## Human Gate

A successful call result is not a scheduled interview. A human coordinator must review the transcript-backed availability windows, choose a time, send the calendar invite, and update any ATS or CRM system.

## Cancellation And Idempotency

Derive an idempotency key from `request_id`, candidate, role, and allowed windows. If the user cancels, mark the local request stopped and do not retry. If a call outcome is ambiguous, route to human review rather than calling again automatically.

## Safety Notes

Read `references/safety.md` before using live planning, and review `references/examples.md` for safe and unsafe examples.
