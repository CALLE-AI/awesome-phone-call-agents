---
name: outbound-call-skill-creator
description: Create directly usable outbound phone-call Agent Skills that bind source and writeback contracts at the right level, connect data such as Google Forms, TikTok Ads, local CSV, or custom systems to an MCP one-off call provider route, compile per-record call goals, enforce safety rules, and configure writeback or session-table output.
---

# Outbound Call Skill Creator

Use this skill when the user wants to create a new outbound phone-call workflow skill that can later process source records directly, compile one call goal per eligible record, run calls through the configured MCP provider route, and write results back or display a session table.

`outbound-call-skill-creator` creates focused business skills. It does not process campaign data itself, does not create a generic outbound runtime platform, and does not use a CLI bootstrap path.

Generated skills should bind enough source, writeback, and safety detail to make later runs predictable. Default to a parameterized-bound workflow: the source family, field schema, source-level outreach basis or consent rule, dedupe rule, goal contract, and writeback policy are fixed at creation time, while runtime requests can still provide approved parameters such as a date window, form ID, CSV path, campaign ID, writeback target, or output file path.

## Core Rule

Generate a directly usable business skill using the scope-first output rule in `references/output-targets.md`. Do not assume the current project has a usable `skills/` directory.

When this creator is used from a normal project after being installed by a skill installer, default to a user-level reusable skill unless the workflow depends on project-local files or the user asks for repository-scoped output. If the installed `outbound-call-skill-creator` folder is inside a recognized user-level skills root, create the generated business skill as a sibling of this creator. Otherwise choose a host-compatible skills root from `references/output-targets.md`, or ask the user when discoverability is unclear.

Use a project-local skills directory only when the user explicitly wants the generated skill versioned with the current project, when the skill depends on project files, or when working inside this reference repository. Never write a generated business skill into the downloaded `outbound-call-skill-creator` skill folder itself.

The generated skill must let a future user make a concrete request such as "process all June 20 records" and have the skill handle source access, filtering, candidate validation, outbound goal compilation, approved MCP execution, dedupe, and writeback or session-table output.

Do not create `template.md`. The creator captures the source, goal, execution, and writeback contract during skill creation and writes that contract into the generated skill instructions and reference files.

## Required Creator Workflow

1. Confirm that the user wants to create a new outbound phone-call workflow skill.
2. Ask for or derive a lowercase hyphenated business skill name.
3. Read `references/output-targets.md`, choose the scope, and choose a host-compatible output parent.
4. Ask which source family to use: `google-form`, `tiktok-ads`, `local-csv`, or `other`.
5. Read `references/data-sources.md` for the selected source family.
6. Read `references/binding-contract.md` and ask the user to choose a binding level, defaulting to `parameterized-bound` when they do not choose: `fully-bound`, `parameterized-bound`, or `unbound-generic`.
7. Run creation-time source onboarding for the selected binding level:
   - `fully-bound`: authenticate or verify the concrete source, fetch a representative sample from that source, confirm schema and writeback readiness, and stop before generating a real-call skill if onboarding cannot complete.
   - `parameterized-bound`: authenticate or verify the source family, fetch a representative sample from one approved source instance, confirm the schema contract, and record which runtime parameters may vary later.
   - `unbound-generic`: collect or record the missing source onboarding blockers and keep the generated skill dry-run-only until an exact runtime contract is approved.
   For any authenticated or connector-backed source family, ask only for the minimum connection details needed to authorize or locate the source before source access and sample fetch complete. Do not ask the user to manually provide the full field mapping before source access has been checked and a representative sample has been fetched.
