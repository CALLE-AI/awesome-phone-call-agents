# Data Sources

Use this reference when selecting and documenting the generated business skill's source records.

For maintainer steps to add a built-in source family, see `references/source-family-extension.md`.

## Required Source Contract

Capture these values before generating a business skill. The source contract must satisfy at least the `parameterized-bound` minimum:

- binding level: `fully-bound` or `parameterized-bound`
- source family
- access method
- authentication or access check method
- creation-time source onboarding status
- sampled source instance or representative runtime instance
- sample fetch result and redaction rule
- concrete source instance when the binding level is `fully-bound`
- allowed runtime source parameters when the binding level is `parameterized-bound`
- date-window filtering semantics
- record identifier or row reference
- E.164 phone-number field
- recipient label field
- dedupe key
- goal input fields
- source-level outreach basis or optional consent field
- durable result-output capability
- result-output policy and field mapping
- creation-time preflight result or documented preflight blocker
- runtime gate requirements before real calls

Do not guess missing identifiers, credentials, field names, date filters, or country codes.

## Binding Levels

Choose whether the workflow stays at the minimum binding level or upgrades to a fixed source instance before writing the generated skill:

| Binding level | What must be fixed at creation time | What may be supplied at runtime |
| --- | --- | --- |
| `fully-bound` | Concrete source instance, field names, source-level outreach basis or consent rule, dedupe key, fixed result target, and result fields. The result target can be source writeback, a source-adjacent result artifact, or a local result CSV. | Date window, subset filters, and other narrow processing controls. |
| `parameterized-bound` | Source family, access method, required schema, source-level outreach basis or consent rule, dedupe key, result-output policy, and result field schema. | Approved instance parameters such as form ID, Notion database or data source ID, Airtable base/table/view locator, CSV path, campaign ID, date window, source writeback target, source-adjacent artifact target, or output path. |

Default to the minimum `parameterized-bound` contract. Use `fully-bound` for stable production or scheduled workflows that should fix a concrete source and durable result-output target. If the workflow cannot support the minimum contract, continue onboarding or stop before generating the skill. Treat early result-output or writeback input as a preference, not as a verified target, until source access and representative sampling identify supported writeback paths, source-adjacent artifact options, or local CSV output.

## Preflight and Runtime Gate

Creation-time source onboarding is required to reach the minimum `parameterized-bound` contract, and `fully-bound` adds concrete instance verification. Run non-mutating checks when tools and permissions are available:

- verify source authentication, connector availability, or local file access
- fetch a small representative sample from the concrete or representative source instance
- inspect source schema or sample rows without placing calls
- confirm the phone, recipient, date, source-level outreach basis or consent field, dedupe, and goal input fields exist
- confirm the sample can support the default outbound goal contract
- confirm a source writeback target and fields exist, configure a source-adjacent result artifact, or configure a new local result CSV target or approved runtime output path
- confirm the MCP provider route and compatible plan, run, or status tools are available

Creation-time source onboarding and preflight must not mutate source records, source permissions, source integrations, scheduler state, source writeback targets, source-adjacent result artifacts, result files, or phone-call provider state. Explicit user-approved authentication setup may create or refresh local host credentials, OAuth tokens, connector sessions, or MCP authorization state so the source can be accessed later. Do not perform a real writeback, create or write a source-adjacent result artifact, write a result CSV, or place a real call during onboarding or preflight. If creation-time source onboarding cannot run, record the blocker and require the generated skill to stop before real calls when the missing capability is still unavailable for the concrete runtime request.

Runtime gating is mandatory before real calls. The generated skill must verify source access, required fields, consent or outreach basis, dedupe reliability, source writeback, source-adjacent result artifact output, or local result CSV output, and provider route/tool readiness for the concrete request. Session-table output is a last-resort non-persistent fallback only when durable output validation is blocked and the run is attended; do not use it as the primary result path for unattended scheduled automation. Approved side effects can happen only after the runtime gate passes, in the selected execution flow.

Treat source writeback narrowly: it updates the bound source instance or canonical source record store. A same-system side file, new sheet, new tab, result table, or export created beside the source is `source-adjacent-result-artifact`, not source writeback. For fully bound workflows, capture the fixed artifact ID/path or the exact creation policy, container, schema, and append or upsert behavior.

