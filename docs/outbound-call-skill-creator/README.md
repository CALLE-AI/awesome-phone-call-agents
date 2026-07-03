# Outbound Call Skill Creator

`outbound-call-skill-creator` is a generator skill for creating focused outbound phone-call business skills. It does not process campaign data or place calls itself. Instead, it captures a reusable workflow contract and writes a directly usable Agent Skill that can later read source records, validate candidates, compile one call goal per eligible record, run one-off calls through the configured MCP provider route, and write durable results through source writeback, a source-adjacent result artifact, or a new local result CSV.

## When To Use

Use this creator when a user wants a reusable outbound phone-call workflow, such as:

- processing authorized Google Form responses and calling leads back
- reading callable leads from TikTok Ads through MCP tools, resources, or approved connectors
- reading appointment or reminder records from a local CSV
- connecting a custom source to a one-off outbound call provider route

Do not use it for one-off calls, generic voice-agent lists, telephony vendor directories, or workflows that do not package AI-agent phone-call behavior.

## Technical Binding Model

This section describes the generated-skill contract for maintainers and checkers. Do not mirror it as the first user prompt.

Generated skills use one of two binding levels. The minimum source binding contract is `parameterized-bound`:

| Binding level | What is fixed at creation time | What is supplied at runtime | Automation level |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, source-level outreach basis or consent rule, dedupe rule, fixed result target, and result fields. The result target can be source writeback to the source instance or canonical record store, a source-adjacent result artifact, or a local result CSV. | Date window, subset filters, and narrow processing controls. | Highest automation; suitable for scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required schema, source-level outreach basis or consent rule, dedupe rule, goal contract, result-output policy, and result field schema. | Approved parameters such as form ID, CSV path, campaign ID, date window, source writeback target, source-adjacent artifact target, or output path. | Recommended default; balances reuse and automation. |

The default recommendation is `parameterized-bound`. It avoids a brittle single-source skill while still fixing the important safety and automation contract. Use `fully-bound` only when the workflow should fix one concrete source and durable result-output target at creation time.

## Creation Prompt Flow

The creator should keep the setup flow guided and recommendation-first:

1. Ask for either the business workflow or the data source.
2. If only workflow is known, ask for the source family with examples such as `google-form`, `tiktok-ads`, `local-csv`, or `other`.
3. If only source family is known, recommend a likely workflow and provisional call goal.
4. Confirm a provisional call goal, then recommend Reusable workflow (`parameterized-bound`) plus Preview before calling (`dry-run-then-batch-approval`) as a preference unless the workflow needs a fixed source or approved direct execution.
5. Confirm one lowercase hyphenated skill name candidate.
6. Check source access and fetch a representative sample before asking for detailed mapping, final goal fields, or writeback choices.
7. Confirm the final goal contract and verified durable result-output target only after the sample identifies supported fields and output paths.
8. Connect or verify the call provider, then finalize the selected execution mode from the earlier preference and the verified onboarding evidence.
9. State the proposed output scope and directory before writing files, including why that target was selected and whether reload or add-location is needed.

Only ask for the next missing value. If the user provides several values at once, record all of them and continue from the first missing value. Only ask for extra output-target confirmation when discoverability is unclear, the path is nonstandard, or a new user skills root must be created.

## User-Facing Language Boundary

The creation conversation should not expose internal concepts as the first decision surface. Prompt with plain business labels first, such as Reusable workflow, Fixed source workflow, Preview before calling, Call provider connection, Checks before real calls, and Save durable results. Keep internal terms such as `parameterized-bound`, `fully-bound`, `dry-run-then-batch-approval`, provider onboarding, runtime gate, and result-output binding in parentheses, technical summaries, generated-skill contracts, and validation details.

Most users should experience the path as: describe the business goal, accept the recommended reusable workflow, let the creator verify the source and call provider, preview the dry-run candidate list when the generated skill is later used, approve the batch, and receive durable results. Advanced modes should appear only when the user asks for them or the workflow clearly requires them.

## Technical Source Onboarding

