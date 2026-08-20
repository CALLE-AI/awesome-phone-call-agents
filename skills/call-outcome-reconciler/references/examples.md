# Examples

Use fictional E.164 numbers in examples. These use `+15550101234`.

Every example below runs offline against a recorded fixture. None of them place
a call, and none of them need credentials.

```bash
cd apps/python/outcome-reconciler
```

## A documented completion

```bash
uv run python cli.py replay --fixture fixtures/happy.json
```

```json
{
  "outcome": "completed",
  "reason": null,
  "mapping": {
    "matched": true,
    "entry_id": "rest.calls.completed",
    "map_version": "2026-08-06",
    "surface": "rest.calls"
  }
}
```

The outcome names the entry that produced it. Every semantic outcome does.

## A documented no-answer

```bash
uv run python cli.py replay --fixture fixtures/no_answer.json
```

Resolves to `not_connected` via `rest.goal_runs.no_answer`. Note the surface:
the Goal Runs error vocabulary is the only place CALL-E publishes an enumerated
failure list, so documented failure outcomes are reachable only from there. The
observed payload is a whole `GoalRun`; the mapping reads `error.code` from it
and the rest is preserved untouched.

## A call that never finishes

```bash
uv run python cli.py replay --fixture fixtures/stuck.json --max-observations 5
uv run python cli.py explain --record out.json
```

```text
outcome         unresolved
reason          polling_budget_exhausted

observed states
  - rest.calls:queued
  - rest.calls:in_progress
  - rest.calls:in_progress
  - rest.calls:in_progress
  - rest.calls:in_progress

decision trail
  - evaluated the last payload observed on surface rest.calls
  - status 'in_progress' is not terminal on surface rest.calls; polling ended without a terminal state
```

The workflow gets a durable answer at the budget instead of hanging. The raw
payload is preserved, so reconciling the same reference later is always possible.

## A documented decline

```bash
uv run python cli.py replay --fixture fixtures/declined.json
```

Resolves to `declined` via `rest.goal_runs.declined`. Together with
`not_connected`, this is why the Goal Runs surface matters: it is the only place
CALL-E publishes a decline code, so it is the only place a decline can be
asserted rather than inferred.

## A decline with no media behind it

The case worth studying. Upstream reports a call as declined by the callee — but
it began and ended at the same instant, with no audio and no transcript.

```bash
uv run python cli.py replay --fixture fixtures/zero_duration_decline.json --output out.json
uv run python cli.py explain --record out.json
```

```text
outcome         unresolved
reason          inconsistent_payload

decision trail
  - evaluated the last payload observed on surface mcp.get_call_run
  - consistency guard guard.declined_without_media fired before mapping

notes
  - A DECLINED that began and ended at the same instant, with no transcript,
    carries no evidence that a person heard the call and refused it. It is
    indistinguishable from a pre-media transport failure, so it is not resolved
    to `declined`.
  - see upstream issue #82
```

A naive integration reports "the person declined" here, and a workflow acts on
it: no retry, no escalation, a lead marked as refused. This layer reports that
the payload contradicts itself and hands the decision back.

## A completion with no media behind it

The same contradiction on the documented Calls surface, where it is expressible
against the contract's own fields:

```bash
uv run python cli.py replay --fixture fixtures/completed_without_media.json --output out.json
uv run python cli.py explain --record out.json
```

```text
outcome         unresolved
reason          inconsistent_payload

decision trail
  - evaluated the last payload observed on surface rest.calls
  - consistency guard guard.completed_without_media fired before mapping
```

The call task says `completed`, but its only attempt has `started_at` equal to
`completed_at` and an empty `transcript_turns`. One attempt with real media
anywhere in the task is enough for the guard not to fire.

## An undocumented failure code

```bash
uv run python cli.py replay --fixture fixtures/unknown_failure_code.json
```

Resolves to `unresolved` with reason `undocumented_failure_detail`. The status
`failed` is documented, but the accompanying failure code has no published
enumeration, so no documented reason exists. The raw payload survives intact,
including fields this version does not recognise:

```json
{
  "status": "failed",
  "failure_code": "carrier_reject_42",
  "vendor_hint": "unrecognised-field-preserved"
}
```

Nothing was guessed, and nothing was lost.

## Transport errors are evidence, not outcomes

```bash
uv run python cli.py replay --fixture fixtures/flaky_transport.json
```

Three failed reads followed by a successful one. The outcome is `completed`; the
failures appear in `evidence.notes`. A transport error never becomes a semantic
outcome on its own.

## A request that times out

```bash
uv run python cli.py replay --fixture fixtures/plan_timeout.json
```

Resolves to `unresolved` with reason `plan_timeout`, distinct from an exhausted
budget. An exhausted budget means the call never reached a terminal state; a
timeout means the state could not be read at all.

## An undocumented terminal status

```bash
uv run python cli.py replay --fixture fixtures/mcp_completed.json
```

The MCP surface reports `COMPLETED`, which ends polling but has no published
meaning. Resolves to `unresolved` with reason `undocumented_code`. Terminality
is operational; it is not a licence to assign meaning.

## Inspecting the table

```bash
uv run python cli.py show-map
```

Prints each surface with whether it is documented, then the documented entries
and the published-but-unmappable values.

## Validating a record

```bash
uv run python cli.py replay --fixture fixtures/happy.json --output out.json
node ../../../skills/call-outcome-reconciler/scripts/validate-outcome-record.mjs --record out.json
```

## Against a live call

```bash
export CALLE_API_KEY=...    # never paste this into chat or commit it
uv run python cli.py reconcile --call-ref <call reference> --max-seconds 900
```

The key is only ever sent to `https://api.heycall-e.com` or to loopback. Any
other host is refused before the key is read, so a mistyped `--base-url` cannot
leak it.

Against a Goal Run, which is addressed by a pair:

```bash
uv run python cli.py reconcile \
  --surface rest.goal_runs \
  --goal-id <goal id> \
  --call-ref <GoalRun.id>
```

`--call-ref` is the `GoalRun.id` returned by create. The contract is explicit
that the nested telephone `run_id` is not valid in this path.

Exit codes: `0` resolved, `2` unresolved, `1` error. A workflow can branch on
the exit code without parsing the record.
