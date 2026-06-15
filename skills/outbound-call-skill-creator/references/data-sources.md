# Data Sources

Use this reference when selecting and documenting the generated business skill's source records.

## Required Source Contract

Capture these values before generating a business skill:

- binding level: `fully-bound`, `parameterized-bound`, or `unbound-generic`
- source family
- access method
- concrete source instance when the binding level is `fully-bound`
- allowed runtime source parameters when the binding level is `parameterized-bound`
- date-window filtering semantics
- record identifier or row reference
- E.164 phone-number field
- recipient label field
- dedupe key
- goal input fields
- outreach basis or consent field
- writeback capability
- writeback policy and field mapping
- creation-time preflight result or documented preflight blocker
- runtime gate requirements before real calls

Do not guess missing identifiers, credentials, field names, date filters, or country codes.

## Binding Levels

Choose one binding level before writing the generated skill:

| Binding level | What must be fixed at creation time | What may be supplied at runtime |
| --- | --- | --- |
| `fully-bound` | Concrete source instance, field names, consent rule, dedupe key, writeback target, and writeback fields. | Date window, subset filters, and other narrow processing controls. |
| `parameterized-bound` | Source family, access method, required schema, consent rule, dedupe key, writeback policy, and writeback field schema. | Approved instance parameters such as form ID, CSV path, campaign ID, date window, writeback target, or output path. |
| `unbound-generic` | Goal contract, safety rules, and the requirement to collect source and writeback details at runtime. | Source access, all field mappings, consent evidence, dedupe key, filters, and writeback target. |

Default to `parameterized-bound`. Use `fully-bound` for stable production or scheduled workflows. Use `unbound-generic` only for exploratory or dry-run-only workflows unless the user later supplies an exact runtime source and writeback contract for approval.

## Preflight and Runtime Gate

Creation-time preflight is best effort. Run non-mutating checks when tools and permissions are available:

- verify source authentication or connectivity
- inspect source schema or a small metadata/sample response without placing calls
- confirm the phone, recipient, date, consent, dedupe, and goal input fields exist
- confirm writeback target and fields exist, or confirm that session-table fallback will be used
- confirm the MCP provider route and compatible plan, run, or status tools are available

Do not perform a real writeback or place a real call during preflight unless the user explicitly approved that side effect. If creation-time preflight cannot run, record the blocker and require the generated skill to stop before real calls when the missing capability is still unavailable for the concrete runtime request.

Runtime gating is mandatory before real calls. The generated skill must verify source access, required fields, consent or outreach basis, dedupe reliability, writeback behavior or session-table fallback, and provider route/tool readiness for the concrete request.

## Google Form

Use `google-form` when records come from Google Forms responses.

Capture:

- form ID, discovery rule, or approved runtime form ID parameter
- local OAuth path or Apps Script fallback path
- submitted-time window behavior
- linked response spreadsheet availability
- phone-number question
- recipient name question
- dedupe key, normally response ID
- fields to include in the outbound goal
- form-level phone follow-up basis or per-response consent field
- writeback columns for status, result summary, call run ID, and processed timestamp

Generated Google Form skills must require a clear basis for phone follow-up. The basis can come from the form description, ad copy, terms, or an explicit per-response consent field.

If the form has no linked response spreadsheet and the user wants writeback, require an Apps Script fallback or ask the user to link a response spreadsheet before real writeback.

For `fully-bound`, capture the concrete form or response spreadsheet and writeback columns. For `parameterized-bound`, capture the required question names and allow the runtime request to provide the form ID only when the runtime gate verifies that the form matches the schema. For `unbound-generic`, keep the skill dry-run-only until form access, field mapping, consent basis, and writeback behavior are supplied.

## ttmcp

Use `ttmcp` when records come from TikTok or related MCP tools exposed by the host.

Capture:

- MCP server or connector name
- exact tool or resource names available in the host
- account, advertiser, campaign, lead, audience, or record scope, or the approved runtime parameter that supplies that scope
- date-window fields and timezone semantics
- record ID field
- phone-number field
- recipient label field
- dedupe key
- goal input fields
- outreach basis or consent evidence
- approved writeback tool or the decision to use session-table output

Generated ttmcp skills must not assume every record is callable. They must validate outreach basis and E.164 phone numbers before creating call candidates.

Do not invent ttmcp tools or schemas. If the host does not expose a writeback-capable tool, use session-table output or local CSV output.

For `fully-bound`, capture the concrete account, advertiser, campaign, or lead scope and writeback tool. For `parameterized-bound`, capture the exact MCP tools and required returned fields, then allow runtime account or campaign identifiers only when the runtime gate confirms the returned schema. For `unbound-generic`, do not permit approved direct execution.

## Local CSV

Use `local-csv` when records come from a user-provided CSV file.

Capture:

- CSV path, or the approved runtime CSV path parameter
- delimiter when it is not comma
- header row presence
- date column and date parsing format
- phone-number column
- recipient label column
- dedupe key column or deterministic row key rule
- goal input columns
- outreach basis or consent column
- output CSV path when local writeback is configured

Generated CSV skills should use deterministic scripts when parsing, validating, deduplicating, or writing output would otherwise be fragile.

If writeback is not configured, output the session table described in the generated skill.

For `fully-bound`, capture the concrete CSV path and output CSV path. For `parameterized-bound`, capture the required column schema and allow runtime CSV and output paths. For `unbound-generic`, require the user to map columns at runtime and keep the workflow dry-run-only until the mapping, consent column, and dedupe rule are approved.

## Other Sources

Use `other` when the source is not one of the built-in families.

Ask one question at a time until the source contract is complete:

- How does the agent access records?
- What exact fields are returned?
- Which field is the E.164 phone number?
- Which field proves phone follow-up is authorized?
- Which field is stable enough for dedupe?
- How should date-window filtering work?
- Can results be written back?
- If writeback is possible, what exact action and fields should be used?

If the user cannot provide enough detail for safe access, generate a skill that can produce a dry-run from manually supplied records and states the missing integration blocker.