## Authenticated Source Onboarding

Use this order for every authenticated or connector-backed source family, including Google Forms, TikTok Ads, Notion, Airtable, and future sources that require OAuth, MCP auth, API keys, managed connector auth, or workspace permissions.

For any authenticated or connector-backed source family, do not ask the user to manually provide the full field mapping before source access has been checked and a representative sample has been fetched.

Proactively inspect available host routes before asking the user for access details. A host route can be a local helper script, installed source adapter, configured connector, exposed MCP tool, exposed MCP resource, API adapter, or managed connector. Only ask the user for a Form ID, account scope, Apps Script endpoint, MCP tool name, or managed connector route when no usable route can be discovered or authorization requires user completion.

Use the actual MCP-capable host or agent runtime selected by the user; do not assume Codex. Host-specific commands are adapter examples, not universal instructions. For Claude, Antigravity, Cursor, or another MCP-capable host, use that host's documented MCP server or connector setup and OAuth flow. Record the host name, setup method, route URL, authorization state, active-session tool visibility, and any refresh or restart step required by that host.

Collect only the minimum connection details needed to authorize or locate the source. After route discovery, ask only for details still needed to complete authorization or locate the representative source instance.

When a safe source authorization or auth-readiness action is available, start it before asking the user for another confirmation. Safe actions include local OAuth status or repair helpers, host MCP login commands, managed connector authorization prompts, and source-native read-only inventory probes. Do not ask the user to say `start auth`, choose a discovered route, or refresh a session before attempting the available non-mutating auth path. Pause only when the auth flow requires browser completion, the auth command fails or reports unsupported auth, a concrete locator or account scope is still required after inventory, or the only remaining path requires the user to provide credentials, tokens, or connector configuration.

1. Record source family and binding level.
2. Discover available host access routes before prompting for route choice.
3. Record the discovered or user-supplied source locator such as form ID or account scope, and access route such as OAuth, Apps Script fallback, MCP tool, MCP resource, API adapter, or managed connector.
4. Verify authentication, connector availability, MCP resource access, API access, or workspace permission.
5. Fetch a small representative sample through a read-only path.
6. Infer the phone field, recipient field, dedupe key, outreach basis or consent field, goal inputs, and durable result-output capability from source metadata and the sample.
7. Show a redacted sample summary and proposed field mapping for user confirmation.
8. Ask the user to fill only fields that cannot be inferred from the sample.
9. Confirm the verified writeback or durable result-output target only after the sample and source metadata identify supported paths.

When the user names only an authenticated source family such as `google-form`, `tiktok-ads`, `notion`, or `airtable`, treat that as enough to recommend a likely workflow and provisional call goal, then enter source access onboarding. First inspect available host routes and run any safe auth-readiness or discovery check. The next prompt should ask only for the minimum locator or user-completed authorization step that remains necessary to fetch a representative sample. Do not ask for detailed field mapping, final goal-field selection, or result-output mapping before the access check and sample fetch have been attempted.

Do not present a blank manual mapping form for phone, recipient, consent, dedupe, goal inputs, or result-output fields before authentication and sample fetch have been attempted. If access or sample fetch is blocked before the minimum source contract can be confirmed, record the blocker and stop before generating the skill.

## Google Form

Use `google-form` when records come from Google Forms responses.

Capture:

- form ID, discovery rule, or approved runtime form ID parameter
- local OAuth path or Apps Script fallback path
- Google authentication or Apps Script access check result
- sampled form ID or representative runtime form ID
- sample response fetch result and redacted sample summary
- default goal fields derived from the sampled form questions
- submitted-time window behavior
- linked response spreadsheet availability
- phone-number question
- recipient name question
- dedupe key, normally response ID
- fields to include in the outbound goal
- form-level phone follow-up basis or per-response consent field
- source writeback columns, source-adjacent artifact fields, or local result CSV fields for status, result summary, call run ID, and processed timestamp

