---
name: lead-qualification-call
description: Outbound lead-qualification phone-call skill that confirms interest, captures needs/timing/authority evidence, and returns a structured qualification result for human sales review before any CRM update.
license: MIT
---

# Lead Qualification Call

Use this skill when a founder, salesperson, or growth team has explicit authority to place one disclosed phone call to an inbound lead to qualify them: confirm interest, capture needs, timeline, budget range, and decision authority, and record whether the lead consents to follow-up.

This skill does not sell, negotiate, quote prices, book meetings, or write to a CRM. It returns a structured qualification result for a human sales owner to review before any pipeline update or meeting invite is sent.

## When To Use

Use this skill for:

- qualifying an inbound demo request, trial signup, or contact-form lead by phone
- confirming that the lead matches the team's ideal customer profile
- capturing the lead's own words about needs, timeline, and budget range
- asking whether the lead consents to follow-up through phone, SMS, or email
- leaving a short voicemail that asks the lead to reply through an approved channel
- creating an evidence-backed disposition for a human sales owner

## When Not To Use

Do not use this skill to:

- pitch, negotiate, discount, or quote pricing on the call
- call a lead who opted out, asked not to be called, or appears on a do-not-call list
- call a number the user did not provide or that lacks documented marketing consent
- place repeated retries, recurring calls, or hidden follow-ups
- promise meetings, discounts, timelines, or product behavior the team has not confirmed
- write leads, opportunities, or CRM notes without human review
- call about regulated offers (credit, insurance, healthcare, legal, debt) unless the user confirms a compliant, authorized program
- continue the call when the lead asks to stop, says it is a bad time, or sounds confused about who is calling

## Required Inputs

- `request_id`: stable local request identifier
- `lead_name`: lead name as provided by the sales workflow
- `to_phone_e164`: lead phone number in E.164 format
- `company_name`: company the caller discloses
- `caller_name`: human sales owner responsible for the request
- `authorized_contact_reason`: why this call is authorized, including where the lead opted in
- `product_label`: the product or service the lead signed up for or asked about
- `qualification_questions`: 2-4 questions the sales owner wants answered, at most one about budget range
- `timezone`: IANA timezone used to reference the lead's local time
- `followup_channels`: allowed follow-up channels, such as `phone`, `sms`, or `email`

Optional inputs:

- `lead_context`: notes the lead already shared (form answers, plan selected)
- `voicemail_allowed`
- `voicemail_message`
- `language`
- `region`
- `do_not_discuss`
- `disqualify_on`: conditions that should end qualification early, such as `employee count below 5` or `no authority to purchase`

## Preflight

Before planning a call:

1. Confirm the user explicitly authorized this one lead-qualification call to this number.
2. Confirm the phone number is E.164 and came from the lead's own signup, form, or stated contact preference — never scraped or enriched without documented consent.
3. Confirm the lead has not opted out or asked not to be called, and the user checked their do-not-call status.
4. Confirm `qualification_questions` are 2-4 discovery questions and at most one touches budget range.
5. Refuse credit, insurance, healthcare-treatment, legal-advice, emergency, or debt-collection framing.
6. Prepare a dry-run preview before any CALL-E plan.

## CALL-E Goal Template

Use this as the CALL-E `--goal` body after filling the inputs:

```text
You are an AI phone assistant calling on behalf of {company_name}. Disclose that immediately, say this is a short follow-up about {product_label}, and name {caller_name} as the person who authorized the call.

Purpose: a brief qualification conversation. Do not sell, negotiate, quote prices, or book a meeting. If the configured CALL-E workflow records or transcribes calls, disclose that before the first question and say the notes go only to {caller_name} for review.

Lead context already on file: {lead_context}

Ask, in this order, and stop after the qualification questions are answered:
1. Confirm the lead is the right person for {product_label}, or who owns it.
2. {qualification_questions}

Qualification rules:
- Ask at most one budget question, framed as a range the lead can decline.
- If the lead says now is a bad time, offer the approved follow-up channels instead of rescheduling on the call.
- If {disqualify_on} comes up, thank the lead, stop qualifying, and record the disqualification reason.
- If the lead asks something you cannot answer, say {caller_name} will follow up through an approved channel.
- If the lead declines, asks to stop, or shows confusion about the caller's identity, thank them and end the call.

If voicemail answers and voicemail is authorized, leave the approved voicemail message.

Return a structured result with disposition, interest_level, needs_summary, timeline, budget_range, decision_authority, qualification_answers, preferred_followup_channel, consent_to_followup, disqualification_reason, voicemail_left, needs_human_review, and evidence. Quote the lead's own words as evidence. Do not infer interest, budget, or consent from silence.
```

## Structured Result

```json
{
  "disposition": "qualified | disqualified | no_answer | voicemail | wrong_number | declined | needs_human_review",
  "request_id": "string",
  "lead_name": "string",
  "interest_level": "high | medium | low | unknown",
  "needs_summary": "string",
  "timeline": "string",
  "budget_range": "string or null",
  "decision_authority": "owner | influencer | unknown",
  "qualification_answers": [
    {
      "question": "string",
      "answer": "string",
      "evidence": "string"
    }
  ],
  "preferred_followup_channel": "phone | sms | email | none | unknown",
  "consent_to_followup": "boolean; true only when the lead explicitly consents",
  "disqualification_reason": "string or null",
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

Run the local preview scripts before any live CALL-E action:

```bash
node scripts/validate-lead-input.mjs assets/sample-lead-request.json
node scripts/preview-lead-call.mjs assets/sample-lead-request.json
```

The preview prints a masked phone number, the filled goal template, a redacted CALL-E planning command, and the structured result schema. It does not place a call and does not contact CALL-E.

## Live Planning

Only after explicit user authorization and CALL-E authentication, copy the generated goal into a CALL-E planning command:

```bash
calle call plan --to-phone <E164_PHONE> --goal "<reviewed goal text>" --timezone America/New_York --language English --region US
```

## Notes For Humans

- The qualification result is a draft for the sales owner, not a pipeline record.
- Budget answers are ranges the lead chose to share; record them as quotes, not facts.
- Consent to follow-up is channel-specific; never widen it.
- Keep the sample request fictional. Do not paste real lead data into this folder.
