---
name: outbound-call-skill-creator
description: Create directly usable outbound phone-call Agent Skills that bind source and durable result-output contracts at the right level, connect data such as Google Forms, TikTok Ads, local CSV, or custom systems to an MCP one-off call provider route, compile per-record call goals, enforce safety rules, and configure source writeback, source-adjacent result artifacts, or new local result CSV output.
---

# Outbound Call Skill Creator

Use this skill when the user wants to create a new outbound phone-call workflow skill that can later process source records directly, compile one call goal per eligible record, run calls through the configured MCP provider route, and write results back, save a source-adjacent result artifact, or save a new local result CSV.

`outbound-call-skill-creator` creates focused business skills. It does not process campaign data itself, does not create a generic outbound runtime platform, and does not use a CLI bootstrap path.

Generated skills should bind enough source, durable result-output, and safety detail to make later runs predictable. The minimum source binding level is `parameterized-bound`: the source family, field schema, source-level outreach basis or consent rule, dedupe rule, goal contract, and result-output policy are fixed at creation time, while runtime requests can still provide approved parameters such as a date window, form ID, CSV path, campaign ID, source writeback target, source-adjacent artifact target, or output file path.

Before asking creation questions, read `references/interaction-flow.md` and use its recommendation-first prompt order and user-facing language boundary. Start with the user's workflow or data source, not with skill naming, output paths, binding levels, execution modes, field mapping, or writeback configuration unless the user already provided those values. In prompts, lead with plain labels such as "Reusable workflow," "Preview before calling," "Call provider connection," and "Checks before real calls"; keep internal terms as secondary detail for contracts, summaries, and advanced users.

## Core Rule

Generate a directly usable business skill using the scope-first output rule in `references/output-targets.md`. Do not assume the current project has a usable `skills/` directory.

When this creator is used from a normal project after being installed by a skill installer, default to a user-level reusable skill unless the workflow depends on project-local files or the user asks for repository-scoped output. If the installed `outbound-call-skill-creator` folder is inside a recognized user-level skills root, create the generated business skill as a sibling of this creator. Otherwise choose a host-compatible skills root from `references/output-targets.md`, or ask the user when discoverability is unclear.

Use a project-local skills directory only when the user explicitly wants the generated skill versioned with the current project, when the skill depends on project files, or when working inside this reference repository. Never write a generated business skill into the downloaded `outbound-call-skill-creator` skill folder itself.

The generated skill must let a future user make a concrete request such as "process all June 20 records" and have the skill handle source access, filtering, candidate validation, outbound goal compilation, approved MCP execution, dedupe, and durable result output.

Minimum source binding is mandatory. If creation-time onboarding cannot reach a `parameterized-bound` source and durable result-output contract, do not generate a business skill.

Do not create `template.md`. The creator captures the source, goal, execution, and result-output contract during skill creation and writes that contract into the generated skill instructions and reference files.

## Required Creator Workflow

1. Confirm that the user wants to create a new outbound phone-call workflow skill when intent is ambiguous; otherwise continue from the user's request.
2. Read `references/interaction-flow.md`, maintain the known-values set, and ask only for the next missing value.
3. Ask for either the business workflow or source family. If only workflow is known, ask for the source family with examples. If only source family is known, recommend a likely business workflow and ask the user to confirm or adjust it.
4. Confirm only a provisional outbound call goal before source sampling. Use a recommended goal draft based on the workflow and source. Do not treat the provisional goal as the final goal contract.
5. Read `references/binding-contract.md` and `references/execution-modes.md`, then recommend workflow reuse and call-preview preference together using plain labels first. Default to Reusable workflow (`parameterized-bound`) plus Preview before calling (`dry-run-then-batch-approval`); mention Fixed source workflow (`fully-bound`) or Direct execution after checks (`approved-direct-execution`) only when the workflow needs them. Record the user's call-preview response as an execution preference, not as the final selected execution mode.
6. Confirm the business skill name, using one recommended lowercase hyphenated candidate when the user has not provided a name.
7. Treat early result-output or writeback input as a preference, not as a verified target. If the user already provided result-output or writeback input, record it as a preference. Do not list or confirm source-specific writeback targets yet.
8. Read `references/data-sources.md` for the selected source family and run creation-time source onboarding for the selected binding level:
   - `fully-bound`: authenticate or verify the concrete source, fetch a representative sample from that source, confirm schema and durable result-output readiness, and stop before generating a real-call skill if onboarding cannot complete.
   - `parameterized-bound`: authenticate or verify the source family, fetch a representative sample from one approved source instance, confirm the schema contract, and record which runtime parameters may vary later.
   If source onboarding cannot support the minimum `parameterized-bound` contract because the source or result-output contract is still unknown, do not write the generated skill yet; continue source onboarding or stop with the missing contract details.
   For any authenticated or connector-backed source family, ask only for the minimum connection details needed to authorize or locate the source before source access and sample fetch complete. Do not ask the user to manually provide the full field mapping before source access has been checked and a representative sample has been fetched.
