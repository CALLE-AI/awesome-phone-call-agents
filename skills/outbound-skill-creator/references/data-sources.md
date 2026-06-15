# Data Sources

Use this reference when selecting and documenting the generated business skill's source records.

## Required Source Contract

Capture these values before generating a business skill:

- source family
- access method
- date-window filtering semantics
- record identifier or row reference
- E.164 phone-number field
- recipient label field
- dedupe key
- goal input fields
- outreach basis or consent field
- writeback capability

Do not guess missing identifiers, credentials, field names, date filters, or country codes.

## Google Form

Use `google-form` when records come from Google Forms responses.

Capture:

- form ID or discovery rule
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

## ttmcp

Use `ttmcp` when records come from TikTok or related MCP tools exposed by the host.

Capture:

- MCP server or connector name
- exact tool or resource names available in the host
- account, advertiser, campaign, lead, audience, or record scope
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

## Local CSV

Use `local-csv` when records come from a user-provided CSV file.

Capture:

- CSV path
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
