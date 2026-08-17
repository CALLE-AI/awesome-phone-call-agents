# n8n CALL-E API Workflow Template

This plugin contains an importable n8n workflow template that uses the CALL-E API directly. It does not require the CALL-E npm SDK, custom n8n nodes, Notion, a webhook receiver, or an Execute Command node.

The sample runs two call tasks one by one, waits for each call to reach a terminal state, and returns a compact result view with:

- metadata sent to CALL-E and metadata returned by CALL-E, with phone-bearing values masked
- answered, no answer, busy, and failed status signals
- summary, transcript turns, and structured result
- redacted raw CALL-E call result for debugging
- sanitized API error details when a request fails

## Files

- `examples/calle-ivr-quality-create-and-wait.workflow.json` - n8n workflow import file.
- `manifest.json` - plugin metadata for this repository.
- `test/workflow-safety.test.mjs` - regression tests for masking, timeout bounds, and manifest safety claims.

## What The Workflow Does

The workflow keeps configuration, validation, dialing, parsing, and output handling visible:

1. `Manual Trigger` starts the sample.
2. `CALL-E Config` stores only the polling interval and timeout; it never carries credentials or a configurable API host.
3. `Validate CALL-E Config` fails fast if the polling settings are unsafe. The create node reads `CALL_E_API_KEY` only from n8n's deployment secret or environment-variable store.
4. `Phone/Task List` defines two fictional IVR quality rows, validates E.164 numbers, and blocks the shipped placeholders.
5. `Loop Over Calls` runs with batch size `1`, so calls are created and waited on one at a time.
6. `Build CALL-E Request Payload` creates the request body, result schema, recipient schema, metadata, and idempotency key.
7. `Create CALL-E Call and Wait` calls `POST /v1/calls`, polls `GET /v1/calls/{id}`, and waits for a terminal status for up to four minutes.
8. `Parse CALL-E Result` extracts status, transcript, summary, structured result, metadata, and failure signals.
9. `Demo Result View` masks phone numbers across the complete displayed result, including metadata, raw call data, status messages, and API errors.
10. `Execution Summary` reports counts and compact per-call results after the loop finishes.

## Setup

