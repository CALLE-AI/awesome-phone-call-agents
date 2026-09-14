# CALL-E API Notes For This Skill

## Use the call task path

```text
POST /v1/calls               create one call task
GET  /v1/calls/{id}          poll terminal state
GET  /v1/calls/{id}/events   attempt level detail
POST webhook_url             terminal delivery, per request
```

The request body this skill uses:

| Field | Why this skill needs it |
| --- | --- |
| `task` | The single question, phrased for a human, with an explicit instruction not to broaden it |
| `recipients[].phones[]` | Exactly one authoritative party, E.164, supplied by the user. The field is `phones`, and the recipient schema rejects unknown properties, so a guessed `phone_numbers` is a rejected request |
| `recipients[].region` | Sent only when the user supplied it, because region drives routing and compliance checks and must never be inferred from the country code |
| `result_schema` | The typed verdict, so the answer is a value rather than a paragraph to re-parse |
| `metadata` | `claim_id`, so the terminal webhook can find the record to correct |
| `webhook_url` | The correction is asynchronous by design, see below |

## Do not use the goal run path here

The asynchronous goal run path has a failure mode where a run is accepted and then fails with `credential_grant_unavailable` before any call is placed: start time equals end time, duration zero, transcript null, and the handset never rang. Observed during development in September 2026 and **not independently confirmed** — treat it as a reason to prefer the call task path, not as a documented API guarantee. Re-check before relying on it.

For this skill the distinction is not only reliability. A gated claim that silently never called is worse than one that failed loudly, because the provisional answer keeps standing while the user believes a correction is on its way. Use the call task path, and treat a missing terminal event as an unresolved claim rather than a resolved one.

## A webhook delivery is not evidence

CALL-E webhook deliveries are unsigned. `apps/python/webhook-result-receiver/README.md` says so plainly about its own consistency check: "that equality is only a consistency check, not authentication." Anyone who learns the URL can POST a body that looks exactly like a terminal event, including a `confirmed_true` verdict.

So the delivery is a *notification*, never a source. The write-back path is:

```text
webhook arrives -> GET /v1/calls/{id} -> release(verdict, abstain) -> write back
```

Two consequences this skill enforces:

- The webhook URL must carry an unguessable path segment, at least 16 characters. Until CALL-E signs deliveries, that secret is the only thing standing in for a signature, so a bare origin is refused by `require_public_https()`.
- The receiver must be a public address. A URL pointing at `localhost`, a private range, or `169.254.169.254` makes the provider fetch inside a network boundary on your behalf.

Deduplicate on the terminal event's top-level `id` before applying a correction, or a redelivery corrects the same claim twice.

## A note on `result_schema` support

This repository is not internally consistent about `result_schema` on `POST /v1/calls`. `skills/appointment-call-confirm` and `skills/ringer-consumer-tasks` send it; `skills/verify-by-phone/references/api-notes.md` records the live API rejecting it as "not supported" and extracts client-side instead. Those notes carry different dates and at least one is stale.

This skill sends it, because a typed verdict is the whole point of the gate. If the API rejects it, the fallback is not to loosen the verdict: keep `result_schema()` as the extraction contract, apply it client-side to the transcript, and feed the same four-value verdict into `release()`. The rule that matters is the enum, not where it is enforced.

## Why the correction is asynchronous

A phone call takes minutes. A chat reply takes seconds. Any design that blocks the answer on the call either hides a multi minute wait behind a chat bubble or gives up on calling at all.

So the gate answers immediately with a provisional answer, places the call, and writes the correction back when the terminal event arrives. `metadata.claim_id` is what makes that write back possible, and it is the reason the claim record exists at all.

## Schema rules that matter

The extraction model receives the schema, including every `description`. The supported subset is `type`, `properties`, `required`, `enum`, nested objects, simple `array.items`, `description`, and `additionalProperties: false`. Not supported: `$ref`, `oneOf`, `anyOf`, `allOf`, and recursion.

Two consequences this skill depends on:

- Prefer string enums to booleans for any decision that can be unclear. `accepts_plan: false` cannot distinguish "no" from "nobody knew".
- Always include an `unknown` enum member, and spend a sentence in its `description` telling the extractor when to choose it. Without that sentence the model picks the nearest confident label.

Field descriptions guide extraction but do not validate. Hard validation comes from `type`, `required`, `enum`, and `additionalProperties`.

## Regions

Outbound support is a published list of countries served by either a local line or an international line, and that list changes. An unsupported destination fails closed rather than dialing. Treat a fail closed pre-check as a blocked claim: the provisional answer stands, and the user is told the region is not callable rather than being told the fact could not be confirmed for some unstated reason.
