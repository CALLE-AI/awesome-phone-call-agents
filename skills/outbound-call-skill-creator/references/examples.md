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
Source family is `google-form`. I need the minimum Google access details first so I can authorize or verify access and fetch a redacted representative sample before we define fields or the default goal.

Recommended binding level is `parameterized-bound`.

I will first check whether this host already exposes Google Forms access. If local OAuth is available, I will run its auth check and list accessible forms before asking you for a Form ID. If auth requires a browser step, I will pause for you to complete it, re-check auth, then list forms.

After access is verified and a sample is fetched, I will propose the phone, recipient, dedupe, outreach-basis, goal-input, and writeback fields for confirmation.
```

If no Google route can be discovered, ask for only the missing route detail:

```text
I could not find a usable local OAuth helper or Google Forms connector in this host. Please provide one of:
- a representative Google Form ID that I can check after authorization is available
- an account or Drive scope that I can use after authorization is available
- an Apps Script fallback endpoint
```

If the user replies only `google-form`, do not ask for the default outbound goal yet. The same pattern applies when the user replies only `tiktok-ads`: inspect available TikTok Ads MCP tools or resources first, verify or request authentication, then ask for the exact MCP tool, resource, account, campaign, or managed connector route only if no usable route can be discovered or a concrete scope is still required. If a safe auth action is available, I will start it before asking for another confirmation; I will not ask the user to say `start auth`, choose a discovered route, or refresh the session before attempting the available non-mutating auth path. If this host has no TikTok Ads MCP server configured, I will add the default route first and then inspect it with `codex mcp get tiktok-ads` and `codex mcp list`. If Codex reports `Auth: Unsupported`, I will treat that only as missing Codex-managed OAuth. When the route is configured but tools are not exposed, I will run `codex mcp login tiktok-ads` or the host's equivalent source MCP login before asking for a different route or session refresh. When TikTok Ads tools or resources are exposed, I will run a source-native read-only auth or inventory probe such as `auth_advertiser_get` before declaring a blocker; only if the available auth path and probe fail or no tools are exposed will I ask for a supported token, managed connector, host-specific login path, or another approved route.

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
- writeback: approved TikTok Ads MCP writeback tool, approved connector action, or session table fallback
- execution: `dry-run-then-batch-approval` or `approved-direct-execution` only after concrete runtime scope passes the runtime gate; finalize provider results with full-history reconciliation, record each stable terminal result, then write back or output one final session table

Generated future use:

```text
Use tiktok-lead-followup to process yesterday's callable leads.
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
- writeback: local CSV with supported target modes `result-csv-file` and `source-csv-in-place`; resolve the concrete target mode during runtime dry-run or approval, using `source-csv-in-place` only when the runtime request explicitly asks to update the original CSV and target result columns are defined
- sensitive boundary: logistics only, no medical advice
- execution: after approval, call eligible rows serially, continue past candidate-level failures when safe, run provider result finalization before CSV writeback, and summarize all results after the batch ends

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

Ask for source access, returned fields, phone field, outreach basis, dedupe key, date filtering, and writeback capability. If any critical value is unknown, generate a dry-run-only skill or stop before generation.

If source onboarding cannot authenticate or sample the source safely, generate only a dry-run-only `unbound-generic` skill with an onboarding blocker.

## Binding Mode Selection

User request:

```text
Create a skill for quote request callbacks. I want to reuse it across multiple forms with the same questions.
```

Recommended creator response:

- recommend `parameterized-bound`
- fix the required Google Form questions, source-level phone follow-up basis or consent basis, dedupe rule, goal contract, provider route, and writeback field schema
- allow the runtime request to provide the concrete form ID and date window
- run best-effort creation-time preflight when available and require form schema and writeback runtime gate checks before real calls
- default execution mode to `dry-run-then-batch-approval`

User request:

```text
Create a skill that automatically processes the same lead form every morning.
```

Recommended creator response:

- recommend `fully-bound`
- fix the concrete form, linked response spreadsheet, writeback columns, and host scheduler boundary
- allow only narrow runtime controls such as date window
- require the runtime gate before every scheduled or approved direct execution run

User request:

```text
Create a generic callback skill. I will tell it the data source later.
```

Recommended creator response:

- use `unbound-generic`
- keep the skill dry-run-only by default
- require runtime collection of source fields, source-level outreach basis or consent evidence, dedupe key, and writeback behavior before any real calls
