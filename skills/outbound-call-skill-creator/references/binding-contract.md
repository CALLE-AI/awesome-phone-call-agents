# Binding Contract

Use this reference when choosing whether the generated outbound phone-call business skill should use the minimum source binding contract or fix a concrete source and writeback target.

The minimum supported source binding level is `parameterized-bound`. Do not generate a business skill whose source, schema, outreach basis, dedupe rule, and writeback policy are less specific than this minimum contract.

## Binding Levels

| Binding level | Creation-time contract | Runtime parameters | Maximum automation |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, source-level outreach basis or consent rule, dedupe rule, writeback target, and writeback fields. | Date window, subset filters, and other narrow processing controls. | Eligible for approved direct execution and scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required field schema, source-level outreach basis or consent rule, dedupe rule, goal contract, writeback policy, and writeback field schema. | Approved instance values such as form ID, CSV path, campaign ID, date window, writeback target, or output path. | Default. Eligible for dry-run batch approval, per-call approval, and approved direct execution only after concrete runtime parameters pass the runtime gate. |

## Selection Rules

Default to the minimum `parameterized-bound` contract when the user wants a reusable workflow and has not asked for a single fixed source instance.

Use `fully-bound` when:

- the workflow targets one stable source instance
- the writeback target and fields are known
- the user wants scheduled runs or approved direct execution
- preflight can usually verify the concrete source and writeback target

Use `parameterized-bound` when:

- the workflow should be reusable across similar forms, CSV files, accounts, campaigns, or source instances
- the required schema is stable
- runtime requests can provide approved source or writeback parameters
- the runtime gate can verify those parameters before real calls

Do not create a generated business skill when the data source, writeback behavior, source-level outreach basis or consent evidence, or dedupe rule is too vague to satisfy the minimum `parameterized-bound` contract. Continue onboarding or stop with the missing contract details instead.

Do not create a skill with no phone field, no source-level outreach basis or consent rule, no stable dedupe key, or no writeback or session-table result path.

## Generated Skill Requirements

The generated skill must state:

- selected binding level
- fixed creation-time values
- allowed runtime parameters
- required runtime parameters
- selected writeback policy
- whether the writeback target is fixed, parameterized, or session-only
- runtime gate checks required before real calls
- maximum execution mode supported by the binding level
