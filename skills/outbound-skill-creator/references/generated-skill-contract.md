# Generated Skill Contract

Use this reference when writing the business skill created by `outbound-skill-creator`.

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
- candidate fields
- outbound goal contract
- MCP provider route
- execution modes
- serial candidate execution
- writeback behavior
- preflight and creation summary
- safety summary
- validation commands

## Binding Level and Runtime Parameters

The generated skill must declare one of these binding levels:

- `fully-bound`: a concrete source instance and concrete writeback target are fixed at creation time. Runtime requests may provide only date windows, subset filters, and other narrow processing controls.
- `parameterized-bound`: the source family, access method, required field schema, consent rule, dedupe rule, goal contract, writeback policy, and writeback field schema are fixed at creation time. Runtime requests may provide approved parameters such as form ID, CSV path, campaign ID, date window, writeback target, or output path.
- `unbound-generic`: the skill only fixes the goal contract and safety rules. Source access, field mapping, consent evidence, dedupe key, filters, and writeback target must be collected at runtime.

Default generated skills should be `parameterized-bound`. `unbound-generic` generated skills must be dry-run-only by default and must not support approved direct execution or scheduled real calls until they are converted to `fully-bound` or `parameterized-bound`, or until the user approves an exact runtime source and writeback contract.

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

Use `dry-run-then-batch-approval` as the default. Use `approved-direct-execution` only when the generated skill is `fully-bound` or `parameterized-bound`, the creation-time contract explicitly allows it, and the concrete runtime request passes the runtime gate. Do not use `approved-direct-execution` for `unbound-generic` workflows.

Even when direct execution is configured, the runtime request must be concrete, such as "process all June 20 records." Open-ended requests such as "run the campaign" are not enough.

## MCP Provider Contract

Generated skills must use:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

Generated skills must not use a CLI bootstrap path.

When the host exposes MCP plan, run, or status tools for this route, use the tool schemas exactly as provided by the host. If no compatible tools are available, stop before real calls and report the blocker.

## Serial Candidate Execution

Generated skills must define the approved batch behavior. After the user approves the exact pending call list, the agent must serially process all ready candidates until every candidate reaches a terminal result or skip state.

For each ready candidate, the generated skill should:

1. Plan exactly one call through the MCP provider route.
2. Inspect the plan before running it.
3. Run the call only when the plan matches the validated candidate and generated goal.
4. Check status when the MCP tools support it.
5. Record the terminal result or failure.
6. Continue to the next ready candidate without asking for another per-candidate confirmation.

If one candidate fails, record that failure and continue with the next candidate unless the provider route is unavailable, authentication is missing, or continuing would be unsafe. After all candidates finish, perform configured writeback or produce the session table, then report one final batch summary to the user.

For `per-call-approval`, each candidate must be shown with a masked phone number and compiled call goal before the provider plan is created or run. For `dry-run-then-batch-approval`, the exact pending call list must be approved once before batch execution. For `approved-direct-execution`, the generated skill must still inspect every provider plan and skip any candidate whose plan does not match the validated candidate and fixed goal contract.

## Writeback Contract

Generated skills must support one of these writeback outcomes:

- source writeback
- local CSV writeback
- session table output

The writeback policy must be chosen at creation time. The generated skill must state whether the writeback target is fully bound or parameterized, and must define field mapping when writeback is configured. The user may specify writeback fields during creation. Runtime requests may provide a writeback target only when the selected binding level explicitly allows that parameter and the runtime gate verifies it before real calls. Generated skills must keep credentials, tokens, callback URLs, confirmation tokens, cookies, and full phone numbers out of user-facing summaries and writeback fields.

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
- MCP provider route availability and compatible tools

Creation-time preflight may be skipped or blocked when tools, permissions, or concrete runtime parameters are unavailable. The generated skill must record that blocker. Runtime gating must not be skipped before real calls.

After the creator writes the generated skill, it should show the user a creation summary with the skill name, output path, binding level, runtime parameters, source contract, outbound goal contract, execution mode, writeback behavior, provider route, validation result, and reload or discovery step.

## Validation Commands

After generating a skill, run:

```bash
node <path-to-outbound-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

Run `python3 scripts/validate_repository.py` only when the generated skill is written into this reference repository or another repository that provides that validation command.
