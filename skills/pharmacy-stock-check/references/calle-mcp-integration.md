# CALL-E MCP integration notes

Behaviour observed while building a pharmacy stock-check workflow against the
CALL-E MCP surface. Written down because none of it is obvious from the tool
schemas, and each item cost debugging time.

Verified against a real completed run (GB, 107 seconds, `task_completed: true`,
confidence 0.82).

---

## The flow is a state machine

```
plan_call     → ready_to_run + confirm_token   (free — no call is placed)
run_call      → run_id                          (spends len(to_phones))
get_call_run  → poll until terminal
```

`run_call` and `get_call_run` return a structured `next_step` object whose
`action` field is an explicit instruction:

| `next_step.action` | Meaning |
| --- | --- |
| `poll_get_call_run` | Keep polling; honour `poll_after_seconds` |
| `wait_for_scheduled_run` | A scheduled run hasn't started yet |
| `ask_user_for_missing_info` | Blocked; `required_user_input` lists the fields |
| `ask_user_for_retry_confirmation` | Blocked on a retry decision |
| `plan_call_same_plan_id` | Re-plan, reusing the same `plan_id` |
| `report_result` | Terminal — report to the user |
| `report_blocked` | Terminal — cannot proceed |

Driving the loop off `next_step.action` rather than off status strings alone is
the cleanest way to integrate.

**Type gotcha:** `next_step` is a structured object on `run_call` and
`get_call_run`, but a plain **string** on `plan_call`. Type-guard before calling
`.get()` on it.

---

## Extraction lands in `result.summary`, not `result.extracted`

This is the biggest surprise on the surface.

`result.extracted` is documented as "Structured extracted data" with
`additionalProperties: true`. In practice it contains an echo of the **request**
plus telephony metadata:

```json
{
  "goal": "...",
  "region": "GB",
  "language": "English",
  "to_phones": ["+15550100"],
  "repair": { "decision": { ... } },
  "calling": { "duration_seconds": 107, "status": "finished", ... }
}
```

The fields the agent actually collected are in `result.summary`, serialised into
a string:

```text
Stock check completed. Result: in_stock=partial, form_available=both,
quantity_available=10, unit_price=5, currency=GBP, requires_prescription=yes,
can_hold=yes, hold_duration_hours=48, alternative_suggested=GPNHS/unclear,
pharmacist_notes=They have only 10 units available, less than the requested
21 capsules.
```

The agent honours the key names given in the `goal` prose reliably. They just
arrive as prose rather than as an object.

**Parsing:** split on `key=` boundaries using the known field names as
delimiters, never on commas — free-text fields like `pharmacist_notes` contain
commas and naive splitting corrupts them.

```python
import re

FIELDS = ["in_stock", "quantity_available", "unit_price", "pharmacist_notes"]
pattern = re.compile(
    r"\b(" + "|".join(sorted(FIELDS, key=len, reverse=True)) + r")\s*=\s*", re.I
)

def parse_summary(summary: str) -> dict[str, str]:
    matches = list(pattern.finditer(summary))
    out = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(summary)
        out[m.group(1).lower()] = summary[m.end():end].strip().strip(",").strip()
    return out
```

Sort field names longest-first so `unit_price` matches before `price`.

Check `result.extracted` for domain keys as a fallback in case this changes.

---

## There is no `result_schema` on MCP

The REST examples and the TypeScript SDK sample both show a `result_schema`
parameter with JSON Schema, plus a `resultValidation` field on the response.
`plan_call` on MCP accepts none of that — only `plan_id`, `to_phones`, `region`,
`language`, `goal`, `scheduled_at`, `retry_confirmation_action`, `user_input`
and `ttl_seconds`.

Steer extraction by naming the exact key names inside the `goal` text. It works
well, but there is no validation signal, so normalise and coerce client-side.

---

## `result.outcome` is the most useful part of the response

```json
{
  "task_completed": true,
  "completion_confidence": { "score": 0.82, "label": "high" },
  "evidence": [
    "The pharmacy confirmed availability of amoxicillin 500mg but only for 10 units.",
    "They stated both brand and generic were available at £5 per unit.",
    "They indicated a prescription is required and that the available units can be held for about two days."
  ]
}
```

This is what makes results safe to act on automatically — it tells you when not
to trust them. Surface the confidence score to the user rather than presenting
every result as equally certain.

Inference quality is good. In the run above the caller said "10 units" against a
request for 21 and the result is `partial`, not `yes`. "Just two days" became
`hold_duration_hours: 48`. Heavily disfluent speech still yielded
`unit_price=5, currency=GBP`.

---

## `to_phones` is an array, and batching is aggregated

One `plan_call` with ten numbers spends ten calls, and nothing in
`confirm_summary` states the cost before you commit.

More importantly, `result.summary` and the confidence block come back
**aggregated for the whole batch**. `result.batch` gives counts
(`total_calls`, `completed_calls`, `no_answer_calls`…) but not per-callee
extraction.

If your workflow needs to know *which* recipient said what — most do — place one
run per recipient and run them concurrently. The call cost is the same.

---

## Cost control

- Charge `len(to_phones)`, not 1, against any budget.
- Check the budget for the whole batch **before** dialling anything.
- `plan_id` is the idempotency key. Never issue `run_call` twice for one plan.
- `confirm_token` expires in roughly 24 hours; check `confirm_expires_at` before
  spending.
- `plan_call` is free. Iterate on goal wording at no cost.
- Persist every response the moment it lands. Never re-dial to recover data you
  already paid for.
- `ttl_seconds: 0` retains run records permanently, which is useful when the
  records are your evidence.

---

## Smaller things

**The activity feed is cumulative.** Every `get_call_run` poll returns the full
history from the beginning, and `next_cursor` was not populated. Dedupe on
`(ts, message)` client-side or a 100-second call will emit the same lines dozens
of times.

**Token cache shape is undocumented.** `calle auth status` reveals
`cache_path` (`~/.calle-mcp/cli/<hash>/token.json`) but not the JSON shape, so a
client has to probe key names defensively. A `calle auth token --json` emitting a
stable `{access_token, expires_at}` would remove the guesswork.

**Region support is finite.** US, SG, MY, IN, AE, AU, CA, GB, VN, DE, JP, FR,
MX, BR, ID, PH, KE at time of writing. Check before designing around a market.

---

## Suggested improvements

1. Populate `result.extracted` with the conversational fields and move the
   request echo to a separate key. This is likely a small change and would
   remove the most error-prone part of every integration.
2. Add `estimated_call_count` and remaining quota to the `plan_call` output so
   `confirm_summary` can state the cost. The confirmation step currently
   confirms intent without confirming spend.
3. Document the `next_step` state machine. It is the best-designed part of the
   API and it is not mentioned in the README.
4. Populate `next_cursor`, or honour `cursor`, for incremental activity fetch.
