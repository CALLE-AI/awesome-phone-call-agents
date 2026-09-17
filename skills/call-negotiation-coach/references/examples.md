# Examples — call-negotiation-coach

## Example 1: Pre-call strategy card for a Steady-type supplier

```bash
python3 scripts/negotiation_coach.py prepare \
    --goal "Renew annual software licence at 0–5% price increase" \
    --batna "Switch to open-source alternative, estimated 3-month migration" \
    --counterparty-disc Steady \
    --concern-mode collaborating \
    --dry-run
```

**Expected output excerpt**:
```json
{
  "dual_concern_mode": "Collaborating",
  "counterparty_disc": "Steady",
  "tactic_sequence": [
    {"step": 1, "tactic": "rapport_building"},
    {"step": 2, "tactic": "label_emotion"},
    {"step": 3, "tactic": "timed_concession"},
    {"step": 4, "tactic": "interest_exploration"}
  ]
}
```

---

## Example 2: Post-call debrief

```bash
python3 scripts/negotiation_coach.py debrief \
    --transcript transcript.json \
    --strategy-card strategy_card.json \
    --dry-run
```

---

## Example 3: Integration with client-persona-profiler

```bash
# Step 1: Profile the counterparty
python3 ../client-persona-profiler/scripts/profile_caller.py \
    --transcript last_call.json --dry-run --out persona.json

# Step 2: Pass DISC archetype to negotiation coach
DISC=$(python3 -c "import json; print(json.load(open('persona.json'))['disc_primary'])")
python3 scripts/negotiation_coach.py prepare \
    --goal "Reduce vendor cost by 10%" \
    --batna "In-house build estimated 6 months" \
    --counterparty-disc "$DISC" \
    --dry-run
```
