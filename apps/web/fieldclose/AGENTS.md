# Agent Instructions

These instructions apply to the entire FieldClose repository.

## Language

Write all repository-facing code, documentation, examples, UI copy, and test descriptions in English. Chinese may be used in private planning conversations, but not in files intended for the public CALL-E contribution.

## Product boundary

FieldClose is a focused, human-approved commercial HVAC work-order closeout application. Do not turn it into a general outbound-call dashboard, marketing dialer, diagnostic assistant, payment tool, or autonomous dispatch system.

## Phone-call safety

Treat every live phone call as a real-world side effect.

- Default all local development, automated tests, and demos to dry-run, fake-server, or no-call behavior.
- Never place a live call without an explicit operator approval tied to the exact recipient and call brief.
- Never guess a phone number, country code, timezone, contact authorization, or missing work-order fact.
- Validate E.164 phone numbers and applicable calling windows before call creation.
- Use a stable idempotency key and reject duplicate call creation for the same approved attempt.
- Disclose that the caller is an AI assistant acting for the contractor.
- Support wrong-person, refusal, do-not-call, voicemail, no-answer, partial-answer, and ambiguous-result paths.
- Mask phone numbers in logs, screenshots, examples, summaries, and test output.
- Do not commit API keys, tokens, private phone numbers, recordings, or private transcripts.

## Agent authority

The phone agent may collect only the approved closeout information. It must not diagnose equipment, quote or negotiate price, approve work, promise arrival times, authorize invoices or payments, provide professional advice, or handle emergencies. Escalate these cases to a human.

## Source of truth

- `docs/product-spec.md` defines product scope and acceptance criteria.
- `docs/call-workflow.md` defines call behavior and decision paths.
- `docs/data-contracts.md` defines domain and integration payloads.
- `docs/safety-and-operations.md` defines mandatory operational controls.
- `docs/architecture.md` records system boundaries and state transitions.

When implementation and documentation disagree, stop and resolve the discrepancy rather than silently changing the product boundary.

## Change and validation discipline

- Establish the available validation baseline before the first code edit.
- Make one logical change at a time when practical.
- Run the narrowest relevant validation after each logical change.
- Do not fix unrelated baseline failures without authorization.
- Once a TypeScript project exists, use its project-specific type-check command; use `npx tsc --noEmit` only when no project command exists.
- Do not describe live CALL-E behavior as verified unless an authorized live test produced inspectable evidence.
