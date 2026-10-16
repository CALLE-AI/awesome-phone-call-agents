# Examples: call-post-summary-faithfulness-auditor

All commands run from the skill root
(`skills/call-post-summary-faithfulness-auditor`). Output below is real
CLI stdout, unedited.

## FAITHFUL - every claim anchors

```bash
python3 scripts/post_summary_faithfulness_auditor.py analyze \
  --call-result references/example-call-result.json
```

```json
{
  "call_id": "demo-faithful-001",
  "verdict": "FAITHFUL",
  "claims": [
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "outcome",
      "value": "confirm",
      "grade": "SUPPORTED",
      "turn_index": 0
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "numeric",
      "value": "4",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "oct 14",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "wednesday",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "14:00",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "A $20 deposit holds the table and the confirmation will be emailed.",
      "kind": "numeric",
      "value": "20",
      "grade": "SUPPORTED",
      "turn_index": 4
    },
    {
      "text": "A $20 deposit holds the table and the confirmation will be emailed.",
      "kind": "action",
      "value": "email",
      "grade": "SUPPORTED",
      "turn_index": 4
    }
  ],
  "counts": {
    "checkable": 7,
    "supported": 7,
    "unsupported": 0,
    "contradicted": 0
  },
  "coverage_gaps": [],
  "disclaimer": "Heuristic lexical anchoring, not semantic entailment. UNSUPPORTED means the claim value was not found verbatim in any transcript turn; it is not proof the claim is false. CONTRADICTED flags conflict with late callee speech under a fixed polarity rule. Route every finding to human verification against the call record."
}
```

## UNSUPPORTED_CLAIMS - fabricated values in the summary

```bash
python3 scripts/post_summary_faithfulness_auditor.py analyze \
  --call-result references/example-call-result-unsupported.json
```

```json
{
  "call_id": "demo-faithful-002",
  "verdict": "UNSUPPORTED_CLAIMS",
  "claims": [
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "outcome",
      "value": "confirm",
      "grade": "SUPPORTED",
      "turn_index": 0
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "numeric",
      "value": "4",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "oct 14",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "wednesday",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "14:00",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "A $20 deposit holds the table.",
      "kind": "numeric",
      "value": "20",
      "grade": "SUPPORTED",
      "turn_index": 4
    },
    {
      "text": "A $45 cleaning deposit was charged.",
      "kind": "numeric",
      "value": "45",
      "grade": "UNSUPPORTED",
      "turn_index": null
    },
    {
      "text": "The voucher will be mailed.",
      "kind": "action",
      "value": "mail",
      "grade": "UNSUPPORTED",
      "turn_index": null
    }
  ],
  "counts": {
    "checkable": 8,
    "supported": 6,
    "unsupported": 2,
    "contradicted": 0
  },
  "coverage_gaps": [],
  "disclaimer": "Heuristic lexical anchoring, not semantic entailment. UNSUPPORTED means the claim value was not found verbatim in any transcript turn; it is not proof the claim is false. CONTRADICTED flags conflict with late callee speech under a fixed polarity rule. Route every finding to human verification against the call record."
}
```

The `$45` charge and the voucher mailing appear in no transcript turn -
exactly the fabrication that would have flowed into a writeback.

## CONTRADICTED_CLAIMS - outcome conflicts with late callee speech

```bash
python3 scripts/post_summary_faithfulness_auditor.py analyze \
  --call-result references/example-call-result-contradicted.json
```

```json
{
  "call_id": "demo-faithful-003",
  "verdict": "CONTRADICTED_CLAIMS",
  "claims": [
    {
      "text": "The guest confirmed and the booking stands.",
      "kind": "outcome",
      "value": "confirm",
      "grade": "CONTRADICTED",
      "turn_index": null,
      "contradicted_by_turn": 3
    }
  ],
  "counts": {
    "checkable": 1,
    "supported": 0,
    "unsupported": 0,
    "contradicted": 1
  },
  "coverage_gaps": [],
  "disclaimer": "Heuristic lexical anchoring, not semantic entailment. UNSUPPORTED means the claim value was not found verbatim in any transcript turn; it is not proof the claim is false. CONTRADICTED flags conflict with late callee speech under a fixed polarity rule. Route every finding to human verification against the call record."
}
```

