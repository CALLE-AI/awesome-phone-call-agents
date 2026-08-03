# Dify CALL-E Workflow Template

This plugin contains an importable Dify workflow DSL template for a one-shot CALL-E outbound call tool.

The workflow validates one authorized phone/task pair, performs a read-only `GET /v1/goals?limit=1` API preflight, supports a dry-run preview, creates one live call only when `dry_run=false`, polls the call result, masks phone numbers in outputs, and returns a compact user-facing report.

## Files

- `examples/call-e-dify-workflow.dsl.yml` - Dify workflow DSL import file.
- `manifest.json` - plugin metadata for this repository.

## What The Workflow Does

The workflow is intentionally small and visible:

1. `Start` accepts `base_url`, `dry_run`, `request_id`, `phone_number`, and `task`; only the HTTP request nodes read the Dify secret environment variable `CALL_E_API_KEY`.
2. `Prepare one-shot call` validates required fields, normalizes the CALL-E base URL, rejects non-HTTPS or untrusted API hosts, enforces E.164 phone number format, rejects placeholder phone numbers for live calls, and prepares a masked preview.
3. `Check API connectivity` calls the documented, read-only `GET /v1/goals?limit=1` endpoint on the configured CALL-E API host. Transport and forced HTTP failures use an explicit Dify default-value error strategy so the preflight gate can return a final report instead of terminating the workflow.
4. `Gate live calls after API preflight` allows live-call creation only when `GET /v1/goals?limit=1` returns a 2xx status code.
5. `Run one-shot call` creates one CALL-E call only when `dry_run=false` and the API preflight passes.
6. `Build per-call payload` creates the CALL-E request body, prepends non-overridable safety boundaries to the task, builds the result schema, recipient schema, metadata, and stable idempotency key.
7. `Create CALL-E call` calls `POST /v1/calls`. An indeterminate transport or forced HTTP failure is reported as unknown and possibly created with the original idempotency key.
8. `Extract call lookup id` finds the returned call ID and prepares the result lookup URL. A 2xx response without a recognized ID is reported as unknown and possibly created, with reconciliation restricted to the same idempotency key.
9. `Poll until terminal` polls `GET /v1/calls/{id}` until the call reaches a terminal state, the timeout is reached, or a poll request fails. Poll failures are returned as failed results.
10. `Parse final call result` extracts status, transcript, summary, structured result, metadata, and failure signals with phone numbers masked.
11. `Summarize iteration results` builds the readable final report and keeps `summary_json` inside that node for debugging.

## Setup

1. Open Dify and import `examples/call-e-dify-workflow.dsl.yml`.
2. Open the workflow app environment variables and set `CALL_E_API_KEY` as a Dify secret environment variable.
3. Keep `CALL-E API base URL` as `https://api.heycall-e.com` for production. Only `https://api.heycall-e.com` is enabled by default.
4. Add a CALL-E-managed test host to the `TRUSTED_BASE_URLS` set in `Prepare one-shot call` before using a non-production base URL. This is the workflow's single host allowlist. Do not run this template with arbitrary hosts because the workflow sends the Bearer API key from `CALL_E_API_KEY` to `GET /v1/goals?limit=1` and `POST /v1/calls`.
5. Keep `Dry run?` set to `true` for the first run.
6. Fill `request_id` with a stable value for this intended call. It must be 8-120 characters and may contain only ASCII letters, numbers, dot, underscore, colon, or hyphen (`[A-Za-z0-9._:-]`). Reuse the same value only when replaying the same call after an ambiguous create result; use a new value for a new live call.
7. Fill one owned or explicitly authorized destination number in E.164 format, for example `+15555550123`.
8. Fill the CALL-E task.
9. Run the workflow and confirm the dry-run preview and connectivity check.
10. Set `Dry run?` to `false` only when you intend to create one live outbound call.

Do not commit real API keys, private customer data, or live lead data into this template.

## Inputs

Configure these fields in `Start`:

