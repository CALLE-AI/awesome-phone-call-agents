# Outbound Skill Creator

`outbound-skill-creator` is a generator skill for creating focused outbound phone-call business skills. It does not process campaign data or place calls itself. Instead, it captures a reusable workflow contract and writes a directly usable Agent Skill that can later read source records, validate candidates, compile one call goal per eligible record, run one-off calls through the configured MCP provider route, and write results back or show a session table.

## When To Use

Use this creator when a user wants a reusable outbound phone-call workflow, such as:

- processing authorized Google Form responses and calling leads back
- reading callable leads from known ttmcp tools
- reading appointment or reminder records from a local CSV
- connecting a custom source to a one-off outbound call provider route

Do not use it for one-off calls, generic voice-agent lists, telephony vendor directories, or workflows that do not package AI-agent phone-call behavior.

## Binding Model

Generated skills use one of three binding levels:

| Binding level | What is fixed at creation time | What is supplied at runtime | Automation level |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, consent rule, dedupe rule, writeback target, and writeback fields. | Date window, subset filters, and narrow processing controls. | Highest automation; suitable for scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required schema, consent rule, dedupe rule, goal contract, writeback policy, and writeback field schema. | Approved parameters such as form ID, CSV path, campaign ID, date window, writeback target, or output path. | Recommended default; balances reuse and automation. |
| `unbound-generic` | Goal contract and safety rules. | Source access, field mapping, consent evidence, dedupe key, filters, and writeback target. | Dry-run-only by default; not suitable for automatic real calls. |

The default recommendation is `parameterized-bound`. It avoids a brittle single-source skill while still fixing the important safety and automation contract.

## Creation Prompt Flow

The creator should keep the setup flow explicit:

1. Recommend one to three lowercase hyphenated skill names when the user has not provided one, then ask for confirmation.
2. State the proposed output scope and directory before writing files, including why that target was selected and whether reload or add-location is needed.
3. Ask for the binding level, defaulting to `parameterized-bound`.
4. Ask for the execution mode, defaulting to `dry-run-then-batch-approval`.

Only ask for extra output-target confirmation when discoverability is unclear, the path is nonstandard, or a new user skills root must be created.

## Execution Modes

The creator asks the user to choose one execution mode for the generated skill:

- `dry-run-then-batch-approval`: preview all eligible calls and compiled goals, then process the approved list serially after one explicit approval.
- `per-call-approval`: show one candidate and compiled goal at a time, then let the user approve, modify, or skip that call.
- `approved-direct-execution`: after a concrete processing request, validate candidates, run the runtime gate, inspect provider plans, and run eligible one-off calls serially without another approval step.

`approved-direct-execution` is allowed only for `fully-bound` or `parameterized-bound` skills whose concrete runtime request passes the runtime gate. It is not allowed for `unbound-generic` workflows.

## Preflight And Runtime Gate

Creation-time preflight is best effort. The creator should run non-mutating source, writeback, and provider checks when the required tools, permissions, and concrete parameters are available, but a blocked creation-time preflight does not always prevent generating the skill.

Runtime gating is mandatory before real calls. A generated skill must stop before calling when the concrete runtime request cannot verify source access, required fields, consent or outreach basis, dedupe reliability, writeback behavior or session-table fallback, provider authentication, and compatible MCP tools.

Do not perform a real writeback or place a real call during preflight unless the user explicitly approved that side effect.

## Writeback Binding

The writeback policy is chosen at creation time:

- source writeback
- local CSV writeback
- session table output

The writeback target depends on the binding level. `fully-bound` skills fix the target and fields at creation time. `parameterized-bound` skills fix the policy and field schema, while allowing an approved runtime target such as an output CSV path or verified source instance. `unbound-generic` skills collect writeback details at runtime and are dry-run-only by default.

## Creation Summary

After writing and validating a generated skill, the creator reports a short summary with the skill name, directory, discovery or reload note, binding level, runtime parameters, source contract, consent rule, dedupe rule, goal summary, execution mode, writeback policy, preflight result or blocker, runtime gate, provider route, and validation result.

The summary should make fixed values and runtime parameters visually distinct, and it must not expose credentials, tokens, cookies, callback URLs, confirmation tokens, or full phone numbers.

## Runtime Contract Formats

Generated skills should use structured formats for runtime behavior:

- concrete request examples and insufficient request examples
- runtime gate reports with `check`, `status`, `evidence`, `blocker`, and `required_before_call`
- writeback mappings with `policy`, `target_binding`, `target`, and logical result fields
- direct execution guardrail checklists

These formats make dry-runs, approvals, runtime blockers, and writeback behavior easier to audit.

## Reference Layout

The creator keeps detailed rules in focused reference files:

- `references/output-targets.md`: where generated skills should be written
- `references/data-sources.md`: source-family contracts and runtime gate requirements
- `references/binding-contract.md`: binding-level selection rules
- `references/execution-modes.md`: approval and direct-execution behavior
- `references/generated-skill-contract.md`: required generated skill structure
- `references/mcp-provider-route.md`: default provider route and one-off call flow
- `references/safety.md`: phone-call safety rules
- `references/creation-summary.md`: user-facing creation summary shape
- `references/examples.md`: concrete creation examples

## Generated Skill Contract

Every generated business skill must include:

- `SKILL.md`
- `references/safety.md`
- `references/examples.md`

Generated skills may also include focused reference files such as:

- `references/source-contract.md`
- `references/goal-contract.md`
- `references/writeback-contract.md`
- `references/binding-contract.md`

The generated `SKILL.md` must describe the source contract, binding level, runtime parameters, candidate fields, outbound goal contract, MCP provider route, execution mode, serial candidate processing, writeback behavior, best-effort creation-time preflight, mandatory runtime gate requirements, safety summary, and validation commands.

## Provider Route

Generated outbound skills use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

Generated skills must use only the MCP tools exposed by the host for that route. They must not invent tool names, schemas, confirmation tokens, or run IDs. If the route, authentication, or compatible tools are unavailable, the generated skill must stop before real calls.

## Validation

After generating a business skill, run:

```bash
node skills/outbound-skill-creator/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

When editing this reference repository, also run:

```bash
python3 scripts/validate_repository.py
```
