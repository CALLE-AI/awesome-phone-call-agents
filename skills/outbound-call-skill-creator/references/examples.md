# Examples

Use fictional reserved phone numbers in examples.

## Google Form Quote Callback Skill

User request:

```text
Create an outbound skill named quote-request-callback. It should process Google Form quote requests, call leads who authorized phone follow-up, and write results back to the linked response spreadsheet.
```

Captured contract:

- output scope: user-level reusable skill, or this repository's `skills/` directory when contributing the workflow here
- binding level: `parameterized-bound` by default; `fully-bound` when a concrete form and linked response spreadsheet are fixed at creation time
- source onboarding: authentication or access check completed, representative sample fetched, schema confirmed, and default goal fields confirmed from the sample
- provider onboarding: selected host runtime has the CALL-E MCP route configured and authenticated, compatible plan/run/status tools found, and no provider blocker
- source family: `google-form`
- phone field: `phone`
- recipient label field: `name`
- dedupe key: Google Forms response ID
- date filtering: submitted-time window
- outreach basis: form description states that submission authorizes a phone follow-up
- provider route: `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`
- writeback: linked response spreadsheet
- execution: `dry-run-then-batch-approval` by default; `approved-direct-execution` only when the binding level supports it and the concrete runtime request passes the runtime gate; after approval or direct-mode validation, process all ready candidates serially and report one final batch summary
- preflight and runtime gate: best-effort creation-time preflight verifies form access, required questions, linked response spreadsheet columns, and provider route/tool readiness when available; runtime gate is mandatory before real calls

Generated future use:

```text
Use quote-request-callback to process all June 20 submissions.
```

## Source-Family-Only Authenticated Onboarding Prompt

User reply:

```text
google-form
```

Recommended creator response:

```text
Source family is `google-form`. I recommend a workflow that follows up with form submitters who requested a phone call.

Recommended provisional goal: call the respondent, confirm their request, ask one follow-up question, and summarize the outcome.

Recommended binding level is `parameterized-bound`.

Next I will check whether this host already exposes Google Forms access. If local OAuth is available, I will run its auth check and list accessible forms before asking you for a Form ID. If auth requires a browser step, I will pause for you to complete it, re-check auth, then list forms.

After access is verified and a sample is fetched, I will propose the phone, recipient, dedupe, outreach-basis, goal-input, and result-output fields for confirmation, then refine the final goal contract from the sampled fields.
```

If no Google route can be discovered, ask for only the missing route detail:

```text
I could not find a usable local OAuth helper or Google Forms connector in this host. Please provide one of:
- a representative Google Form ID that I can check after authorization is available
- an account or Drive scope that I can use after authorization is available
- an Apps Script fallback endpoint
```

If the user replies only `google-form`, recommend the likely workflow and provisional call goal before asking for source access details. For MCP-backed sources, I will first identify the current or target MCP-capable host and use that host's documented connector or MCP setup.

The same pattern applies when the user replies only `tiktok-ads`: recommend a likely lead follow-up workflow, inspect available TikTok Ads MCP tools or resources, verify or request authentication, then ask for the exact MCP tool, resource, account, campaign, or managed connector route only if no usable route can be discovered or a concrete scope is still required. If a safe auth action is available, I will start it before asking for another confirmation; I will not ask the user to say `start auth`, choose a discovered route, or refresh the session before attempting the available non-mutating auth path. If the selected host is Codex and this host has no TikTok Ads MCP server configured, I will ask whether to add the default route before running `codex mcp add`; after approval I will inspect it with `codex mcp get tiktok-ads` and `codex mcp list`. For non-Codex MCP hosts, I will use that host's documented MCP server or connector setup instead. If Codex reports `Auth: Unsupported`, I will treat that only as missing Codex-managed OAuth. When the route is configured but tools are not exposed, I will run `codex mcp login tiktok-ads` for Codex or the host's equivalent source MCP login before asking for a different route or session refresh. When TikTok Ads tools or resources are exposed, I will run a source-native read-only auth or inventory probe such as `auth_advertiser_get` before declaring a blocker; only if the available auth path and probe fail or no tools are exposed will I ask for a supported token, managed connector, host-specific login path, or another approved route.