Generated Google Form skills must require a clear basis for phone follow-up. The basis can come from the form description, ad copy, terms, or an explicit per-response consent field.

If the form has no linked response spreadsheet and the user wants source writeback, require an Apps Script fallback or ask the user to link a response spreadsheet before real source writeback. If the user wants a result file in the same Google Drive context without mutating the response store, configure `source-adjacent-result-artifact` with a fixed spreadsheet, tab, folder, schema, and append or upsert rule. If source writeback and source-adjacent output are unavailable or not requested, configure a new local result CSV instead of making session-table output the normal path.

Do not ask for Google Form field mapping before Google access has been verified and a representative response sample has been fetched.

For `fully-bound`, creation must verify access to the concrete form and fetch a small response sample before generating a real-call skill. For `parameterized-bound`, creation must verify Google access and sample one representative form so the generated skill can later accept a runtime form ID only when the runtime gate confirms the form matches the sampled schema. Use the existing `google-form-callback` local OAuth and export scripts as the preferred reference pattern when available.

When `google-form-callback` helper scripts are available, do not ask the user whether to use local OAuth before checking them. Run or direct the host to run `google-auth.mjs status` first. If authenticated, run `google-local-api-client.mjs --action list-forms` before asking for a Form ID, then fetch metadata or a small response sample from the selected or representative form. If auth is missing, directly run or request `preflight-auth.mjs --repair-google`, wait for the user to complete browser authorization when required, re-check `google-auth.mjs status`, and then list forms. Only ask for an Apps Script fallback endpoint, manual Form ID, or account scope when local OAuth helpers are unavailable, auth cannot be completed, or listing forms is not permitted.

For `fully-bound`, capture the concrete form or response spreadsheet and source writeback columns, capture a source-adjacent result artifact target, or capture the concrete local result CSV target. For `parameterized-bound`, capture the required question names and result field schema, then allow the runtime request to provide the form ID only when the runtime gate verifies that the form matches the schema.

## TikTok Ads

Use `tiktok-ads` when records come from TikTok Ads through exposed MCP tools, resources, or approved connectors.

Default access route:

```text
source family: `tiktok-ads`
access method: MCP
source route: https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp
```

Capture:

- MCP server or connector name
- access method and route used for onboarding
- exact tool or resource names available in the host
- account, advertiser, campaign, lead, audience, or record scope, or the approved runtime parameter that supplies that scope
- date-window fields and timezone semantics
- record ID field
- phone-number field
- recipient label field
- dedupe key
- goal input fields
- outreach basis or consent evidence
- approved writeback tool or connector action, approved source-adjacent artifact action, or a new local result CSV output policy when source-system durable output is unavailable

Generated TikTok Ads skills must not assume every record is callable. They must validate outreach basis and E.164 phone numbers before creating call candidates.

Do not ask for TikTok Ads field mapping before the exact MCP tool or resource access has been verified and a representative record sample has been fetched.

For `tiktok-ads`, inspect exposed MCP tools and resources first. If the current host exposes TikTok Ads MCP tools or resources, verify their auth readiness and fetch a small representative record sample before asking the user for account, campaign, schema, or field mapping details. Only ask the user for the exact MCP tool, resource, account, campaign, or managed connector route when no usable TikTok Ads route can be discovered or the discovered route requires a concrete scope.

When the selected host is Codex and no TikTok Ads MCP server is configured, ask the user for explicit permission before adding the default source route. Present the route and explain that `codex mcp add` changes the host MCP configuration; run the setup commands only after the user approves:

```bash
codex mcp add tiktok-ads --url https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp
codex mcp get tiktok-ads
codex mcp list
```