9. Capture the source fields from the sampled schema for phone number, recipient label, dedupe key, date filtering, source-level outreach basis or optional consent field, goal inputs, and any runtime parameters allowed by the binding level.
10. Show a small redacted sample summary and prompt the user to confirm or adjust only fields that cannot be inferred. Confirm the final outbound goal contract only after representative sampling identifies the available goal input fields.
11. Confirm the verified durable result-output target only after source access and representative sampling identify supported writeback paths, source-adjacent artifact options, or local CSV output. Prefer verified source writeback, source-adjacent result artifacts, or a new local result CSV; record session-table output only as a last-resort fallback when durable output validation is blocked.
12. Read `references/mcp-provider-route.md` and run creation-time provider onboarding for the default CALL-E MCP provider route in the current host runtime: configure or verify the MCP route, complete or verify provider authentication, and confirm compatible plan/run/status tools without placing a real call. When user action is needed, describe it as connecting or authorizing the call provider, not as "provider onboarding." For Codex, use the `codex mcp` adapter commands in the reference. For Claude, Antigravity, Cursor, or another MCP host, use that host's connector or MCP server setup and authorization flow. Do not treat app connector tools, plugin tools, or similarly named non-MCP tools as proof that this provider route is authenticated. Provider onboarding failure permits only dry-run-only generation with an explicit blocker; it must not generate a skill that can place real calls.
13. Finalize the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known. Use the earlier call-preview preference when it is compatible with the binding level and onboarding evidence. If provider onboarding is blocked, generate only a dry-run-only skill with the blocker recorded.
14. Read `references/output-targets.md`, choose the scope, and choose a host-compatible output parent. Ask the user only when discoverability is unclear, the output path is explicit but nonstandard, or a new user skills root would need to be created.
15. Capture the final result-output policy at creation time and capture field mapping, supported target modes, or allowed runtime output parameters. Prefer verified source writeback when available. Treat source writeback narrowly: it updates the bound source instance or canonical source record store, not a newly created side file. When the result should live in the same source system but not mutate the source records, configure `source-adjacent-result-artifact` with a verified container, artifact ID or creation policy, schema, and append or upsert behavior. When source writeback and source-adjacent output are unavailable or not requested, configure a new local result CSV as the durable fallback. Keep session-table output as a last-resort non-persistent fallback only when durable output validation is blocked; do not proactively present session table as a normal user-facing option.
16. Run best-effort creation-time preflight checks when tools and permissions are available: read-only source auth/schema checks, non-mutating source writeback checks, source-adjacent artifact checks, local result CSV path checks, and MCP route/tool readiness. Treat source onboarding, durable result-output validation, and provider authentication as hard gates for real-call generation; treat additional non-mutating preflight checks as best-effort evidence that must be recorded when blocked.
17. Read `references/safety.md` and include the required safety boundaries in the generated skill.
18. Generate the business skill folder and files in the selected output parent using `references/generated-skill-contract.md`.
19. Run this skill's bundled checker script with `--skill-dir <generated-business-skill-dir>`.
20. Read `references/creation-summary.md` and show the user a creation summary covering skill name, path, binding level, source onboarding, provider onboarding, source contract, goal contract, execution mode, result-output target, provider route, validation result, and reload or discovery note. In the summary, use plain labels first and internal contract terms second.
21. Run repository validation only when the generated skill is being committed to a repository that provides a validation command.

## Built-In Choices

Present these source families by default:

- `google-form`: Google Forms responses with local OAuth or an explicitly configured Apps Script fallback.
- `tiktok-ads`: records obtained from TikTok Ads through exposed MCP tools, resources, or approved connectors.
- `local-csv`: records from a user-provided CSV file.
- `other`: a custom source that requires multi-turn clarification before generating the skill.

If the user selects `other`, do not guess API schemas, credentials, identifiers, date filters, result-output behavior, or MCP tool names. Ask for the missing contract details one at a time.

