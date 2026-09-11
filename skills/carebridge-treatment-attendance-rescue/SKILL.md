---
name: carebridge-treatment-attendance-rescue
description: Safely coordinate a consenting patient's practical barrier to an essential treatment visit through approved contacts and CALL-E, returning an auditable attendance outcome.
license: MIT
---

# CareBridge Treatment Attendance Rescue

Use this skill when an authorised care team needs to coordinate a practical barrier that may prevent a consenting patient from attending an essential treatment visit within the next 24 hours.

CareBridge is a coordination workflow, not a clinical decision-maker. It helps establish whether attendance is secured, a human review is required, or the visit remains at risk.

## When to use

Use this skill for practical, non-clinical barriers such as:

- cancelled transport
- unavailable caregiver
- medication pickup coordination
- appointment clarification
- other approved attendance logistics

## Do not use

Do not use this skill to:

- diagnose, prescribe, triage, or give medical advice
- contact emergency services
- decide whether a patient should attend, skip, or change treatment
- call a patient, caregiver, provider, or clinic without explicit authorisation and consent
- infer a phone number, language, clinical status, consent, or provider approval
- share more patient information than is necessary for the specific coordination task

## Required inputs

Before any live CALL-E call, obtain:

1. Explicit authorisation from the care organisation.
2. Explicit consent from the person to be called.
3. A valid E.164 phone number.
4. The recipient's preferred language.
5. The practical barrier reported by the consenting contact.
6. The approved provider or caregiver contact list.
7. The organisation's human-escalation contact.

If any required input is missing, do not place a call. Return `human_review_required`.

## Safe workflow

1. Confirm the case uses synthetic data, or that the organisation has authorised the workflow.
2. Verify the contact's consent before discussing logistics.
3. Identify only the practical barrier.
4. Select an approved playbook for transport, caregiver availability, medication pickup, or appointment clarification.
5. Contact approved providers one at a time.
6. Stop as soon as a provider confirms a viable option.
7. Return a structured, auditable result.
8. Escalate personal emergencies, possible clinical concerns, consent withdrawal, unknown barriers, or failed coordination to an authorised human.

## Structured outcomes

Return one of these outcomes:

- `care_secured`: An approved practical plan was confirmed.
- `human_review_required`: A sensitive, clinical, uncertain, or consent-related issue requires an authorised human.
- `still_at_risk`: Approved coordination was attempted but no safe plan was confirmed.
- `cancelled`: The authorised user cancelled the coordination attempt.

Each result should include:

- barrier category
- consent status
- minimum necessary information shared
- approved contacts attempted
- confirmed plan, if any
- timestamped audit events
- escalation reason, if any

## Live-call safety rules

Phone calls have real-world side effects.

- Use a no-call simulation or dry-run by default.
- Enable live calling only after explicit user confirmation.
- Do not expose API keys, tokens, transcripts, or full phone numbers in logs or summaries.
- Mask phone numbers in user-facing output.
- Do not create recurring calls without a separate explicit request.
- Prevent duplicate calls for the same case unless an authorised user restarts the workflow.
- Stop outreach immediately if consent is withdrawn.
- Do not use the result of a phone call as clinical advice or emergency guidance.

## Example safe result

```json
{
  "status": "care_secured",
  "barrier": "transport_cancelled",
  "consent": "verified",
  "data_sharing": "minimum_necessary",
  "plan": "Approved provider confirmed a pickup window.",
  "next_action": "Care team monitors attendance.",
  "audit_events": [
    "Barrier verified",
    "First approved provider unavailable",
    "Second approved provider confirmed pickup"
  ]
}
