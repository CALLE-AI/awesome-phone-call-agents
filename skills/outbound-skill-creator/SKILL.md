---
name: outbound-skill-creator
description: Create directly usable outbound phone-call Agent Skills that bind source and writeback contracts at the right level, connect data such as Google Forms, ttmcp, local CSV, or custom systems to an MCP one-off call provider route, compile per-record call goals, enforce safety rules, and configure writeback or session-table output.
---

# Outbound Skill Creator

Use this skill when the user wants to create a new outbound phone-call workflow skill that can later process source records directly, compile one call goal per eligible record, run calls through the configured MCP provider route, and write results back or display a session table.

`outbound-skill-creator` creates focused business skills. It does not process campaign data itself, does not create a generic outbound runtime platform, and does not use a CLI bootstrap path.

Generated skills should bind enough source, writeback, and safety detail to make later runs predictable. Default to a parameterized-bound workflow: the source family, field schema, consent rule, dedupe rule, goal contract, and writeback policy are fixed at creation time, while runtime requests can still provide approved parameters such as a date window, form ID, CSV path, campaign ID, writeback target, or output file path.

## Core Rule

Generate a directly usable business skill using the scope-first output rule in `references/output-targets.md`. Do not assume the current project has a usable `skills/` directory.

When this creator is used from a normal project after being installed by a skill installer, default to a user-level reusable skill unless the workflow depends on project-local files or the user asks for repository-scoped output. If the installed `outbound-skill-creator` folder is inside a recognized user-level skills root, create the generated business skill as a sibling of this creator. Otherwise choose a host-compatible skills root from `references/output-targets.md`, or ask the user when discoverability is unclear.

Use a project-local skills directory only when the user explicitly wants the generated skill versioned with the current project, when the skill depends on project files, or when working inside this reference repository. Never write a generated business skill into the downloaded `outbound-skill-creator` skill folder itself.

The generated skill must let a future user make a concrete request such as "process all June 20 records" and have the skill handle source access, filtering, candidate validation, outbound goal compilation, approved MCP execution, dedupe, and writeback or session-table output.

Do not create `template.md`. The creator captures the source, goal, execution, and writeback contract during skill creation and writes that contract into the generated skill instructions and reference files.

## Required Creator Workflow

1. Confirm that the user wants to create a new outbound phone-call workflow skill.
2. Ask for or derive a lowercase hyphenated business skill name.
3. Read `references/output-targets.md`, choose the scope, and choose a host-compatible output parent.
4. Ask which source family to use: `google-form`, `ttmcp`, `local-csv`, or `other`.
5. Read `references/data-sources.md` for the selected source family.
6. Ask the user to choose a binding level, defaulting to `parameterized-bound` when they do not choose: `fully-bound`, `parameterized-bound`, or `unbound-generic`.
7. Capture the source fields for phone number, recipient label, dedupe key, date filtering, outreach basis or consent, goal inputs, and any runtime parameters allowed by the binding level.
8. Capture the outbound goal contract: call purpose, required context, allowed questions, prohibited claims, completion criteria, result values, summary format, and escalation cases.
9. Read `references/mcp-provider-route.md` and use the default MCP provider route in the generated skill.
10. Ask the user to choose an execution mode, defaulting to `dry-run-then-batch-approval`: `dry-run-then-batch-approval`, `per-call-approval`, or `approved-direct-execution`.
11. Capture writeback policy at creation time and capture field mapping or allowed runtime writeback parameters: source writeback, local CSV writeback, or session table fallback.
12. Run best-effort creation-time preflight checks when tools and permissions are available: read-only source auth/schema checks, non-mutating writeback target or field checks, and MCP route/tool readiness. If preflight cannot run, record the blocker in the generated skill and require a runtime mandatory gate before real calls.
13. Read `references/safety.md` and include the required safety boundaries in the generated skill.
14. Generate the business skill folder and files in the selected output parent using `references/generated-skill-contract.md`.
15. Run this skill's bundled checker script with `--skill-dir <generated-business-skill-dir>`.
16. Show the user a creation summary covering skill name, path, binding level, source contract, goal contract, execution mode, writeback target, provider route, validation result, and reload or discovery note.
17. Run repository validation only when the generated skill is being committed to a repository that provides a validation command.