## Creation-Time Source Onboarding

Creation-time source onboarding happens after the workflow, source family, provisional call goal, binding level, call-preview preference, skill name, and any result-output preference are known, and before final field mapping, verified result-output target confirmation, final execution mode selection, or generated-skill contract generation.

For `fully-bound` generated skills, authenticate or verify the concrete source, fetch a representative sample from that exact source, confirm schema and durable result-output readiness, and stop before generating a real-call skill when onboarding cannot complete.

For `parameterized-bound` generated skills, authenticate or verify the source family, fetch a representative sample from one approved source instance, confirm the schema contract, and allow runtime instances only when the runtime gate verifies the same schema and source contract.

If source onboarding cannot produce enough source, schema, outreach-basis or consent, dedupe, and durable result-output detail for the minimum `parameterized-bound` contract, stop before writing the generated skill and ask for the missing contract details.

During onboarding, show the user a small redacted sample summary, never full private phone numbers, credentials, tokens, cookies, callback URLs, or provider confirmation tokens. Use the sampled fields to refine and finalize the provisional outbound goal.

For any authenticated or connector-backed source family, inspect available host-local access routes before asking the user to choose an access route. When a host-local source adapter, connector, MCP tool, or helper script is available, inspect it before asking the user to choose an access route. When a safe source authorization or auth-readiness action is available, start it before asking the user for another confirmation; do not ask the user to say `start auth`, choose a discovered route, or refresh a session before attempting the available non-mutating auth path. For source MCP servers, do not treat a host CLI status such as Codex `Auth: Unsupported` as proof that source access is unavailable when source-native MCP tools or resources are exposed; run the source's read-only auth or inventory probe first. Collect only minimum connection details before access is verified: skill name, binding level, source family, source locator such as form ID or account scope only when no usable route can be discovered or the discovered route needs a concrete locator, and access route such as OAuth, Apps Script fallback, MCP tool, MCP resource, or managed connector. After access verification and representative sample fetch, infer the phone field, recipient field, dedupe key, outreach basis or consent field, goal inputs, and durable result-output capability from the sample. Ask the user to fill or correct only fields that cannot be inferred.

When the user names only an authenticated source family such as `google-form` or `tiktok-ads`, first use `references/interaction-flow.md` to recommend a likely workflow and provisional call goal. Then discover available host access routes, run or request authorization, and attempt a read-only sample fetch before asking for detailed field mapping, final goal-field selection, or result-output mapping. Do not ask the user to choose `use local OAuth to list accessible forms` when a local OAuth helper can be checked directly. If the user has not provided a skill name yet, derive a temporary candidate name from the source context, but do not use a missing skill name as a reason to collect detailed mapping first.

## Creation-Time Provider Onboarding

Creation-time provider onboarding happens after source onboarding and verified durable result-output capability discovery, and before choosing a real-call execution mode. It verifies that the selected host runtime has a configured and authenticated MCP route for the CALL-E provider route, and that a fresh session can expose compatible plan, run, and status tools for one-off calls.

Authentication is the hard gate. A bound generated skill that may place real calls needs explicit evidence for:

- provider host runtime, such as Codex, Claude, Antigravity, Cursor, or another MCP-capable agent host
- MCP route setup check result for `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`
- provider authentication or auth readiness check result
- compatible MCP provider tools exposed by that configured route

Use the current host's MCP setup and authorization flow. Host adapter examples:

- Codex adapter: configure a server such as `calle-prod`, authenticate it, and re-check with `codex mcp`.
- Claude, Antigravity, Cursor, or another MCP host adapter: configure the MCP server or connector with the route URL, transport, and authentication settings in that host, complete OAuth or managed authorization, and re-check tool availability in a fresh agent session.
- Managed connector/app route: use only the host's documented connector setup and authorization state as route evidence. Do not use similarly named callable app tools as proof that the MCP route is installed or authorized.

Use this setup sequence when the Codex CLI is the selected host adapter:

```bash
codex mcp get calle-prod
codex mcp add calle-prod --url https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
codex mcp login calle-prod
codex mcp list
```

Skip `add` when `calle-prod` already exists with the required route. Skip `login` only when `codex mcp list` or `codex mcp get calle-prod` shows that OAuth is already ready. If login requires browser completion, stop and wait for the user to finish it before generating a real-call skill.