1. Create or copy an API key from [CALL-E API Keys](https://dashboard.heycall-e.com/account/api-keys).
2. In your n8n deployment's secret or environment-variable store, set `CALL_E_API_KEY` to that API key. Do not place it in workflow data or a Code node.
3. Open n8n and import `examples/calle-ivr-quality-create-and-wait.workflow.json`.
4. Use the [CALL-E API Reference](https://test-docs.heycall-e.com/api-reference) for endpoint, request, and response details.
5. The workflow fixes its trusted API host to `https://api.heycall-e.com`; it will not send the Bearer credential to a user-configurable URL.
6. In `Phone/Task List`, replace the blocked placeholders with owned or explicitly authorized E.164 test numbers.
7. Review the IVR task, locale, and metadata for both rows before allowing a live call.
8. Keep the imported workflow inactive until its configuration and destinations have been reviewed.
9. Execute the workflow manually.

Do not commit real API keys or private lead data into this template.

## Sample Data

The default rows are desensitized IVR quality checks. They do not contain real leads, private Notion page IDs, customer properties, or campaign data. Their shipped E.164 values are fictional placeholders and are explicitly blocked by `Phone/Task List`, so the workflow cannot dial them.

Each row still demonstrates metadata round-trip behavior with keys similar to a lead workflow:

- `lead_id`
- `notion_page_id`
- `company`
- `property`
- `campaign`
- `source_url`

The included task text is in English and instructs the agent to listen to an owned or explicitly authorized test IVR opening only. The task tells the agent not to enter personal data, authenticate, make purchases, open a case, or request a human agent.

Replace both placeholders with phone numbers you own or are explicitly authorized to call. A valid replacement can create a real outbound call.

## Inputs

Configure the following workflow settings in `CALL-E Config`:

| Field | Required | Description |
| --- | --- | --- |
| `pollIntervalSeconds` | Yes | Seconds between call status polls. Defaults to `5` and must be between `1` and `30`. |
| `waitTimeoutMinutes` | Yes | Maximum Code-node polling time for each call. Defaults to `4` and cannot exceed `4`, leaving a one-minute buffer below n8n's default 300-second task-runner limit. |

Set the required `CALL_E_API_KEY` through n8n's deployment secret or environment-variable store. `Create CALL-E Call and Wait` reads it at execution time and never copies it into item data. The API base URL is intentionally fixed to the trusted HTTPS host `https://api.heycall-e.com`.

The workflow performs polling inside one Code-node task. n8n's [`N8N_RUNNERS_TASK_TIMEOUT`](https://docs.n8n.io/hosting/configuration/environment-variables/task-runners/) defaults to 300 seconds, so `Validate CALL-E Config` rejects waits above four minutes rather than advertising an unsupported 30-minute wait. Poll intervals are limited to 30 seconds, the final sleep is shortened to the remaining deadline, and each HTTP request is limited to 30 seconds. For longer-running calls, replace the Code-node polling loop with n8n Wait and HTTP Request nodes before raising this guard.

Configure each call row in `Phone/Task List`:

| Field | Required | Description |
| --- | --- | --- |
| `callItemId` | Yes | Stable sample row ID. Used in the idempotency key. |
| `ivrName` | Yes | Human-readable label for the authorized test IVR. |
| `phone` | Yes | E.164 destination phone number. The shipped placeholders are blocked and must be replaced with an authorized test number before live execution. |
| `region` | Yes | Region hint, for example `US`. |
| `locale` | Yes | Locale hint, for example `en-US`. |
| `task` | Yes | English instruction for the CALL-E agent. |
| `metadata` | Yes | Metadata sent to CALL-E and compared with metadata returned by CALL-E. |

## Output

`Demo Result View` returns one item per call:

| Field | Description |
| --- | --- |
| `callItemId` | Stable identifier for the input row. |
| `maskedPhone` | Masked destination phone number. |
| `task` | IVR quality-check instruction sent to CALL-E. |
| `metadataSent` | Metadata included in the CALL-E create request, with phone-bearing values masked in the displayed output. |
| `metadataReturned` | Metadata from the CALL-E call result, with phone-bearing values masked in the displayed output. |
| `metadataRoundTrip` | Comparison for `lead_id`, `notion_page_id`, `company`, `property`, and `campaign`. |
| `callStatus` | `ok`, call ID, raw status values, failure code/message, and answered/no answer/busy/failed booleans. |
| `returnedData.summary` | Summary from structured result or call-level summary fields. |
| `returnedData.transcript` | Transcript turns if returned by CALL-E. |
| `returnedData.structuredResult` | Structured IVR quality result following the configured schema. |
| `redactedRawCallResult` | Raw CALL-E call result with phone-number fields masked for safer inspection. |
| `apiError` | Sanitized API error message and name when the create or poll request fails. Response bodies are omitted, and phone-like E.164 values are masked. |

## Side Effects

This workflow creates outbound calls when a valid API key and reachable phone numbers are configured. It has no dry-run mode beyond the required API-key and phone-placeholder checks.

To disable or roll back the sample:

- keep the workflow inactive in n8n
- remove the workflow's access to `CALL_E_API_KEY` in the n8n deployment secret or environment-variable store
- stop a running n8n execution from the n8n execution view
- delete the imported workflow from n8n when it is no longer needed

## Manual Verification

1. Import the workflow.
2. Run it without `CALL_E_API_KEY` configured.
3. Confirm `Create CALL-E Call and Wait` fails before dialing with the missing secret error.
4. Configure `CALL_E_API_KEY` through n8n's secret or environment-variable store and replace the phone numbers with authorized test IVRs.
5. Run the workflow again.
6. Confirm the loop processes one item at a time and `Execution Summary` contains two result objects.
7. Set `waitTimeoutMinutes` above `4` and confirm `Validate CALL-E Config` rejects the unsupported Code-node wait before dialing.

## Notes

- The workflow uses n8n `helpers.httpRequest` inside a Code node because n8n Code nodes may not expose global `fetch`.
- The four-minute wait cap, deadline-aware sleeps, and 30-second HTTP request limit keep the polling Code node below the stock 300-second runner task timeout with a one-minute execution buffer.
- The request uses a deterministic `Idempotency-Key` header derived from canonical call intent, including the task, recipient phone number, region, locale, schemas, metadata, and `callItemId`.
- The workflow accepts a create or poll result only when it is a documented `CallTask`: `object: "call_task"`, a `call_` ID, and one of `queued`, `in_progress`, `completed`, `failed`, or `canceled`.
- The workflow intentionally avoids Notion and webhooks so it can be imported and tested as a standalone CALL-E API example.
- Run `node --test plugins/n8n-calle-api/test/workflow-safety.test.mjs` from the repository root to execute the focused safety regression tests.
