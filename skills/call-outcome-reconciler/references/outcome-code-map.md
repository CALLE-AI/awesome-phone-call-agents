# The Mapping Table

`outcome-code-map.yaml`, at the root of this skill, is the only place upstream
status values are given a semantic meaning. No mapping logic lives anywhere
else. To track upstream changes, edit that file; no code path needs to change.

The Python companion app ships a synchronised copy so it stays installable on
its own. Update it with:

```bash
node skills/call-outcome-reconciler/scripts/sync-mapping.mjs
node skills/call-outcome-reconciler/scripts/sync-mapping.mjs --check   # verify only
```

The app's test suite fails if the two copies drift.

## Why entries are keyed by surface

A CALL-E status value is only meaningful together with the surface it was read
from. `completed` on one surface and `COMPLETED` on another are different
vocabularies, and one is published while the other is not. Without surface
keying, a rule written for one surface would silently fire on a payload from
another, which is exactly the invention this layer refuses to do.

| Surface | Status field | Documented upstream |
| --- | --- | --- |
| `rest.calls` | `status` | Yes. `CallStatus` is a five-value enum in the v0.6.0 OpenAPI contract. |
| `rest.goal_runs` | `status` | Yes. `GoalRunStatus` is a five-value lifecycle enum; `GoalRunError.code` is an eight-value failure enum. |
| `mcp.get_call_run` | `status` | No. Uppercase values that appear in neither the OpenAPI contract nor the documentation site. |

On `rest.goal_runs` the observed payload is a whole `GoalRun`, preserved
verbatim. Polling follows `GoalRunStatus`, and meaning is read from the nested
`error.code`. The two are deliberately kept apart: an error code is not a
lifecycle state and never governed when to stop polling.

## Field paths

`status_field`, every `match` key and every guard `field` is a dot-separated
path into the observed payload. A segment ending in `[]` descends into a list
and fans out over its elements, and the rule must then hold for **all** of them.
A path with no `[]` behaves exactly like a plain top-level key.

| Path | Reaches |
| --- | --- |
| `status` | the top-level status field |
| `error.code` | `GoalRunError.code` on a `GoalRun` |
| `recipients[].attempts[].transcript_turns` | every attempt on a `CallTask` |

Resolution is total: a missing branch contributes nothing rather than raising,
so an unexpected payload shape can never make a rule throw. A path that resolves
to nothing never matches, so an unknown key still cannot fall through to a
default.

## The two tiers

**`entries`** are documented cases and the only source of a semantic outcome.
Every entry must carry `documented: true` and cite a `source`. The loader rejects
the file outright if an entry is marked `documented: false` — undocumented values
belong in the second tier.

| Entry id | Match | Outcome |
| --- | --- | --- |
| `rest.calls.completed` | `status: completed` | `completed` |
| `rest.calls.canceled` | `status: canceled` | `cancelled` |
| `rest.goal_runs.no_answer` | `error.code: no_answer` | `not_connected` |
| `rest.goal_runs.declined` | `error.code: declined` | `declined` |
| `rest.goal_runs.canceled` | `error.code: canceled` | `cancelled` |
| `rest.goal_runs.completed` | `status: completed` **and** `error: null` | `completed` |
| `rest.goal_runs.status_canceled` | `status: canceled` **and** `error: null` | `cancelled` |

The last two carry `error: null` deliberately. A Goal Run that reports an error
is described by that error, not by its lifecycle state, so they never pre-empt
the error-code entries above or the unmappable error codes below.

**`unmappable`** records values that are published but carry no documented
outcome meaning. These never produce a semantic outcome. They exist so the
decision trail can say precisely why no mapping applied instead of reporting a
generic miss.

| Item id | Match | Resolves to |
| --- | --- | --- |
| `rest.calls.failed` | `status: failed` | `unresolved` / `undocumented_failure_detail` |
| `rest.goal_runs.call_failed` | `error.code: call_failed` | `unresolved` / `ambiguous_documented_code` |
| `rest.goal_runs.timed_out` | `error.code: timed_out` | `unresolved` / `ambiguous_documented_code` |
| `rest.goal_runs.result_invalid` | `error.code: result_invalid` | `unresolved` / `result_error_not_call_outcome` |
| `rest.goal_runs.result_unavailable` | `error.code: result_unavailable` | `unresolved` / `result_error_not_call_outcome` |
| `rest.goal_runs.result_failed` | `error.code: result_failed` | `unresolved` / `result_error_not_call_outcome` |

## Consistency guards

A guard fires before mapping. When it matches, the observation resolves to
`unresolved` with the guard's reason even if an entry would otherwise have
matched. Guards encode contradictions visible in the payload itself; they never
infer intent.

| Guard id | Surface | Fires when | Resolves to |
| --- | --- | --- | --- |
| `guard.declined_without_media` | `mcp.get_call_run` | `DECLINED`, `started_at` equals `ended_at`, no `transcript` | `unresolved` / `inconsistent_payload` |
| `guard.declined_without_elapsed_time` | `mcp.get_call_run` | `DECLINED`, `duration_seconds: 0`, no `transcript` | `unresolved` / `inconsistent_payload` |
| `guard.completed_without_completion_time` | `rest.calls` | `completed` with no `completed_at` | `unresolved` / `inconsistent_payload` |
| `guard.completed_without_media` | `rest.calls` | `completed`, but every attempt has `started_at == completed_at` and empty `transcript_turns` | `unresolved` / `inconsistent_payload` |

Guards fire on the **first** match, so several narrow guards are preferable to
one wide clause list: each states one contradiction and names it in the decision
trail. The two `DECLINED` guards are the same contradiction in the two forms
this repository has observed the MCP surface report elapsed time.

Supported predicates are `equals`, `in`, `absent`, `absent_or_empty`, and
`equals_field`. The loader rejects any other predicate, which keeps guards
declarative and auditable.

`equals_field` compares two paths pairwise **inside the same repeated node**, so
one attempt's `started_at` is never compared to another attempt's
`completed_at`; the loader rejects operands drawn from different scopes. A pair
of absent or null values never satisfies it, because a queued attempt has
neither timestamp and that is not evidence of anything.

A guard on an undocumented surface must cite a `source` for the fields it reads.
The MCP guards cite `apps/shared/fake-mcp-broker-server.mjs` and
`extract_server_duration` in `apps/python/batch-runner/client.py` — observed
client behaviour in this repository, not a published contract, because this
surface has none.

## Terminality is operational, not semantic

Each surface declares which values end polling. That is a statement about when
to stop asking, not about what a value means. A value can be terminal for
polling and still have no documented meaning, in which case polling stops and
the outcome is `unresolved`. The undocumented MCP terminal values are recorded
from observed client behaviour in this repository, and the table says so.

## Updating the table

1. Edit `outcome-code-map.yaml`.
2. Bump `map_version`, and `upstream_contract_version` if the contract moved.
3. Run `node skills/call-outcome-reconciler/scripts/sync-mapping.mjs`.
4. Run the app's test suite. Malformed tables fail loudly at load time.

Adding a documented case is a one-entry change. Nothing else in the skill or the
app needs to be touched.