8. Capture the source fields from the sampled schema for phone number, recipient label, dedupe key, date filtering, source-level outreach basis or optional consent field, goal inputs, and any runtime parameters allowed by the binding level.
9. Show a small redacted sample summary and prompt the user to confirm or adjust field mapping.
10. Prompt the user to define the default outbound goal from the sampled fields: call purpose, required context, allowed questions, prohibited claims, completion criteria, result values, summary format, and escalation cases.
11. Read `references/mcp-provider-route.md` and run creation-time provider onboarding for the default CALL-E MCP provider route in the current host runtime: configure or verify the MCP route, complete or verify provider authentication, and confirm compatible plan/run/status tools without placing a real call. For Codex, use the `codex mcp` adapter commands in the reference. For Claude, Antigravity, Cursor, or another MCP host, use that host's connector or MCP server setup and authorization flow. Do not treat app connector tools, plugin tools, or similarly named non-MCP tools as proof that this provider route is authenticated. If provider onboarding still cannot complete, record a provider onboarding blocker and keep the generated skill dry-run-only.
12. Read `references/execution-modes.md` and ask the user to choose an execution mode, defaulting to `dry-run-then-batch-approval`. For `fully-bound` and `parameterized-bound`, available modes are `dry-run-then-batch-approval`, `per-call-approval`, or `approved-direct-execution`. For `unbound-generic`, the only available mode is `dry-run-then-batch-approval` with dry-run-only behavior until onboarding is complete.
13. Capture writeback policy at creation time and capture field mapping, supported target modes, or allowed runtime writeback parameters: source writeback, local CSV writeback, or session table fallback. For local CSV, record supported target modes (`source-csv-in-place` and `result-csv-file`) and choose the concrete target mode during the runtime dry-run or approval step based on the user's requested output behavior.
14. Run best-effort creation-time preflight checks when tools and permissions are available: read-only source auth/schema checks, non-mutating writeback target or field checks, and MCP route/tool readiness. If preflight cannot run for a bound workflow, record the blocker and do not generate a real-call skill until source and provider onboarding requirements are satisfied.
15. Read `references/safety.md` and include the required safety boundaries in the generated skill.
16. Generate the business skill folder and files in the selected output parent using `references/generated-skill-contract.md`.
17. Run this skill's bundled checker script with `--skill-dir <generated-business-skill-dir>`.
18. Read `references/creation-summary.md` and show the user a creation summary covering skill name, path, binding level, source onboarding, provider onboarding, source contract, goal contract, execution mode, writeback target, provider route, validation result, and reload or discovery note.
19. Run repository validation only when the generated skill is being committed to a repository that provides a validation command.

## Built-In Choices

Present these source families by default:

- `google-form`: Google Forms responses with local OAuth or an explicitly configured Apps Script fallback.
- `tiktok-ads`: records obtained from TikTok Ads through exposed MCP tools, resources, or approved connectors.
- `local-csv`: records from a user-provided CSV file.
- `other`: a custom source that requires multi-turn clarification before generating the skill.

If the user selects `other`, do not guess API schemas, credentials, identifiers, date filters, writeback behavior, or MCP tool names. Ask for the missing contract details one at a time.

## Creation-Time Source Onboarding

Creation-time source onboarding happens after source family and binding level selection, and before final goal and writeback contract generation.

For `fully-bound` generated skills, authenticate or verify the concrete source, fetch a representative sample from that exact source, confirm schema and writeback readiness, and stop before generating a real-call skill when onboarding cannot complete.

For `parameterized-bound` generated skills, authenticate or verify the source family, fetch a representative sample from one approved source instance, confirm the schema contract, and allow runtime instances only when the runtime gate verifies the same schema and source contract.

For `unbound-generic` generated skills, source onboarding may be incomplete only when the missing values are recorded as onboarding blockers and the generated skill is dry-run-only until an exact runtime source, schema, source-level outreach basis or consent, dedupe, and writeback contract is approved.

During onboarding, show the user a small redacted sample summary, never full private phone numbers, credentials, tokens, cookies, callback URLs, or provider confirmation tokens. Use the sampled fields to help the user define the default outbound goal.

For any authenticated or connector-backed source family, inspect available host-local access routes before asking the user to choose an access route. When a host-local source adapter, connector, MCP tool, or helper script is available, inspect it before asking the user to choose an access route. When a safe source authorization or auth-readiness action is available, start it before asking the user for another confirmation; do not ask the user to say `start auth`, choose a discovered route, or refresh a session before attempting the available non-mutating auth path. For source MCP servers, do not treat a host CLI status such as Codex `Auth: Unsupported` as proof that source access is unavailable when source-native MCP tools or resources are exposed; run the source's read-only auth or inventory probe first. Collect only minimum connection details before access is verified: skill name, binding level, source family, source locator such as form ID or account scope only when no usable route can be discovered or the discovered route needs a concrete locator, and access route such as OAuth, Apps Script fallback, MCP tool, MCP resource, or managed connector. After access verification and representative sample fetch, infer the phone field, recipient field, dedupe key, outreach basis or consent field, goal inputs, and writeback capability from the sample. Ask the user to fill or correct only fields that cannot be inferred.

When the user names only an authenticated source family such as `google-form` or `tiktok-ads`, the next creation step must be source access onboarding: choose or confirm the binding level, discover available host access routes, run or request authorization, and attempt a read-only sample fetch before asking for the default outbound goal, writeback mapping, or full field mapping. Do not ask the user to choose `use local OAuth to list accessible forms` when a local OAuth helper can be checked directly. If the user has not provided a skill name yet, derive a temporary candidate name from the source context or ask only for the name in the same onboarding prompt; do not use a missing skill name as a reason to collect goal details first.

