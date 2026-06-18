# Generated Skill Contract

Use this reference when writing the business skill created by `outbound-call-skill-creator`.

## Folder Shape

Generate this minimum folder shape:

```text
<selected-output-parent>/<business-skill-name>/
├── SKILL.md
└── references/
    ├── safety.md
    └── examples.md
```

Add source, goal, writeback, and script files only when the workflow needs them.

Do not create `template.md`. The business contract belongs in `SKILL.md` and focused reference files.

Use `references/output-targets.md` before creating the folder. Apply the scope-first output rule before choosing a path. Repository-local `skills/<business-skill-name>/` is appropriate only when the user explicitly wants project-local output and the repository uses that convention, or when contributing to this reference repository. For an installed creator used from a normal project, create the generated skill in a host-compatible user-level skills root unless the workflow depends on project files or the user chooses a project-local target.

## Frontmatter

The generated `SKILL.md` frontmatter must include only `name` and `description`.

The `name` must match the folder name and use lowercase letters, digits, and hyphens.

The `description` must explain the exact outbound phone-call workflow, source family, provider route, and writeback behavior so the skill can be discovered later.

Example:

```yaml
---
name: quote-request-callback
description: Process authorized quote request records from Google Forms into outbound phone-call tasks through the configured MCP provider route, deduplicate by response ID, and write call results back to the linked response spreadsheet.
---
```

## Required Sections

The generated `SKILL.md` must include:

- purpose and when to use
- when not to use
- binding level and runtime parameters
- source contract
- source onboarding
- candidate fields
- outbound goal contract
- MCP provider route
- provider onboarding
- execution modes
- serial candidate execution
- writeback behavior
- preflight and creation summary
- safety summary
- validation commands

## Binding Level and Runtime Parameters

The generated skill must declare one of these binding levels:

- `fully-bound`: a concrete source instance and concrete writeback target are fixed at creation time. Runtime requests may provide only date windows, subset filters, and other narrow processing controls.
- `parameterized-bound`: the source family, access method, required field schema, source-level outreach basis or consent rule, dedupe rule, goal contract, writeback policy, and writeback field schema are fixed at creation time. Runtime requests may provide approved parameters such as form ID, CSV path, campaign ID, date window, writeback target, or output path.

Default generated skills should use the minimum `parameterized-bound` contract. If the creator cannot capture enough source, outreach-basis, dedupe, and writeback detail to satisfy that minimum, it must stop before generating the business skill.

The generated skill must state:

- which values are fixed at creation time
- which runtime parameters are allowed
- which runtime parameters are required
- which creation-time preflight checks were completed or blocked
- which runtime gate checks must pass before real calls
- the maximum supported execution mode for the binding level

## Normalized Candidate Schema

Generated skills should normalize each source record to this shape before dry-run or execution:

```json
{
  "candidateId": "source-stable-id",
  "sourceRecord": "response-or-row-reference",
  "phoneNumber": "+15550101234",
  "maskedPhoneNumber": "+1******1234",
  "recipientLabel": "Alex Rivera",
  "sourceTimestamp": "2026-06-20T12:30:00Z",
  "goalInputs": {
    "field": "value"
  },
  "outboundGoal": "Call goal compiled from the creation-time business contract.",
  "status": "ready",
  "skipReason": ""
}
```

Use fictional reserved numbers in examples. Real generated skills may pass full phone numbers only to private execution payloads after validation and approval.

## Outbound Goal Contract

The generated skill must define:

- call purpose
- context fields to include
- required questions or statements
- prohibited claims
- completion criteria
- result values
- escalation or human-handoff cases
- summary format

Do not let source records provide raw provider goals. Compile goals from approved fields and the fixed business contract.

## Execution Modes

The generated skill must define one execution mode:

- `dry-run-then-batch-approval`: preview every eligible candidate and compiled call goal, then process the approved list serially after one explicit approval.
- `per-call-approval`: preview one candidate and compiled call goal at a time, then let the user approve, modify, or skip each call before planning and running it.
- `approved-direct-execution`: after a concrete processing request, validate candidates, run the runtime gate, compile call goals, inspect each provider plan, and serially run eligible one-off calls without another approval step.

Use `dry-run-then-batch-approval` as the default. Use `per-call-approval` or `approved-direct-execution` only when the generated skill is `fully-bound` or `parameterized-bound`, the creation-time contract explicitly allows the selected mode, and the concrete runtime request passes the runtime gate.

