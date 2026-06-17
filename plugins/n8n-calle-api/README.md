# n8n CALL-E API Workflow Template

This plugin contains an importable n8n workflow template that uses the CALL-E API directly. It does not require the CALL-E npm SDK, custom n8n nodes, Notion, a webhook receiver, or an Execute Command node.

The sample runs two call tasks one by one, waits for each call to reach a terminal state, and returns a compact result view with:

- metadata sent to CALL-E and metadata returned by CALL-E
- answered, no answer, busy, and failed status signals
- summary, transcript turns, and structured result
- raw CALL-E call result for debugging
- API error details when a request fails

## Files

- `examples/calle-ivr-quality-create-and-wait.workflow.json` - n8n workflow import file.
- `manifest.json` - plugin metadata for this repository.

## What The Workflow Does

The workflow is intentionally small and visible:

1. `Manual Trigger` starts the sample.
2. `CALL-E Config` stores `apiKey`, `baseUrl`, polling interval, and timeout.
3. `Validate CALL-E Config` fails fast if the API key is missing or still set to the placeholder.
4. `2 Phone/Task List` defines two sample IVR quality tasks and metadata payloads.
5. `Loop Over Calls` runs with batch size `1`, so calls are created and waited on one at a time.
6. `Build CALL-E API Input` creates the CALL-E request body, result schema, recipient schema, metadata, and idempotency key.
7. `CALL-E API createAndWait` calls `POST /v1/calls`, polls `GET /v1/calls/{id}`, and waits for a terminal status.
8. `Parse CALL-E Result` extracts status, transcript, summary, structured result, metadata, and failure signals.
9. `Demo Result View` and `Execution Summary` produce easy-to-inspect n8n outputs.

## Setup

1. Open n8n and import `examples/calle-ivr-quality-create-and-wait.workflow.json`.
2. Open the `CALL-E Config` node.
3. Replace `replace_with_calle_api_key` with your CALL-E API key.
4. Keep `baseUrl` as `https://api.heycall-e.com` for production, or replace it with your test API base URL.
5. Review the two rows in `2 Phone/Task List`.
6. Replace the default phone numbers with owned or authorized test IVR numbers before a live run.
7. Execute the workflow manually.

Do not commit real API keys or private lead data into this template.

## Sample Data

The default rows are desensitized IVR quality checks. They do not contain real leads, private Notion page IDs, customer properties, or campaign data.

Each row still demonstrates metadata round-trip behavior with keys similar to a lead workflow:

- `lead_id`
- `notion_page_id`
- `company`
- `property`
- `campaign`
- `source_url`

The included task text is in English and instructs the agent to listen to the public IVR opening only. The task tells the agent not to enter personal data, authenticate, make purchases, open a case, or request a human agent.

The default IVR/contact-center numbers are public business numbers from official pages. They may still trigger real outbound calls, so replace them with your own test numbers unless you explicitly intend to call those public IVRs.

## Inputs

Configure these fields in `CALL-E Config`:

| Field | Required | Description |
| --- | --- | --- |
| `apiKey` | Yes | CALL-E API key. The workflow fails before dialing if this is missing or still set to the placeholder. |
| `baseUrl` | Yes | CALL-E API base URL. Defaults to `https://api.heycall-e.com`. |
| `pollIntervalSeconds` | Yes | Seconds between call status polls. Defaults to `5`. |
| `waitTimeoutMinutes` | Yes | Maximum wait time for each call. Defaults to `30`. |

Configure each call row in `2 Phone/Task List`:

| Field | Required | Description |
| --- | --- | --- |
| `callItemId` | Yes | Stable sample row ID. Used in the idempotency key. |
| `phone` | Yes | Destination phone number. Replace with an authorized test number before live execution. |
| `region` | Yes | Region hint, for example `BR`. |
| `locale` | Yes | Locale hint, for example `pt-BR`. |
| `task` | Yes | English instruction for the CALL-E agent. |
| `metadata` | Yes | Metadata sent to CALL-E and compared with metadata returned by CALL-E. |

## Output

`Demo Result View` returns one item per call:

| Field | Description |
| --- | --- |
| `metadataSent` | Metadata included in the CALL-E create request. |
| `metadataReturned` | Metadata from the CALL-E call result. |
| `metadataRoundTrip` | Comparison for `lead_id`, `notion_page_id`, `company`, `property`, and `campaign`. |
| `callStatus` | `ok`, call ID, raw status values, failure code/message, and answered/no answer/busy/failed booleans. |
| `returnedData.summary` | Summary from structured result or call-level summary fields. |
| `returnedData.transcript` | Transcript turns if returned by CALL-E. |
| `returnedData.structuredResult` | Structured IVR quality result following the configured schema. |
| `rawCallResult` | Full raw CALL-E call result. |
| `apiError` | API error message and name when the create or poll request fails. |

## Side Effects

This workflow creates outbound calls when a valid API key and reachable phone numbers are configured. It has no dry-run mode beyond the required API-key placeholder check.

To disable or roll back the sample:

- keep the workflow inactive in n8n
- remove or replace the API key in `CALL-E Config`
- stop a running n8n execution from the n8n execution view
- delete the imported workflow from n8n when it is no longer needed

## Manual Verification

1. Import the workflow.
2. Run it without changing `apiKey`.
3. Confirm `Validate CALL-E Config` fails with the missing API key error.
4. Set a valid API key and replace the phone numbers with authorized test IVRs.
5. Run the workflow again.
6. Confirm the loop processes one item at a time and `Execution Summary` contains two result objects.

## Notes

- The workflow uses n8n `helpers.httpRequest` inside a Code node because n8n Code nodes may not expose global `fetch`.
- The request uses an `Idempotency-Key` header built from sample metadata and `callItemId`.
- The workflow intentionally avoids Notion and webhooks so it can be imported and tested as a standalone CALL-E API example.
