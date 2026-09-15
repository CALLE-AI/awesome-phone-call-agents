# Examples — client-persona-profiler

## Example 1: Analytical Caller (Steady/Analytical blend)

### Input Transcript

```json
[
  {"role": "agent",  "text": "Hello, can I help you today?"},
  {"role": "callee", "text": "Yes. I need to verify the exact policy details and documentation."},
  {"role": "agent",  "text": "Of course. Here are the specifics."},
  {"role": "callee", "text": "Can you confirm with data? I want accurate evidence before I decide."},
  {"role": "agent",  "text": "Absolutely. Let me share the official documentation."},
  {"role": "callee", "text": "Good. I need precise numbers and a written confirmation please."}
]
```

### Command

Save the transcript above as `analytical-caller.json`, then run:

```bash
python3 scripts/profile_caller.py \
  --transcript analytical-caller.json \
  --profile-dir /tmp/profiles/ \
  --caller-id "test-analytical-caller" \
  --dry-run \
  --out /tmp/persona_card.json
```

### Expected Output (abbreviated)

```json
{
  "caller_token": "sha256:...",
  "persona_archetype": "Analytical",
  "disc_scores": { "D": 0.0, "I": 0.0769, "S": 0.0, "C": 0.9231 },
  "archetype_confidence": "high",
  "sentiment_trajectory": ["neutral", "neutral", "neutral"],
  "sentiment_trend": "stable",
  "rfmap_loyalty_score": 48,
  "loyalty_tier": "at_risk",
  "churn_risk": "high",
  "recommended_playbook": {
    "archetype": "Analytical",
    "open_with": "Lead with facts, data, and specifics.",
    "avoid": "Emotional appeals, vague generalisations, premature commitments.",
    "close_with": "Offer written confirmation."
  },
  "flags": ["CHURN_RISK_ELEVATED"],
  "schema_version": "1.0"
}
```

> **Note**: This is the first interaction for this caller, so the RFMAP
> score is low (`CHURN_RISK_ELEVATED`). Churn risk on a single interaction
> is expected and softens as history accumulates — see Example 3.

---

## Example 2: Influential Caller

### Input Transcript

A caller who is enthusiastic, story-driven, and people-oriented:

```json
[
  {"role": "callee", "text": "Hi! Excited to hear about this. Tell me more, it sounds amazing!"},
  {"role": "callee", "text": "I love the energy. Let's collaborate and share this story together!"},
  {"role": "callee", "text": "Count me in! This is going to be so fun working with the team."}
]
```

### Expected Output (key fields)

```json
{
  "persona_archetype": "Influential",
  "archetype_confidence": "high",
  "disc_scores": { "D": 0.0, "I": 1.0, "S": 0.0, "C": 0.0 },
  "flags": ["LOW_TURN_COUNT", "CHURN_RISK_ELEVATED"],
  "recommended_playbook": {
    "archetype": "Influential",
    "open_with": "Start with energy and warmth.",
    "loyalty_lever": "Recognition, community belonging, public acknowledgment."
  }
}
```

> **Note**: Only 3 turns are available (below `--min-turns 4`), so
> `LOW_TURN_COUNT` is set — act on the archetype with caution.

---

## Example 3: Returning Caller (5th interaction, high loyalty)

After 4 prior interactions with a caller (loaded from the profile store),
the 5th call returns:

```json
{
  "interaction_count": 5,
  "first_seen_days_ago": 42,
  "last_seen_days_ago": 3,
  "rfmap_loyalty_score": 65,
  "loyalty_tier": "high_value",
  "churn_risk": "medium"
}
```

---

## Example 4: Short Call — Flags LOW_TURN_COUNT

When fewer than `--min-turns` (default: 4) turns are present:

```json
{
  "persona_archetype": "Undetermined",
  "archetype_confidence": "undetermined",
  "flags": ["UNDETERMINED_ARCHETYPE", "LOW_TURN_COUNT"]
}
```

The skill returns `Undetermined` honestly rather than guessing from insufficient
data.

---

## Validation

After any run, validate with:

```bash
python3 scripts/validate_profile.py --card /tmp/persona_card.json
```

Expected: `Persona card is valid.`