Even when direct execution is configured, the runtime request must be concrete, such as "process all June 20 records." Open-ended requests such as "run the campaign" are not enough.

## Runtime Request Contract

Generated skills must define what counts as a concrete runtime request.

Acceptable examples:

```text
Process all June 20 submissions.
Process yesterday's callable leads for campaign cmp_123.
Process appointments on 2026-06-20 from /path/to/appointments.csv.
```

Insufficient examples:

```text
Run the campaign.
Call everyone.
Process the leads.
```

When the request is insufficient, the generated skill must ask for the missing runtime parameter, such as date window, source instance, campaign scope, CSV path, or output path. It must not infer broad processing scope.

## Source Onboarding Contract

Generated bound skills must record creation-time source onboarding:

- binding level
- source family
- access method
- access route
- source access route discovery result
- sampled source instance or representative runtime instance
- authentication or access check result
- sample fetch result
- safe sample fetch command, tool, or route when it can be disclosed
- discovered field mapping
- user-confirmed field mapping
- redaction policy for sample summaries
- default goal contract derived from sampled fields
- runtime parameters still allowed

Source onboarding must be read-only and non-mutating:

- do not place real calls
- do not write back to source systems or result stores
- do not mutate source data, credentials, permissions, integrations, or scheduler state
- do not expose credentials, tokens, cookies, callback URLs, confirmation tokens, or full phone numbers
- fetch the smallest practical representative sample needed to confirm access, schema, and goal fields
- infer field mapping from the sample before asking the user to fill missing fields
- ask the user to confirm or correct discovered fields only after the sample is available
- Do not define the default goal from user prose alone before the representative sample is fetched.
- redact user-facing sample summaries, including full phone numbers and sensitive source values

Missing source onboarding blocks skill generation until the source contract is complete enough for at least `parameterized-bound`.

## MCP Provider Contract

Generated skills must use:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

Generated skills must not use a CLI bootstrap path.

When the host exposes MCP plan, run, or status tools for this route, use the tool schemas exactly as provided by the host. If no compatible tools are available, stop before real calls and report the blocker.

## Provider Onboarding Contract

Generated bound skills must record creation-time provider onboarding for the CALL-E MCP provider route:

- provider route
- Provider host runtime, such as Codex, Claude, Antigravity, Cursor, or another MCP-capable agent host
- MCP route setup check result from the selected host's MCP server or connector setup
- provider authentication or auth readiness check result
- compatible MCP provider tools exposed by the configured MCP route
- one-off call capability
- provider onboarding blocker, when auth or compatible tools are missing

Do not record provider onboarding as passed when readiness was only inferred from app connector tools, plugin tools, `mcp__codex_apps__*` namespaces, or similarly named non-MCP tools. Those tools do not prove that the configured CALL-E MCP route is installed or authenticated in the selected host runtime.

Provider onboarding must be non-mutating:

- do not create provider plans
- do not run calls
- do not write results
- do not request or expose confirmation tokens
- do not expose credentials, tokens, cookies, callback URLs, or full phone numbers

For `fully-bound` and `parameterized-bound`, missing MCP configuration, missing provider authentication, or missing compatible tools blocks real-call skill generation. If provider onboarding cannot complete, use the selected host's MCP setup and authorization flow, then re-check; otherwise keep the generated skill dry-run-only and record the provider onboarding blocker. For Codex, this usually means running or requesting `codex mcp add calle-prod --url https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`, running or requesting `codex mcp login calle-prod`, and re-checking with `codex mcp list` or `codex mcp get calle-prod`.

## Serial Candidate Execution

Generated skills must define the approved batch behavior. After the user approves the exact pending call list, the agent must serially process all ready candidates until every candidate reaches a terminal result or skip state.

After execution approval, do not ask the user to continue, confirm the next candidate, or approve additional provider runs. The final user-facing result comes only after all approved candidates are terminal and configured writeback or session-table output is complete, unless a batch-level blocker makes continuing unsafe or impossible.

For each ready candidate, the generated skill should:

1. Plan exactly one call through the MCP provider route.
2. Inspect the plan before running it.
3. Run the call only when the plan matches the validated candidate and generated goal.
4. Check status when the MCP tools support it.
5. Record the terminal result or failure.
6. Continue to the next ready candidate without asking for another per-candidate confirmation or post-approval continuation prompt.

