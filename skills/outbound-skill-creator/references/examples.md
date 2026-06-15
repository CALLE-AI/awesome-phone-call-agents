# Examples

Use fictional reserved phone numbers in examples.

## Google Form Quote Callback Skill

User request:

```text
Create an outbound skill named quote-request-callback. It should process Google Form quote requests, call leads who authorized phone follow-up, and write results back to the linked response spreadsheet.
```

Captured contract:

- output scope: user-level reusable skill, or this repository's `skills/` directory when contributing the workflow here
- source family: `google-form`
- phone field: `phone`
- recipient label field: `name`
- dedupe key: Google Forms response ID
- date filtering: submitted-time window
- outreach basis: form description states that submission authorizes a phone follow-up
- provider route: `https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth`
- writeback: linked response spreadsheet
- execution: dry-run first unless the generated skill is configured for approved direct execution; after approval, process all ready candidates serially and report one final batch summary

Generated future use:

```text
Use quote-request-callback to process all June 20 submissions.
```

## ttmcp Lead Follow-Up Skill

User request:

```text
Create an outbound skill named tiktok-lead-followup. It should read callable lead records from ttmcp, call leads about their submitted product interest, and write status back only if an approved ttmcp writeback tool exists.
```

Captured contract:

- output scope: user-level reusable skill unless the user explicitly asks for project-local output
- source family: `ttmcp`
- MCP tool names: captured from the host before generation
- phone field: captured from returned lead records
- recipient label field: captured from returned lead records
- dedupe key: lead record ID
- date filtering: record creation time in the source account timezone
- outreach basis: lead form includes phone follow-up consent
- writeback: approved ttmcp writeback tool or session table fallback
- execution: after approval, process all ready candidates serially, record each terminal result, then write back or output one final session table

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
- source family: `local-csv`
- CSV path: provided at runtime
- phone column: `phone_e164`
- recipient label column: `patient_name`
- dedupe key column: `appointment_id`
- date filtering: `appointment_date` in `YYYY-MM-DD`
- outreach basis column: `phone_followup_authorized`
- writeback: local result CSV
- sensitive boundary: logistics only, no medical advice
- execution: after approval, call eligible rows serially, continue past candidate-level failures when safe, and summarize all results after the batch ends

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
