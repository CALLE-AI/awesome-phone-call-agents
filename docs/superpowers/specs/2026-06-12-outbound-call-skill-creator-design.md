# Outbound Call Skill Creator Design

## Goal

Create an `outbound-call-skill-creator` Agent Skill that helps an agent generate a directly usable outbound phone-call workflow skill.

The generated business skill should behave like `google-form-callback`: after it is created, a user can invoke it with a concrete request such as "process all June 20 submissions" and the generated skill can handle the selected data source, compile outbound call goals, run the approved execution path through the configured MCP provider route, deduplicate work, and write durable results through source writeback, a source-adjacent result artifact, or a new local result CSV.

`outbound-call-skill-creator` is not a generic outbound runtime platform. It is a skill-generation workflow for creating focused, installable business skills in a selected output target.

## Scope

The first version supports three built-in source and durable result-output families:

- `google-form`
- `tiktok-ads`
- `local-csv`

If the user chooses another source or destination, the creator enters a requirements-gathering workflow and generates a custom adapter contract for the resulting business skill. The custom path should not guess API details, credentials, identifiers, or result-output behavior.

Generated skills must remain directly tied to AI-agent phone-call workflows and follow this repository's safety rules.

## User Experience

When a user asks to create an outbound workflow skill, `outbound-call-skill-creator` collects the minimum information needed to generate a usable skill:

- business purpose and recipient type
- output scope and target: user-level reusable skill, project-local skill, explicit path, or this reference repository `skills/`
- binding level: `fully-bound` or `parameterized-bound`
- data source type and access method
- required source fields
- E.164 phone-number field
- recipient name or label field, when available
- dedupe identifier field
- submitted or updated time field, when date-window processing is needed
- outbound call goal behavior for each row or record
- language and region handling rules
- execution mode: `dry-run-then-batch-approval` or `approved-direct-execution`
- durable result-output destination and result fields
- source-adjacent or local result output fallback when source writeback is not configured
- best-effort creation-time preflight result or blocker
- mandatory runtime gate requirements before real calls

The creator should present `google-form`, `tiktok-ads`, and `local-csv` as default integration choices. Choosing `other` starts a multi-turn clarification flow for source access, record shape, date filtering, dedupe keys, and durable result-output capability.

The creator must choose the generated skill output scope before creating files. Use a scope-first, host-aware rule: user-level reusable skills go to a recognized user skills root, project-local skills go to a host-compatible repository skills root, explicit paths win when the user provides them, and maintained generated workflows in this reference repository use this repository's `skills/` directory. When the creator is installed by a skill installer and invoked from a different project, the default should be user-level reusable output unless the workflow depends on project-local files or the user asks to version it with the project.

The minimum binding level should be `parameterized-bound`: source family, field schema, consent rule, dedupe rule, goal contract, result-output policy, and result field schema are fixed at creation time, while runtime requests provide approved parameters such as form ID, CSV path, campaign ID, date window, source writeback target, source-adjacent artifact target, or output path. `fully-bound` is appropriate for stable production or scheduled workflows that fix a concrete source and durable result target.

## Generated Skill Shape

The generated skill uses the normal Agent Skills folder pattern:

```text
<selected-output-parent>/<business-skill-name>/
├── SKILL.md
├── references/
└── scripts/
```

The generated skill does not use `template.md` as a user-editable runtime contract. Instead, the creator writes the selected source, goal, execution, safety, and result-output behavior directly into the generated skill instructions and reference files.

For simple workflows, the generated `SKILL.md` can contain the full source, goal, and result-output contract. For more complex workflows, the creator may generate focused reference files such as:

- `references/source-contract.md`
- `references/goal-contract.md`
- `references/result-output-contract.md`
- `references/binding-contract.md`
- `references/safety.md`
- `references/examples.md`

The generated skill should include scripts only when deterministic handling is valuable, such as CSV parsing, candidate validation, dedupe state management, dry-run rendering, source writeback payload generation, source-adjacent artifact output, or result CSV writing.

## Data Flow

Generated skills follow this flow:

```text
source records -> normalized candidates -> runtime gate -> safety validation -> outbound goal compilation -> MCP dry-run or execution -> dedupe state -> durable result output
```

Each normalized candidate should include:

- stable candidate ID
- source record ID or row reference
- E.164 destination phone number
- masked phone number for summaries
- recipient display name or label, when available
- source timestamp, when available
- goal input fields
- generated outbound call goal
- validation status and skip reason, when not callable

## Source Contracts

### Google Form

Generated Google Form skills should follow the existing `google-form-callback` pattern where applicable:

- use local OAuth or an explicitly configured Apps Script fallback
- support form IDs and submitted-time windows
- require a clear basis for phone follow-up in the form description, terms, or per-response consent field
- use the linked response spreadsheet for writeback when available
- avoid exposing OAuth tokens, callback URLs, or full phone numbers

### TikTok Ads

Generated TikTok Ads skills should describe the exact MCP tool or query path selected during creation. The source family is `tiktok-ads`; MCP is the access method. Use `https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp` as the default MCP route when the host has not already exposed a TikTok Ads connector.

The creator must capture:

- account or advertiser scope, when applicable
- tool names or resource names
- record filters and date-window semantics
- field mapping for phone number, name, dedupe key, and goal inputs
- allowed writeback action, if one exists

The generated skill must not assume that every TikTok Ads record is callable. It must validate explicit outreach basis and phone-number format before creating call candidates.

