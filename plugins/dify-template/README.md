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
6. `Build per-call payload` creates a v2 request with one top-level `phone`, a closed scalar `result_schema`, metadata, and the idempotency key prepared before the creation stage. It prepends safety boundaries and explicit missing-answer rules to the task; routing hints remain omitted.
7. `Create CALL-E call` calls `POST /v2/calls`, which returns HTTP 202 after acceptance. Transport failures, HTTP 408/409/5xx, and forced HTTP failures retain the original key and report that a call may already exist.
8. `Extract call lookup id` validates `object: "call"`, a `call_` API resource ID, a documented lifecycle status, and a known `result_status` before preparing the lookup URL. An invalid 2xx response requires reconciliation with the same key and unchanged request body.
9. `Poll until terminal` polls `GET /v2/calls/{id}` while `result_status` is `pending`, including when `status` is already `completed`. It stops on a final result status, timeout, or lookup failure. Failed lookups retain the last valid response and accepted Call ID.
10. `Parse final call result` reads `result`, `error`, `call_outcome`, `result_status`, top-level `transcript`, and metadata, with phone numbers masked. The summary comes from `result.summary`.
11. `Summarize iteration results` builds the readable final report and keeps `summary_json` inside that node for debugging.

## Setup

1. Open Dify and import `examples/call-e-dify-workflow.dsl.yml`.
2. Open the workflow app environment variables and set `CALL_E_API_KEY` as a Dify secret environment variable.
3. Keep `CALL-E API base URL` as `https://api.heycall-e.com` for production. Only `https://api.heycall-e.com` is enabled by default.
4. Add a CALL-E-managed test host to the `TRUSTED_BASE_URLS` set in `Prepare one-shot call` before using a non-production base URL. This is the workflow's single host allowlist. Do not run this template with arbitrary hosts because the workflow sends the Bearer API key from `CALL_E_API_KEY` to `GET /v1/goals?limit=1` and `POST /v2/calls`.
5. Keep `Dry run?` set to `true` for the first run.
6. Fill `request_id` with a stable value for this intended call. It must be 8-120 characters and may contain only ASCII letters, numbers, dot, underscore, colon, or hyphen (`[A-Za-z0-9._:-]`). Preserve the exported workflow and original Start inputs when recovering an uncertain creation. Reuse the same value and unchanged request body for replay; use a new value only for an intentionally new live call.
7. Fill one owned or explicitly authorized destination number in E.164 format, for example `+15555550123`.
8. Fill the CALL-E task.
9. Run the workflow and confirm the dry-run preview and connectivity check.
10. Set `Dry run?` to `false` only when you intend to create one live outbound call.

Do not commit real API keys, private customer data, or live lead data into this template.

## Inputs

Configure these fields in `Start`:

| Field | Required | Description |
| --- | --- | --- |
| `base_url` | Yes | Trusted CALL-E API base URL. Defaults to `https://api.heycall-e.com`. The workflow rejects non-HTTPS URLs and hosts not listed in its `TRUSTED_BASE_URLS` allowlist. Use the host URL without a version suffix. |
| `dry_run` | Yes | The workflow accepts only exact `true` or `false` for `dry_run`. `true` previews the payload and checks connectivity without creating a call. `false` creates one live call. |
| `request_id` | Yes | Replay-safe request identifier, stable per intended live call. It must be 8-120 characters and may contain only `[A-Za-z0-9._:-]`. The same value retains the same key, including when inputs change, so v2 can reject conflicting replay. Use a new value only for an intentionally new call. |
| `phone_number` | Yes | Destination phone number in E.164 format. Use only owned or explicitly authorized numbers. |
| `task` | Yes | English instruction for the CALL-E agent. Non-overridable safety boundaries are prepended before this task reaches CALL-E, including logistics-only handling for medical, legal, financial, and emergency topics. |

Configure `CALL_E_API_KEY` as a secret Dify environment variable before running the workflow. The HTTP request nodes consume it directly; code nodes do not receive it as an input. Do not put live CALL-E API keys in Start inputs, task text, or exported example files.

## Output

The Dify End node exposes only:

| Field | Description |
| --- | --- |
| `report` | Human-readable final answer returned by the End node. |

`summary_json` remains available inside the `Summarize iteration results` node for debugging. It includes dry-run mode, preview data, live-call counts, parsed status, metadata round trip, polling state, transcript turns, summary, structured result, error, and redacted raw call result.

`resultStatusCounts` counts `available`, `unavailable`, `pending`, and `not_applicable` separately. An available empty object is preserved. A final unavailable result can have both `result` and `error` set to null. No-answer, busy, and declined outcomes are telephone outcomes, not technical failures. Neither `status: "completed"` nor an available result proves business success; inspect the schema fields for that decision.