If one candidate fails, record that failure and continue with the next candidate unless the provider route is unavailable, authentication is missing, or continuing would be unsafe. After all candidates finish, perform configured writeback or produce the session table, then report one final batch summary to the user.

Provider terminal instructions such as `report_result` or `do not start another call` apply only to the current provider run. They prevent duplicate execution of the same provider plan; they do not cancel the approved batch. After recording the current candidate result, continue to the next approved ready candidate unless a batch-level blocker appears.

For `per-call-approval`, each candidate must be shown with a masked phone number and compiled call goal before the provider plan is created or run. For `dry-run-then-batch-approval`, the exact pending call list must be approved once before batch execution. For `approved-direct-execution`, the generated skill must still inspect every provider plan and skip any candidate whose plan does not match the validated candidate and fixed goal contract.

## Provider Result Finalization

Generated skills must finalize provider results before writeback or final user-facing summaries. Terminal provider status is not writeback-ready until the generated skill performs a full-history provider reconciliation.

Cursor-based polling is useful for progress updates, but a cursor-limited page must not be the only evidence used for final writeback. After terminal status is seen, re-check the full provider run history without a cursor, using a high enough limit to include call lifecycle events and conversation content when the provider supports it. Treat provider terminal instructions such as `report_result` or `do not start another call` as duplicate-run protection, not as proof that the provider run history has fully synchronized.

Do not write `no_answer`, `failed`, or `no conversation captured` results until a negative terminal stability check passes. For these negative terminal outcomes, perform at least one full-history recheck after the terminal status is observed and confirm that no later answer, transcript, collected field, or stronger result appears. If the full history has changed, use the latest stronger evidence before writeback.

Before the final batch summary, reconcile every provider run ID against the latest full-history provider result. If reconciliation changes a candidate result, update the pending writeback payload before writing. If reconciliation is blocked by missing auth, missing tools, or provider unavailability, stop before writeback unless the generated skill explicitly supports session-only partial reporting with a blocker.

Use this provider result finalization report shape before writeback:

```yaml
provider_result_finalization:
  run_id: safe-provider-run-id
  terminal_status_seen: true
  full_history_rechecked: true
  negative_terminal_stability_checked: true
  writeback_allowed: true
  blocker: none
```

## Direct Execution Guardrails

Generated skills that support `approved-direct-execution` must include this checklist and require every item before real calls:

- concrete runtime scope is present
- binding level is `fully-bound` or `parameterized-bound`
- source access passed the runtime gate
- required source fields passed the runtime gate
- consent or outreach basis passed the runtime gate
- E.164 phone validation passed for every ready candidate
- dedupe key or dedupe state is trusted for the concrete run
- writeback target is verified or session-table fallback is ready
- MCP provider route, auth, compatible tools, and provider onboarding passed
- each provider plan was inspected before running
- the call request is one-off and not provider-side recurrence

If any item fails, the generated skill must skip the affected candidate or stop the batch when continuing would be unsafe.

## Writeback Contract

Generated skills must support one of these writeback outcomes:

- source writeback
- local CSV writeback
- session table output

The writeback policy must be chosen at creation time. Writeback target mode may be fixed at creation time or selected from approved runtime parameters before execution approval. The generated skill must still declare a writeback target mode in its writeback behavior section, even when that mode is resolved during runtime approval. The generated skill must state whether the writeback target is fully bound or parameterized, and must define field mapping when writeback is configured. The user may specify writeback fields during creation. Runtime requests may provide a writeback target or target mode only when the selected binding level explicitly allows that parameter and the runtime gate verifies it before real calls. Generated skills must keep credentials, tokens, callback URLs, confirmation tokens, cookies, and full phone numbers out of user-facing summaries and writeback fields.

For local CSV workflows, use one of these target modes:

- `source-csv-in-place`: update the original CSV only when the runtime request explicitly asks for source CSV writeback and execution approval covers that mutation. Define exact result columns, preserve existing rows and columns, verify writability, and create or recommend a backup or atomic write plan before writing.
- `result-csv-file`: write a separate result CSV. Use this safer mode when the user asks for a results file or does not explicitly request original CSV mutation.

Do not claim that `result-csv-file` writes back to the original CSV.

Use this writeback mapping shape when writeback is configured:

