# Examples - call-list-capture-completeness-auditor

All commands run verbatim from the skill directory. Every output block
below is byte-real CLI output from a live run.

## 1. Craft a readback-disciplined goal

```bash
python3 scripts/list_capture_completeness_auditor.py craft --number +14155550149 --business-name "Harbor Grill" --task "confirm the reservation requests"
```

Output:

```json
{
  "goal_template": {
    "name": "readback-disciplined business call",
    "description": "Harbor Grill: confirm the reservation requests - with readback discipline protocol",
    "language": "en-US",
    "to": "+14155550149",
    "protocol": "Repeat the full list back item by item, in the order the caller gave. Ask 'Is that everything?' before closing. Never add items the caller did not state. If an item is unclear, ask a targeted question about that one item rather than re-asking the whole list. Write the final list into the summary exactly as confirmed.",
    "safety": "Fictional testing only. This template is not an order record or proof of what was promised."
  }
}
```

The `protocol` field drops into any plan_call goal so the agent knows,
before dialing, exactly how to confirm enumerated requests. The same
JSON ships as `data/example-goal.json`.

## 2. Analyze - ALL_ITEMS_CAPTURED (demo-list-001)

```bash
python3 scripts/list_capture_completeness_auditor.py analyze --call-result data/fixtures/demo-list-001.json
```

Output:

```json
{
  "skill": "call-list-capture-completeness-auditor",
  "mode": "analyze",
  "call_id": "demo-list-001",
  "verdict": "ALL_ITEMS_CAPTURED",
  "lists": [
    {
      "start_turn_index": 1,
      "items": [
        {
          "item": "crib",
          "stated_turn_index": 1,
          "note": null,
          "captured": true
        },
        {
          "item": "late checkout",
          "stated_turn_index": 1,
          "note": null,
          "captured": true
        },
        {
          "item": "high floor",
          "stated_turn_index": 1,
          "note": null,
          "captured": true
        }
      ]
    }
  ],
  "dropped_items": [],
  "added_items": [],
  "counts": {
    "lists_detected": 1,
    "items_total": 3,
    "items_captured": 3,
    "items_dropped": 0,
    "items_added": 0
  },
  "review_action": "none",
  "notes": "Heuristic text-only analysis of enumerated item lists and agent readback. Chunking and item matching are approximate for natural speech; every verdict routes to human review, never to automated claims about what was actually promised."
}
```

The callee listed three requests; the readback sentence repeats all
three in order and closes with "Is that everything?" - the passing
grade, counts confirm 3/3 captured with nothing added.

## 3. Analyze - ITEMS_DROPPED (demo-list-002)

```bash
python3 scripts/list_capture_completeness_auditor.py analyze --call-result data/fixtures/demo-list-002.json
```

Output:

```json
{
  "skill": "call-list-capture-completeness-auditor",
  "mode": "analyze",
  "call_id": "demo-list-002",
  "verdict": "ITEMS_DROPPED",
  "lists": [
    {
      "start_turn_index": 1,
      "items": [
        {
          "item": "crib",
          "stated_turn_index": 1,
          "note": null,
          "captured": true
        },
        {
          "item": "late checkout",
          "stated_turn_index": 1,
          "note": null,
          "captured": true
        },
        {
          "item": "high floor",
          "stated_turn_index": 1,
          "note": null,
          "captured": false
        }
      ]
    }
  ],
  "dropped_items": [
    {
      "item": "high floor",
      "stated_turn_index": 1
    }
  ],
  "added_items": [],
  "counts": {
    "lists_detected": 1,
    "items_total": 3,
    "items_captured": 2,
    "items_dropped": 1,
    "items_added": 0
  },
  "review_action": "add item-by-item readback to the goal template",
  "notes": "Heuristic text-only analysis of enumerated item lists and agent readback. Chunking and item matching are approximate for natural speech; every verdict routes to human review, never to automated claims about what was actually promised."
}
```

The readback captured only the crib and late checkout. The callee's own
restatement ("And the high floor.") does not rescue the grade - capture
counts agent turns only - so the high floor is a true omission and the
review action says add item-by-item readback.

## 4. Analyze - ITEMS_ADDED (demo-list-003)

```bash
python3 scripts/list_capture_completeness_auditor.py analyze --call-result data/fixtures/demo-list-003.json
```

Output:

```json
{
  "skill": "call-list-capture-completeness-auditor",
  "mode": "analyze",
  "call_id": "demo-list-003",
  "verdict": "ITEMS_ADDED",
  "lists": [
    {
      "start_turn_index": 1,
      "items": [
        {
          "item": "crib",
          "stated_turn_index": 1,
          "note": null,
          "captured": true
        },
        {
          "item": "late checkout",
          "stated_turn_index": 1,
          "note": null,
          "captured": true
        }
      ]
    }
  ],
  "dropped_items": [],
  "added_items": [
    {
      "item": "breakfast package",
      "turn_index": 2
    }
  ],
  "counts": {
    "lists_detected": 1,
    "items_total": 2,
    "items_captured": 2,
    "items_dropped": 0,
    "items_added": 1
  },
  "review_action": "remove unverifiable items from the confirmation script",
  "notes": "Heuristic text-only analysis of enumerated item lists and agent readback. Chunking and item matching are approximate for natural speech; every verdict routes to human review, never to automated claims about what was actually promised."
}
```

The callee listed two items; the confirmation sentence invents a third -
"the breakfast package" - that matches nothing the callee said. The
callee's vague "Uh, sure." is exactly how such an invention slips
through unverified, which is why the review action says remove it from
the confirmation script.

The fourth fixture, demo-list-004 (a plain date-change call with no
enumerated list), grades `NO_LIST_EXCHANGED` with `review_action`
"none"; it is covered by the test suite and the verdicts table in
SKILL.md.
