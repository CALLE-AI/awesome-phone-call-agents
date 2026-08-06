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
| `rest.goal_runs` | `code` | Yes. `GoalRunError.code` is an eight-value enum. |
| `mcp.get_call_run` | `status` | No. Uppercase values that appear in neither the OpenAPI contract nor the documentation site. |

## The two tiers

**`entries`** are documented cases and the only source of a semantic outcome.
Every entry must carry `documented: true` and cite a `source`. The loader rejects
the file outright if an entry is marked `documented: false` — undocumented values
belong in the second tier.

| Entry id | Match | Outcome |
| --- | --- | --- |
| `rest.calls.completed` | `status: completed` | `completed` |
| `rest.calls.canceled` | `status: canceled` | `cancelled` |
| `rest.goal_runs.no_answer` | `code: no_answer` | `not_connected` |
| `rest.goal_runs.declined` | `code: declined` | `declined` |
| `rest.goal_runs.canceled` | `code: canceled` | `cancelled` |

**`unmappable`** records values that are published but carry no documented
outcome meaning. These never produce a semantic outcome. They exist so the
decision trail can say precisely why no mapping applied instead of reporting a
generic miss.

| Item id | Match | Resolves to |
| --- | --- | --- |
| `rest.calls.failed` | `status: failed` | `unresolved` / `undocumented_failure_detail` |
| `rest.goal_runs.call_failed` | `code: call_failed` | `unresolved` / `ambiguous_documented_code` |
| `rest.goal_runs.timed_out` | `code: timed_out` | `unresolved` / `ambiguous_documented_code` |
| `rest.goal_runs.result_invalid` | `code: result_invalid` | `unresolved` / `result_error_not_call_outcome` |
| `rest.goal_runs.result_unavailable` | `code: result_unavailable` | `unresolved` / `result_error_not_call_outcome` |
| `rest.goal_runs.result_failed` | `code: result_failed` | `unresolved` / `result_error_not_call_outcome` |

## Consistency guards

A guard fires before mapping. When it matches, the observation resolves to
`unresolved` with the guard's reason even if an entry would otherwise have
matched. Guards encode contradictions visible in the payload itself; they never
infer intent.

| Guard id | Fires when | Resolves to |
| --- | --- | --- |
| `guard.declined_without_media` | `mcp.get_call_run` reports `DECLINED` with `duration_seconds: 0` | `unresolved` / `inconsistent_payload` |
| `guard.completed_without_duration` | `rest.calls` reports `completed` with `duration_seconds: 0` | `unresolved` / `inconsistent_payload` |

Supported predicates are `equals`, `in`, `absent`, and `absent_or_empty`. The
loader rejects any other predicate, which keeps guards declarative and auditable.

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