After adding an approved route or discovering an existing server, inspect its configured auth state and the MCP tools or resources exposed to the current agent session. Treat Codex `Auth: Unsupported` as absence of Codex-managed OAuth, not as proof that source access is unavailable. If `Auth` is `OAuth` or another login-capable mode, run or request the selected host's login flow and then re-check with that host's status command or connector state. In Codex, this usually means `codex mcp list`, `codex mcp get tiktok-ads`, and, when tools are not yet exposed, `codex mcp login tiktok-ads`; in other MCP hosts, use the host's equivalent source MCP login, connector refresh, or session restart before asking the user for a different route. If TikTok Ads MCP tools or resources are exposed, run the source-native read-only auth or inventory probe before declaring a blocker. Prefer `auth_advertiser_get` or an equivalent account-inventory tool first; if it returns accessible advertisers, use the returned advertiser scope or ask only for the minimum account, campaign, form, page, or lead scope still needed to fetch a representative sample. If no TikTok Ads tools or resources are exposed after the available host auth path has been attempted, or the source-native probe fails because authorization is missing, record a source onboarding blocker and ask only for the missing authentication route such as a supported bearer-token environment variable, managed connector, host-specific login path, or another approved TikTok Ads connector.

During creation-time onboarding, fetch a small sample through the exact MCP tool or resource names exposed by the host. Record the tool names, sampled scope, returned fields, and redaction rule in the generated skill.

Do not invent TikTok Ads MCP tools or schemas. If the host does not expose a writeback-capable tool but does expose a same-account or same-workspace artifact action, configure `source-adjacent-result-artifact` and record the artifact container, schema, and append or upsert behavior. If neither source writeback nor source-adjacent output is available, configure a new local result CSV output path. Use session-table output only as a last-resort non-persistent fallback when durable output cannot be verified.

For `fully-bound`, capture the concrete account, advertiser, campaign, or lead scope and source writeback tool, source-adjacent artifact target, or local result CSV target. For `parameterized-bound`, capture the exact MCP tools, required returned fields, and result field schema, then allow runtime account or campaign identifiers only when the runtime gate confirms the returned schema.

## Notion

Use `notion` when records come from a Notion database, data source, or database-like table exposed through hosted Notion MCP, another approved Notion MCP route, the Notion API, an integration token, or a managed connector route.

Recommended Notion access route: hosted Notion MCP. It uses OAuth through the user's Notion workspace and avoids asking new users to create or paste integration tokens.

Default access route:

```text
source family: `notion`
access method: hosted Notion MCP at https://mcp.notion.com/mcp, another approved Notion MCP route, Notion API, integration token, or managed connector
source locator: Notion database URL or ID, Notion data source ID, or managed connector resource locator
```

Use the selected MCP host's server or connector setup for hosted Notion MCP before asking for a Notion integration token. Complete that host's OAuth flow, then refresh or restart tools as required by the host so active-session Notion tools are visible.

Codex adapter example for hosted Notion MCP:

```bash
codex mcp add notion --url https://mcp.notion.com/mcp
codex mcp login notion
codex mcp list
```

For Codex, first check whether a `notion` MCP server already points to `https://mcp.notion.com/mcp`. Skip `add` when the hosted route is already configured. If no hosted route is configured, ask the user for explicit permission before adding the hosted Notion MCP route and explain that `codex mcp add` changes host MCP configuration. Run `login` when OAuth is not ready. Do not ask the user to create a Notion integration token before checking or offering hosted Notion MCP. Use integration tokens only when hosted Notion MCP is unavailable, unsupported by the selected host, or insufficient for the workspace permission model.

Treat a Notion data source as the canonical record source. A Notion database can contain one or more data sources, so database IDs and database URLs are accepted locators but must be resolved to a concrete data source before schema sampling, candidate validation, or real-call execution.

Capture:

- Notion route type, such as API, MCP, integration token, or managed connector
- access method and route used for onboarding
- authentication, token, connector, workspace permission, or MCP resource access check result
- supplied source locator: database URL, database ID, data source ID, or managed connector resource locator
- canonical data source ID after locator resolution
- database ID and data source name when a database locator is supplied
- resolution result when a database contains zero, one, or multiple data sources
- sampled data source ID or representative runtime data source ID
- sample fetch result and redacted sample summary from queried pages
- property names and property types returned by the data source schema
- created-time, last-edited-time, date property, status property, or other date-window filtering semantics
- page ID or other stable page reference
- E.164 phone-number property
- recipient label property
- dedupe key, normally page ID unless a stable business identifier property is configured
- goal input properties
- source-level outreach basis or consent evidence, such as an approved database purpose, workspace policy, or per-page consent/status property
- source writeback page properties, source-adjacent result artifact target, or local result CSV output policy for status, result summary, call run ID, and processed timestamp