If the user replies only `notion`, recommend a likely workflow for approved records in a Notion database or data source. For Notion, I will recommend hosted Notion MCP first because it uses OAuth and avoids user-managed integration tokens. I will use the selected host's MCP server or connector setup and OAuth flow before asking for a Notion integration token. If the selected host is Codex, I will check for an existing `notion` MCP route. If the selected host is Codex and no existing `notion` MCP route points to hosted Notion MCP, I will ask whether to add it before running `codex mcp add notion`; after approval I will run `codex mcp add notion --url https://mcp.notion.com/mcp`, `codex mcp login notion`, and `codex mcp list`. After OAuth and active-session tools are visible, I will ask only for the database URL, database ID, data source ID, or managed connector resource locator still needed for a sample fetch. If a database locator is supplied, resolve it to a canonical data source before asking for field mapping.

If the user replies only `airtable`, recommend a likely workflow for approved records in an Airtable table or view. For Airtable, I will recommend hosted Airtable MCP first because it uses OAuth and avoids user-managed personal access tokens. I will use the selected host's MCP server, connector, or plugin setup and OAuth flow before asking for an Airtable personal access token. If the selected host is Codex, I will check for an existing `airtable` MCP route and the official `airtable@openai-curated` plugin. If the selected host is Codex and neither the Airtable plugin nor a hosted Airtable MCP route is configured, I will ask whether to install the plugin or add the route before running `codex plugin add` or `codex mcp add airtable`; after approval I will run `codex plugin add airtable@openai-curated` or `codex mcp add airtable --url https://mcp.airtable.com/mcp`, then `codex mcp login airtable` and `codex mcp list`. After OAuth and active-session tools are visible, I will ask only for the base ID, table ID or name, optional view ID or name, filter formula, or managed connector resource locator still needed for a sample fetch. If base schema access is available, resolve table and field names to stable IDs before asking for field mapping.

## TikTok Ads Lead Follow-Up Skill

User request:

```text
Create an outbound skill named tiktok-lead-followup. It should read callable lead records from TikTok Ads, call leads about their submitted product interest, and write status back only if an approved TikTok Ads MCP writeback tool or connector action exists.
```

Captured contract:

- output scope: user-level reusable skill unless the user explicitly asks for project-local output
- binding level: `parameterized-bound` by default, with runtime account or campaign parameters allowed only after runtime schema verification
- source onboarding: authentication or access check completed, representative sample fetched, schema confirmed, and default goal fields confirmed from the sample
- provider onboarding: selected host runtime has the CALL-E MCP route configured and authenticated, compatible plan/run/status tools found, and no provider blocker
- source family: `tiktok-ads`
- access method: MCP
- source route: `https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp`, or another approved TikTok Ads connector route exposed by the host
- MCP tool names: captured from the host before generation
- phone field: captured from returned lead records
- recipient label field: captured from returned lead records
- dedupe key: lead record ID
- date filtering: record creation time in the source account timezone
- outreach basis: lead form includes phone follow-up consent
- result output: approved TikTok Ads MCP writeback tool or approved connector action when available; otherwise use an approved source-adjacent result artifact in the same account or workspace when available; otherwise write a new local result CSV; use session-table output only as a last-resort non-persistent fallback when durable output cannot be verified
- execution: `dry-run-then-batch-approval` or `approved-direct-execution` only after concrete runtime scope passes the runtime gate; finalize provider results with full-history reconciliation, record each stable terminal result, then write back to the source, write a source-adjacent result artifact, or write one result CSV

Generated future use:

```text
Use tiktok-lead-followup to process yesterday's callable leads.
```

## Notion Callback Workflow Skill

User request:

```text
Create an outbound skill named notion-crm-callbacks. It should read approved callback records from a Notion CRM database, call contacts who consented to phone follow-up, and write call status back to the Notion page when page-property writeback is verified.
```