Provider onboarding is non-mutating for phone-call side effects: do not create provider plans, run calls, write results, expose credentials, or request confirmation tokens during onboarding. MCP setup and provider authorization are allowed only to prepare the host. Do not infer provider readiness from app connector tools, plugin tools, or `mcp__codex_apps__*` namespaces; those are not evidence that the configured CALL-E MCP route is installed or authorized.

For `fully-bound` and `parameterized-bound` generated skills that may place real calls, provider route setup and provider authentication or auth readiness must pass before real-call generation. If no authenticated MCP route is available, stop and ask the user to connect or authorize it, then re-check. If it still cannot be verified, provider onboarding failure permits only dry-run-only generation with an explicit blocker; it must not generate a skill that can place real calls until provider auth and compatible tools are available.

## Creation Prompts

Use short, explicit prompts during creation. Prefer recommending a safe default instead of leaving the user to infer it. Use `references/interaction-flow.md` as the source of truth for prompt order, copyable examples, information reuse, and manual action blocks.

Do not ask for all details at once. If the user already provided several values, record them and continue from the first missing value. Do not ask for skill name, output target, binding level, execution mode, full field mapping, or writeback behavior before workflow, source family, and call goal are established unless the user already supplied those later values.

Do not lead user prompts with internal terms such as binding level, execution mode, provider onboarding, runtime gate, or writeback binding. Present the plain label and default recommendation first, then include internal terms only in parentheses when useful. For example, say "Reusable workflow (`parameterized-bound`) with preview before calling (`dry-run-then-batch-approval`)" instead of asking the user to choose a binding level and execution mode.

### Workflow And Source

Start by asking for either the business workflow or source family. If the user provides only a source family, recommend a likely workflow and ask the user to confirm or adjust it. If the user provides only the workflow, ask for the source family with the built-in choices.

### Outbound Goal

Confirm a provisional outbound call goal before binding, naming, writeback, and output target decisions. Provide a recommended goal draft based on the workflow and source, then finalize the outbound goal contract only after source sampling identifies the available goal input fields.

### Workflow Reuse And Call Preview

Recommend workflow reuse and call-preview preference together. The default prompt should be "Reusable workflow (`parameterized-bound`) with preview before calling (`dry-run-then-batch-approval`)." Mention Fixed source workflow (`fully-bound`) only when one source and writeback target should be fixed at creation time, and mention Direct execution after checks (`approved-direct-execution`) only for stable workflows whose concrete runtime requests must pass the checks before real calls. Do not finalize the selected execution mode until source onboarding, verified durable result-output capability, and provider onboarding evidence are known.

### Skill Name

When the user has not provided a name, derive one lowercase hyphenated candidate from the business context and ask the user to confirm it.

When the user has already provided a name, validate that it is a lowercase hyphenated slug. If it is not valid, suggest the closest valid slug and ask for confirmation before writing files.

### Writeback

Record early writeback or result-output input as a preference only. Confirm writeback by listing source-specific writeback options only after source access and representative sampling identify supported paths. Treat session-table output as a fallback when writeback is unavailable, blocked, or intentionally omitted, not as a standard writeback option.

### Output Target

Before writing files, state the selected scope, output parent, generated skill directory, why that target was chosen, and whether the host may need a reload or add-location step. Ask the user only when discoverability is unclear, the output path is explicit but not a known skills parent, or a new user skills root would need to be created.

## Binding Levels

Choose a binding level before writing the generated skill, but present the choice to the user as workflow reuse. Treat `parameterized-bound` as the minimum binding level; if the user has no preference, use Reusable workflow (`parameterized-bound`). Use Fixed source workflow (`fully-bound`) only when the workflow should fix a concrete source and durable result-output target at creation time.

Use `references/binding-contract.md` for full binding-level selection rules and generated skill requirements.

| Binding level | Creation-time contract | Runtime parameters | Maximum automation |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, source-level outreach basis or consent rule, dedupe rule, fixed result target, and result fields. The result target can be source writeback to the source instance or canonical record store, a source-adjacent result artifact, or a local result CSV. | Date window, subset filters, and other narrow processing controls. | Eligible for approved direct execution and scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required field schema, source-level outreach basis or consent rule, dedupe rule, goal contract, result-output policy, and result field schema. | Approved instance values such as form ID, CSV path, campaign ID, date window, source writeback target, source-adjacent artifact target, or output path. | Default. Eligible for dry-run batch approval and approved direct execution only after concrete runtime parameters pass the runtime gate. |

