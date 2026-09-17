# Ambiguous Outcomes

A dispatch whose outcome is unknown is the most dangerous state in a workflow that spends money. This document exists because the instinct on encountering one is to retry, and that instinct is wrong.

## The Four Outcomes

| Outcome | Meaning | Next step |
| --- | --- | --- |
| `answered` | The call connected and returned a schema-valid result | Validate, then approve or act |
| `declined` | The vendor cannot or will not take the job | Try the next vendor, as a new authorized dispatch |
| `no_answer` | The provider confirms nobody answered | Retry is permitted, under an explicit attempt cap |
| `unknown` | It is not established whether a call happened or what was said | **Stop. A person reconciles it.** |

`no_answer` and `unknown` look similar and are not. `no_answer` is a fact reported by the provider. `unknown` is the absence of a fact.

## What Produces `unknown`

- The client timed out while waiting for the provider to accept the request.
- The provider accepted the call but no terminal event ever arrived.
- A webhook was received but failed signature or schema validation.
- The process crashed between dialling and recording the result.
- The provider returned an error whose retry-safety is not documented.

In every one of these, the call may already have happened.

## Why Retrying Is Wrong

A client-side timeout tells you about your client, not about the vendor's telephone.

The concrete failure: a client abandons the request after 15 seconds. The provider had already accepted it and dialled. The retry path constructs a fresh dispatch, which mints a fresh idempotency key, which the provider correctly treats as a new call. The vendor's phone rings twice, quotes twice, and now two commitments exist for one job. The recipient experiences it as harassment.

Two fixes, both required:

1. **Set the client timeout above the provider's own acceptance latency.** Placing a call is not a fast operation. Tens of seconds is normal. A 15-second timeout is a bug.
2. **Never mint a new identity on retry.** See `references/idempotency.md`.

## Handling `unknown`

1. Record the state as `unknown` with the timestamp and the last known provider reference.
2. Do not redial. Do not schedule a redial. Do not offer the user a one-click redial without showing them that a call may already have been placed.
3. Surface it in whatever queue a human actually reads.
4. If the provider offers a call-status lookup, poll it before concluding anything. A lookup is cheap. A duplicate call is not.
5. Reconciliation is a human action: someone checks with the vendor, then records what actually happened.

## The Principle

**Ambiguity is a state, not an error.**

Errors get retried. States get resolved. Naming this state, giving it a place in the schema, and refusing to let any automatic path act on it is the difference between a workflow that fails safely and one that fails expensively.
