---
name: outbound-call-skill-creator
description: Create directly usable outbound phone-call Agent Skills that connect data sources such as Google Forms, ttmcp, local CSV, or custom systems to an MCP one-off call provider route, compile per-record call goals, enforce safety rules, and configure writeback or session-table output.
---

# Outbound Call Skill Creator

Use this skill when the user wants to create a new outbound phone-call workflow skill that can later process source records directly, compile one call goal per eligible record, run calls through the configured MCP provider route, and write results back or display a session table.

`outbound-call-skill-creator` creates focused business skills. It does not process campaign data itself, does not create a generic outbound runtime platform, and does not use a CLI bootstrap path.

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
4. Ask which source family to use: `google-form`, `ttmcp`, `local-csv`, or `other`.
5. Read `references/data-sources.md` for the selected source family.
6. Capture the source fields for phone number, recipient label, dedupe key, date filtering, and goal inputs.
7. Capture the outbound goal contract: call purpose, required context, allowed questions, completion criteria, result values, and escalation cases.
8. Read `references/mcp-provider-route.md` and use the default MCP provider route in the generated skill.
9. Capture execution policy: dry-run first or approved direct execution after a concrete processing request, including serial processing after approval.
10. Capture writeback policy: source writeback, local CSV writeback, or session table fallback.
11. Read `references/safety.md` and include the required safety boundaries in the generated skill.
12. Generate the business skill folder and files in the selected output parent using `references/generated-skill-contract.md`.
13. Run this skill's bundled checker script with `--skill-dir <generated-business-skill-dir>`.
14. Run repository validation only when the generated skill is being committed to a repository that provides a validation command.

## Built-In Choices

Present these source families by default:

- `google-form`: Google Forms responses with local OAuth or an explicitly configured Apps Script fallback.
- `ttmcp`: records obtained through known ttmcp MCP tools or resources.
- `local-csv`: records from a user-provided CSV file.
- `other`: a custom source that requires multi-turn clarification before generating the skill.

If the user selects `other`, do not guess API schemas, credentials, identifiers, date filters, writeback behavior, or MCP tool names. Ask for the missing contract details one at a time.

## Generated Skill Requirements

Every generated business skill must include:

- `SKILL.md`
- `references/safety.md`
- `references/examples.md`

Generate additional reference files when the workflow is too detailed for the main `SKILL.md`, such as:

- `references/source-contract.md`
- `references/goal-contract.md`
- `references/writeback-contract.md`

Generate scripts only when deterministic handling is valuable, such as CSV parsing, candidate validation, dedupe state checks, dry-run rendering, or writeback payload generation.

## Default Provider Route

Generated skills must use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

The generated skill must use the MCP tools exposed by the host for that route. It must not invent tool names or schemas. If the route is unavailable or authentication is missing, the generated skill must stop before real calls and report the blocker.

## Direct Execution Policy

A generated skill may support approved direct execution when the user gives a concrete processing request such as "process all June 20 records" and the creation-time contract explicitly allowed direct execution.

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
node <path-to-outbound-call-skill-creator>/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

When developing inside this reference repository, the checker path is `skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs`; after editing this repository, also run `python3 scripts/validate_repository.py`.