## Creation-Time Provider Onboarding

Creation-time provider onboarding happens after source onboarding and before choosing a real-call execution mode. It verifies that the selected host runtime has a configured and authenticated MCP route for the CALL-E provider route, and that a fresh session can expose compatible plan, run, and status tools for one-off calls.

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

For `fully-bound` and `parameterized-bound` generated skills that may place real calls, provider route setup and provider authentication or auth readiness must pass before generation. If no authenticated MCP route is available, stop and ask the user to connect or authorize it, then re-check. If it still cannot be verified, record a provider onboarding blocker and keep the generated skill dry-run-only until provider auth and compatible tools are available.

## Creation Prompts

Use short, explicit prompts during creation. Prefer recommending a safe default instead of leaving the user to infer it.

### Skill Name

When the user has not provided a name, derive one to three lowercase hyphenated candidates from the business context and ask the user to confirm one. Put the best candidate first.

When the user has already provided a name, validate that it is a lowercase hyphenated slug. If it is not valid, suggest the closest valid slug and ask for confirmation before writing files.

### Output Target

Before writing files, state the selected scope, output parent, generated skill directory, why that target was chosen, and whether the host may need a reload or add-location step. Ask the user only when discoverability is unclear, the output path is explicit but not a known skills parent, or a new user skills root would need to be created.

### Execution Mode

Present execution modes after the binding level is known. For `fully-bound` and `parameterized-bound`, recommend `dry-run-then-batch-approval` first, then briefly explain `per-call-approval` and `approved-direct-execution`. For `unbound-generic`, offer only `dry-run-then-batch-approval` with dry-run-only behavior until onboarding is complete; state that the workflow must be bound before `per-call-approval` or `approved-direct-execution` can be selected.

## Binding Levels

Ask the user to choose a binding level before writing the generated skill. If the user has no preference, use `parameterized-bound`.

Use `references/binding-contract.md` for full binding-level selection rules and generated skill requirements.

| Binding level | Creation-time contract | Runtime parameters | Maximum automation |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, source-level outreach basis or consent rule, dedupe rule, writeback target, and writeback fields. | Date window, subset filters, and other narrow processing controls. | Eligible for approved direct execution and scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required field schema, source-level outreach basis or consent rule, dedupe rule, goal contract, writeback policy, and writeback field schema. | Approved instance values such as form ID, CSV path, campaign ID, date window, writeback target, or output path. | Default. Eligible for dry-run batch approval, per-call approval, and approved direct execution only after concrete runtime parameters pass the runtime gate. |
| `unbound-generic` | Goal contract and safety rules only; source and writeback details are collected at runtime. | Source access, fields, filters, source-level outreach basis or consent evidence, dedupe key, and writeback target must be supplied each run. | Dry-run only by default. Do not allow real direct execution or scheduled runs until the workflow is converted to a bound skill or an exact runtime contract is approved. |

Do not create a real-call skill with no phone field, no source-level outreach basis or consent rule, no stable dedupe key, or no writeback or session-table result path. If those values are unavailable, generate a dry-run-only `unbound-generic` skill or keep asking for the missing contract.

## Execution Modes

Ask the user to choose the generated skill's execution mode after choosing the binding level. If the user does not choose, use `dry-run-then-batch-approval`.

Use `references/execution-modes.md` for full mode selection rules, concrete runtime request examples, and direct execution guardrails.

- `dry-run-then-batch-approval`: preview every eligible candidate and compiled call goal, then process the approved list serially after one explicit approval.
- `per-call-approval`: preview one candidate and compiled call goal at a time, then let the user approve, modify, or skip each call before planning and running it.
- `approved-direct-execution`: after a concrete processing request, validate candidates, run the runtime gate, compile call goals, inspect each provider plan, and serially run eligible one-off calls without another approval step.

Use `per-call-approval` or `approved-direct-execution` only for `fully-bound` or `parameterized-bound` generated skills. Do not use either mode for `unbound-generic` workflows.

## Preflight and Runtime Gate

Creation-time preflight is best effort. Run it when the source, writeback target, provider route, tools, and permissions are available, but do not make every preflight check a hard prerequisite for generating the skill.

Runtime gating is mandatory before any real call. A generated skill must stop before real calls when source access, required fields, consent validation, dedupe state, writeback behavior, provider authentication, or compatible MCP tools cannot be verified for the concrete runtime request.

