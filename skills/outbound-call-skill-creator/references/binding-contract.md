# Binding Contract

Use this reference when choosing how tightly the generated outbound phone-call business skill should bind its data source and writeback behavior.

## Binding Levels

| Binding level | Creation-time contract | Runtime parameters | Maximum automation |
| --- | --- | --- | --- |
| `fully-bound` | Concrete source instance, field mapping, consent rule, dedupe rule, writeback target, and writeback fields. | Date window, subset filters, and other narrow processing controls. | Eligible for approved direct execution and scheduled host runs after the runtime gate passes. |
| `parameterized-bound` | Source family, access method, required field schema, consent rule, dedupe rule, goal contract, writeback policy, and writeback field schema. | Approved instance values such as form ID, CSV path, campaign ID, date window, writeback target, or output path. | Default. Eligible for dry-run batch approval, per-call approval, and approved direct execution only after concrete runtime parameters pass the runtime gate. |
| `unbound-generic` | Goal contract and safety rules only; source and writeback details are collected at runtime. | Source access, fields, filters, consent evidence, dedupe key, and writeback target must be supplied each run. | Dry-run only by default. Do not allow real direct execution or scheduled runs until the workflow is converted to a bound skill or an exact runtime contract is approved. |

## Selection Rules

Default to `parameterized-bound` when the user wants a reusable workflow and has not asked for a single fixed source instance.

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

Use `unbound-generic` when:

- the user is exploring the workflow
- the data source, writeback behavior, consent evidence, or dedupe rule is not yet known
- the skill should produce dry-runs from manually supplied or runtime-specified records

Do not create a real-call skill with no phone field, no outreach basis or consent rule, no stable dedupe key, or no writeback or session-table result path.

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