For bound workflows, creation includes a source onboarding pass before the generated skill is written. The creator verifies source access, asks the user to resolve access blockers, fetches a small representative sample through a read-only path, confirms the schema, and uses the sampled fields to help define the default outbound goal. User-approved authorization may create or refresh local host credentials, OAuth tokens, connector sessions, or MCP authorization state, but onboarding must not mutate source records, source permissions, source integrations, scheduler state, result-output targets, or phone-call provider state. This lets a later runtime request provide only the intended processing scope, such as a date window, instead of rebuilding the source and goal contract.

For authenticated or connector-backed sources such as Google Forms, TikTok Ads, and future OAuth, API, MCP, or managed connector sources, the creator collects only minimum connection details before access is verified. It must not present a blank manual mapping form for phone, recipient, consent, dedupe, goal inputs, or result-output fields before authentication and sample fetch have been attempted. After a redacted representative sample is available, it proposes the field mapping and asks the user to fill only fields that cannot be inferred.

If the user only names an authenticated source family such as `google-form` or `tiktok-ads`, first recommend a likely workflow and provisional call goal, then enter source access onboarding. The creator should proactively inspect host-local adapters, connectors, MCP tools, MCP resources, or helper scripts before asking the user to choose an access route. When a safe source authorization or auth-readiness action is available, start it before asking the user for another confirmation; do not ask the user to say `start auth`, choose a discovered route, or refresh a session before attempting the available non-mutating auth path. For Google Forms, when `google-form-callback` helpers are available, check `google-auth.mjs status`, run or request `preflight-auth.mjs --repair-google` if auth is missing, and use `google-local-api-client.mjs --action list-forms` before asking for a Form ID. For TikTok Ads in Codex, inspect exposed MCP tools and resources first; when no TikTok Ads MCP server is configured, ask the user for explicit permission before adding the default source route, and explain that `codex mcp add` changes host MCP configuration. After approval, run `codex mcp add tiktok-ads --url https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp`, then `codex mcp get tiktok-ads` and `codex mcp list` before asking the user for a route choice. Treat Codex `Auth: Unsupported` as missing Codex-managed OAuth only. If the route is configured but tools are not exposed, run `codex mcp login tiktok-ads` or the host's equivalent source MCP login before asking for a different route or session refresh. If TikTok Ads tools or resources are exposed, run a source-native read-only auth or inventory probe such as `auth_advertiser_get` before declaring a blocker; only ask for a supported token, managed connector, host-specific login path, or another approved route when no tools are exposed after the available auth path has been attempted or the source-native probe cannot authenticate. Ask the user only for the minimum locator or user-completed authorization step that remains necessary, and wait until the sample is available before asking for detailed field mapping, final goal-field selection, or result-output mapping.

If source onboarding cannot confirm at least the `parameterized-bound` source and durable result-output contract, the creator stops before generating the skill and reports the missing contract details.

## Technical Provider Onboarding

Creation also includes provider onboarding for the default CALL-E MCP route. In user prompts, present this as connecting or authorizing the call provider. The creator verifies that the selected host runtime has a configured MCP route for `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`, completes or requests that host's authorization flow, and re-checks route setup, auth readiness, and compatible plan/run/status tools before writing a real-call generated skill. For Codex, the host adapter uses `codex mcp add calle-prod --url https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`, `codex mcp login calle-prod`, and `codex mcp list` or `codex mcp get calle-prod`. For Claude, Antigravity, Cursor, or another MCP host, use that host's MCP server or connector setup and authorization flow.

Provider onboarding is non-mutating for phone-call side effects: it must not create provider plans, place calls, write results, request confirmation tokens, or expose credentials. App connector tools, plugin tools, and `mcp__codex_apps__*` namespaces do not prove that the CALL-E MCP route is installed or authorized. If provider onboarding cannot complete, the generated skill records a provider onboarding blocker and remains dry-run-only until the blocker is resolved; it must not be generated as a skill that can place real calls.

## Example Creation Flow

User request:

