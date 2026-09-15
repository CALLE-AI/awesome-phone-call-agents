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

```bash
python3 scripts/profile_caller.py \
  --transcript references/example-transcript.json \
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
  "disc_scores": { "D": 0.12, "I": 0.08, "S": 0.18, "C": 0.62 },
  "archetype_confidence": "high",
  "sentiment_trajectory": ["neutral", "neutral", "neutral"],
  "sentiment_trend": "stable",
  "rfmap_loyalty_score": 0,
  "loyalty_tier": "low_value",
  "churn_risk": "high",
  "recommended_playbook": {
    "archetype": "Analytical",
    "open_with": "Lead with facts, data, and specifics.",
    "avoid": "Emotional appeals, vague generalisations, premature commitments.",
    "close_with": "Offer written confirmation."
  },
  "flags": ["UNDETERMINED_ARCHETYPE"],
  "schema_version": "1.0"
}
```

> **Note**: On a first interaction, `rfmap_loyalty_score` is low and
> `UNDETERMINED_ARCHETYPE` may be set if the margin is narrow. More interactions
> refine the profile.

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
  "disc_scores": { "D": 0.10, "I": 0.62, "S": 0.14, "C": 0.14 },
  "recommended_playbook": {
    "archetype": "Influential",
    "open_with": "Start with energy and warmth.",
    "loyalty_lever": "Recognition, community belonging, public acknowledgment."
  }
}
```

---

## Example 3: Returning Caller (4th interaction, high loyalty)

After 4 interactions with a caller (loaded from profile store):

```json
{
  "interaction_count": 4,
  "first_seen_days_ago": 42,
  "last_seen_days_ago": 3,
  "rfmap_loyalty_score": 74,
  "loyalty_tier": "high_value",
  "churn_risk": "low"
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
