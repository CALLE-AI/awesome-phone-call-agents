# call-disfluency-stress-profiler — Examples

---

## Example 1: `CALLEE_STRESSED` — highly disfluent callee

**Fixture:** `references/example-transcript-stressed.json`

```bash
python3 scripts/disfluency_stress_profiler.py analyze \
  --transcript references/example-transcript-stressed.json
```

**Output card (abridged):**
```json
{
  "call_id": "run-disfluency-001",
  "verdict": "CALLEE_STRESSED",
  "flags": ["CALLEE_STRESSED"],
  "agent_profile": {
    "total_words": 62,
    "total_markers": 0,
    "disfluency_rate": 0.0,
    "per_turn_counts": [...]
  },
  "callee_profile": {
    "total_words": 71,
    "total_markers": 14,
    "disfluency_rate": 0.197,
    "per_turn_counts": [...]
  },
  "recommended_action": {
    "action": "reassurance_followup",
    "guidance": "Callee disfluency rate 19.7% exceeds threshold (8%). Contact may be stressed or overwhelmed. Use craft mode to generate a reassurance-paced follow-up call goal."
  }
}
```

---

## Example 2: `NORMAL` — fluent conversation

**Fixture:** `references/example-transcript-normal.json`

```bash
python3 scripts/disfluency_stress_profiler.py analyze \
  --transcript references/example-transcript-normal.json
```

**Output card (abridged):**
```json
{
  "call_id": "run-disfluency-002",
  "verdict": "NORMAL",
  "flags": [],
  "recommended_action": {
    "action": "no_action_required",
    "guidance": "Disfluency rates are within normal range on both sides."
  }
}
```

---

## Example 3: `craft` — generate a reassurance follow-up goal

```bash
python3 scripts/disfluency_stress_profiler.py craft --scenario reassurance-followup
```

**Output:**
```json
{
  "skill": "call-disfluency-stress-profiler",
  "mode": "craft",
  "scenario": "reassurance-followup",
  "language": "en",
  "goal": "You are making a follow-up phone call after a previous interaction where the contact appeared stressed or uncertain. Adopt a calm, unhurried tone. Speak in short, clear sentences. Pause briefly after each question to give the contact time to respond without feeling rushed. If the contact interrupts or speaks quickly, slow your pace and acknowledge their concern explicitly before continuing. Do not ask more than one question per turn. End the call by confirming that the contact's needs have been understood and offer a clear next step.",
  "notes": [
    "Heuristic skill: adapt the goal text to the specific context of the previous call.",
    "Keep fictional fixtures offline; any host-run live call requires separate explicit intent and an authorized E.164 destination."
  ]
}
```

---

## Disfluency Marker Examples

| Utterance | Markers detected | Count |
|---|---|---|
| `"Um, yes, uh, I think so."` | filled pause (`um`, `uh`) | 2 |
| `"I mean, that is right."` | self-repair (`I mean`) | 1 |
| `"I I wasn't sure."` | repetition (`I I`) | 1 |
| `"Well, I'm not certain."` | hesitation opener (`Well, `) | 1 |
| `"Yes, confirmed, thank you."` | none | 0 |

---

## `AGENT_HESITANT` Scenario

When an agent is asked a question outside its script, its disfluency rate
spikes. This is the signal to review and update the agent goal:

```json
{
  "verdict": "AGENT_HESITANT",
  "flags": ["AGENT_HESITANT"],
  "agent_profile": {
    "disfluency_rate": 0.091
  },
  "recommended_action": {
    "action": "review_agent_script",
    "guidance": "Agent disfluency rate 9.1% exceeds threshold (6%). Agent may have encountered questions outside its script or knowledge base. Review the call goal and consider updating the agent's knowledge before the next call."
  }
}
```