Do not create a business skill with no phone field, no source-level outreach basis or consent rule, no stable dedupe key, or no durable result path such as verified source writeback, a source-adjacent result artifact, or a new local result CSV. Session-table output is only a last-resort non-persistent fallback when durable output validation is blocked, not the primary result path. If those values are unavailable, keep asking for the missing contract or stop before generation.

## Execution Modes

Record the generated skill's call-preview preference after choosing the binding level, but present the choice to the user as call-preview behavior. If the user does not choose, prefer Preview before calling (`dry-run-then-batch-approval`). Finalize the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known.

Use `references/execution-modes.md` for full mode selection rules, concrete runtime request examples, and direct execution guardrails.

- `dry-run-then-batch-approval`: preview every eligible candidate and compiled call goal, then process the approved list serially after one explicit approval.
- `approved-direct-execution`: after a concrete processing request, validate candidates, run the runtime gate, compile call goals, inspect each provider plan, and serially run eligible one-off calls without another approval step.

Use `approved-direct-execution` only after the generated skill's supported binding level and concrete runtime request pass the required gates.

## Preflight and Runtime Gate

Creation-time preflight is best effort after the hard gates are satisfied. Source onboarding, durable result-output validation, and provider authentication are hard gates for generating a skill that can place real calls. Run additional non-mutating preflight checks when the source, source writeback target, source-adjacent result artifact target, local result CSV target, provider route, tools, and permissions are available, but do not make every optional preflight check a hard prerequisite for generating the skill.

Runtime gating is mandatory before any real call. A generated skill must stop before real calls when source access, required fields, consent validation, dedupe state, source writeback, source-adjacent result artifact output, local result CSV output, provider authentication, or compatible MCP tools cannot be verified for the concrete runtime request. Session-table fallback may be used only when durable output validation is blocked and the run is attended; it is not suitable for unattended scheduled automation unless the user explicitly accepts the host session transcript as the record.

Do not perform a real writeback, write a result CSV, or place a real call during creation-time onboarding or preflight. Approved side effects can happen only later in the selected runtime execution flow after the runtime gate passes.

## Creation Summary

After the generated skill is written and validated, show a concise creation summary. Use `references/creation-summary.md` for the full summary shape and safety rules.

Include:

- skill name
- generated skill directory
- output scope and discoverability or reload note
- binding level and allowed runtime parameters
- source onboarding status, sampled source instance, and sample fetch result
- source family, access method, and required fields
- consent or outreach basis
- dedupe key or dedupe state rule
- outbound goal contract summary
- execution mode and unavailable modes, if any
- result-output policy, fixed or runtime-resolved target mode, target binding, and field mapping
- provider onboarding status, provider host runtime, MCP route setup and provider auth check results, compatible MCP tools, and blocker if any
- creation-time preflight result or blocker
- mandatory runtime gate checks before real calls
- MCP provider route
- validation command and result

If a value is intentionally parameterized, label it as a runtime parameter instead of presenting it as already fixed. If a required source or durable result-output value is unknown, report it as a creation blocker and do not generate the skill until the contract is complete.

## Runtime Contract Formats

Generated skills must define structured runtime contracts for:

- concrete runtime request examples and insufficient request examples
- source onboarding report with `binding_level`, `source_family`, `access_method`, `auth_or_access_check`, `sample_fetch`, `sampled_source_instance`, `field_mapping`, `user_confirmed_field_mapping`, `default_goal_source`, and `onboarding_blocker`
- provider onboarding report with `provider_route`, `provider_host_runtime`, `mcp_route_setup_check`, `auth_readiness`, `compatible_tools`, `one_off_call_capability`, and `provider_onboarding_blocker`
- provider result finalization report with `run_id`, `terminal_status_seen`, `full_history_rechecked`, `negative_terminal_stability_checked`, `result_output_allowed`, and `blocker`
- runtime gate report rows with `check`, `status`, `evidence`, `blocker`, and `required_before_call`
- result-output mapping with `policy`, `target_mode`, `target_binding`, `target`, and logical result fields
- approved direct execution guardrails

Use `references/generated-skill-contract.md` as the source of truth for these formats.

## Generated Skill Requirements

Every generated business skill must include:

- `SKILL.md`
- `references/safety.md`
- `references/examples.md`

Generate additional reference files when the workflow is too detailed for the main `SKILL.md`, such as:

- `references/source-contract.md`
- `references/goal-contract.md`
- `references/result-output-contract.md`
- `references/binding-contract.md`

