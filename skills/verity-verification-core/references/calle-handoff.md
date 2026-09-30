# CALL-E handoff

This skill decides `ALLOW` / `BLOCK` for a call that already happened. Placing the call
and acting on the verdict happen in your integration. This note is the contract between
the two.

## Where the boundary is

| Your integration | This skill |
|---|---|
| Holds the resource (slot, inventory, ticket). | — |
| Builds the call plan and places `POST /v1/calls`. | `preview_gate.py` shows the plan it expects. |
| Receives the webhook, **re-fetches** `GET /v1/calls/{id}`. | — |
| Passes the re-fetched snapshot + intent + value + a fresh resource re-check. | `reconcile_call.py` / `decide()` returns the verdict. |
| On `ALLOW`: writes the action, idempotently. | — |
| On `BLOCK`: confirms `repair_target` on a second channel, or routes to a human. | — |

## Credentials

`CALLE_API_KEY` is server-side only. It authorizes real outbound calls and spends
account balance. Never put it in a client bundle, a webhook URL, a log line, or an API
response. **This skill never reads it** — it takes a call snapshot as plain data.

## Placing the call

Use the plan from `preview_gate.py`:

- `task` — the natural-language instruction (templated per intent).
- `result_schema` — a small closed object (`appointment_date`, `appointment_time`,
  `timezone`, `confirmed`). It is a **cross-check only**. The value this skill acts on
  comes from the transcript grammar, never from `structured_result`.
- `metadata` — your correlation ids, echoed back on the call and webhook.
- `webhook_url` — a per-request HTTPS URL. Carry only an opaque nonce in the path;
  CALL-E does not sign webhooks, so the path is a coarse filter, not a secret.
- `Idempotency-Key` — `verity:{verification_id}:v1`, derived from a durable workflow
  event so a network retry re-sends the same key and body and gets the original call
  back. A `409 idempotency_conflict` means a body-divergence bug — do not create a
  divergent call; surface it for a human.

## Do not trust the webhook body

CALL-E webhook delivery has no signature, no timestamp, no secret, and is at-least-once.
Treat `POST /calle/webhook` as *"a result may exist"*. Validate `CALL-E-Event-Id ==
body.id`, dedupe on the event id, then **discard the body** and fetch
`GET /v1/calls/{id}` server-side. Run `decide()` on that snapshot. A forged webhook for
a call you do not own yields `not_found` from CALL-E, which your integration should
treat as `needs_human`.

## Non-terminal and failed calls

- `status` not `completed` -> `decide()` returns `call_not_completed`, no
  `repair_target`; route to a human. A failed reschedule leaves the original
  appointment untouched.
- `task_completed` still `null` on a re-fetch -> the result is not terminal. Poll once
  more after a delay; if still non-terminal, `needs_human`. Do not guess a result.
- `429` on create or re-fetch -> bounded retry honoring `Retry-After`; on exhaustion,
  `needs_human` (`calle_rate_limited`). Never fabricate a snapshot.

## The fresh resource re-check (E6)

`decide()` needs a `slot_recheck` taken **immediately before** the call, from your own
resource store:

```json
{ "slot_id": "...", "held_by_hold_id": "...", "available": false, "sandbox_ok": true }
```

If the slot was taken between your hold and the write, `held_by_hold_id` will not match
and the gate returns `slot_lost` — an `ALLOW` that cannot be committed is downgraded to
`BLOCK`, never retried into a silent write. `sandbox_ok: false` (your store is
unreachable) returns `sandbox_unavailable` and wins over every other check.

## Feeding learned patterns

When a `BLOCK` is later resolved and you know the correct value, normalise the
transcript window with `normalizePattern` (TypeScript core) into a PII-safe skeleton
and store it. On future calls, run your matcher and pass hits into `decide()` as
`matched_fixtures: [{ fixture_id, expected_behavior: "force_sms_confirmation" }]`. The
gate then routes matching calls to the second channel automatically (E7), with no human
flag. `assertPatternPiiClean` rejects any pattern that still holds a raw name, E.164,
or calendar date before you persist it.
