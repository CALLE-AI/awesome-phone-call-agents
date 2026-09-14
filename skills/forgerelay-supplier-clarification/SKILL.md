---
name: forgerelay-supplier-clarification
description: Use CALL-E to collect missing manufacturing RFQ details from an authorized supplier contact through a bounded, approval-gated phone call, then return structured answers without negotiating or making commitments.
---

# ForgeRelay Supplier Clarification

## Purpose And When To Use

Use this skill when a manufacturing RFQ cannot safely move forward because a small set of factual details is missing and the user wants CALL-E to ask an authorized supplier contact for those details.

The skill is intentionally narrow. It collects bounded facts such as material, process, quantity, tolerance, finish, drawing revision, inspection needs, and requested delivery date. It does not negotiate, accept a quotation, place an order, approve a supplier, or make legal or commercial commitments.

Use this skill for:

- clarification calls about missing or conflicting RFQ fields
- follow-up on a known request or drawing revision
- collecting structured answers for an RFQ operations record
- a one-off call to a recipient whose outreach basis or consent is documented

## When Not To Use

Do not use this skill to:

- make cold calls when the outreach basis is unclear
- negotiate price, payment, warranty, liability, intellectual property, or contract terms
- authorize production, approve a quote, place or cancel an order, or select a supplier
- request export-controlled, classified, medical, financial, or other highly sensitive information
- infer a phone number, country code, timezone, language, or recipient consent
- create recurring calls or retry a failed call without separate authorization
- call emergency services or use the workflow for urgent safety incidents

## Binding Level And Runtime Parameters

Selected binding level: `parameterized-bound`

The source family and field schema are fixed, while the concrete local JSON request, approved result path, recipient, questions, and CALL-E host are runtime parameters. This skill never binds credentials, phone numbers, or provider tool names at creation time.

Runtime parameters still allowed: request JSON path, local result CSV path, language, region, deadline, and an authenticated host runtime that exposes the required CALL-E route.

## Source Contract

Source family: `local-json-rfq-clarification`

The source is one local JSON object that follows the required candidate fields below. The deterministic validator reads it without network access, rejects malformed input, masks the phone number, and produces an idempotent dry-run preview. It does not mutate the source.

### Candidate Fields

Require all of these fields before preparing a call:

- `requestId`: stable RFQ or task identifier
- `supplierLabel`: non-sensitive recipient or organization label
- `phoneNumber`: authorized E.164 destination
- `outreachBasis`: structured, recipient-specific contact basis with `type` and `reference`
- `callerIdentity`: business identity CALL-E should state
- `questions`: one to eight bounded clarification questions
- `allowedContext`: facts CALL-E may disclose during the call
- `resultTarget`: durable destination for the structured result

Each question must have:

- `id`: stable lowercase identifier
- `category`: one allowed factual category
- `prompt`: one factual question
- `required`: boolean

Allowed outreach types are `explicit-recipient-consent`, `existing-supplier-relationship`, and `inbound-follow-up-request`. A public listing is not an outreach basis.

Optional fields are `language`, `region`, `deadline`, and `notes`. Do not infer them. Because prompts, context, and basis references contain free text, the first successful validation returns `pending-safety-review` and a SHA-256 `safetyReviewHash`. After a human or authorized agent reviews the exact preview, add:

```json
{
  "safetyReview": {
    "status": "approved",
    "reviewedBy": "reviewer identity",
    "contentHash": "exact safetyReviewHash"
  }
}
```

Any safety-relevant edit invalidates that approval and changes both the review hash and idempotency key.

Use `scripts/validate-clarification-input.mjs <input.json>` when a JSON request is available. The script validates and prints a masked dry-run preview. It never places a call.

## Outbound Goal Contract

The outbound goal is to collect answers only for the ordered `questions` in the source object and return them for human review. CALL-E may state `callerIdentity`, `requestId`, and `allowedContext`. It must not infer other facts, negotiate, make commitments, or expand the question set.

The call is successful when the recipient answers one or more approved questions or explicitly requests a human follow-up. An unanswered required question produces `partial`, not an invented value.

## Source Onboarding

Source access route: local JSON file passed to the bundled Node.js validator.

Source access route discovery result: the repository fixture and validator provide a concrete read-only local route.