### Local CSV

Generated CSV skills should require:

- a user-provided CSV path
- column mapping
- date parsing rules when date-window processing is supported
- a dedupe key column or deterministic row key
- an output CSV path when writeback is configured

If writeback is not configured, the generated skill outputs a session table with one row per candidate and includes skip or execution status.

## Call Provider Route

Generated skills should use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

Generated skills should not use a CLI bootstrap path. The MCP route is responsible for the one-off call provider workflow, such as planning, running, and checking call status when those tools are available.

The generated skill must discover or use the MCP tools exposed in the target host instead of inventing tool names or schemas. If the MCP route is not available, authentication is missing, or the host cannot call the route safely, the generated skill should stop before real calls and report the blocker.

## Outbound Goal Contract

The generated skill should compile one outbound call goal per candidate from the business rules captured at creation time.

The goal contract should specify:

- purpose of the call
- required context fields from the source record
- allowed questions or statements
- completion criteria
- escalation or human-handoff cases
- prohibited claims and sensitive-domain boundaries
- result values to write back
- summary format

Generated skills must not provide medical, legal, financial, or emergency advice. When a workflow touches sensitive areas, the call should collect logistics, confirm preferences, or route to a human.

## Execution Policy

Generated skills should support two batch execution modes:

- `dry-run-then-batch-approval`
- `approved-direct-execution`

The default architecture remains:

```text
Host scheduler handles recurrence.
Phone-call provider handles exactly one call per scheduled run.
```

Generated skills must run a dry-run preview before real calls unless the generated skill was explicitly configured for direct execution after a user gives a concrete processing request. `approved-direct-execution` is allowed only for `fully-bound` or `parameterized-bound` workflows whose concrete runtime request passes the runtime gate.

Even in direct mode, the generated skill must validate candidates, mask phone numbers in summaries, inspect the provider plan, and skip unsafe or ambiguous records.

After the user approves the exact pending call list, generated skills must process ready candidates serially. The agent should plan, inspect, run, check status when available, record the result, and then continue to the next candidate without another per-candidate confirmation. Candidate-level failures should be recorded and the batch should continue when safe. The generated skill should stop the batch only when authentication is missing, the MCP provider route is unavailable, required provider tools are unavailable, dedupe state cannot be trusted, or continuing would be unsafe. After all candidates complete or skip, the generated skill must write configured source results, a source-adjacent result artifact, or a local result CSV and report one final batch summary. Session table output is only a last-resort non-persistent fallback when durable output validation is blocked.

## Result Output Policy

Generated skills support durable result-output outcomes:

- source writeback to the bound source instance or canonical source record store
- source-adjacent result artifact in the same provider, account, workspace, folder, or campaign context
- new local result CSV output
- session table output only as a last-resort non-persistent fallback

Treat source writeback narrowly. A same-system side file, new sheet, new tab, result table, or export beside the source is `source-adjacent-result-artifact`, not source writeback. Session table output is not the default fallback; prefer a source-adjacent artifact or local result CSV first.

The result-output policy is chosen at creation time. The concrete result target may be fixed for `fully-bound` workflows or parameterized for `parameterized-bound` workflows. Runtime targets must pass the runtime gate before real calls.

Result records should include:

- source record ID or row reference
- candidate ID
- status
- skip reason or call result
- provider run ID when safe to expose
- masked phone number
- result summary
- processed timestamp

The generated skill must not write credentials, tokens, confirmation tokens, cookies, or full phone numbers to user-facing summaries or result outputs.

## Creation Summary

After writing and validating a generated business skill, the creator should show a concise creation summary with skill name, generated directory, discoverability or reload note, binding level, runtime parameters, source contract, consent rule, dedupe rule, goal summary, execution mode, result-output policy, preflight result or blocker, runtime gate, provider route, and validation result.

## Safety Requirements

Every generated skill must include rules for:

- explicit user intent before processing records for calls
- E.164 phone numbers
- masked phone numbers in summaries
- no credential exposure
- no hidden recurring schedules
- no duplicate jobs
- dedupe by stable candidate or source response ID
- clear cancellation behavior for scheduled workflows
- dry-run or approved direct execution policy
- boundaries for medical, legal, financial, and emergency content

Generated skills must not guess country codes, regions, phone numbers, timezones, credentials, scheduler IDs, or provider confirmation tokens.

## Validation

After implementing `outbound-call-skill-creator`, repository validation must pass:

```bash
python3 scripts/validate_repository.py
```

The implementation should also include focused tests or script fixtures when generator scripts are added. At minimum, validate that a generated skill has valid frontmatter, English repository-facing content, expected folder structure, selected binding level, selected execution mode, runtime gate requirements, and the required safety sections.

## First-Version Defaults

The first implementation should create a procedural creator skill rather than a broad shared runtime. The creator skill should guide the agent through the scope-first output target, source, goal, execution, and result-output contract, then generate a focused business skill in that selected target.

Generated skills should always include:

- `SKILL.md`
- `references/safety.md`
- `references/examples.md`

Generated skills may include source, goal, and writeback reference files when the workflow is too complex to keep in `SKILL.md`.

The first version should not extract or share runtime code from `google-form-callback`. It may reference the pattern, but code reuse should wait until two or more generated skills show the same deterministic script need.

The first version should not add sample generated skills as committed fixtures. Examples should live inside `outbound-call-skill-creator` references unless a real, maintained workflow is added later.
