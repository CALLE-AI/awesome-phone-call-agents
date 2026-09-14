# Safety Reference — insurance-call-recovery

## Explicit user intent

No call is planned from an implied task. The unresolved task, type, destination, and intended outcome must be explicitly present before planning. No live call is executed without explicit approval after the preview.

## E.164 validation

The destination must already be an authorized E.164 number. Reject malformed numbers; never guess or silently rewrite a number.

## Phone-number masking

Any destination shown in a preview, log, summary, or result must be masked. Full numbers remain inside the call-execution path only.

## Credential protection

CALL-E credentials are loaded from environment configuration and never written to task text, logs, fixtures, transcripts, or structured results.

## AI disclosure

Every live call must disclose at the beginning that the caller is an AI agent, before task-specific questions. Never impersonate an employee, customer, adjuster, carrier representative, or other real person.

## No hidden recurring jobs

This skill makes at most one call per explicitly approved task. It does not create recurring schedules or automatic redials.

## Duplicate-call prevention

Before a live call, check whether the same recovery identity already has a terminal result. Do not place a duplicate terminal task.

## Dry-run behavior

Dry-run is the default entry point for testing and demos. It uses fixture transcripts and never invokes the live CALL-E execution operation.

## Evidence verification

A recovered or partially recovered outcome must be directly supported by transcript content attributable to the called party. Do not infer missing fields.

## Fail-closed outcomes

No-answer, refusal, ambiguity, conflicting information, or failed verification must never be reported as recovered.

## Human escalation

Escalate when intent, destination, identifiers, or outcome cannot be safely verified, or when the request exceeds scope.

## Insurance / financial boundaries

The workflow relays and records information. It does not adjudicate claims, provide legal or financial advice, alter coverage, invent policy terms or decisions, or make promises on the agency's behalf.

## Cancellation / rollback

There are no recurring jobs. Before `run_call`, withdrawing approval stops the call. After a call has started, the adapter does not claim rollback of an external phone side effect; human follow-up is required for any resulting remediation.

## Voicemail

Do not leave sensitive claim, billing, or policy details on voicemail unless an explicitly authorized scripted voicemail message is part of the task.

## Logging

Do not log authorization headers, API tokens, full phone numbers, transcripts containing unnecessary personal information, or customer identifiers beyond what the task requires.
