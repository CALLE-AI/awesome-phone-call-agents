# Examples - call-arithmetic-accuracy-auditor

All commands run verbatim from the skill directory. Every output block
below is byte-real CLI output from a live run.

## 1. Craft a factors-first goal

```bash
python3 scripts/arithmetic_accuracy_auditor.py craft --number +14155550135 --business-name "Harbor Grill" --task "confirm the Friday reservation total"
```

Output:

```json
{
  "goal_template": {
    "name": "arithmetic-accurate business call",
    "description": "Harbor Grill: confirm the Friday reservation total - with factors-first arithmetic protocol",
    "language": "en-US",
    "to": "+14155550135",
    "protocol": "Arithmetic protocol: state the quantities and unit prices aloud BEFORE any total; compute the total yourself before speaking it; read every total digit by digit (for example, three six zero dollars); if you are unsure of a total, state the line items separately and offer to confirm the sum in writing; never round a total up.",
    "safety": "Fictional testing only. This template is not a pricing or billing system."
  }
}
```

The `protocol` field drops into any plan_call goal so the agent knows, before dialing, to state quantities and unit prices before any total and to read totals digit by digit. The same JSON ships as `data/example-goal.json`.

## 2. Analyze - ALL_COMPUTATIONS_CORRECT (demo-arith-001)

```bash
python3 scripts/arithmetic_accuracy_auditor.py analyze --call-result data/fixtures/demo-arith-001.json
```

Output:

```json
{
  "skill": "call-arithmetic-accuracy-auditor",
  "mode": "analyze",
  "call_id": "demo-arith-001",
  "verdict": "ALL_COMPUTATIONS_CORRECT",
  "computations": [
    {
      "turn_index": 0,
      "kind": "multiply",
      "sentence": "I see 3 nights at 120 dollars a night, so that comes to 360 dollars total.",
      "factors": {
        "qty": 3,
        "unit_price": 120.0
      },
      "stated_result": 360.0,
      "computed_result": 360.0,
      "delta": null,
      "status": "CORRECT",
      "reason": null
    },
    {
      "turn_index": 2,
      "kind": "add",
      "sentence": "There is also a 45 dollar cleaning fee, so 360 and 45 comes to 405 dollars.",
      "factors": {
        "operands": [
          360.0,
          45.0
        ]
      },
      "stated_result": 405.0,
      "computed_result": 405.0,
      "delta": null,
      "status": "CORRECT",
      "reason": null
    }
  ],
  "counts": {
    "detected": 2,
    "correct": 2,
    "incorrect": 0,
    "unverifiable": 0
  },
  "review_action": "none"
}
```

Both spoken computations recompute cleanly from the agent's own stated factors: 3 nights x 120 = 360, then the line-item sum 360 + 45 = 405 - the passing grade.

## 3. Analyze - ARITHMETIC_ERRORS_FOUND (demo-arith-002)

```bash
python3 scripts/arithmetic_accuracy_auditor.py analyze --call-result data/fixtures/demo-arith-002.json
```

Output:

```json
{
  "skill": "call-arithmetic-accuracy-auditor",
  "mode": "analyze",
  "call_id": "demo-arith-002",
  "verdict": "ARITHMETIC_ERRORS_FOUND",
  "computations": [
    {
      "turn_index": 0,
      "kind": "multiply",
      "sentence": "I have you for 3 nights at 120 dollars a night, so that's 420 dollars total.",
      "factors": {
        "qty": 3,
        "unit_price": 120.0
      },
      "stated_result": 420.0,
      "computed_result": 360.0,
      "delta": 60.0,
      "status": "INCORRECT",
      "reason": null
    },
    {
      "turn_index": 2,
      "kind": "add",
      "sentence": "And with the 45 dollar cleaning fee, 420 and 45 comes to 465 dollars.",
      "factors": {
        "operands": [
          420.0,
          45.0
        ]
      },
      "stated_result": 465.0,
      "computed_result": 465.0,
      "delta": null,
      "status": "CORRECT",
      "reason": null
    }
  ],
  "counts": {
    "detected": 2,
    "correct": 1,
    "incorrect": 1,
    "unverifiable": 0
  },
  "review_action": "recompute spoken totals in the goal template before deployment"
}
```

The agent said 3 nights at 120 dollars "so that's 420 dollars total" - the factors give 360, a delta of 60. The follow-up sentence-sum 420 + 45 = 465 is sentence-locally correct, which is exactly why the audit recomputes each sentence: a confident line-item sum built on a wrong multiply hides the error from a human skimming the transcript.

## 4. Analyze - UNVERIFIABLE_COMPUTATIONS_ONLY (demo-arith-004)

```bash
python3 scripts/arithmetic_accuracy_auditor.py analyze --call-result data/fixtures/demo-arith-004.json
```

Output:

```json
{
  "skill": "call-arithmetic-accuracy-auditor",
  "mode": "analyze",
  "call_id": "demo-arith-004",
  "verdict": "UNVERIFIABLE_COMPUTATIONS_ONLY",
  "computations": [
    {
      "turn_index": 0,
      "kind": "add",
      "sentence": "Your total comes to 250 dollars.",
      "factors": {
        "operands": []
      },
      "stated_result": 250.0,
      "computed_result": null,
      "delta": null,
      "status": "UNVERIFIABLE",
      "reason": "FACTORS_MISSING"
    },
    {
      "turn_index": 2,
      "kind": "duration",
      "sentence": "The run goes from 9 to 11, that's 2 hours, all included.",
      "factors": {
        "start": "9",
        "end": "11"
      },
      "stated_result": 2.0,
      "computed_result": null,
      "delta": null,
      "status": "UNVERIFIABLE",
      "reason": "AMBIGUOUS_CLOCK"
    }
  ],
  "counts": {
    "detected": 2,
    "correct": 0,
    "incorrect": 0,
    "unverifiable": 2
  },
  "review_action": "state the factors aloud before the total so arithmetic can be verified"
}
```

A bare "250 dollars" total with no spoken factors, and a clock range with no meridiem ("from 9 to 11") - both route to UNVERIFIABLE with an explicit reason, and the review action asks the goal template to state factors aloud before totals.