Captured contract:

- output scope: user-level reusable skill unless the user explicitly asks for project-local output
- binding level: `parameterized-bound` by default, with runtime Notion database or data source locators allowed only after runtime locator resolution and schema verification
- source onboarding: Notion authentication or connector access checked, database or data source locator resolved to a canonical data source, data source schema retrieved, representative page sample fetched, and default goal fields confirmed from the sample
- provider onboarding: selected host runtime has the CALL-E MCP route configured and authenticated, compatible plan/run/status tools found, and no provider blocker
- source family: `notion`
- access method: hosted Notion MCP at `https://mcp.notion.com/mcp` by default, or another approved Notion MCP/API/integration-token/managed connector route when hosted MCP is unavailable
- source locator: Notion database URL, database ID, data source ID, or managed connector resource locator
- canonical source: data source ID resolved during onboarding; if a database contains multiple data sources, the user chooses the exact data source before sampling
- phone property: `phone_e164`
- recipient label property: `contact_name`
- dedupe key: Notion page ID unless a stable CRM record ID property is configured
- date filtering: `requested_callback_at` date property, or created time when no business date property is configured
- outreach basis: `phone_follow_up_consent` is true, or a source-level policy confirms that the Notion source contains only approved callback requests
- result output: update existing Notion page properties for call status, result summary, provider run ID, and processed timestamp only after hosted Notion MCP or another authenticated Notion route exposes page update capability and canary writeback/readback passes; otherwise use an approved source-adjacent result artifact in the same Notion workspace when available; otherwise write a new local result CSV; use session-table output only as a last-resort non-persistent fallback when durable output cannot be verified
- execution: `dry-run-then-batch-approval` by default; `approved-direct-execution` only after concrete runtime locator, schema, consent, dedupe, result-output, and provider checks pass; after approval or direct-mode validation, process all ready candidates serially and report one final batch summary

Generated future use:

```text
Use notion-crm-callbacks to process approved callback requests from the Sales CRM database for 2026-06-20.
```

## Airtable Follow-Up Workflow Skill

User request:

```text
Create an outbound skill named airtable-follow-up-calls. It should read approved follow-up records from an Airtable table view, call contacts who consented to phone follow-up, and write call status back to Airtable when record-field writeback is verified.
```

Captured contract:

- output scope: user-level reusable skill unless the user explicitly asks for project-local output
- binding level: `parameterized-bound` by default, with runtime Airtable base, table, or view locators allowed only after runtime locator resolution and schema verification
- source onboarding: Airtable authentication or connector access checked, base and table locator resolved, schema retrieved when available, representative record sample fetched from the configured table or view, and default goal fields confirmed from the sample
- provider onboarding: selected host runtime has the CALL-E MCP route configured and authenticated, compatible plan/run/status tools found, and no provider blocker
- source family: `airtable`
- access method: hosted Airtable MCP at `https://mcp.airtable.com/mcp` by default, or another approved Airtable MCP/API OAuth/personal-access-token/managed connector route when hosted MCP is unavailable
- source locator: Airtable base ID, table ID or name, optional view ID or name, and optional filter formula
- canonical source: base ID plus table ID; view ID is captured when the view defines the approved candidate subset
- phone field: `phone_e164`
- recipient label field: primary field or `contact_name`
- dedupe key: Airtable record ID unless a stable CRM record ID field is configured
- date filtering: `follow_up_date` date field, or record created time when no business date field is configured
- outreach basis: `phone_follow_up_consent` is true, an approved view or formula filter includes only callable records, or a source-level policy confirms that the table contains only approved follow-up requests
- result output: non-destructive updates to existing Airtable record fields for call status, result summary, provider run ID, and processed timestamp only after hosted Airtable MCP or another authenticated Airtable route exposes non-destructive record update capability and canary writeback/readback passes; otherwise use an approved source-adjacent result artifact in the same Airtable base or workspace when available; otherwise write a new local result CSV; use session-table output only as a last-resort non-persistent fallback when durable output cannot be verified
- execution: `dry-run-then-batch-approval` by default; `approved-direct-execution` only after concrete runtime locator, schema, consent, dedupe, result-output, and provider checks pass; after approval or direct-mode validation, process all ready candidates serially and report one final batch summary