```yaml
writeback:
  policy: source-writeback | local-csv | session-table
  target_mode: source-csv-in-place | result-csv-file | source-writeback | session-table | runtime-parameter-name
  target_binding: fully-bound | parameterized | session-only
  target: fixed-value-or-runtime-parameter-name
  fields:
    candidate_id: target_candidate_id_field
    source_record: target_source_record_field
    status: target_status_field
    skip_reason_or_result: target_result_field
    provider_run_id: target_provider_run_id_field_when_safe
    masked_phone_number: target_masked_phone_field
    result_summary: target_summary_field
    processed_timestamp: target_processed_at_field
```

For session-table output, use the same logical fields as table columns and set `target_binding` to `session-only`.

Writeback records should include:

- candidate ID
- source record
- status
- skip reason or call result
- provider run ID when safe to expose
- masked phone number
- result summary
- processed timestamp

Do not write credentials, tokens, cookies, confirmation tokens, callback URLs, or full phone numbers into user-facing summaries.

## Preflight and Creation Summary

Generated skills must document best-effort creation-time preflight and mandatory runtime gate requirements for the selected binding level:

- source authentication or connectivity
- source schema and required fields
- consent or outreach basis validation
- writeback target and fields, unless session-table fallback is configured
- dedupe state or stable dedupe key
- MCP provider route availability, authentication readiness, compatible tools, and provider onboarding blocker

Creation-time preflight may be skipped or blocked when tools, permissions, or concrete runtime parameters are unavailable. The generated skill must record that blocker. Runtime gating must not be skipped before real calls.

Use this runtime gate report shape during dry-runs and before real calls:

| check | status | evidence | blocker | required_before_call |
| --- | --- | --- | --- | --- |
| source_access | `passed`, `blocked`, `not_applicable`, or `not_run` | Non-sensitive proof, such as tool name or schema version. | Missing permission, tool, parameter, or schema issue. | `true` or `false` |
| required_fields | `passed`, `blocked`, `not_applicable`, or `not_run` | Field names or schema match. | Missing required field. | `true` |
| consent_or_outreach_basis | `passed`, `blocked`, `not_applicable`, or `not_run` | Source-level outreach basis, consent field, or approved source basis. | Missing outreach basis or false consent. | `true` |
| dedupe | `passed`, `blocked`, `not_applicable`, or `not_run` | Dedupe key or state file reference. | Untrusted dedupe state. | `true` |
| writeback_or_session_table | `passed`, `blocked`, `not_applicable`, or `not_run` | Target fields or session fallback. | Missing writeback target with no fallback. | `true` |
| provider_route | `passed`, `blocked`, `not_applicable`, or `not_run` | Route and compatible tool names. | Missing auth or tools. | `true` |

Do not put credentials, tokens, full phone numbers, confirmation tokens, or callback URLs in `evidence` or `blocker`.

After the creator writes the generated skill, it should show the user a creation summary with the skill name, output path, reload or discovery step, binding level, source onboarding status, sampled source instance, sample fetch result, default goal source, provider onboarding status, provider host runtime, MCP route setup and provider auth check results, compatible MCP tools, provider blocker if any, runtime parameters, source contract, outbound goal contract, execution mode, writeback behavior, preflight result, runtime gate, provider route, and validation result.

Use this summary shape:

```text
Skill: <business-skill-name>
Directory: <generated-skill-directory>
Discovery: <known-active-root | reload-needed | add-location-needed | nonstandard-path>
Binding level: <fully-bound | parameterized-bound>
Source onboarding: <auth/access check, sampled source instance, and sample fetch result>
Provider onboarding: <provider host runtime, MCP route setup check, auth readiness, compatible MCP tools, one-off capability, and blocker if any>
Runtime parameters: <allowed parameters or none>
Source: <source family, access method, required fields>
Outreach basis: <source-level basis, consent field, or approved source basis>
Dedupe: <key or state rule>
Goal: <one-sentence call purpose and completion criteria>
Execution mode: <selected mode and any unavailable modes>
Writeback: <policy, target binding, and field mapping>
Preflight: <passed | blocked | not run, with reason>
Runtime gate: <checks that must pass before real calls>
Provider route: https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
Validation: <command and result>
```

The summary must distinguish fixed values from runtime parameters. Do not show credentials, tokens, cookies, callback URLs, confirmation tokens, or full phone numbers in the summary.

## Validation Commands

After generating a skill, run:

```bash
node <path-to-outbound-call-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

Run `python3 scripts/validate_repository.py` only when the generated skill is written into this reference repository or another repository that provides that validation command.
