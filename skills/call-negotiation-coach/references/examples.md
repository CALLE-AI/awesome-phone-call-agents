# Examples

## Example 1: Pre-Call Preparation

**Command:**
```bash
python3 scripts/negotiation_coach.py prepare \
    --goal "Renew contract at <= 5% increase" \
    --batna "Switch to Supplier B at 15% higher" \
    --counterparty-disc Steady \
    --dry-run
```

**Output Excerpt:**
```json
{
  "mode": "prepare",
  "batna_floor_note": "Walk away if outcome is worse than: Switch to Supplier B at 15% higher",
  "tactic_sequence": [
    {
      "step": 1,
      "tactic": "rapport_building",
      "script_hint": "Acknowledge the relationship before discussing numbers."
    },
    {
      "step": 2,
      "tactic": "label_emotion",
      "script_hint": "It sounds like cost certainty matters more than the headline rate."
    }
  ]
}
```

## Example 2: Post-Call Debrief (Successful)

**Command:**
```bash
python3 scripts/negotiation_coach.py debrief \
    --transcript transcript.json \
    --strategy-card strategy_card.json \
    --dry-run
```

**Output Excerpt:**
```json
{
  "mode": "debrief",
  "reached_agreement": true,
  "batna_violated": false,
  "tactic_adherence": {
    "rapport_building": "EXECUTED",
    "label_emotion": "SKIPPED"
  },
  "anti_patterns_detected": [],
  "flags": []
}
```
