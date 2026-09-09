# Examples

All phone numbers below are reserved fictional numbers. Every example runs
with no credentials, no network, and places no call.

## Example 1: compose a verification call task from a goal

`goal.json`:

```json
{
  "item": "XZ-420 compressor",
  "targetEquipment": "ACME HVAC-200",
  "constraints": [
    { "kind": "availability" },
    { "kind": "compatibility" },
    { "kind": "price_max", "params": { "max": 25000, "currency": "INR" } },
    { "kind": "pickup_today" },
    { "kind": "hold_until", "params": { "until": "5 PM" } }
  ],
  "authorizedActions": [
    "ask_question", "request_availability", "request_pricing",
    "request_pickup_window", "request_hold"
  ],
  "candidate": { "name": "Example Components", "phone": "+15550101234" }
}
```

```bash
node scripts/build-call-task.mjs goal.json
```

Emits the composed task text and the strict `resultSchema`. The task opens
with the disclosure, carries one question per hard constraint plus a fallback
question for the hedge-prone ones, and ends with the safety footer. Nothing
is dialled.

Exit codes: `0` ok, `1` invalid goal, `2` authorization violation,
`3` prohibited side-effect phrase. Remove `request_hold` from
`authorizedActions` and the hold question disappears rather than being asked
without permission:

```bash
# authorizedActions without "request_hold" -> exit 2
node scripts/build-call-task.mjs goal-no-hold.json
```

## Example 2: refuse a published Goal that cannot answer the question

A published CALL-E Goal owns its own version-pinned `resultSchema`. It can be
healthy and still be structurally unable to settle a hard constraint, because
no declared field can carry the answer. Running it anyway spends a real call
on a real person and returns a constraint that can only ever be UNKNOWN.

`published-goal.json` — a stock-check Goal with no hold or compatibility
field:

```json
{
  "id": "goal_example_stock_check",
  "title": "Example stock check",
  "publishedRunSpec": {
    "id": "runspec_1",
    "version": 2,
    "inputSchema": {
      "type": "object",
      "required": ["item"],
      "properties": { "item": { "type": "string" } }
    },
    "resultSchema": {
      "type": "object",
      "properties": {
        "in_stock": { "type": "string" },
        "quoted_price": { "type": "number" }
      }
    }
  }
}
```

```bash
node scripts/check-goal-compatibility.mjs goal.json --spec published-goal.json
```

```json
{
  "goal": "Example stock check",
  "runSpecVersion": 2,
  "compatible": false,
  "bindings": [
    { "kind": "availability", "resultField": "in_stock" },
    { "kind": "price_max", "resultField": "quoted_price" }
  ],
  "unanswerable": [
    { "kind": "compatibility", "lookedFor": ["compatibility", "compatible", "fits"] },
    { "kind": "pickup_today", "lookedFor": ["pickup_available", "pickup_today", "can_pickup"] },
    { "kind": "hold_until", "lookedFor": ["hold_confirmed", "hold_available", "will_hold"] }
  ],
  "missingVariables": [],
  "declaredResultFields": ["in_stock", "quoted_price"]
}
```

Exit code `2`, with a message naming the constraints that have nowhere to
land. **Do not run that Goal**: the call would happen and the answer would
still be missing.

Note that `availability` bound to `in_stock` and `price_max` to
`quoted_price` — binding is family-based, so a Goal may name its fields its
own way.

Give it a Goal that also declares `compatibility`, `pickup_available` and
`hold_confirmed`, and the same command exits `0`:

```
COMPATIBLE — "Example supplier verification" v4 can answer all 4 phone-derived constraint(s).
```

Check a live Goal instead of a saved document with
`--goal-id goal_abc123` and `CALLE_API_KEY` set. That path is read-only
(`goals.get`); it places no call and spends no credit.

## Example 3: a full run, offline

```bash
MOCK_CALL_E=true pnpm dev     # deterministic mock CALL-E, no credentials
```

```bash
curl -s localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"input":"Find a genuine XZ-420 compressor for an ACME HVAC-200 within 25 km. It must be compatible, available today, under 25000, and the supplier must hold it until 5 PM. You may request a hold, but do not purchase anything."}'

curl -s -X POST localhost:3000/api/tasks/$TASK_ID/start
curl -s -X POST localhost:3000/api/tasks/$TASK_ID/tick   # repeat until completed
```

Six fictional suppliers are contacted in priority order. Watch for the three
behaviours that matter:

- one supplier hedges ("I think we have it") and the constraint stays
  `unknown` — it never becomes verified;
- one has the hold pending a manager, so a **follow-up call is generated from
  state**, not from a script, and the hold resolves on the second call;
- two suppliers are never called at all, because a candidate satisfied every
  hard requirement and the run stopped early.

The final `decision` is `success`, `partial`, or `no_match`, and every
verified claim carries `evidenceIds` into the `evidence` array with the
CALL-E call id, the supplier's own words, and a confidence score.

## Example 4: the honest failure

Same request, different morning — the winning supplier sold out:

```bash
curl -s localhost:3000/api/tasks -H 'content-type: application/json' \
  -d '{"input":"...","scenarioId":"compressor_failure"}'
```

Every candidate fails a hard requirement or stays unknown, and the run ends
`NO FULLY VERIFIED MATCH` with a per-candidate reason. That report is the
result. A verification agent that cannot return "no" is not a verification
agent.