Authentication or access check result: passed; the validator read the local fixture successfully.

Sample fetch result: passed; `assets/example-request.json` produced a valid masked dry-run preview.

Sampled source instance: `assets/example-request.json`, containing fictional RFQ `RFQ-DEMO-1042`.

Discovered field mapping: top-level RFQ fields plus ordered `questions[].id`, `questions[].prompt`, and `questions[].required`.

Field mapping confirmed after the representative sample: the validator and example use the same required input contract.

Default goal contract derived from sampled fields: ask the ordered factual questions using only the approved context.

Redaction policy for sample summaries: mask phone numbers and omit credentials, private personal data, and unapproved context.

Runtime parameters still allowed: request JSON path, result CSV path, language, region, deadline, and authenticated CALL-E host runtime.

## Provider Onboarding

MCP provider route: `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`

Provider host runtime: blocked until the operator selects and configures an MCP-capable host for the runtime task.

MCP route setup check result: blocked; the required route is not configured by this portable repository package.

Provider authentication check result: blocked; OAuth must be completed in the selected host before a real call.

Compatible MCP provider tools: `plan_call`, `run_call`, and `get_call_run` are unavailable until route onboarding completes.

One-off call capability: blocked; real calls remain disabled until the host verifies plan, run, and status tools.

Provider onboarding blocker: configure the required CALL-E MCP route, complete provider authentication, and verify concrete plan, run, and status tools in the selected host.

The workflow remains dry-run-only while this provider onboarding blocker exists. Route readiness must come from the selected host's MCP setup and authentication checks. It must not use a CLI bootstrap path. Do not treat similarly named app or plugin tools as provider readiness evidence.

## Execution Modes

Selected execution mode: `dry-run-then-batch-approval`

Preview every eligible candidate and compiled call goal, then ask the user to approve the exact pending list. `approved-direct-execution` is unavailable for this portable skill because its provider and concrete source instances are resolved only at runtime.

Every runtime gate must pass before a real call. A failed source, consent, dedupe, output, route, authentication, tool, or provider-plan check keeps the task in dry-run-only mode.

## Workflow

1. Read `references/safety.md`.
2. Validate the required input contract.
3. Check that the outreach basis applies to this exact recipient and request.
4. Check that the result target is a writable, new local CSV path and compute the content-bound idempotency key from the full safety contract:

   ```text
   request + recipient + basis + caller + full questions + allowed context + result path + locale fields
   ```

5. Require a matching `safetyReviewHash` before reporting the request as dry-run ready.
6. Reject a duplicate completed or active task with the same idempotency key.
7. Produce a dry-run preview containing the exact basis, caller identity, masked destination, allowed context, ordered question prompts and categories, forbidden actions, and result path.
8. Ask the user to approve the exact call preview unless a previously approved runtime contract explicitly covers this exact task.
9. Discover the authenticated CALL-E tools exposed by the host. Do not invent tool names or parameters.
10. Prepare one call plan. Inspect it before execution.
11. Run the plan only when it targets the approved E.164 number and preserves every boundary in the preview.
12. Check status until the provider reports a terminal result. Reconcile the full available history before finalizing a negative result.
13. Write the structured result to the approved durable target. Report the masked destination, status, answered question ids, unresolved question ids, and provider run id when safe.

Use this execution shape:

```text
validate -> deduplicate -> preview -> approve -> plan -> inspect -> call once -> reconcile -> write result
```

## Serial Candidate Execution

After execution approval, do not ask the user to continue, confirm the next candidate, or approve additional provider runs. Serially process all ready candidates in the exact approved list.

For each candidate, prepare one provider plan, inspect it, place at most one call, reconcile provider status, and write the durable result before moving to the next candidate. Record a candidate failure or skip and continue unless the provider route, authentication, or result output has become unavailable or continuing would be unsafe.

Provider terminal instructions such as `report_result` or `do not start another call` apply only to the current provider run. They prevent duplicate execution of that plan; they do not cancel the remaining approved candidates.

## Call Behavior

CALL-E should:

- identify the caller business and the RFQ or request id
- ask whether the recipient can discuss the request
- ask only the approved questions
- allow the recipient to decline, stop, or ask for a human follow-up
- repeat an answer only to confirm transcription
- label uncertain answers as uncertain
- end the call when the recipient asks to stop

