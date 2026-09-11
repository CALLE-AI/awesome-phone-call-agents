# Examples

All numbers below are in the `+1555` range reserved for fiction.

## Plan before dialing

Always start here. `plan_hold` compiles the task, validates every number, and
reports what the freshness ledger already answers. It dials nothing.

```json
{
  "goal": "Ask whether the practice is accepting new patients this month.",
  "routingHint": "Reach the front desk.",
  "workflow": "intake",
  "intent": "capacity-check",
  "batchId": "intake-2026-09-07",
  "targets": [
    { "subjectId": "clinic-north", "phone": "+15550199001", "label": "Northside Clinic" },
    { "subjectId": "clinic-east", "phone": "+15550199007", "label": "Eastgate Family" }
  ],
  "fields": [
    { "name": "accepts_new_patients", "asks": ["new patients", "accepting new", "taking patients"] }
  ]
}
```

Response:

```json
{
  "task": "Reach the front desk. Ask whether the practice is accepting new patients this month. Say you are an automated assistant when a person answers.",
  "taskChars": "148/255",
  "droppedSegments": [],
  "idempotencyKey": "hl1_5f2b...",
  "dialable": [
    { "subjectId": "clinic-north", "phone": "+15••••01", "label": "Northside Clinic", "routeHint": null },
    { "subjectId": "clinic-east", "phone": "+15••••07", "label": "Eastgate Family", "routeHint": null }
  ],
  "rejected": [],
  "alreadyAnswered": [],
  "stillNeedsCalling": 2,
  "note": "Nothing was dialed. Call run_hold with confirm: true to place these calls."
}
```

`taskChars` is worth reading. The API caps `task` at 255 characters; when a
goal is long, `droppedSegments` names what was cut to make room. The routing
hint is dropped before anything required.

## A number that will not be dialed

Undialable targets are separated during planning, before any dispatch.

```json
{
  "targets": [
    { "subjectId": "clinic-north", "phone": "+15550199001" },
    { "subjectId": "typo", "phone": "+1 555 019 9002" },
    { "subjectId": "wrong-list", "phone": "+19110000000" }
  ]
}
```

```json
{
  "dialable": [{ "subjectId": "clinic-north", "phone": "+15••••01" }],
  "rejected": [
    { "subjectId": "typo", "maskedPhone": "[redacted-phone]", "reason": "contains_whitespace" },
    { "subjectId": "wrong-list", "maskedPhone": "+19••••00", "reason": "blocked_prefix" }
  ]
}
```

`blocked_prefix` is an emergency or crisis line. It is refused unconditionally
and no configuration permits it.

## Placing the calls

`run_hold` takes the same arguments plus `confirm`. Without it, nothing dials:

```json
{ "refused": "confirm was not true",
  "note": "run_hold places real phone calls to real people. Set confirm: true in the same request, or use plan_hold to see what would happen." }
```

With `confirm: true`, each target is judged separately:

```json
{
  "outcome": "completed",
  "callId": "call_9RtQ2",
  "replayed": false,
  "targets": [
    {
      "subjectId": "clinic-north",
      "phone": "+15••••01",
      "verdict": "verified",
      "result": { "accepts_new_patients": "yes" },
      "unsupportedFields": [],
      "reasons": []
    },
    {
      "subjectId": "clinic-east",
      "phone": "+15••••07",
      "verdict": "needs_human",
      "result": { "accepts_new_patients": null },
      "unsupportedFields": ["accepts_new_patients"],
      "reasons": ["`accepts_new_patients` carries a value the call never asked about."]
    }
  ]
}
```

The second clinic is the case this skill exists for. The call returned a
confident, schema-valid answer, and no turn in the transcript asked the
question. The value is withheld and the reason is stated.

## Re-running the same batch

The idempotency key comes from `workflow`, `intent` and `batchId` — never from
a timestamp. Running the same batch again fetches the call that already
happened instead of dialing a second time:

```json
{ "outcome": "completed", "callId": "call_9RtQ2", "replayed": true }
```

To deliberately call the same places again, change `batchId` to the new
authorizing record, for example `intake-2026-10-01`.

## An outcome nobody knows

```json
{
  "outcome": "unresolved",
  "callId": "call_9RtQ2",
  "classification": {
    "class": "reconcile",
    "code": "wait_timeout",
    "reason": "The wait timed out. The call may still dial and complete. Fetch the call by id and reconcile before any further action.",
    "reuseIdempotencyKey": true
  },
  "note": "Not retried. An unknown call outcome is reconciled, never re-dialed — a second dispatch would ring a second person."
}
```

Report this and stop. Use `get_verdict` with the call id once it settles. Do
not re-run `run_hold` hoping for a cleaner answer.

## Checking a call afterwards

```json
{ "callId": "call_9RtQ2", "subjectId": "clinic-north",
  "fields": [{ "name": "accepts_new_patients", "asks": ["new patients"] }] }
```

```json
{
  "verdict": "verified",
  "result": { "accepts_new_patients": "yes" },
  "fields": [
    {
      "field": "accepts_new_patients",
      "verdict": "verified",
      "supportingTurn": "Are you accepting new patients at the moment?",
      "note": "A bot turn raised this topic and a usable answer came back."
    }
  ],
  "secondsOnHold": 208
}
```

`supportingTurn` quotes the exact turn the probe matched. If that quote is not
the question you meant to ask, the probe is matching the wrong thing — see
`references/probes.md`.

`secondsOnHold` is how long the agent waited before a person answered. Passing
`subjectId` records it, along with the menu path, so the next call to that
place starts with a route hint.

## Trying it without an account

The tools are served by an MCP server in a separate repository. This skill
directory is documentation and contains no runnable code, so these commands are
for a clone of that repository, not for here:

```bash
git clone https://github.com/Elioz404/HOLDLINE && cd HOLDLINE && npm install
HOLDLINE_SIMULATE=1 npm run mcp
```

Every response then carries `simulated: true` and a notice that no telephone
was involved. Use it to check probe wording and read the shape of a verdict.
Never report simulated output as a finding.