Do not perform a real writeback or place a real call during creation-time onboarding or preflight. Approved side effects can happen only later in the selected runtime execution flow after the runtime gate passes.

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
- writeback policy, fixed or runtime-resolved writeback target mode, target binding, and field mapping
- provider onboarding status, provider host runtime, MCP route setup and provider auth check results, compatible MCP tools, and blocker if any
- creation-time preflight result or blocker
- mandatory runtime gate checks before real calls
- MCP provider route
- validation command and result

If a value is intentionally parameterized, label it as a runtime parameter instead of presenting it as already fixed. If a value is unknown, label it as a blocker and state whether the generated skill is dry-run-only until resolved.

## Runtime Contract Formats

Generated skills must define structured runtime contracts for:

- concrete runtime request examples and insufficient request examples
- source onboarding report with `binding_level`, `source_family`, `access_method`, `auth_or_access_check`, `sample_fetch`, `sampled_source_instance`, `field_mapping`, `default_goal_source`, and `onboarding_blocker`
- provider onboarding report with `provider_route`, `provider_host_runtime`, `mcp_route_setup_check`, `auth_readiness`, `compatible_tools`, `one_off_call_capability`, and `provider_onboarding_blocker`
- provider result finalization report with `run_id`, `terminal_status_seen`, `full_history_rechecked`, `negative_terminal_stability_checked`, `writeback_allowed`, and `blocker`
- runtime gate report rows with `check`, `status`, `evidence`, `blocker`, and `required_before_call`
- writeback mapping with `policy`, `target_mode`, `target_binding`, `target`, and logical result fields
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
- `references/writeback-contract.md`
- `references/binding-contract.md`

Generate scripts only when deterministic handling is valuable, such as CSV parsing, candidate validation, dedupe state checks, dry-run rendering, or writeback payload generation.

## Default Provider Route

Generated skills must use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

During creation, configure and authenticate this route in the selected host runtime before generating a real-call skill. The generated skill must use the MCP tools exposed by the host for that route and must not invent tool names or schemas. If the route is unavailable, the MCP server or connector is missing, OAuth or managed authorization is incomplete, or authentication is missing, the generated skill must stop before real calls and report the provider onboarding blocker.

## Direct Execution Policy

A generated skill may support approved direct execution when the user gives a concrete processing request such as "process all June 20 records" and the creation-time contract explicitly allowed direct execution.

Approved direct execution requires a `fully-bound` generated skill or a `parameterized-bound` generated skill whose concrete runtime parameters pass the source, writeback, dedupe, and provider runtime gate. It is not allowed for `unbound-generic` workflows.

Even in direct execution mode, the generated skill must:

- validate E.164 phone numbers
- validate outreach basis or consent
- deduplicate by the configured key
- mask phone numbers in summaries
- skip unsafe or ambiguous records
- avoid hidden recurring schedules
- report writeback status or produce a session table

If direct execution was not configured, the generated skill must dry-run first and ask the user to approve the exact pending call list before real calls.

## Serial Candidate Execution

Generated skills must define what happens after the user approves the exact pending call list. After execution approval, do not ask the user to continue, confirm the next candidate, or approve additional provider runs. The agent should serially process every ready candidate until the candidate list is exhausted. For each candidate, plan one call, inspect the plan, run the call, check status when the MCP tools support it, record the result, and then continue to the next candidate without asking for another per-candidate confirmation.

If one candidate fails, the generated skill should record the failure or skip reason and continue with the next candidate unless the failure means the MCP provider route is unavailable, authentication is missing, or continuing would be unsafe. After all candidates reach a terminal result or skip state, the generated skill must provide one final summary and perform configured writeback or session-table output.

Provider terminal instructions such as `report_result` or `do not start another call` apply only to the current provider run. They prevent duplicate execution of the same plan; they must not be treated as permission to stop an approved multi-candidate batch after the first completed call.

Generated skills must include provider result finalization rules before writeback. Terminal provider status is not writeback-ready until the generated skill performs a full-history provider reconciliation without relying only on a cursor-limited polling page. Do not write `no_answer`, `failed`, or `no conversation captured` results until a negative terminal stability check passes.

## Session Table Fallback

If writeback is not configured, generated skills must output a table with one row per task and these columns:

- candidate ID
- source record
- recipient label
- masked phone
- status
- skip reason or result
- processed timestamp

## Validation

After generating a business skill, run:

```bash
node <path-to-outbound-call-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

When developing inside this reference repository, the checker path is `skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs`; after editing this repository, also run `python3 scripts/validate_repository.py`.
