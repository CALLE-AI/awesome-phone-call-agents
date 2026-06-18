# Data Sources

Use this reference when selecting and documenting the generated business skill's source records.

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
- writeback capability
- writeback policy and field mapping
- creation-time preflight result or documented preflight blocker
- runtime gate requirements before real calls

Do not guess missing identifiers, credentials, field names, date filters, or country codes.

## Binding Levels

Choose whether the workflow stays at the minimum binding level or upgrades to a fixed source instance before writing the generated skill:

| Binding level | What must be fixed at creation time | What may be supplied at runtime |
| --- | --- | --- |
| `fully-bound` | Concrete source instance, field names, source-level outreach basis or consent rule, dedupe key, writeback target, and writeback fields. | Date window, subset filters, and other narrow processing controls. |
| `parameterized-bound` | Source family, access method, required schema, source-level outreach basis or consent rule, dedupe key, writeback policy, and writeback field schema. | Approved instance parameters such as form ID, CSV path, campaign ID, date window, writeback target, or output path. |

Default to the minimum `parameterized-bound` contract. Use `fully-bound` for stable production or scheduled workflows that should fix a concrete source and writeback target. If the workflow cannot support the minimum contract, continue onboarding or stop before generating the skill.

## Preflight and Runtime Gate

Creation-time source onboarding is required to reach the minimum `parameterized-bound` contract, and `fully-bound` adds concrete instance verification. Run non-mutating checks when tools and permissions are available:

- verify source authentication, connector availability, or local file access
- fetch a small representative sample from the concrete or representative source instance
- inspect source schema or sample rows without placing calls
- confirm the phone, recipient, date, source-level outreach basis or consent field, dedupe, and goal input fields exist
- confirm the sample can support the default outbound goal contract
- confirm writeback target and fields exist, or confirm that session-table fallback will be used
- confirm the MCP provider route and compatible plan, run, or status tools are available

Creation-time source onboarding and preflight must not mutate source records, source permissions, source integrations, scheduler state, writeback targets, or phone-call provider state. Explicit user-approved authentication setup may create or refresh local host credentials, OAuth tokens, connector sessions, or MCP authorization state so the source can be accessed later. Do not perform a real writeback or place a real call during onboarding or preflight. If creation-time source onboarding cannot run, record the blocker and require the generated skill to stop before real calls when the missing capability is still unavailable for the concrete runtime request.

Runtime gating is mandatory before real calls. The generated skill must verify source access, required fields, consent or outreach basis, dedupe reliability, writeback behavior or session-table fallback, and provider route/tool readiness for the concrete request. Approved side effects can happen only after the runtime gate passes, in the selected execution flow.

## Authenticated Source Onboarding

Use this order for every authenticated or connector-backed source family, including Google Forms, TikTok Ads, and future sources that require OAuth, MCP auth, API keys, managed connector auth, or workspace permissions.

For any authenticated or connector-backed source family, do not ask the user to manually provide the full field mapping before source access has been checked and a representative sample has been fetched.

Proactively inspect available host routes before asking the user for access details. A host route can be a local helper script, installed source adapter, configured connector, exposed MCP tool, exposed MCP resource, API adapter, or managed connector. Only ask the user for a Form ID, account scope, Apps Script endpoint, MCP tool name, or managed connector route when no usable route can be discovered or authorization requires user completion.

Collect only the minimum connection details needed to authorize or locate the source. After route discovery, ask only for details still needed to complete authorization or locate the representative source instance.

When a safe source authorization or auth-readiness action is available, start it before asking the user for another confirmation. Safe actions include local OAuth status or repair helpers, host MCP login commands, managed connector authorization prompts, and source-native read-only inventory probes. Do not ask the user to say `start auth`, choose a discovered route, or refresh a session before attempting the available non-mutating auth path. Pause only when the auth flow requires browser completion, the auth command fails or reports unsupported auth, a concrete locator or account scope is still required after inventory, or the only remaining path requires the user to provide credentials, tokens, or connector configuration.

1. Record source family and binding level.
2. Discover available host access routes before prompting for route choice.
3. Record the discovered or user-supplied source locator such as form ID or account scope, and access route such as OAuth, Apps Script fallback, MCP tool, MCP resource, API adapter, or managed connector.
4. Verify authentication, connector availability, MCP resource access, API access, or workspace permission.
5. Fetch a small representative sample through a read-only path.
6. Infer the phone field, recipient field, dedupe key, outreach basis or consent field, goal inputs, and writeback capability from source metadata and the sample.
7. Show a redacted sample summary and proposed field mapping for user confirmation.
8. Ask the user to fill only fields that cannot be inferred from the sample.

When the user names only an authenticated source family such as `google-form` or `tiktok-ads`, treat that as enough to enter source access onboarding. First inspect available host routes and run any safe auth-readiness or discovery check. The next prompt should ask only for the minimum locator or user-completed authorization step that remains necessary to fetch a representative sample, while confirming the recommended binding level if needed. Do not ask for the default outbound goal, writeback mapping, or full field mapping before the access check and sample fetch have been attempted.

Do not present a blank manual mapping form for phone, recipient, consent, dedupe, goal inputs, or writeback fields before authentication and sample fetch have been attempted. If access or sample fetch is blocked before the minimum source contract can be confirmed, record the blocker and stop before generating the skill.

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
- writeback columns for status, result summary, call run ID, and processed timestamp

Generated Google Form skills must require a clear basis for phone follow-up. The basis can come from the form description, ad copy, terms, or an explicit per-response consent field.

If the form has no linked response spreadsheet and the user wants writeback, require an Apps Script fallback or ask the user to link a response spreadsheet before real writeback.

Do not ask for Google Form field mapping before Google access has been verified and a representative response sample has been fetched.