Generate scripts only when deterministic handling is valuable, such as CSV parsing, candidate validation, dedupe state checks, dry-run rendering, source writeback payload generation, or result CSV writing.

## Default Provider Route

Generated skills must use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

During creation, configure and authenticate this route in the selected host runtime before generating a real-call skill. The generated skill must use the MCP tools exposed by the host for that route and must not invent tool names or schemas. If the route is unavailable, the MCP server or connector is missing, OAuth or managed authorization is incomplete, or authentication is missing, the generated skill must stop before real calls and report the provider onboarding blocker.

## Direct Execution Policy

A generated skill may support approved direct execution when the user gives a concrete processing request such as "process all June 20 records" and the creation-time contract explicitly allowed direct execution.

Approved direct execution requires a `fully-bound` generated skill or a `parameterized-bound` generated skill whose concrete runtime parameters pass the source, durable result-output, dedupe, and provider runtime gate.

Even in direct execution mode, the generated skill must:

- validate E.164 phone numbers
- validate outreach basis or consent
- deduplicate by the configured key
- mask phone numbers in summaries
- skip unsafe or ambiguous records
- avoid hidden recurring schedules
- report source writeback, source-adjacent result artifact, or local result CSV status; use session-table output only as a last-resort attended fallback when durable output validation is blocked

If direct execution was not configured, the generated skill must dry-run first and ask the user to approve the exact pending call list before real calls.

## Serial Candidate Execution

Generated skills must define what happens after the user approves the exact pending call list. After execution approval, do not ask the user to continue, confirm the next candidate, or approve additional provider runs. The agent should serially process every ready candidate until the candidate list is exhausted. For each candidate, plan one call, inspect the plan, run the call, check status when the MCP tools support it, record the result, and then continue to the next candidate without asking for another per-candidate confirmation.

If one candidate fails, the generated skill should record the failure or skip reason and continue with the next candidate unless the failure means the MCP provider route is unavailable, authentication is missing, or continuing would be unsafe. After all candidates reach a terminal result or skip state, the generated skill must provide one final summary and perform configured source writeback, source-adjacent result artifact output, or local result CSV output. Use session-table output only when durable output validation is blocked and the run is attended.

Provider terminal instructions such as `report_result` or `do not start another call` apply only to the current provider run. They prevent duplicate execution of the same plan; they must not be treated as permission to stop an approved multi-candidate batch after the first completed call.

Generated skills must include provider result finalization rules before writing source results, writing source-adjacent artifacts, writing a result CSV, or producing a final session table. Terminal provider status is not result-output-ready until the generated skill performs a full-history provider reconciliation without relying only on a cursor-limited polling page. Do not write `no_answer`, `failed`, or `no conversation captured` results until a negative terminal stability check passes.

## Durable Result Output

Generated skills must prefer durable result output in this order:

1. Verified source writeback when the source exposes a safe writeback path to the bound source instance or canonical source record store.
2. Source-adjacent result artifact when the result should stay in the same source system but must not mutate the source records.
3. A new local result CSV when source writeback and source-adjacent output are unavailable, not requested, or cannot be verified.
4. Session-table output only as a last-resort non-persistent fallback when durable output validation is blocked.

Do not call a same-system side file or newly created artifact "source writeback." Use `source-adjacent-result-artifact` for a result file, sheet, table, or tab created or used beside the source in the same provider, account, workspace, folder, or campaign context. For `fully-bound`, fix the artifact ID/path or the exact creation policy, container, schema, and append or upsert behavior at creation time. Creating a new source-adjacent artifact is a durable side effect and must be covered by runtime approval or direct-execution contract.

Do not proactively present session-table output as a normal user-facing choice. If the generated skill falls back to a session table, it must state that the result is non-persistent and unsuitable for unattended scheduled automation unless the user explicitly accepts the host session transcript as the record.

New local result CSV output must validate the output path, avoid mutating the source CSV unless explicitly requested, define exact result columns, and avoid writing full phone numbers. Use a table with one row per task and these logical fields for result CSVs or session-table fallback:

- candidate ID
- source record
- recipient label
- masked phone
- status
- skip reason or result
- provider run ID when safe to expose
- result summary
- processed timestamp

## Validation

After generating a business skill, run:

```bash
node <path-to-outbound-call-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

When developing inside this reference repository, the checker path is `skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs`; after editing this repository, also run `python3 scripts/validate_repository.py`.
