# Binding Contract

Use this reference when choosing whether the generated outbound phone-call business skill should use the minimum source binding contract or fix a concrete source and durable result-output target.

The minimum supported source binding level is `parameterized-bound`. Do not generate a business skill whose source, schema, outreach basis, dedupe rule, and durable result-output policy are less specific than this minimum contract.

## Binding Levels

| Binding level | Creation-time contract | Runtime parameters | Maximum automation |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, source-level outreach basis or consent rule, dedupe rule, fixed result target, and result fields. The result target can be source writeback to the source instance or canonical record store, a source-adjacent result artifact, or a local result CSV. | Date window, subset filters, and other narrow processing controls. | Eligible for approved direct execution and scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required field schema, source-level outreach basis or consent rule, dedupe rule, goal contract, result-output policy, and result field schema. | Approved instance values such as form ID, Notion database or data source ID, Airtable base/table/view locator, CSV path, campaign ID, date window, source writeback target, source-adjacent artifact target, or output path. | Default. Eligible for dry-run batch approval and approved direct execution only after concrete runtime parameters pass the runtime gate. |

## Selection Rules

Default to the minimum `parameterized-bound` contract when the user wants a reusable workflow and has not asked for a single fixed source instance.

Use `fully-bound` when:

- the workflow targets one stable source instance
- the source writeback target, source-adjacent result artifact target, or local result CSV target and fields are known
- the user wants scheduled runs or approved direct execution
- preflight can usually verify the concrete source and durable result-output target

Use `parameterized-bound` when:

- the workflow should be reusable across similar forms, Notion data sources, Airtable tables or views, CSV files, accounts, campaigns, or source instances
- the required schema is stable
- runtime requests can provide approved source or result-output parameters
- the runtime gate can verify those parameters before real calls

Do not create a generated business skill when the data source, durable result-output behavior, source-level outreach basis or consent evidence, or dedupe rule is too vague to satisfy the minimum `parameterized-bound` contract. Continue onboarding or stop with the missing contract details instead.

Do not create a skill with no phone field, no source-level outreach basis or consent rule, no stable dedupe key, or no durable result path such as verified source writeback, a source-adjacent result artifact, or a new local result CSV. Session-table output is only a last-resort non-persistent fallback when durable output validation is blocked.

Treat source writeback narrowly. It means updating the bound source instance or its canonical record store, such as fixed result columns on a response spreadsheet, writable lead-record fields, or an explicitly requested source CSV in-place update. A same-system side file, new sheet, new tab, exported table, or result artifact is not source writeback; classify it as `source-adjacent-result-artifact`.

For `fully-bound` source-adjacent output, fix the provider/account/workspace/folder or equivalent container and either the artifact ID/path or the exact creation policy, naming rule, schema, and append or upsert behavior at creation time. Creating a new artifact is a durable side effect and must be covered by execution approval or by the approved direct-execution contract.

## Generated Skill Requirements

The generated skill must state:

- selected binding level
- fixed creation-time values
- allowed runtime parameters
- required runtime parameters
- selected result-output policy
- whether the result target is source writeback, source-adjacent result artifact, local result CSV, parameterized, or last-resort session-only
- runtime gate checks required before real calls
- maximum execution mode supported by the binding level
