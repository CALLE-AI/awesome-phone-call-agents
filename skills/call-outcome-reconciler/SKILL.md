---
name: call-outcome-reconciler
description: Resolve how a CALL-E phone call actually ended by polling its call reference to exactly one terminal outcome, mapping only documented upstream cases and reporting ambiguous, undocumented, or never-terminating calls as an explicit unresolved result with the raw upstream payload preserved.
license: MIT
---

# Call Outcome Reconciler

A workflow built on CALL-E cannot always answer "how did this call end?" Calls
can stay in progress without a terminal state arriving. A zero-duration failure
before media is established can be reported as the callee declining, so
infrastructure failure looks identical to a person saying no. Failure codes on
the Calls surface have no published enumeration. Downstream automation then acts
on outcomes it cannot trust, and a hung call hangs the workflow indefinitely.

This skill adds a conservative client-side layer over CALL-E's public contract.
It turns a call reference into exactly one durable terminal outcome, and when
the public contract does not answer the question it says so explicitly instead
of guessing.

Canonical outcome and result semantics are defined upstream by CALL-E. This
skill asserts none of its own.

## When To Use

* A workflow needs a trustworthy answer to how a specific call ended.
* A call has been in progress longer than expected and the workflow is blocked.
* An outcome looks wrong — a decline with no duration, a failure with an
  unfamiliar code — and you need to know what upstream actually returned.
* You want an auditable record of a call outcome, including the evidence and the
  reasoning behind it.

## When Not To Use

This skill will not:

* **Define canonical result semantics.** Those belong upstream. This is a
  client-side reading of the public contract.
* **Place, retry, or cancel a call.** It reads the status of a call reference
  that already exists. Retry policy is a workflow decision for the caller.
* **Create schedules or recurring jobs.** Nothing runs in the background.
* **Infer an outcome from an undocumented code.** That is the whole design.

If you need to place a call, use a calling skill. If you need recurrence, the
host scheduler owns it.

## Inputs

| Input | Required | Notes |
| --- | --- | --- |
| Call reference | Yes | An upstream identifier for a call that already exists. On `rest.goal_runs` this is the `GoalRun.id`, not the nested telephone `run_id`. |
| Surface | No | `rest.calls` (default), `rest.goal_runs`, or `mcp.get_call_run`. |
| Base URL | No | Defaults to `https://api.heycall-e.com`. The API key is only ever sent there or to loopback; any other host is refused before the key is read. |
| Goal id | Only on `rest.goal_runs` | Identifies the Goal the run belongs to. |
| Budgets | No | Wall clock (default 900s) and observation count (default 60). |
| Recipient E.164 | No | Used only to render a masked value in the record. |

`declined` and `not_connected` are documented only on `rest.goal_runs`, because
`GoalRunError.code` is the sole enumerated failure vocabulary CALL-E publishes.
Reconciling a call on `rest.calls` can never produce them — that is a faithful
reading of the contract, not a gap in this skill.

## Output

One outcome record. Exactly one of six outcomes, a machine-readable reason when
unresolved, the mapping entry that produced the outcome, the observation
history, and the raw upstream payloads preserved verbatim.

| Outcome | Meaning |
| --- | --- |
| `completed` | Reached a terminal state documented as normal completion. |
| `not_connected` | Did not establish media for a documented reason. |
| `declined` | The callee actively declined, per a documented code. |
| `infrastructure_failure` | A documented pre-media or transport failure. |
| `cancelled` | The caller cancelled before completion. |
| `unresolved` | Everything else, with the reason and the last raw payload. |

`unresolved` is a successful result, not an error. It means the question was
asked honestly and the public contract does not answer it. Read
[`references/outcome-contract.md`](references/outcome-contract.md) for the full
record shape and the guarantees a consumer can rely on.

## Workflow

1. Confirm the caller supplied a call reference for a call that already exists.
   This skill initiates nothing.
2. Preview offline first. Every scenario has a recorded fixture and needs no
   credentials — see [`references/examples.md`](references/examples.md).
3. Reconcile the real call reference, choosing budgets deliberately. Read
   [`references/polling-policy.md`](references/polling-policy.md) before changing
   them.
4. Branch on the outcome. Never coerce `unresolved` into a semantic outcome.
5. When an outcome needs justifying, print the decision trail with `explain`.

## Dry Run

Always preview before running against a live call reference. The preview makes
no network request and needs no credentials:

```bash
cd apps/python/outcome-reconciler
uv run python cli.py replay --fixture fixtures/zero_duration_decline.json
uv run python cli.py explain --record out.json
```

`explain` prints what was observed, which mapping entry matched or why none did,
and which budget tripped. It is the difference between a black box and a
reviewable answer.

## The Mapping Table

`outcome-code-map.yaml`, at the root of this skill, is the only place upstream
values are given a meaning. No mapping logic lives anywhere else. Documented
cases sit in `entries`; published values with no documented meaning sit in
`unmappable` and never produce a semantic outcome. Entries are keyed by surface,
because the same word carries different vocabularies on different surfaces.

Tracking an upstream change is a one-entry edit to that file. Read
[`references/outcome-code-map.md`](references/outcome-code-map.md) for the
structure, the current entries, and how to update them.

After editing, synchronise the companion app's copy:

```bash
node skills/call-outcome-reconciler/scripts/sync-mapping.mjs
node skills/call-outcome-reconciler/scripts/sync-mapping.mjs --check
```

## Companion App

The runnable [`outcome-reconciler`](../../apps/python/outcome-reconciler/) app
implements this behaviour and makes the failure paths inspectable. Its default
test suite runs against a local fake status server and requires no CALL-E
credentials.

Validate any record against the contract:

```bash
node skills/call-outcome-reconciler/scripts/validate-outcome-record.mjs --record out.json
```

## Safety Rules

* **This skill places no calls.** It reads the status of an existing call
  reference and holds no recipient list.
* Act only on a call reference the caller supplied. Initiate nothing.
* Mask phone numbers in every summary: `+1555010****`. Use fictional numbers such
  as `+15550101234` in examples.
* An outcome record preserves the upstream payload verbatim, which may include an
  unmasked number. Treat a record as call data; redact before sharing it.
* Never print, log, or persist credentials, and never ask a user to paste a token
  into chat.
* Create no schedules and no background jobs. Polling runs in the foreground and
  stops when interrupted, so there is nothing to cancel afterwards.
* Stop rather than guess. An undocumented value is never translated into a
  semantic outcome.
* Treat medical, legal, financial, and emergency calls as logistics only. An
  `unresolved` outcome on such a call belongs to a human, not to automation.

Read [`references/safety.md`](references/safety.md) for the full safety contract,
including how to handle records that contain raw upstream fields.

## Output Format

Report the outcome, the reason when unresolved, the masked recipient, and the
mapping entry id when one matched. State plainly that no call was placed. When
the outcome is `unresolved`, say what would resolve it: reconciling again later,
or a documented upstream code that does not yet exist.