```text
Create an outbound skill named quote-request-callback. It should process Google Form quote requests, call leads who authorized phone follow-up, and write results back to the response spreadsheet.
```

Typical creator decisions:

- Skill name: `quote-request-callback`
- Output target: user-level reusable skill, unless the user asks for repository-scoped output
- Binding level: `parameterized-bound`
- Source onboarding: access check completed, representative form response sampled through a read-only path, default goal fields derived from the sample, and no onboarding blocker
- Provider onboarding: selected host runtime has the CALL-E MCP route configured and authenticated, compatible plan/run/status tools found, and no provider blocker
- Runtime parameters: form ID and date window
- Source contract: Google Form responses with required `name`, `phone`, submitted time, response ID, and phone follow-up basis
- Goal contract: confirm submitted quote interest, ask whether a sales specialist may follow up, and avoid pricing promises
- Execution mode: `dry-run-then-batch-approval`
- Result output: source writeback to the linked response spreadsheet with status, result summary, safe run ID, and processed timestamp fields
- Runtime gate: verify form schema, source-level or per-response phone follow-up basis, dedupe key, result-output target, and provider route before real calls

Future use:

```text
Use quote-request-callback to process all June 20 submissions for form <form-id>.
```

## Technical Execution Modes

The creator should not ask most users to choose by execution-mode names. It records Preview before calling (`dry-run-then-batch-approval`) as the default preference after the workflow reuse choice is known, then finalizes the selected execution mode only after source onboarding, verified durable result-output capability, and provider onboarding evidence are known. For `fully-bound` and `parameterized-bound`, available modes are:

- `dry-run-then-batch-approval`: preview all eligible calls and compiled goals, then process the approved list serially after one explicit approval.
- `approved-direct-execution`: after a concrete processing request, validate candidates, run the runtime gate, inspect provider plans, and run eligible one-off calls serially without another approval step.

Execution mode selection happens only after the source and durable result-output contract satisfies at least the `parameterized-bound` minimum and provider onboarding evidence is known.

## Technical Preflight And Runtime Gate

Creation-time preflight is best effort. The creator should run non-mutating source, result-output, and provider checks when the required tools, permissions, and concrete parameters are available, but a blocked creation-time preflight does not always prevent generating the skill.

Runtime gating is mandatory before real calls. A generated skill must stop before calling when the concrete runtime request cannot verify source access, required fields, consent or outreach basis, dedupe reliability, source writeback, source-adjacent result artifact output, local result CSV output, provider authentication, and compatible MCP tools.

Do not perform a real writeback, create or write a source-adjacent artifact, write a result CSV, or place a real call during creation-time onboarding or preflight. Approved side effects can happen only later in the selected runtime execution flow after the runtime gate passes.

Generated skills must finalize provider results before result output. Cursor-based status polling can show progress, but terminal provider status is not result-output-ready until the skill performs a full-history provider reconciliation. Negative terminal outcomes such as `no_answer`, `failed`, or `no conversation captured` require a negative terminal stability check before writing source, source-adjacent, or CSV results.

## Result Output Binding

The result-output policy is chosen at creation time, but early result-output or writeback input is only a preference until source access and representative sampling identify supported paths:

- source writeback
- source-adjacent result artifact
- new local result CSV
- session table output only as a last-resort non-persistent fallback

Treat source writeback narrowly: it updates the bound source instance or canonical source record store. A same-system side file, new sheet, new tab, result table, or export beside the source is `source-adjacent-result-artifact`, not source writeback. For `fully-bound`, fix the artifact ID/path or the exact creation policy, container, schema, and append or upsert behavior at creation time.

For local CSV output, the creator records supported result-output target modes and the generated skill chooses the concrete mode during the runtime dry-run or approval step. Use `source-csv-in-place` only when the runtime request explicitly asks to update the original CSV and execution approval covers that mutation. Use `result-csv-file` when results should be written to a separate CSV or the request does not explicitly ask to mutate the original CSV. Do not describe a separate results file as original CSV writeback.