## Side Effects

With `dry_run=true`, the workflow performs a read-only CALL-E API preflight with `GET /v1/goals?limit=1` and does not create a call.

With `dry_run=false`, the workflow creates one outbound phone call through CALL-E only after `GET /v1/goals?limit=1` returns a 2xx status code, then polls for the result. It does not create recurring schedules or provider-side recurrence.

All HTTP nodes disable automatic retries. The API preflight and poll nodes use Dify's `default-value` error strategy with an empty JSON body and status code `0`. The create node leaves its error strategy unset so HTTP error status codes and bodies reach the result parser. Its enclosing one-shot iteration continues on transport failure; the following code reports unknown and possibly created using the key prepared before submission.

Dify can mark a run with a handled HTTP error as `partial-succeeded`. Read the report's creation state and recovery instructions before replaying.

The polling sleep is capped below Dify's default 5-second code-node timeout. Each polling round uses five serial four-second wait slices, and the workflow runs at most 45 rounds over approximately 15 minutes. Counting the loop-start node conservatively, the graph uses at most 419 workflow steps, below Dify's default limits of 100 loop rounds and 500 workflow steps.

The live create request derives its idempotency key from `request_id` and the stable call item. Changing the phone, task, metadata, or schema does not silently generate a replacement key. Replaying the original body and key recovers the same Call, including after completion, without preparing or dialing again. Do not copy inferred region or locale from a response into a replay body.

If a creation response is invalid or uncertain, the workflow reports unknown and possibly created, skips automatic lookup, and shows the same idempotency key for replay or reconciliation. It never automatically creates a replacement call. Use the following recovery rules from the [Calls v2 contract](https://docs.heycall-e.com/calls):

| Response | Recovery |
| --- | --- |
| Timeout, lost response, HTTP 408, or 5xx | Back off, then replay the original key and unchanged body. Acceptance may already have occurred. |
| HTTP 409 with `details.reason_code: "creation_in_progress"` | Back off, then replay the original key and unchanged body. |
| Other HTTP 409 conflicts | Restore the original body. A new key is only for an intentionally new call. |
| HTTP 429 | Back off before retrying with the original key and body. |
| Definitive validation rejection, such as HTTP 400 or 422 | Inspect the returned error details, correct the rejected inputs, and reuse `request_id`. No Call was accepted for that rejected request. |
| Poll timeout, HTTP failure, or invalid/mismatched Call response | Retain the accepted ID and last valid data; resume `GET /v2/calls/{id}`. A lookup failure does not undo creation or cancel the call. |

The report includes returned error details, including missing prerequisites. A successful poll must match the accepted Call ID and v2 response contract. The template keeps automatic HTTP retries disabled; creation replay and resuming a stopped lookup require an operator or caller.

To prevent future live calls:

- keep `dry_run=true`
- stop the Dify execution before it reaches `Create CALL-E call`
- remove or rotate the `CALL_E_API_KEY` secret in Dify
- delete the imported workflow app from Dify when it is no longer needed

After `POST /v2/calls` succeeds, stopping the Dify execution stops only this workflow's polling; it does not cancel the outbound call. Removing or rotating the API key and deleting the app also affect only polling or future executions after that boundary.

This template does not invoke cancellation. An operator can call `POST /v2/calls/{id}/cancel` before provider submission. After submission, cancellation returns `409 call_cannot_cancel` and does not hang up an active call.

Existing imported workflows require an explicit update. Historical `/v1/calls` IDs must still be read through their original interface; importing this template does not migrate them.

## Manual Verification

1. Import the workflow into Dify.
2. Run it with `dry_run=true`, a valid API key, one authorized E.164 phone number, and a short test task.
3. Confirm the final report says no live call was created.
4. Confirm the preview masks the phone number.
5. Set `dry_run=false` only for an authorized test number.
6. Confirm the workflow creates one call, polls until `result_status` resolves or the wait ends, and returns a masked report with telephone outcome, business result status, summary, and errors when present.
7. Replay the same original inputs and `request_id`; confirm the API Call ID stays unchanged. Editing accepted inputs while retaining `request_id` must produce a conflict rather than another call.

Run `python3 scripts/validate_repository.py` for credential-free regressions covering the embedded code, result readiness, unavailable and empty results, rejected and uncertain creation, lookup recovery, stable keys, and masking.

## Notes

- This is a one-shot workflow. For batch behavior, call this Dify workflow from an external loop or scheduler.
- Host schedulers should handle recurrence. CALL-E should handle exactly one call per scheduled run.
- The workflow masks E.164, common US-style, and grouped international phone numbers, including display formats with parentheses such as `+44 (20) 7123 4567`, in summaries, transcripts, evidence, structured results, raw result output, and final report text.
