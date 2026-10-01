# Examples: call-apology-effectiveness-auditor

All outputs below are real runs of the shipped script against the shipped
fixtures (byte-identical, only reformatted as fenced blocks).

## Example 1: an effective, empathic apology (EFFECTIVE_APOLOGY)

Fixture: `references/example-transcript.json`. The callee raises a missed
callback grievance; the agent acknowledges, expresses regret, offers a
concrete repair, and explains briefly.

Command:

```bash
python3 skills/call-apology-effectiveness-auditor/scripts/apology_effectiveness_auditor.py analyze \
  --transcript skills/call-apology-effectiveness-auditor/references/example-transcript.json
```

Output:

```json
{
  "call_id": "run-apo-empathic-01",
  "skill": "call-apology-effectiveness-auditor",
  "analysis_mode": "heuristic",
  "apology_assessment": "assessed",
  "reason": null,
  "grievance_turn_index": 1,
  "grievances_total": 1,
  "grievance_evidence": "Nobody called me back and this is the third time I've waited all day.",
  "apology_detected": true,
  "apology_evidence": "I'm so sorry about this - that's on us, we missed the callback.",
  "components_present": [
    "ACKNOWLEDGMENT",
    "REPAIR",
    "EXPLANATION",
    "REGRET"
  ],
  "typology": "empathic",
  "verdict": "EFFECTIVE_APOLOGY",
  "recommended_action": {
    "action": "continue",
    "guidance": "Apology carried the components that matter; confirm the repair actually happened."
  },
  "disclaimer": "Lexical apology grading. A grievance lexicon hit is not proof of genuine distress; a component marker is not proof of sincerity; sometimes the right posture is no apology at all (the agent cannot own fault it does not have). Advisory for human review, not a relationship-quality certificate."
}
```

## Example 2: a rote apology with no components (PARTIAL_APOLOGY)

Fixture: `references/example-transcript-rote.json`. The agent says only
"I'm sorry about that" and moves on to scheduling.

Command:

```bash
python3 skills/call-apology-effectiveness-auditor/scripts/apology_effectiveness_auditor.py analyze \
  --transcript skills/call-apology-effectiveness-auditor/references/example-transcript-rote.json
```

Output:

```json
{
  "call_id": "run-apo-rote-01",
  "skill": "call-apology-effectiveness-auditor",
  "analysis_mode": "heuristic",
  "apology_assessment": "assessed",
  "reason": null,
  "grievance_turn_index": 1,
  "grievances_total": 1,
  "grievance_evidence": "I never received the referral letter, I'm not happy about this.",
  "apology_detected": true,
  "apology_evidence": "I'm sorry about that.",
  "components_present": [],
  "typology": "rote",
  "verdict": "PARTIAL_APOLOGY",
  "recommended_action": {
    "action": "reissue_proper_apology",
    "guidance": "The apology was thin. Name the miss specifically (acknowledgment), then offer a concrete repair or a brief explanation."
  },
  "disclaimer": "Lexical apology grading. A grievance lexicon hit is not proof of genuine distress; a component marker is not proof of sincerity; sometimes the right posture is no apology at all (the agent cannot own fault it does not have). Advisory for human review, not a relationship-quality certificate."
}
```

## Example 3: a deflection-style non-apology (NON_APOLOGY)

Fixture: `references/example-transcript-non-apology.json`. The agent
apologizes for the feeling, not the failure.

Command:

```bash
python3 skills/call-apology-effectiveness-auditor/scripts/apology_effectiveness_auditor.py analyze \
  --transcript skills/call-apology-effectiveness-auditor/references/example-transcript-non-apology.json
```

Output:

```json
{
  "call_id": "run-apo-deflect-01",
  "skill": "call-apology-effectiveness-auditor",
  "analysis_mode": "heuristic",
  "apology_assessment": "assessed",
  "reason": null,
  "grievance_turn_index": 1,
  "grievances_total": 1,
  "grievance_evidence": "You promised Tuesday and nobody called.",
  "apology_detected": true,
  "apology_evidence": "I'm sorry you feel that way.",
  "components_present": [],
  "typology": null,
  "verdict": "NON_APOLOGY",
  "recommended_action": {
    "action": "escalate_to_human",
    "guidance": "A deflection-style non-apology risks deepening the grievance; a human should own the recovery."
  },
  "disclaimer": "Lexical apology grading. A grievance lexicon hit is not proof of genuine distress; a component marker is not proof of sincerity; sometimes the right posture is no apology at all (the agent cannot own fault it does not have). Advisory for human review, not a relationship-quality certificate."
}
```

## Example 4: a grievance with no apology at all (GRIEVANCE_UNADDRESSED)

Fixture: `references/example-transcript-unaddressed.json`. The agent
never apologizes and just continues scheduling.

Command:

```bash
python3 skills/call-apology-effectiveness-auditor/scripts/apology_effectiveness_auditor.py analyze \
  --transcript skills/call-apology-effectiveness-auditor/references/example-transcript-unaddressed.json
```

Output:

```json
{
  "call_id": "run-apo-unaddr-01",
  "skill": "call-apology-effectiveness-auditor",
  "analysis_mode": "heuristic",
  "apology_assessment": "assessed",
  "reason": null,
  "grievance_turn_index": 1,
  "grievances_total": 1,
  "grievance_evidence": "I'm so frustrated, I waited all week and never got a call back.",
  "apology_detected": false,
  "apology_evidence": null,
  "components_present": [],
  "typology": null,
  "verdict": "GRIEVANCE_UNADDRESSED",
  "recommended_action": {
    "action": "escalate_to_human",
    "guidance": "The callee raised a grievance and the agent never apologized; a human should decide the recovery."
  },
  "disclaimer": "Lexical apology grading. A grievance lexicon hit is not proof of genuine distress; a component marker is not proof of sincerity; sometimes the right posture is no apology at all (the agent cannot own fault it does not have). Advisory for human review, not a relationship-quality certificate."
}
```