| Field | Required | Description |
| --- | --- | --- |
| `base_url` | Yes | Trusted CALL-E API base URL. Defaults to `https://api.heycall-e.com`. The workflow rejects non-HTTPS URLs and hosts not listed in its `TRUSTED_BASE_URLS` allowlist. Do not include `/v1`. |
| `dry_run` | Yes | The workflow accepts only exact `true` or `false` for `dry_run`. `true` previews the payload and checks connectivity without creating a call. `false` creates one live call. |
| `request_id` | Yes | Replay-safe request identifier, stable per intended live call. It must be 8-120 characters and may contain only `[A-Za-z0-9._:-]`. Reuse the same value only when replaying the same call after an ambiguous `POST /v1/calls` result; use a new value for a new call. |
| `phone_number` | Yes | Destination phone number in E.164 format. Use only owned or explicitly authorized numbers. |
| `task` | Yes | English instruction for the CALL-E agent. Non-overridable safety boundaries are prepended before this task reaches CALL-E, including logistics-only handling for medical, legal, financial, and emergency topics. |

Configure `CALL_E_API_KEY` as a secret Dify environment variable before running the workflow. The HTTP request nodes consume it directly; code nodes do not receive it as an input. Do not put live CALL-E API keys in Start inputs, task text, or exported example files.

## Output

The Dify End node exposes only:

| Field | Description |
| --- | --- |
| `report` | Human-readable final answer returned by the End node. |

`summary_json` remains available inside the `Summarize iteration results` node for debugging. It includes dry-run mode, preview data, live-call counts, parsed status, metadata round trip, polling state, transcript turns, summary, structured result, and redacted raw call result.

## Side Effects

With `dry_run=true`, the workflow performs a read-only CALL-E API preflight with `GET /v1/goals?limit=1` and does not create a call.

With `dry_run=false`, the workflow creates one outbound phone call through CALL-E only after `GET /v1/goals?limit=1` returns a 2xx status code, then polls for the result. It does not create recurring schedules or provider-side recurrence.

The API preflight, create, and poll HTTP nodes disable automatic retries and use Dify's `default-value` error strategy with an empty JSON body and status code `0`. This lets downstream code return a final report for Dify transport errors and force-failed HTTP responses instead of terminating the workflow.

The polling sleep is capped below Dify's default 5-second code-node timeout. Each polling round uses five serial four-second wait slices, and the workflow runs at most 45 rounds over approximately 15 minutes. Counting the loop-start node conservatively, the graph uses at most 419 workflow steps, below Dify's default limits of 100 loop rounds and 500 workflow steps.

The live create request uses a stable idempotency key derived from `request_id`, the call item, destination phone number, and task. This protects replay after an ambiguous `POST /v1/calls` result from creating a duplicate outbound call.

If `POST /v1/calls` returns 2xx without a documented `CallTask` (`object: "call_task"`, a `call_` ID, and a documented lifecycle status), or Dify cannot determine the POST outcome because of a transport or force-failed HTTP response, the workflow does not claim that no call was created. It reports the creation outcome as unknown and possibly created, skips automatic lookup, and shows the same idempotency key to use for replay or provider-side reconciliation. Do not retry that request with a new key. A successful poll response must meet the same `CallTask` contract; otherwise the workflow requires reconciliation rather than reporting a confirmed call.

To prevent future live calls:

- keep `dry_run=true`
- stop the Dify execution before it reaches `Create CALL-E call`
- remove or rotate the `CALL_E_API_KEY` secret in Dify
- delete the imported workflow app from Dify when it is no longer needed

After `POST /v1/calls` succeeds, stopping the Dify execution stops only this workflow's polling; it does not cancel the outbound call. Removing or rotating the API key and deleting the app also affect only polling or future executions after that boundary.

The CALL-E API used by this template does not provide a call-cancel action, so cancellation is available only before call creation.

## Manual Verification

1. Import the workflow into Dify.
2. Run it with `dry_run=true`, a valid API key, one authorized E.164 phone number, and a short test task.
3. Confirm the final report says no live call was created.
4. Confirm the preview masks the phone number.
5. Set `dry_run=false` only for an authorized test number.
6. Confirm the workflow creates one call, polls until a terminal status or timeout, and returns a masked report with status, summary, and outcome fields.

## Notes

- This is a one-shot workflow. For batch behavior, call this Dify workflow from an external loop or scheduler.
- Host schedulers should handle recurrence. CALL-E should handle exactly one call per scheduled run.
- The workflow masks E.164, common US-style, and grouped international phone numbers, including display formats with parentheses such as `+44 (20) 7123 4567`, in summaries, transcripts, evidence, structured results, raw result output, and final report text.
