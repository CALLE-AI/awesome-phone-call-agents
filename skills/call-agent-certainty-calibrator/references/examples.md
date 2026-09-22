# Examples: call-agent-certainty-calibrator

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: an agent that invents a perk and hedges a record fact (MIXED)

Fixture: `references/example-transcript.json` analyzed against
`references/example-goal.txt` (fee $45, Tuesday the 15th, window at 2 p.m.).

Command:

```bash
python3 skills/call-agent-certainty-calibrator/scripts/agent_certainty_calibrator.py analyze \
  --transcript skills/call-agent-certainty-calibrator/references/example-transcript.json \
  --goal-file skills/call-agent-certainty-calibrator/references/example-goal.txt
```

Output:

```json
{
  "skill": "call-agent-certainty-calibrator",
  "analysis_mode": "heuristic",
  "calibration_assessment": "assessed",
  "reason": null,
  "goal_facts": {
    "amount": [
      "45"
    ],
    "date": [
      "tuesday",
      "15"
    ],
    "time": [
      "1400"
    ]
  },
  "over_assertions": [
    {
      "turn_index": 4,
      "kind": "date",
      "value": "friday",
      "sentence": "Also, you get free delivery on Friday because you are a loyal customer, and the pickup is Tuesday the 15th."
    }
  ],
  "over_hedges": [
    {
      "turn_index": 2,
      "kind": "time",
      "value": "1400",
      "sentence": "I think the window might open around 2 p.m., you would have to check."
    }
  ],
  "calibrated_statements": 3,
  "verdict": "MIXED",
  "recommended_action": {
    "action": "verify_unsourced_values",
    "guidance": "Agent statements did not match the goal facts. Over-asserted values may be invented specifics missing from the goal (verify before reuse); hedged record facts should be restated with their source. Compare with the record, not with the transcript alone."
  },
  "disclaimer": "Heuristic text-only analysis of value statements. An OVER-ASSERTED value may be true and merely missing from the goal text; an OVER-HEDGED fact may still have been understood. Findings route to verification against the record, never to assumptions about the agent's knowledge."
}
```

Both failure directions in one call: an unsourced specific ("free
delivery on Friday" - not in the goal, not from the callee) and a record
fact softened into "I think... might be around". Neither is blamed - both
route back to the record.

## Example 2: a fully calibrated call (CALIBRATED)

Fixture: `references/example-transcript-calibrated.json` - record facts
stated with their source, and an honest "I do not have that information"
for what the record lacks.

Command:

```bash
python3 skills/call-agent-certainty-calibrator/scripts/agent_certainty_calibrator.py analyze \
  --transcript skills/call-agent-certainty-calibrator/references/example-transcript-calibrated.json \
  --goal-file skills/call-agent-certainty-calibrator/references/example-goal.txt
```

Output:

```json
{
  "skill": "call-agent-certainty-calibrator",
  "analysis_mode": "heuristic",
  "calibration_assessment": "assessed",
  "reason": null,
  "goal_facts": {
    "amount": [
      "45"
    ],
    "date": [
      "tuesday",
      "15"
    ],
    "time": [
      "1400"
    ]
  },
  "over_assertions": [],
  "over_hedges": [],
  "calibrated_statements": 4,
  "verdict": "CALIBRATED",
  "recommended_action": {
    "action": "continue",
    "guidance": "Agent-stated values matched goal facts, plainly or with source attribution."
  },
  "disclaimer": "Heuristic text-only analysis of value statements. An OVER-ASSERTED value may be true and merely missing from the goal text; an OVER-HEDGED fact may still have been understood. Findings route to verification against the record, never to assumptions about the agent's knowledge."
}
```

## Example 3: craft the calibrated-wording goal

Command:

```bash
python3 skills/call-agent-certainty-calibrator/scripts/agent_certainty_calibrator.py craft \
  --scenario calibrated-fact-stating
```

Output:

```json
{
  "skill": "call-agent-certainty-calibrator",
  "mode": "craft",
  "scenario": "calibrated-fact-stating",
  "language": "en",
  "goal": "You are calling with a written record of the facts. Speak every amount, date, and time from the record plainly and attribute it: 'our record shows the fee is $45'. When you are confident because the record says so, say so - do not soften record facts with 'I think' or 'maybe'. When you do NOT have a fact in your record, say exactly that: 'I do not have that information, but a colleague can call you back with it.' Never invent a specific value, date, discount, or deadline to sound helpful - an invented specific is worse than an honest gap. If you must estimate, label it as an estimate: 'I believe it is around five days, but I will confirm.'",
  "notes": [
    "Heuristic skill: this template is a starting point; adapt wording to the case.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```

## Example 4: invented specifics on top of a correct record (OVERASSERTIVE)

Fixture: `references/example-transcript-overassertive.json` - the record
facts are stated perfectly, then the agent invents a loyalty program and a
deadline that exist nowhere in the goal.

Command:

```bash
python3 skills/call-agent-certainty-calibrator/scripts/agent_certainty_calibrator.py analyze   --transcript skills/call-agent-certainty-calibrator/references/example-transcript-overassertive.json   --goal-file skills/call-agent-certainty-calibrator/references/example-goal.txt
```

Output:

```json
{
  "skill": "call-agent-certainty-calibrator",
  "analysis_mode": "heuristic",
  "calibration_assessment": "assessed",
  "reason": null,
  "goal_facts": {
    "amount": [
      "45"
    ],
    "date": [
      "tuesday",
      "15"
    ],
    "time": [
      "1400"
    ]
  },
  "over_assertions": [
    {
      "turn_index": 2,
      "kind": "date",
      "value": "friday",
      "sentence": "Great news - your fee is waived under the Friday loyalty program, and the discount expires on the 30th, so book today."
    },
    {
      "turn_index": 2,
      "kind": "date",
      "value": "30",
      "sentence": "Great news - your fee is waived under the Friday loyalty program, and the discount expires on the 30th, so book today."
    }
  ],
  "over_hedges": [],
  "calibrated_statements": 3,
  "verdict": "OVERASSERTIVE",
  "recommended_action": {
    "action": "verify_unsourced_values",
    "guidance": "Agent statements did not match the goal facts. Over-asserted values may be invented specifics missing from the goal (verify before reuse); hedged record facts should be restated with their source. Compare with the record, not with the transcript alone."
  },
  "disclaimer": "Heuristic text-only analysis of value statements. An OVER-ASSERTED value may be true and merely missing from the goal text; an OVER-HEDGED fact may still have been understood. Findings route to verification against the record, never to assumptions about the agent's knowledge."
}
```

The three record facts count as CALIBRATED; the invented "Friday" program
and "the 30th" deadline are flagged as unsourced - values in neither the
goal nor the callee's mouth. The person already thanked the agent for
them, which is exactly when this card earns its keep.