Generated Notion skills must not assume every page in a database or data source is callable. They must validate outreach basis or consent, E.164 phone numbers, and the configured candidate filter before creating call candidates.

Do not ask for Notion field mapping before Notion access has been verified, the locator has been resolved to a canonical data source, the data source schema has been retrieved, and a representative page sample has been fetched.

For Notion database locators, resolve the locator before sampling:

1. If a data source ID is supplied, retrieve that data source directly and use it as the canonical source instance.
2. If a database URL or database ID is supplied, retrieve the database and inspect its data sources.
3. If the database contains exactly one data source, use that data source as the canonical source instance.
4. If the database contains multiple data sources, ask the user to choose the data source by name or ID before sampling.
5. If the database contains no accessible data sources, record a source onboarding blocker and stop before generating a real-call skill.

During creation-time onboarding, retrieve the canonical data source schema and query a small sample of pages through the exact Notion MCP tool, API endpoint, resource, or connector action exposed by the host. Record the tool or route names, locator resolution, sampled data source ID, returned property names and types, and redaction rule in the generated skill.

Public or shared Notion page routes may be used only for read-only discovery and sampling when they are the approved source access path. Do not treat public page metadata, anonymous browser state, `read_and_write` flags returned by shared-page data, or internal `saveTransactions` calls as authenticated production writeback. A generated Notion skill that uses only a public shared-page route must keep Notion source writeback blocked and configure a source-adjacent result artifact or local result CSV as the durable output target.

Treat Notion source writeback narrowly: updating call results on the source record means updating page properties on the sampled or runtime-matched pages. Do not describe updating a Notion data source schema as source writeback. If result fields do not already exist and creation of new properties is required, treat that as a schema-changing side effect that must be explicitly configured and approved before runtime. If the host cannot verify safe page-property writeback, configure a source-adjacent result artifact in the same Notion workspace or a new local result CSV. Use session-table output only as a last-resort non-persistent fallback when durable output cannot be verified.

Do not mark Notion source writeback ready until hosted Notion MCP or another authenticated Notion route exposes page update capability for the target pages. The writeback action must update the existing page property, such as a `properties.result.rich_text` payload for the target page ID, and must keep full phone numbers, provider secrets, callback URLs, cookies, and confirmation tokens out of result text. Before real runs rely on Notion writeback, run an explicitly approved writeback preflight against a disposable or approved test row: write a harmless canary value, read it back, confirm an exact match, then restore or overwrite the test value.

For `fully-bound`, capture the concrete database or data source locator, canonical data source ID, field mapping, candidate filter, and fixed page-property writeback target, source-adjacent result artifact, or local result CSV target. For `parameterized-bound`, capture the required data source schema and result field schema, then allow runtime database or data source identifiers only when the runtime gate resolves them to a data source and confirms the schema and result-output contract.

## Airtable

Use `airtable` when records come from an Airtable base table or view exposed through hosted Airtable MCP, another approved Airtable MCP route, Airtable Web API, OAuth, personal access token, or a managed connector route.

Recommended Airtable access route: hosted Airtable MCP. It uses OAuth through the user's Airtable account and avoids asking new users to create or paste personal access tokens.

Official Airtable setup reference: <https://support.airtable.com/v1/docs/using-the-airtable-mcp-server>.

Default access route:

```text
source family: `airtable`
access method: hosted Airtable MCP at https://mcp.airtable.com/mcp, another approved Airtable MCP route, Airtable Web API OAuth, personal access token, or managed connector
source locator: Airtable base ID, table ID or name, optional view ID or name, and optional filter formula
```

Use the selected MCP host's server, connector, or plugin setup for hosted Airtable MCP before asking for an Airtable personal access token. Complete that host's OAuth flow, then refresh or restart tools as required by the host so active-session Airtable tools are visible.

Codex adapter example for hosted Airtable MCP:

```bash
codex plugin add airtable@openai-curated
codex mcp add airtable --url https://mcp.airtable.com/mcp
codex mcp login airtable
codex mcp list
```