The result-output target depends on the binding level. `fully-bound` skills fix the target and fields at creation time. `parameterized-bound` skills fix the policy and field schema, while allowing an approved runtime target mode or target such as source CSV update, source-adjacent artifact target, output CSV path, or verified source instance.

## Creation Summary

After writing and validating a generated skill, the creator reports a short summary with the skill name, directory, discovery or reload note, binding level, source onboarding status, sampled source instance, sample fetch result, default goal source, provider onboarding status, provider host runtime, MCP route setup and provider auth check results, compatible MCP tools, provider blocker if any, runtime parameters, source contract, source-level outreach basis or consent rule, dedupe rule, goal summary, execution mode, result-output policy, preflight result or blocker, runtime gate, provider route, and validation result.

The summary should make fixed values and runtime parameters visually distinct, and it must not expose credentials, tokens, cookies, callback URLs, confirmation tokens, or full phone numbers.

## Runtime Contract Formats

Generated skills should use structured formats for runtime behavior:

- concrete request examples and insufficient request examples
- source onboarding reports with access check status, sampled source instance, sample fetch result, redaction policy, and default goal source
- provider onboarding reports with provider route, provider host runtime, MCP route setup check, auth readiness, compatible MCP tools, one-off call capability, and blocker fields
- provider result finalization reports with `run_id`, `terminal_status_seen`, `full_history_rechecked`, `negative_terminal_stability_checked`, `result_output_allowed`, and `blocker`
- runtime gate reports with `check`, `status`, `evidence`, `blocker`, and `required_before_call`
- result-output mappings with `policy`, `target_mode`, `target_binding`, `target`, and logical result fields
- direct execution guardrail checklists

These formats make dry-runs, approvals, runtime blockers, and result-output behavior easier to audit.

## Reference Layout

The creator keeps detailed rules in focused reference files:

- `skills/outbound-call-skill-creator/references/output-targets.md`: where generated skills should be written
- `skills/outbound-call-skill-creator/references/interaction-flow.md`: prompt order, known-value reuse, and copyable user choices
- `skills/outbound-call-skill-creator/references/data-sources.md`: source-family contracts and runtime gate requirements
- `skills/outbound-call-skill-creator/references/binding-contract.md`: binding-level selection rules
- `skills/outbound-call-skill-creator/references/execution-modes.md`: approval and direct-execution behavior
- `skills/outbound-call-skill-creator/references/generated-skill-contract.md`: required generated skill structure
- `skills/outbound-call-skill-creator/references/mcp-provider-route.md`: default provider route and one-off call flow
- `skills/outbound-call-skill-creator/references/safety.md`: phone-call safety rules
- `skills/outbound-call-skill-creator/references/creation-summary.md`: user-facing creation summary shape
- `skills/outbound-call-skill-creator/references/examples.md`: concrete creation examples

## Generated Skill Contract

Every generated business skill must include:

- `SKILL.md`
- `references/safety.md`
- `references/examples.md`

Generated skills may also include focused reference files such as:

- `references/source-contract.md`
- `references/goal-contract.md`
- `references/result-output-contract.md`
- `references/binding-contract.md`

The generated `SKILL.md` must describe the source contract, source onboarding status, provider onboarding status with host MCP route setup and authentication evidence, provider blocker if any, binding level, runtime parameters, candidate fields, outbound goal contract, MCP provider route, execution mode, serial candidate processing, result-output behavior, best-effort creation-time preflight, mandatory runtime gate requirements, safety summary, and validation commands.

## Provider Route

Generated outbound skills use this MCP provider route by default:

```text
https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth
```

Generated skills must use only the MCP tools exposed by the host for that route. They must not invent tool names, schemas, confirmation tokens, or run IDs. If the route, authentication, or compatible tools are unavailable, the generated skill must stop before real calls.

## Validation

After generating a business skill, run:

```bash
node skills/outbound-call-skill-creator/scripts/check-generated-skill.mjs --skill-dir <generated-business-skill-dir>
```

When editing this reference repository, also run:

```bash
python3 scripts/validate_repository.py
```
