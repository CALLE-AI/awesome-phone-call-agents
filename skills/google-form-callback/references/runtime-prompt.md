# Runtime Prompt Template

Use this template for one scheduled Google Form callback plan. Create one plan
per form. The scheduler belongs to the host agent or external cron; CALL-E only
places one call per eligible response during a scheduled run.

```text
You are executing a user-authorized scheduled Google Form callback run.

Schedule:
- Requested cadence: {{schedule_prompt}}
- Timezone: {{timezone}}
- Form ID: {{form_id}}
- Form name: {{form_name}}
- Export path: {{export_path}}
- Candidates path: {{candidates_path}}
- State path: {{state_path}}
- Template path: {{template_path}}
- Writeback path: {{writeback_path}}
- Submitted after: {{submitted_after}}
- Submitted before: {{submitted_before}}
- Auth preflight passed before schedule creation: {{auth_preflight_ok}}
- Approved for real calls: {{approved_real_calls}}

Workflow:
1. Re-run `preflight-auth.mjs` before export, dry-run, or calls as a runtime guard. Google and CALL-E were checked before this scheduler job was created, but they must still both be ready now. If either authorization is unavailable in the scheduled environment, skip this run and report the blocker.
2. Export the Google Form metadata and responses for {{form_id}}, preferably through `google-local-api-client.mjs --action export`, and include the approved response window:
   `node skills/google-form-callback/scripts/google-local-api-client.mjs --action export --form-id "{{form_id}}" {{response_window_args}} --output "{{export_path}}"`
3. Run extract-callback-candidates.mjs with the exported form payload, template path, state path, and the same approved response window:
   `node skills/google-form-callback/scripts/extract-callback-candidates.mjs --input "{{export_path}}" --template "{{template_path}}" --state "{{state_path}}" {{response_window_args}} > "{{candidates_path}}"`
4. Run process-callback-candidates.mjs in dry-run mode first as an internal validation step and inspect skipped, already processed, and pending responses.
   `node skills/google-form-callback/scripts/process-callback-candidates.mjs --input "{{candidates_path}}" --state "{{state_path}}" --dry-run`
5. If `Approved for real calls` is `true`, immediately run process-callback-candidates.mjs with `--execute --approved-real-calls --poll --writeback "{{writeback_path}}" {{writeback_sink_args}}` for this form's pending candidates. Do not ask the user for another per-run or per-response confirmation.
   `node skills/google-form-callback/scripts/process-callback-candidates.mjs --input "{{candidates_path}}" --state "{{state_path}}" --execute --approved-real-calls --poll --writeback "{{writeback_path}}" {{writeback_sink_args}}`
6. If `Approved for real calls` is `false`, stop after the dry-run report and do not place calls.
7. Confirm the writeback file was produced and posted. With local OAuth this is handled by `--writeback-local`; with an Apps Script fallback it is handled by `--writeback-url`. If only the file was produced, retry posting with `--post-writeback "{{writeback_path}}"` and the approved writeback route.

Required runtime checks:
- Do not call any phone number except the E.164 phone number extracted from this form response.
- Deduplicate by responseId through the configured state file.
- Do not remove or widen the approved response time window. If `Submitted after` was generated at schedule creation, it is the lower bound that prevents old responses from being called on the first scheduled run.
- Do not create a provider-side recurring schedule.
- Treat the approved scheduler job as the user confirmation for real calls when `Approved for real calls` is `true`.
- Do not expose Google OAuth tokens, provider credentials, confirmation tokens, cookies, or full phone numbers in public logs.
- If Google authorization or CALL-E authorization is unavailable in the scheduled environment, skip the run and report the blocker.
- If a response involves medical, legal, financial, or emergency judgment, collect logistics or route to a human instead of giving advice.

Final report:
- status: success, skipped, or failed
- form ID and form name
- pending, skipped, already processed, and called counts
- masked phone numbers only
- writeback status for the result and summary columns
```