The official Airtable Codex plugin is the simplest Codex path when plugin installation is allowed; it bundles Airtable-specific guidance and points the host at Airtable's hosted MCP. The direct `codex mcp add` command remains the explicit Codex route setup path when a plugin is not desired or the creator needs auditable route evidence. For Codex, first check whether the plugin is already installed and enabled and whether an `airtable` MCP server already points to `https://mcp.airtable.com/mcp`. Skip `plugin add` when the plugin is already installed and enabled. Skip `mcp add` when the hosted route is already configured. If neither path is configured, ask the user for explicit permission before installing the Airtable plugin or adding the hosted Airtable MCP route and explain that `codex plugin add` and `codex mcp add` change host configuration. Run `login` when OAuth is not ready. Do not ask the user to create an Airtable personal access token before checking or offering hosted Airtable MCP. Use personal access tokens only when hosted Airtable MCP is unavailable, unsupported by the selected host, or insufficient for the base permission model.

Prefer stable IDs when available. Airtable table names and table IDs can both address records, but generated skills should record table IDs and field IDs when schema access is available so later table or field renames do not break runtime requests.

Capture:

- Airtable route type, such as hosted MCP, another MCP route, Web API OAuth, personal access token, or managed connector
- access method and route used for onboarding
- authentication, token, connector, base permission, or MCP resource access check result
- token scopes and resource access used for onboarding, including `data.records:read` for record reads, `schema.bases:read` for schema metadata when available, and `data.records:write` only when source writeback is configured
- base ID and base name when discoverable
- table ID or table name, and table ID resolution result when a table name is supplied
- optional view ID or view name used as the candidate subset
- optional `filterByFormula`, sort, field selection, `returnFieldsByFieldId`, and date-window filtering semantics
- sampled table ID or representative runtime table ID
- schema fetch result from the base metadata API when available, including field names, field IDs, field types, primary field, and views
- sample fetch result and redacted sample summary from `list records`
- record ID and created time
- E.164 phone-number field
- recipient label field, normally the primary field or a configured name field
- dedupe key, normally Airtable record ID unless a stable business identifier field is configured
- goal input fields
- source-level outreach basis or consent evidence, such as an approved base or table purpose, view filter, formula filter, status field, or per-record consent field
- source writeback fields, source-adjacent result artifact target, or local result CSV output policy for status, result summary, call run ID, and processed timestamp

Generated Airtable skills must not assume every record in a base, table, or view is callable. They must validate outreach basis or consent, E.164 phone numbers, and the configured table, view, formula, or status filter before creating call candidates.

Do not ask for Airtable field mapping before Airtable access has been verified, the base/table/view locator has been resolved, schema has been fetched when the route supports it, and a representative record sample has been fetched.

For Airtable locators, resolve and sample in this order:

1. Verify the route can authenticate with Airtable through hosted Airtable MCP, another OAuth route, personal access token fallback, or a managed connector.
2. If the route can list bases, use it to verify the base ID, base name, and permission level before asking for a base ID.
3. Retrieve base schema when `schema.bases:read` or an equivalent connector capability is available.
4. Resolve table names to table IDs from schema metadata when possible; prefer table IDs in the generated skill contract.
5. Resolve the configured view ID or name when a view is used as the candidate subset.
6. List a small record sample from the table or view through a read-only path. Use a small `pageSize` or `maxRecords`; handle pagination by recording that `offset` is required for later full runs.
7. If schema access is unavailable, infer only from the sampled records and record that missing schema metadata is a source onboarding blocker unless the sample and user confirmation are enough to satisfy the minimum `parameterized-bound` contract.

During creation-time onboarding, fetch a small sample through the exact Airtable API, MCP tool, resource, or connector action exposed by the host. Record the tool or route names, base ID, table ID or name, view ID or name, returned fields, field-key mode, pagination rule, and redaction rule in the generated skill.