For `fully-bound`, creation must verify access to the concrete form and fetch a small response sample before generating a real-call skill. For `parameterized-bound`, creation must verify Google access and sample one representative form so the generated skill can later accept a runtime form ID only when the runtime gate confirms the form matches the sampled schema. Use the existing `google-form-callback` local OAuth and export scripts as the preferred reference pattern when available.

When `google-form-callback` helper scripts are available, do not ask the user whether to use local OAuth before checking them. Run or direct the host to run `google-auth.mjs status` first. If authenticated, run `google-local-api-client.mjs --action list-forms` before asking for a Form ID, then fetch metadata or a small response sample from the selected or representative form. If auth is missing, directly run or request `preflight-auth.mjs --repair-google`, wait for the user to complete browser authorization when required, re-check `google-auth.mjs status`, and then list forms. Only ask for an Apps Script fallback endpoint, manual Form ID, or account scope when local OAuth helpers are unavailable, auth cannot be completed, or listing forms is not permitted.

For `fully-bound`, capture the concrete form or response spreadsheet and writeback columns. For `parameterized-bound`, capture the required question names and allow the runtime request to provide the form ID only when the runtime gate verifies that the form matches the schema.

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
- approved writeback tool or connector action, or the decision to use session-table output

Generated TikTok Ads skills must not assume every record is callable. They must validate outreach basis and E.164 phone numbers before creating call candidates.

Do not ask for TikTok Ads field mapping before the exact MCP tool or resource access has been verified and a representative record sample has been fetched.

For `tiktok-ads`, inspect exposed MCP tools and resources first. If the current host exposes TikTok Ads MCP tools or resources, verify their auth readiness and fetch a small representative record sample before asking the user for account, campaign, schema, or field mapping details. Only ask the user for the exact MCP tool, resource, account, campaign, or managed connector route when no usable TikTok Ads route can be discovered or the discovered route requires a concrete scope.

When the selected host is Codex and no TikTok Ads MCP server is configured, add the default source route before asking the user whether to use it:

```bash
codex mcp add tiktok-ads --url https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer-tmp
codex mcp get tiktok-ads
codex mcp list
```

After adding or discovering the server, inspect its configured auth state and the MCP tools or resources exposed to the current agent session. Treat Codex `Auth: Unsupported` as absence of Codex-managed OAuth, not as proof that source access is unavailable. If `Auth` is `OAuth` or another login-capable mode, run or request the host login flow and then re-check with `codex mcp list` or `codex mcp get tiktok-ads`. In Codex, when the route is configured but TikTok Ads tools are not yet exposed, run `codex mcp login tiktok-ads` or the host's equivalent source MCP login before asking the user for a different route or session refresh. If TikTok Ads MCP tools or resources are exposed, run the source-native read-only auth or inventory probe before declaring a blocker. Prefer `auth_advertiser_get` or an equivalent account-inventory tool first; if it returns accessible advertisers, use the returned advertiser scope or ask only for the minimum account, campaign, form, page, or lead scope still needed to fetch a representative sample. If no TikTok Ads tools or resources are exposed after the available host auth path has been attempted, or the source-native probe fails because authorization is missing, record a source onboarding blocker and ask only for the missing authentication route such as a supported bearer-token environment variable, managed connector, host-specific login path, or another approved TikTok Ads connector.

During creation-time onboarding, fetch a small sample through the exact MCP tool or resource names exposed by the host. Record the tool names, sampled scope, returned fields, and redaction rule in the generated skill.

Do not invent TikTok Ads MCP tools or schemas. If the host does not expose a writeback-capable tool, use session-table output or local CSV output.

For `fully-bound`, capture the concrete account, advertiser, campaign, or lead scope and writeback tool. For `parameterized-bound`, capture the exact MCP tools and required returned fields, then allow runtime account or campaign identifiers only when the runtime gate confirms the returned schema.

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
- output CSV path when local writeback is configured

Generated CSV skills should use deterministic scripts when parsing, validating, deduplicating, or writing output would otherwise be fragile.

During creation-time onboarding, read a small sample from the concrete or representative CSV path. Confirm headers, delimiter, date parsing, source-level outreach basis or consent column, dedupe, goal input columns, and output path behavior before generating a bound real-call skill.

For local CSV workflows, capture supported writeback target modes at creation time and choose the concrete target mode during the runtime dry-run or approval step. Record the supported modes as:

- `source-csv-in-place`: update the original CSV only when the runtime request explicitly asks to update the source CSV and the execution approval covers that mutation. Before real calls, verify the file is writable, define the exact appended or updated result columns, preserve existing rows and columns, and create or recommend a backup or atomic write plan.
- `result-csv-file`: write a separate result CSV. This is the safer default when the runtime request asks for a results file or does not explicitly request original CSV mutation.

Do not describe a separate result CSV as "writeback to the original CSV." If the runtime request asks to update the original CSV, select `source-csv-in-place` during dry-run or approval and do not create a separate result CSV while calling it source writeback. If the request does not specify original CSV mutation, use `result-csv-file` or stop for clarification before real calls.

Do not require a per-row consent column when the user confirms the CSV source only contains records collected from people who requested or agreed to phone follow-up. Record that as the source-level outreach basis in the generated skill and runtime gate. At runtime, verify the request uses the same approved source class or schema; if it does not, ask for a new source-level basis or consent field before real calls.

If writeback is not configured, output the session table described in the generated skill.

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
- Can results be written back?
- If writeback is possible, what exact action and fields should be used?

If the user cannot provide enough detail for safe access, stop before generation and state the missing integration blocker.

For custom sources, do not generate a skill until the source can be authenticated or accessed, sampled safely, and mapped to the required phone-call fields.