## FLAT SHAPE (unwrapped)

Some call records carry `post_summary` and `transcript` at the top level
instead of nested under `result`. The loader accepts both shapes.

```bash
python3 scripts/post_summary_faithfulness_auditor.py analyze \
  --call-result references/example-call-result-flat.json
```

```json
{
  "call_id": "demo-faithful-004",
  "verdict": "FAITHFUL",
  "claims": [
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "outcome",
      "value": "confirm",
      "grade": "SUPPORTED",
      "turn_index": 0
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "numeric",
      "value": "4",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "oct 14",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "wednesday",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "Guest confirmed party of 4 for Wednesday, October 14 at 2 p.m.",
      "kind": "date_time",
      "value": "14:00",
      "grade": "SUPPORTED",
      "turn_index": 2
    },
    {
      "text": "A $20 deposit holds the table and the confirmation will be emailed.",
      "kind": "numeric",
      "value": "20",
      "grade": "SUPPORTED",
      "turn_index": 4
    },
    {
      "text": "A $20 deposit holds the table and the confirmation will be emailed.",
      "kind": "action",
      "value": "email",
      "grade": "SUPPORTED",
      "turn_index": 4
    }
  ],
  "counts": {
    "checkable": 7,
    "supported": 7,
    "unsupported": 0,
    "contradicted": 0
  },
  "coverage_gaps": [],
  "disclaimer": "Heuristic lexical anchoring, not semantic entailment. UNSUPPORTED means the claim value was not found verbatim in any transcript turn; it is not proof the claim is false. CONTRADICTED flags conflict with late callee speech under a fixed polarity rule. Route every finding to human verification against the call record."
}
```

## NO_CHECKABLE_CLAIMS (opinion_only)

An opinion-only summary has nothing machine-checkable to anchor, so the
card routes on `reason: opinion_only` instead of guessing an outcome.

```bash
python3 scripts/post_summary_faithfulness_auditor.py analyze \
  --call-result references/example-call-result-no-checkable.json
```

```json
{
  "call_id": "demo-faithful-005",
  "verdict": "NO_CHECKABLE_CLAIMS",
  "reason": "opinion_only",
  "claims": [
    {
      "text": "The customer seemed satisfied and was polite throughout.",
      "kind": "non_checkable_opinion",
      "value": "",
      "grade": "NON_CHECKABLE",
      "turn_index": null
    }
  ],
  "counts": {
    "checkable": 0,
    "supported": 0,
    "unsupported": 0,
    "contradicted": 0
  },
  "coverage_gaps": [
    "outcome"
  ],
  "disclaimer": "Heuristic lexical anchoring, not semantic entailment. UNSUPPORTED means the claim value was not found verbatim in any transcript turn; it is not proof the claim is false. CONTRADICTED flags conflict with late callee speech under a fixed polarity rule. Route every finding to human verification against the call record."
}
```

## Craft - the faithful-summary goal

```bash
python3 scripts/post_summary_faithfulness_auditor.py craft \
  --task 'Confirm a restaurant reservation for a party of 4 on Wednesday October 14 at 2 p.m.' \
  --facts 'party of 4; Wednesday October 14; 2 p.m.; $20 deposit' \
  --outcome-token CONFIRMED
```

```text
GOAL: Confirm a restaurant reservation for a party of 4 on Wednesday October 14 at 2 p.m.. FACTS: party of 4; Wednesday October 14; 2 p.m.; $20 deposit.
SUMMARY DISCIPLINE: end the call by restating ONLY what was spoken aloud
- repeat numbers exactly as digit words (four, not 4-5)
- never introduce a value, date, name, or promise the other party did not say
- state the outcome word (CONFIRMED) exactly once in the final summary
```

A worked goal produced with these inputs ships as
`references/example-goal.txt`.