## Built-In Choices

Present these source families by default:

- `google-form`: Google Forms responses with local OAuth or an explicitly configured Apps Script fallback.
- `ttmcp`: records obtained through known ttmcp MCP tools or resources.
- `local-csv`: records from a user-provided CSV file.
- `other`: a custom source that requires multi-turn clarification before generating the skill.

If the user selects `other`, do not guess API schemas, credentials, identifiers, date filters, writeback behavior, or MCP tool names. Ask for the missing contract details one at a time.

## Binding Levels

Ask the user to choose a binding level before writing the generated skill. If the user has no preference, use `parameterized-bound`.

| Binding level | Creation-time contract | Runtime parameters | Maximum automation |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, consent rule, dedupe rule, writeback target, and writeback fields. | Date window, subset filters, and other narrow processing controls. | Eligible for approved direct execution and scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required field schema, consent rule, dedupe rule, goal contract, writeback policy, and writeback field schema. | Approved instance values such as form ID, CSV path, campaign ID, date window, writeback target, or output path. | Default. Eligible for dry-run batch approval, per-call approval, and approved direct execution only after concrete runtime parameters pass the runtime gate. |
| `unbound-generic` | Goal contract and safety rules only; source and writeback details are collected at runtime. | Source access, fields, filters, consent evidence, dedupe key, and writeback target must be supplied each run. | Dry-run only by default. Do not allow real direct execution or scheduled runs until the workflow is converted to a bound skill or an exact runtime contract is approved. |

Do not create a real-call skill with no phone field, no outreach basis or consent rule, no stable dedupe key, or no writeback or session-table result path. If those values are unavailable, generate a dry-run-only `unbound-generic` skill or keep asking for the missing contract.

## Execution Modes

Ask the user to choose the generated skill's execution mode after choosing the binding level. If the user does not choose, use `dry-run-then-batch-approval`.

- `dry-run-then-batch-approval`: preview every eligible candidate and compiled call goal, then process the approved list serially after one explicit approval.
- `per-call-approval`: preview one candidate and compiled call goal at a time, then let the user approve, modify, or skip each call before planning and running it.
- `approved-direct-execution`: after a concrete processing request, validate candidates, run the runtime gate, compile call goals, inspect each provider plan, and serially run eligible one-off calls without another approval step.

Use `approved-direct-execution` only for `fully-bound` or `parameterized-bound` generated skills. Do not use it for `unbound-generic` workflows.

## Preflight and Runtime Gate

Creation-time preflight is best effort. Run it when the source, writeback target, provider route, tools, and permissions are available, but do not make every preflight check a hard prerequisite for generating the skill.

Runtime gating is mandatory before any real call. A generated skill must stop before real calls when source access, required fields, consent validation, dedupe state, writeback behavior, provider authentication, or compatible MCP tools cannot be verified for the concrete runtime request.

Do not perform a real writeback or place a real call during preflight unless the user explicitly approved that side effect.

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

The generated skill must use the MCP tools exposed by the host for that route. It must not invent tool names or schemas. If the route is unavailable or authentication is missing, the generated skill must stop before real calls and report the blocker.

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

Generated skills must define what happens after the user approves the exact pending call list. After approval, the agent should serially process every ready candidate until the candidate list is exhausted. For each candidate, plan one call, inspect the plan, run the call, check status when the MCP tools support it, record the result, and then continue to the next candidate without asking for another per-candidate confirmation.

If one candidate fails, the generated skill should record the failure or skip reason and continue with the next candidate unless the failure means the MCP provider route is unavailable, authentication is missing, or continuing would be unsafe. After all candidates reach a terminal result or skip state, the generated skill must provide one final summary and perform configured writeback or session-table output.

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
node <path-to-outbound-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

When developing inside this reference repository, the checker path is `skills/outbound-skill-creator/scripts/check-generated-skill.mjs`; after editing this repository, also run `python3 scripts/validate_repository.py`.
