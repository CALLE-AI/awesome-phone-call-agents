# CALL-E Handoff

The bundled scripts stop before a provider request. A host adapter may execute a plan only after the operator approves the exact preview. This reference defines the boundary so adding CALL-E does not weaken it.

## Frozen Mapping

For each approved `calls[]` item:

| Plan field | CALL-E create-call input |
| --- | --- |
| `recipient_e164` | `recipient.phone` |
| `opening_disclosure`, `purpose`, ordered `questions` | one rendered `task` string, without additions |
| `idempotency_key` | create-call idempotency key |
| `plan_id`, `call_id`, `business_id` | non-sensitive metadata |

The adapter must reject a changed recipient, purpose, disclosure, or question list. It must not accept provider-generated replacements for those fields.

## Python SDK Shape

After approval, a CALL-E Python SDK adapter uses the equivalent of:

```python
from calle import CalleClient

with CalleClient(api_key=api_key) as client:
    created = client.calls.create(
        task=render_frozen_task(call),
        recipient={"phone": call["recipient_e164"]},
        metadata={
            "skill": "research-gap-call-verifier",
            "plan_id": plan["plan_id"],
            "call_id": call["call_id"],
            "business_id": call["business_id"],
        },
        idempotency_key=call["idempotency_key"],
    )
```

`api_key` comes from the host's secret store. Never put it in the plan, a fixture, logs, or source control. The adapter should print the idempotency key before sending the request so an ambiguous timeout can be recovered with the same key rather than a second dial.

## Terminal Result Mapping

Poll `client.calls.get(call_id)` until CALL-E reports `completed`, `failed`, or `canceled`. Preserve the full provider payload in an access-controlled, short-lived location. Build the provider-neutral result envelope from the authoritative fetched payload, not from an unsigned webhook body.

For each planned gap, a direct callee transcript turn must support the adapter's `answer` and `callee_quote`. Provider summaries and structured results may help locate evidence but never replace the transcript. Map a provider timeout to `timed_out` and an unrecognized or non-terminal final state to `unknown`; both reconcile to `not_reached`.

## Ambiguous Create And Retry

If create-call returns an error or times out, the call may already exist. Do not generate a new key and do not blindly repeat the call. Query or retry with the same content-bound idempotency key. A second attempt after a terminal failure requires separate operator approval.

This skill creates no recurring schedule and authorizes no purchase, booking, cancellation, or other commitment.