Treat Airtable source writeback narrowly: updating call results on the source record means non-destructive updates to configured fields on existing records, such as an Airtable API `PATCH` or an equivalent hosted MCP record-update action. Do not use destructive `PUT` updates for result output. Do not enable `typecast` unless the generated skill explicitly documents why conversion is safe for the configured result fields. If result fields do not already exist and creating new fields is required, treat that as a schema-changing side effect that needs explicit configuration and approval before runtime. If the host cannot verify safe record-field writeback, configure a source-adjacent result artifact in the same Airtable base or workspace when available, or a new local result CSV. Use session-table output only as a last-resort non-persistent fallback when durable output cannot be verified.

Do not mark Airtable source writeback ready until hosted Airtable MCP or another authenticated Airtable route exposes non-destructive record update capability for the target table. The writeback action must update only the configured result fields on existing record IDs, and must keep full phone numbers, provider secrets, callback URLs, cookies, and confirmation tokens out of result text. Before real runs rely on Airtable writeback, run an explicitly approved writeback preflight against a disposable or approved test record: write a harmless canary value, read it back, confirm an exact match, then restore or overwrite the test value.

For `fully-bound`, capture the concrete base ID, table ID, optional view ID, field mapping, candidate filter, and fixed record-field writeback target, source-adjacent result artifact, or local result CSV target. For `parameterized-bound`, capture the required table schema and result field schema, then allow runtime Airtable base, table, or view locators only when the runtime gate resolves them and confirms the schema, candidate filter, dedupe, and result-output contract.

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
- source-level outreach basis, or an optional consent column when the CSV does not guarantee authorized records
- output CSV path when local result output is configured

Generated CSV skills should use deterministic scripts when parsing, validating, deduplicating, or writing output would otherwise be fragile.

During creation-time onboarding, read a small sample from the concrete or representative CSV path. Confirm headers, delimiter, date parsing, source-level outreach basis or consent column, dedupe, goal input columns, and output path behavior before generating a bound real-call skill.

For local CSV workflows, capture supported result-output target modes at creation time and choose the concrete target mode during the runtime dry-run or approval step. Record the supported modes as:

- `source-csv-in-place`: update the original CSV only when the runtime request explicitly asks to update the source CSV and the execution approval covers that mutation. Before real calls, verify the file is writable, define the exact appended or updated result columns, preserve existing rows and columns, and create or recommend a backup or atomic write plan.
- `result-csv-file`: write a separate new result CSV. This is the safer default when the runtime request asks for a results file or does not explicitly request original CSV mutation.

Do not describe a separate result CSV as "writeback to the original CSV." If the runtime request asks to update the original CSV, select `source-csv-in-place` during dry-run or approval and do not create a separate result CSV while calling it source writeback. If the request does not specify original CSV mutation, use `result-csv-file` as the durable fallback. Before real calls, verify that the output path is writable, define exact result columns, avoid full phone numbers in output, and preserve source rows and columns.

Do not require a per-row consent column when the user confirms the CSV source only contains records collected from people who requested or agreed to phone follow-up. Record that as the source-level outreach basis in the generated skill and runtime gate. At runtime, verify the request uses the same approved source class or schema; if it does not, ask for a new source-level basis or consent field before real calls.

If source CSV in-place update is not configured, use a new local result CSV as the default durable output. Output a session table only when durable output validation is blocked; treat it as non-persistent and do not proactively offer it as a normal option.

For `fully-bound`, capture the concrete CSV path and output CSV path. For `parameterized-bound`, capture the required column schema and allow runtime CSV and output paths.

## Other Sources

Use `other` when the source is not one of the built-in families.

Ask one question at a time until the source contract is complete:

- How does the agent access records?
- What exact fields are returned?
- Which field is the E.164 phone number?
- Which field proves phone follow-up is authorized?
- Which field is stable enough for dedupe?
- How should date-window filtering work?
- Can results be written back to the source?
- If source writeback is possible, what exact action and fields should be used?
- If source writeback is unavailable or should not mutate the source records, should results go to a source-adjacent artifact in the same system?
- If source-system durable output is unavailable, what local result CSV path or approved runtime output path should be used?

If the user cannot provide enough detail for safe access, stop before generation and state the missing integration blocker.

For custom sources, do not generate a skill until the source can be authenticated or accessed, sampled safely, and mapped to the required phone-call fields.
