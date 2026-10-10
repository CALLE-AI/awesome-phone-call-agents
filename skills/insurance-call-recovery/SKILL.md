---
name: insurance-call-recovery
description: Recover unresolved insurance agency phone tasks by identifying the intent, contacting the appropriate party through CALL-E, verifying the outcome, and producing an evidence-backed result.
---

# Insurance Call Recovery

## What this is

This skill recovers one unresolved insurance-agency phone task at a time. It supports claim status, billing, renewal, and policy-service follow-ups.

**A completed phone call does not equal a recovered task.** A task is recovered only when the requested outcome is supported by information attributable to the called party. Otherwise the workflow fails closed and escalates to a human.

This is not an inbound receptionist, sales workflow, claims adjudication system, or coverage-advice system.

## When to use

Use this skill when an agency has a specific, already-identified unresolved phone task and an authorized destination number for the appropriate party.

Do not use it for cold outreach, marketing, inbound receptionist duties, claims adjudication, coverage decisions, legal/financial advice, or destinations that are unknown or unauthorized.

## Supported task types

| Intent | Typical task | Party role |
|---|---|---|
| `claim_status` | Obtain current claim status and next step | Claims department / authorized claims contact |
| `billing` | Confirm review or resolution of a billing issue | Billing / payments contact |
| `renewal` | Confirm renewal intent or required next step | Renewal / policy-servicing contact |
| `policy_service` | Confirm a requested service change was applied | General servicing contact |

If intent cannot be reliably classified, stop for human clarification.

## Required inputs

- `task_description`
- `task_type`
- `destination` — authorized E.164 number
- `intended_outcome`

Optional:

- `policy_or_claim_reference`
- `deadline`
- `previous_call_context`

Do not collect more customer data than the task requires.

## Workflow

1. Identify and classify the unresolved task.
2. Identify the required party role.
3. Validate the authorized E.164 destination.
4. Create a stable `recovery_id`.
5. Check for an existing terminal result for that recovery.
6. Show a preview with the masked destination and intended outcome.
7. Obtain explicit approval.
8. In live mode, execute the CALL-E lifecycle:
   `plan_call` → `run_call` → `get_call_run`.
9. Disclose at call start that the caller is an AI agent, before task-specific questions.
10. Ask only questions needed to resolve the declared task.
11. Verify each claimed outcome against transcript evidence.
12. Apply the evidence gate.
13. Return a structured result.
14. Escalate when evidence is insufficient.

## Side effects

Live mode can place an outbound phone call. No call is placed in dry-run mode.

A live call requires explicit approval after the preview. A task is not automatically retried, scheduled, or redialed.

## CALL-E contract

The demo adapter uses the repository ecosystem's documented lifecycle:

- `plan_call`
- `run_call`
- `get_call_run`

The exact CALL-E API base URL and request/response details are configured through environment variables rather than hard-coded. The adapter accepts a JSON API contract so the skill does not invent a provider SDK.

Before live use, configure the adapter against the current CALL-E API documentation and verify the configured endpoint contract.

Expected logical operations:

```text
POST <CALL_E_BASE_URL>/plan_call
POST <CALL_E_BASE_URL>/run_call
GET  <CALL_E_BASE_URL>/get_call_run/<recovery_id>
```

The live adapter sends the bearer token from `CALL_E_API_TOKEN`; the token is never included in task text, logs, examples, or structured results.

## Structured result

```json
{
  "recovery_id": "irc_2f9a1c3e",
  "status": "recovered",
  "intent": "claim_status",
  "task": "Obtain latest claim status",
  "party_contacted": "claims_department",
  "outcome": {
    "claim_status": "under_review",
    "next_action": "adjuster_review"
  },
  "evidence": {
    "source": "phone_call",
    "verified": true
  },
  "confidence": "high",
  "human_escalation_required": false
}
```

Supported statuses:

- `recovered`
- `partially_recovered`
- `no_answer`
- `refused`
- `ambiguous`
- `human_escalation_required`

## Evidence gate

Never mark a task recovered merely because the call connected, the recipient answered, or the model believes the task is resolved.

`recovered` requires the requested outcome fields to be directly supported by transcript content attributable to the called party.

If the required identifier or outcome cannot be verified, use `ambiguous` or `human_escalation_required`.

## Fail-closed behavior

| Call outcome | Required handling |
|---|---|
| No answer / voicemail only | `no_answer`, escalate |
| Recipient refuses | `refused`, escalate where resolution remains outstanding |
| Unclear/unverifiable answer | `ambiguous` + human escalation |
| Conflicting information | Human escalation |
| Required identifier not confirmed | Human escalation |
| Verified requested outcome | `recovered` |

No automatic redial occurs.

## Idempotency

A recovery identity is derived from the task's identifying fields: intent, destination, task reference, and task description. If a terminal result already exists for the same recovery identity, surface it instead of placing a duplicate call.

## Human escalation

Escalate when:

- intent is ambiguous
- destination is unknown or unauthorized
- identifiers cannot be verified
- information conflicts
- evidence is insufficient
- the request exceeds the skill's scope
- legal, financial, or emergency-sensitive content exceeds supported boundaries

Preserve verified transcript-derived details for the human reviewer.

## Safety boundaries

This skill may retrieve permitted status information, request permitted information, relay verified information, record follow-up actions, and escalate unresolved cases.

It must not independently adjudicate claims, give legal or financial advice, alter coverage, invent policy terms, invent claim decisions, make promises on an agency's behalf, or override human decisions.

See `references/safety.md` and `references/examples.md`.