CALL-E must not:

- invent missing context
- reveal information outside `allowedContext`
- pressure the recipient
- agree to price, lead time, payment, quality, warranty, liability, or contract terms
- confirm an order, award, production release, or supplier approval
- make an unapproved follow-up call

## Result Contract

Write one result object:

```json
{
  "requestId": "RFQ-DEMO-1042",
  "status": "completed",
  "answered": [
    {
      "questionId": "material-grade",
      "answer": "6061-T6",
      "confidence": "stated-by-recipient"
    }
  ],
  "unresolvedQuestionIds": [],
  "recipientRequestedHumanFollowUp": false,
  "notes": [],
  "providerRunId": "provider-safe-id",
  "completedAt": "2026-07-26T18:00:00Z"
}
```

Allowed statuses are `not-approved`, `blocked`, `duplicate`, `completed`, `partial`, `declined`, `no-answer`, and `failed`.

Do not write a negative terminal result until provider history has been rechecked and the status is stable. Do not store a full phone number, credentials, or an unredacted transcript in the result.

## Provider Result Finalization

Terminal provider status is not result-output-ready until the agent performs full-history provider reconciliation without relying only on a cursor-limited status page. For `no-answer`, `failed`, or other negative outcomes, also perform a negative terminal stability check.

Finalize one report with `run_id`, `terminal_status_seen`, `full_history_rechecked`, `negative_terminal_stability_checked`, `result_output_allowed`, and `blocker`. Do not write source results, the local result CSV, or a final session table until `result_output_allowed` is true.

## Result-Output Behavior

Result target mode: `local-result-csv`

Write a new local result CSV at the user-approved runtime path. Never modify the source JSON. Use one row per task with request id, supplier label, masked phone, status, answered question ids, unresolved question ids, human-follow-up flag, provider run id when safe, redacted result summary, and processed timestamp.

Durable result output preference:

1. Use verified source writeback only when a future bound source explicitly provides a safe update route.
2. Otherwise use a verified source-adjacent result artifact when the source system supports it.
3. Default to the approved `result-csv-file` path for this local JSON source.
4. Use a session-table only as a last-resort attended fallback, label it non-persistent, and never use it for unattended work.

Validate the output parent, create a new file rather than overwriting an existing result, and never write full phone numbers or credentials.

## Failure And Cancellation

- If authorization, consent, destination, provider authentication, or result output cannot be verified, stop before calling.
- If the plan differs from the approved preview, discard it and report `blocked`.
- If the recipient declines or asks to stop, end the call and report `declined`.
- If the user cancels before execution, discard the plan. There is no recurring job to cancel.
- If a call is in progress, use the provider's supported stop action when available. Do not start a replacement call automatically.
- A retry is a new real-world side effect and requires a new preview and approval.

## Preflight And Creation Summary

Creation-time preflight verified the repository fixture, source schema, masked dry-run validator, and local read-only source access. Provider route setup and authentication are intentionally blocked in this portable package, so the skill remains dry-run-only until runtime onboarding passes.

At runtime, summarize:

- selected binding level and accepted runtime parameters
- source instance, access check, field mapping, and sample validation
- outreach basis, dedupe key, approved goal, and exact pending candidates
- result target mode, path, schema, and writability
- provider host, route setup, authentication, compatible tools, and blocker
- each mandatory runtime gate and whether it passed

Do not claim a call, result write, or onboarding step succeeded without direct evidence.

## Safety Summary

The skill requires explicit task authorization, a recipient-specific outreach basis, E.164 validation, masked summaries, bounded questions, minimal disclosed context, idempotent deduplication, one call per approved task, and a durable result path. It creates no recurring schedule and never retries automatically.

Read `references/safety.md` before runtime. Phone calls remain blocked until every runtime gate passes.

## Validation Commands

From the repository root, run:

```bash
node skills/forgerelay-supplier-clarification/scripts/validate-clarification-input.mjs skills/forgerelay-supplier-clarification/assets/example-request.json
node skills/forgerelay-supplier-clarification/scripts/check-trust-boundaries.mjs
node skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs --skill-dir skills/forgerelay-supplier-clarification
python3 "$PWD/scripts/validate_repository.py"
```

## Examples

Read `references/examples.md` for a valid fictional dry run and rejection cases.
