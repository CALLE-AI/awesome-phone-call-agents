# CALL-E platform surface map

What this integration actually uses of the CALL-E platform, what it
deliberately does not, and where behaviour is **unknown rather than
assumed**. Every vocabulary listed here is pinned to an implementation
constant by `tests/test_platform_surface_map.py`, so this page cannot drift
from the code. Platform facts were verified against the official
documentation and SDK source (checked 2026-09-04; see
`skills/warranty-recovery/references/calle-platform-notes.md` for the
research record). Two real calls are recorded: R1 and the owned-number
no-answer R4; everything else here is
adapter and contract behaviour verified by tests, labelled per row.
R8 and R3 were authorized failed attempts and are limitations, not evidence.

## 1. Calls API — the runtime surface

| Aspect | What this integration does | Evidence |
| --- | --- | --- |
| Client | `CalleClient` as a context manager, explicit HTTP timeout, key read only from `CALLE_API_KEY` | `Recorded CALL-E result` (R1) plus adapter tests against mocked SDK shapes |
| Creation | `calls.create` at most once per run, after every gate and the atomic ledger reservation; the vendor call id is persisted to the ledger before the first status read | `Recorded CALL-E result` (R1) |
| Polling | bounded poll of `calls.get` with a wall-clock deadline and injectable clock — never the SDK's `wait_for_result`, which sleeps on the real clock | `Synthetic scenario` (adapter tests) |
| Statuses | exactly `queued`, `in_progress`, `completed`, `failed`, `canceled`; an unrecognized status is a non-terminal transport needing human reconciliation | `Synthetic scenario`; R4 records the `failed` no-answer shape |
| Idempotency | a deterministic claim-version-bound key is sent on the one permitted create; same key + same request returns the original call (documented). Same key + **different body is not stated in public docs** — UNKNOWN; the local ledger suppresses both cases, and nothing depends on vendor behaviour | `Recorded CALL-E result` for the key discipline; the same-key/different-body row is a **known limitation**, not evidence |
| Cancellation | none — the Calls API documents no cancel operation; every control is in front of the create | public documentation (2026-09-04) |

## 2. Conditional Goal path

Goal is **probe-gated, never primary**. A GoalRun payload is evaluated by
`probe_goal_capability` against five named checks (documented speaker labels
with at least one `user` turn, extraction-compatible result shape, readable
statuses, keypad-plan support when a plan is supplied, complete
eight-error mapping against GET truth). Only a payload that passes may be
treated as equivalent to the Calls surface — and the payload must come from
a GET, never from an assertion about deployed Goal text.

The eight documented `GoalRun.error.code` values, each mapped to a fixed
`(transport, terminal, claim)` triple:

```text
call_failed · no_answer · declined · timed_out · canceled ·
result_invalid · result_unavailable · result_failed
```

`ClaimStatus` is UNKNOWN in every error row by design — an error is never a
stated status.

## 3. Webhook hints and GET truth

Webhooks are **hints, never truth**. `webhook_hint` accepts a payload only
for the terminal events `call.completed`, `call.failed`,
`call.result_validation_failed`; every other event is ignored.
`reconcile_hint` then re-reads the call via the GET seam and reconciles:
when GET agrees with the hint the run resolves; when they disagree, GET
wins and the disagreement is recorded; when GET cannot be read, the hint
resolves nothing. A hint never writes anything and never short-circuits a
human review.

## 4. Bounded keypad

A keypad plan is optional and **supplied, never discovered**. When one is
supplied, the adapter reports `MenuNavigation(plan_supplied, resolved)`:
`resolved` is `False` only when evidence says the menu did not resolve, and
`None` when no evidence stated either way. An unresolved supplied plan with
nothing established ends `MENU_UNRESOLVED`; discovered navigation never
classifies anything, and an unresolved-menu conclusion is never inferred
from a transport signal.

## 5. Typed errors

Transport failures carry the platform's own `failure_code` /
`failure_message` verbatim into `TransportOutcome` diagnostics, kept
separate from the business state. The validation layer names its own
failures (`RESULT_INVALID` with per-field errors); Goal errors use the
eight-code vocabulary above. Nothing invents a code the platform never
sent, and no error message ever carries key material.

## 6. Limitations and unknowns

- **Same-key/different-body create behaviour is UNKNOWN** — not stated in
  public documentation; the local ledger is the primary control and this
  integration claims only local suppression.
- **R8 and R3 attempted but produced no platform-behaviour evidence.** Each
  authorized attempt created one call with zero retries, then failed as a
  zero-duration `404`/`call_failed` with no transcript. They were sent
  `US`/`en-US` routing for `+91…` destinations; that defect is closed, but
  the carrier/platform cause is not independently proven.
- **R5–R9 recorded observations other than the failed R8 do not exist.**
  Every platform-behaviour row above that is not R1/R4 is `Synthetic
  scenario` — adapter tests against mocked SDK shapes — and is never presented as an observed platform fact.
- **Goal is not deployed or verified through the API**; the probe evaluates
  payloads, and repository prompt text is authored source, not proof of
  deployed text.
- **No cancel operation exists**; the cancellation story is entirely the
  pre-create gates.
- **Live runtime evidence is exactly two recorded calls (R1/R4)** — R1 is a
  controlled, consenting role-player with a synthetic business record; R4 is
  an owned no-answer destination. They prove controlled runtime integration,
  not platform-scale behaviour and not warranty-desk adoption.
