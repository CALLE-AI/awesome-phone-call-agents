# Fictional Examples

These examples contain fictional organizations and no phone numbers. They illustrate campaign briefs, not authorization to call anyone.

## Restaurant Feedback

Workflow name: `Guest Visit Follow-up`

Veyra prompt:

```text
Call opted-in guests on behalf of Harbor Table, identify the caller as an AI assistant, explain that the purpose is feedback about their previous visit, and ask permission to continue. If they decline, reach the wrong person, or opt out, end politely and record the appropriate disposition. If they agree, ask what went well, what could improve, and whether they intend to visit again. If they express interest, ask which upcoming week they prefer, but do not promise a reservation, discount, or event. Capture consent, sentiment, feedback themes, return intent, preferred week, and next step. Treat unanswered questions as unknown.
```

Review before compile:

- Feedback is collected only after permission.
- Opt-out and wrong-person branches terminate.
- Return intent does not create a reservation.
- Results distinguish no answer, refusal, and unknown intent.

## Education Enquiry

Workflow name: `Course Enquiry Qualification`

Veyra prompt:

```text
Call people who explicitly requested information from fictional Northbridge Academy. Disclose the AI caller, organization, and course-enquiry purpose, then ask permission. If they agree, ask which programme they are considering, intended start period, preferred study format, and whether funding is already arranged, being explored, or unknown. Answer only approved programme FAQs. Do not make admissions, scholarship, visa, or financing promises. Capture the answers, unanswered questions, qualification status, and whether a human admissions callback is requested.
```

Review before compile:

- The contact source establishes a requested follow-up.
- Funding collection excludes account or payment details.
- Qualification does not imply admission.
- A callback is requested, not promised for an invented time.

## Insurance Renewal Information

Workflow name: `Renewal Information Check`

Veyra prompt:

```text
Call policyholders who authorized a renewal follow-up from fictional Alder Insurance. Identify the AI caller and purpose and ask permission before discussing the policy. Verify only that the intended policyholder is speaking without requesting sensitive identity data. If authorized to continue, collect whether property details changed, whether they want a human review, and their preferred callback window. Do not recommend coverage, quote a premium, determine eligibility, or claim that a policy is renewed. Capture identity status, consent, change categories, review request, preferred window, opt-out status, and unresolved items.
```

Review before compile:

- A wrong-person path reveals no policy details.
- No financial advice, quote, eligibility decision, or renewal occurs.
- Callback preference is not a guaranteed appointment.
- Unverified identity and unclear answers remain unresolved.

Every example remains in draft state until Veyra displays an exact campaign preview and the user explicitly approves the authorized recipients. No example places a call.
