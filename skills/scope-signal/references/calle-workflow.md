# Exact CALL-E Workflow

The local script never invokes these tools. A CALL-E-capable host performs this sequence only after all live gates in `SKILL.md` pass.

1. Call `plan_call` with `to_phones` containing the single frozen E.164 number, `goal` equal to the compiled task, `user_input` describing the same bounded intent, and `result_schema` equal to the compiled schema. Include `language` and `region` only when explicitly supplied. Planning remains preview-only.
2. Compare the returned plan with the approved recipient and task. Require `ready_to_run`, `plan_id`, and the provider confirmation value. Do not show or persist confirmation values in repository artifacts.
3. Call `run_call` exactly once using the returned `plan_id` and confirmation value. Bind the scope-signal `idempotency_key` through supported metadata or the adapter's idempotency facility. If the provider cannot preserve one-call idempotency, stop.
4. Record the returned `run_id`. If it is missing or execution times out, classify the outcome as unknown and do not redial.
5. Call `get_call_run` with that exact `run_id`, never a call ID. Poll until a terminal status: `COMPLETED`, `FAILED`, `NO_ANSWER`, `DECLINED`, `CANCELED`, `CANCELLED`, `VOICEMAIL`, `BUSY`, or `EXPIRED`.
6. Reconcile only the authoritative terminal payload. `COMPLETED` is necessary but not sufficient: each fact still needs matching callee transcript evidence.

There is no automatic retry, second recipient, recurring schedule, provider-side recurrence, acceptance step, or financial action. Cancellation is safest before `run_call`; after it, use provider cancellation only if supported and continue polling the same run.
