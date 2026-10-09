# call-goal-drift-auditor — Examples

---

## Example 1: `MILD_DRIFT` — appointment call with off-topic sales pitch

**Goal:** `references/example-goal.txt`
```
Confirm the dental appointment scheduled for Thursday at 3 p.m. with Dr. Patel.
Verify that the patient's insurance information is on file.
```

**Transcript:** `references/example-transcript-drift.json`

```bash
python3 scripts/goal_drift_auditor.py analyze \
  --transcript references/example-transcript-drift.json \
  --goal-file references/example-goal.txt
```

**Output card (abridged):**
```json
{
  "call_id": "run-drift-001",
  "verdict": "MILD_DRIFT",
  "goal_keywords": ["appointment", "confirm", "dental", "insurance", "patel", "thursday", "verify"],
  "agent_turn_count": 6,
  "on_topic_turn_count": 4,
  "on_topic_ratio": 0.6667,
  "off_topic_spans": [
    {
      "start_turn_index": 4,
      "length_in_agent_turns": 2,
      "first_off_topic_evidence": "While I have you, did you know we also offer teeth whitening and orthodontic consultations?"
    }
  ],
  "goal_achieved": true,
  "recommended_action": {
    "action": "monitor_and_consider_tighter_goal",
    "guidance": "One off-topic span detected. The call largely stayed on track but had one notable digression. Consider using craft mode to add bounding instructions."
  }
}
```

---

## Example 2: `ON_TRACK` — focused appointment confirmation

**Transcript:** `references/example-transcript-on-track.json`

```bash
python3 scripts/goal_drift_auditor.py analyze \
  --transcript references/example-transcript-on-track.json \
  --goal-file references/example-goal.txt
```

**Output card (abridged):**
```json
{
  "call_id": "run-drift-002",
  "verdict": "ON_TRACK",
  "on_topic_ratio": 1.0,
  "off_topic_spans": [],
  "goal_achieved": true,
  "recommended_action": {
    "action": "no_action_required",
    "guidance": "Agent maintained goal focus (on-topic ratio 100.0%). No significant drift detected."
  }
}
```

---

## Example 3: `craft` — generate a tighter bounded goal

```bash
python3 scripts/goal_drift_auditor.py craft \
  --scenario goal-refocus \
  --goal-file references/example-goal.txt
```

**Output:**
```json
{
  "skill": "call-goal-drift-auditor",
  "mode": "craft",
  "scenario": "goal-refocus",
  "language": "en",
  "goal": "You are making a call with a specific and bounded goal. Your goal is: Confirm the dental appointment scheduled for Thursday at 3 p.m. with Dr. Patel. Verify that the patient's insurance information is on file. Do not discuss other services or billing unless the patient raises them. Stay focused on this goal throughout the entire call. Do not volunteer information about other topics or services unless the contact raises them directly. If the contact steers the conversation off-topic, acknowledge their concern briefly and return to the primary goal. Before ending the call, confirm explicitly that the goal has been achieved. If the goal cannot be achieved in this call, state clearly what step is needed next.",
  "notes": [
    "Heuristic skill: adapt the bounding instructions to the specific context.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```

---

## Verdict Decision Tree

```
goal_keywords extracted?
  └─ NO  → unclear (no_goal_keywords_extracted)

agent turns present?
  └─ NO  → unclear (no_agent_turns)

on_topic_ratio < 60% AND goal_achieved = false?
  └─ YES → GOAL_NOT_ACHIEVED

off_topic_spans ≥ 2?
  └─ YES → SIGNIFICANT_DRIFT

off_topic_spans = 1?
  └─ YES → MILD_DRIFT

else → ON_TRACK
```

---

## Off-Topic Span Detection

A span is flagged when **≥ 2 consecutive** agent turns contain none of the
goal keywords. Single off-topic turns are absorbed as conversational noise.

```
Turn 1 (agent):  "Confirming your appointment Thursday." → ON-TOPIC ✅
Turn 2 (callee): "Yes."
Turn 3 (agent):  "We have a whitening promotion."        → off-topic ❌
Turn 4 (agent):  "Invisalign is also available."         → off-topic ❌  ← span (length=2)
Turn 5 (agent):  "Back to your appointment Thursday."    → ON-TOPIC ✅
```

---

## Goal Achievement Check

The skill checks the **last 4 agent turns** for co-occurrence of:
1. At least one goal keyword, AND
2. A confirmation phrase (`confirmed`, `all set`, `you're set`, `scheduled`, etc.)

If both are present in any of those turns, `goal_achieved: true`.
