---
name: veyra-campaign-planner
description: Turn a plain-language outbound phone-call process into an approval-ready Veyra campaign brief, review its generated workflow, and gate any live dispatch behind an exact recipient preview.
license: MIT
---

# Veyra Campaign Planner

Use this skill when a user wants to turn a business calling process into a reusable Veyra workflow and campaign. Produce an actionable campaign brief, help the user review Veyra's generated graph and compiled CALL-E request, and preserve a hard boundary between planning and placing real calls.

This skill does not place calls. Veyra's runnable implementation is in [`apps/web/veyra/`](../../apps/web/veyra/); read its README only when setup, execution, or deployment is requested.

## Prepare The Campaign Brief

Gather only information that changes the workflow:

- caller identity and organization
- specific purpose and desired outcome
- recipient source and evidence that contact is authorized
- information to collect, qualification rules, and allowed next steps
- required disclosures, prohibited claims, opt-out behavior, and voicemail behavior
- locale and recipient-local calling window when known independently of the phone number

If a missing detail affects authorization, safety, or a real-world commitment, stop and ask for it. Otherwise state a conservative assumption.

Return:

1. A concise workflow name.
2. One plain-English Veyra prompt describing the goal, conversation stages, branches, fields to capture, qualification criteria, next steps, and restrictions. Describe intent rather than fixed speech so CALL-E can converse naturally.
3. A short review checklist covering consent, terminal branches, captured fields, qualification logic, and prohibited actions.

Do not invent contacts, phone numbers, consent, company policy, offers, appointment availability, or facts the caller has not supplied.

## Review The Generated Workflow

After Veyra generates or edits the graph, verify:

- exactly one start and at least one terminal path
- AI identity, organization, purpose, and permission occur before substantive questions
- refusal, opt-out, wrong-person, and do-not-contact paths end without persuasion
- every decision edge is understandable and every captured field is used or returned
- qualification rules reference fields actually collected
- next steps are bounded and do not promise unavailable transfers, bookings, prices, approvals, or callbacks
- the compiled CALL-E task preserves intent without forcing a monotonous verbatim script
- the result schema distinguishes negative answers from unknown, unavailable, or unestablished outcomes

Revise the workflow before compiling if any check fails. See [`references/examples.md`](references/examples.md) for brief-to-prompt examples.

## Preview And Approval Boundary

Keep Veyra in fake mode while authoring and testing. Before any live launch:

1. Read [`references/safety.md`](references/safety.md).
2. Require valid E.164 contacts and explicit authorization for every recipient.
3. Show the exact call count, masked recipients, locale, personalized tasks, result schema, and stated side effects.
4. Require approval of that exact preview. Any changed recipient, task, schema, locale, schedule, or call mode invalidates approval.
5. Submit once. Never automatically retry a timeout or uncertain provider response; the first attempt may have connected.

Withholding approval cancels the workflow before dispatch. Once the worker submits a call, report that Veyra cannot cancel it. Stop the worker to pause unsubmitted queue items, but make clear that paused messages remain queued.

## Output Format

Use this compact shape unless the user requests another format:

```markdown
Workflow name: ...

Veyra prompt:
...

Review before compile:
- ...

Execution state: draft only; no call placed
```

Never imply that generating, compiling, previewing, or planning a campaign placed a call.
