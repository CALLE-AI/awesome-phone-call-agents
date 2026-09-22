# Examples: call-cross-call-consistency-checker

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks). Both fixtures
describe calls to the same fictional number (+1 415-555-0152).

## Example 1: a date that changed between calls (CONTRADICTIONS_FOUND)

Fixtures: `references/example-transcript-a.json` (delivery fee $45, Tuesday
the 15th, 2 p.m.) and `references/example-transcript-b.json` (same fee,
same time - but Wednesday the 16th, and the person notices).

Command:

```bash
python3 skills/call-cross-call-consistency-checker/scripts/cross_call_consistency_checker.py analyze \
  --transcript-a skills/call-cross-call-consistency-checker/references/example-transcript-a.json \
  --transcript-b skills/call-cross-call-consistency-checker/references/example-transcript-b.json
```

Output:

```json
{
  "call_a": null,
  "call_b": null,
  "skill": "call-cross-call-consistency-checker",
  "analysis_mode": "heuristic",
  "consistency_assessment": "assessed",
  "reason": null,
  "comparisons": [
    {
      "kind": "amount",
      "values_a": [
        "45"
      ],
      "values_b": [
        "45"
      ],
      "status": "CONSISTENT",
      "shared": [
        "45"
      ]
    },
    {
      "kind": "date",
      "values_a": [
        "tuesday",
        "15"
      ],
      "values_b": [
        "wednesday",
        "16"
      ],
      "status": "CONTRADICTED"
    },
    {
      "kind": "time",
      "values_a": [
        "1400"
      ],
      "values_b": [
        "1400"
      ],
      "status": "CONSISTENT",
      "shared": [
        "1400"
      ]
    }
  ],
  "contradiction_count": 1,
  "verdict": "CONTRADICTIONS_FOUND",
  "recommended_action": {
    "action": "verify_before_next_call",
    "guidance": "You are calling a person your organization has called before. You have records of what was said on previous calls. State amounts, dates, and times only as they appear in your record, and say where they come from: 'our record shows your delivery on Tuesday the 15th'. If the person mentions a different value than you just said, do not adopt theirs silently and do not insist on yours - say that the two differ, promise to check, and offer a callback with the verified answer. Never end a call with two unreconciled values and no acknowledgment of the difference."
  },
  "disclaimer": "Heuristic text-only comparison of agent-stated values. A CONTRADICTED kind may reflect a legitimately changed record - a rescheduled delivery, an updated price. Every contradiction routes to verification against the record, never to blame."
}
```

Note the design choices: only AGENT-stated values are compared (the
callee remembering "the 15th" is a correction, not a record), and a
legitimate reschedule phrasing ("moved from the 12th to the 15th") counts
as shared, not contradictory.

## Example 2: two calls that say the same thing (CONSISTENT)

Fixtures: `example-transcript-a.json` vs
`example-transcript-b-consistent.json`.

Command:

```bash
python3 skills/call-cross-call-consistency-checker/scripts/cross_call_consistency_checker.py analyze \
  --transcript-a skills/call-cross-call-consistency-checker/references/example-transcript-a.json \
  --transcript-b skills/call-cross-call-consistency-checker/references/example-transcript-b-consistent.json
```

Output:

```json
{
  "call_a": null,
  "call_b": null,
  "skill": "call-cross-call-consistency-checker",
  "analysis_mode": "heuristic",
  "consistency_assessment": "assessed",
  "reason": null,
  "comparisons": [
    {
      "kind": "amount",
      "values_a": [
        "45"
      ],
      "values_b": [
        "45"
      ],
      "status": "CONSISTENT",
      "shared": [
        "45"
      ]
    },
    {
      "kind": "date",
      "values_a": [
        "tuesday",
        "15"
      ],
      "values_b": [
        "tuesday",
        "15"
      ],
      "status": "CONSISTENT",
      "shared": [
        "tuesday",
        "15"
      ]
    },
    {
      "kind": "time",
      "values_a": [
        "1400"
      ],
      "values_b": [
        "1400"
      ],
      "status": "CONSISTENT",
      "shared": [
        "1400"
      ]
    }
  ],
  "contradiction_count": 0,
  "verdict": "CONSISTENT",
  "recommended_action": {
    "action": "continue",
    "guidance": "Agent-stated amounts, dates, and times match across the two calls."
  },
  "disclaimer": "Heuristic text-only comparison of agent-stated values. A CONTRADICTED kind may reflect a legitimately changed record - a rescheduled delivery, an updated price. Every contradiction routes to verification against the record, never to blame."
}
```

## Example 3: craft the consistency-guarded goal

Command:

```bash
python3 skills/call-cross-call-consistency-checker/scripts/cross_call_consistency_checker.py craft \
  --scenario consistency-guarded-callback
```

Output:

```json
{
  "skill": "call-cross-call-consistency-checker",
  "mode": "craft",
  "scenario": "consistency-guarded-callback",
  "language": "en",
  "goal": "You are calling a person your organization has called before. You have records of what was said on previous calls. State amounts, dates, and times only as they appear in your record, and say where they come from: 'our record shows your delivery on Tuesday the 15th'. If the person mentions a different value than you just said, do not adopt theirs silently and do not insist on yours - say that the two differ, promise to check, and offer a callback with the verified answer. Never end a call with two unreconciled values and no acknowledgment of the difference.",
  "notes": [
    "Heuristic skill: this template is a starting point; adapt wording to the case.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```