Generated future use:

```text
Use airtable-follow-up-calls to process approved records from the Customer Follow-up view for 2026-06-20.
```

## Local CSV Appointment Confirmation Skill

User request:

```text
Create an outbound skill named appointment-confirmation-calls. It should read a CSV of appointment records, call each patient to confirm logistics only, and write a result CSV.
```

Captured contract:

- output scope: project-local only when the CSV workflow should be versioned with the current project; otherwise user-level reusable skill
- binding level: `parameterized-bound` when the CSV path is supplied at runtime but columns are fixed; `fully-bound` when the CSV path and result CSV path are fixed
- source onboarding: file access check completed, representative sample fetched, schema confirmed, and default goal fields confirmed from the sample
- provider onboarding: selected host runtime has the CALL-E MCP route configured and authenticated, compatible plan/run/status tools found, and no provider blocker
- source family: `local-csv`
- CSV path: provided at runtime
- phone column: `phone_e164`
- recipient label column: `patient_name`
- dedupe key column: `appointment_id`
- date filtering: `appointment_date` in `YYYY-MM-DD`
- outreach basis: source-level; this CSV is exported only from records whose owners requested or agreed to phone follow-up, so no per-row consent column is required
- result output: local CSV with supported target modes `result-csv-file` and `source-csv-in-place`; resolve the concrete target mode during runtime dry-run or approval, using `result-csv-file` as the default durable output and `source-csv-in-place` only when the runtime request explicitly asks to update the original CSV and target result columns are defined
- sensitive boundary: logistics only, no medical advice
- execution: after approval, call eligible rows serially, continue past candidate-level failures when safe, run provider result finalization before local result CSV output, and summarize all results after the batch ends

Generated future use:

```text
Use appointment-confirmation-calls to process appointments on 2026-06-20 from /path/to/appointments.csv.
```

## Custom Source Skill

User request:

```text
Create an outbound skill for records from our internal API.
```

Creator behavior:

Ask for source access, returned fields, phone field, outreach basis, dedupe key, date filtering, and durable result-output capability. If any critical value is unknown, stop before generation and explain the missing contract detail.

If source onboarding cannot authenticate or sample the source safely, do not generate the skill yet. Record the blocker in the creation conversation and continue only after the user provides an access route or representative source sample that supports the minimum `parameterized-bound` contract.

## Binding Mode Selection

User request:

```text
Create a skill for quote request callbacks. I want to reuse it across multiple forms with the same questions.
```

Recommended creator response:

- recommend `parameterized-bound`
- fix the required Google Form questions, source-level phone follow-up basis or consent basis, dedupe rule, goal contract, provider route, and result-output field schema
- allow the runtime request to provide the concrete form ID, date window, and approved output path or source-adjacent artifact target when source writeback is not fixed
- run best-effort creation-time preflight when available and require form schema and durable result-output runtime gate checks before real calls
- default execution mode to `dry-run-then-batch-approval`

User request:

```text
Create a skill that automatically processes the same lead form every morning.
```

Recommended creator response:

- recommend `fully-bound`
- fix the concrete form, linked response spreadsheet, source-adjacent result artifact, or local result CSV target, result columns, and host scheduler boundary
- allow only narrow runtime controls such as date window
- require the runtime gate before every scheduled or approved direct execution run

User request:

```text
Create a generic callback skill. I will tell it the data source later.
```

Recommended creator response:

- explain that this creator generates directly usable batch-call skills, so the source family and minimum source contract must be known before generation
- ask for the source family and enough access detail to run source onboarding
- recommend `parameterized-bound` once the source family, required schema, outreach basis, dedupe rule, and durable result-output policy are known
