---
name: client-persona-profiler
description: Post-call persona detection skill. Analyses a CALL-E transcript to classify the caller's behavioural archetype (DISC model), compute an RFMAP loyalty score across accumulated call history, persist a privacy-preserving profile, and return a structured persona card with a personalised next-call strategy playbook. Backed by peer-reviewed DISC, persona-DB, and customer-loyalty research.
license: MIT
---

# client-persona-profiler

> **Detect who your caller is — and how to keep them.**

Unlock lasting customer relationships by understanding the *person* behind every
call, not just the transaction. This skill silently profiles caller behaviour
across interactions, builds a long-term loyalty picture, and hands the agent a
concrete, archetype-specific playbook for the next call.

---

## Why This Skill Exists

Most call-centre AI focuses on *what* the caller wants right now. This skill
focuses on *who they are* — their communication style, their loyalty, and their
churn risk — so every subsequent interaction is more effective, more personalised,
and more likely to convert a one-time caller into a long-term champion.

---

## Scientific Foundation

| Research | Relevance |
|---|---|
| Marston (1928) + Bonnstetter et al. (2009) — DISC | Four-quadrant behavioural archetype classification |
| Salemi et al. *Persona-DB* arXiv:2402.11060 (2024) | Persona profile storage and retrieval without fine-tuning |
| RFMAP Model (ResearchGate, 2024) | Recency-Frequency-Monetary-Activation loyalty scoring |
| *Big Five from Call-Centre Transcripts* (MDPI, 2023) | Validates transcript-based personality inference in call-centre settings |
| Salemi et al. *LLM Call Driver* arXiv (2024) | Automated intent extraction from transcripts |
| arXiv:2411.12539 (Nov 2024) — CSAT from transcripts | Sentiment trajectory as loyalty proxy |

Full citations: [`references/research-papers.md`](references/research-papers.md)

---

## Quick Start

### Heuristic mode (no LLM required)

```bash
python3 scripts/profile_caller.py \
  --transcript path/to/transcript.json \
  --profile-dir /var/call-profiles/ \
  --caller-id "+1-555-000-0001" \
  --dry-run \
  --out /tmp/persona_card.json
```

### With LLM-assisted scoring (optional)

```bash
export OPENAI_API_KEY="sk-..."
python3 scripts/profile_caller.py \
  --transcript path/to/transcript.json \
  --profile-dir /var/call-profiles/ \
  --caller-id "+1-555-000-0001" \
  --out /tmp/persona_card.json
```

### Validate output schema

```bash
python3 scripts/validate_profile.py --card /tmp/persona_card.json
```

---

## Input

The skill accepts any CALL-E transcript in one of two formats:

**Format A — array of turns:**
```json
[
  {"role": "agent",  "text": "Hello, how can I help you today?"},
  {"role": "callee", "text": "I need to see all the policy documents first."}
]
```

**Format B — wrapper object:**
```json
{
  "call_id": "calle-20260915-001",
  "transcript": [
    {"role": "agent",  "text": "Hello, how can I help you today?"},
    {"role": "callee", "text": "I need to see all the policy documents first."}
  ]
}
```

Supported turn keys: `role` / `speaker`, and `text` / `content` / `message`.

---

## Output — Persona Card

```json
{
  "caller_token":        "sha256:3f9c8e2a1b7d...",
  "analysis_timestamp":  "2026-09-15T09:00:00Z",
  "interaction_count":   4,
  "first_seen_days_ago": 42,
  "last_seen_days_ago":  3,

  "persona_archetype":   "Analytical",
  "archetype_confidence":"high",
  "disc_scores": {
    "D": 0.08, "I": 0.10, "S": 0.18, "C": 0.64
  },

  "sentiment_trajectory": ["neutral", "neutral", "positive"],
  "sentiment_trend":       "improving",

  "rfmap_loyalty_score":  74,
  "loyalty_tier":         "high_value",
  "churn_risk":           "low",

  "call_driver":          "policy documentation request",
  "recommended_playbook": {
    "archetype":    "Analytical",
    "open_with":    "Lead with facts, data, and specifics. Reference documented policies.",
    "avoid":        "Emotional appeals, vague generalisations, premature commitments.",
    "close_with":   "Offer written confirmation. Give them time to evaluate.",
    "loyalty_lever":"Transparency, consistency between what is said and what is delivered.",
    "churn_warning":"Discovered discrepancies between promises and reality."
  },

  "flags":           [],
  "profile_version": 4,
  "analysis_mode":   "heuristic",
  "dry_run":         false,
  "schema_version":  "1.0"
}
```

---

## DISC Archetype Reference

| Archetype | Key Trait | Engagement Style |
|---|---|---|
| **Dominant (D)** | Results-driven, decisive | Direct, brief, outcome-focused |
| **Influential (I)** | People-oriented, enthusiastic | Story-driven, warm, community-focused |
| **Steady (S)** | Consistent, supportive | Calm, step-by-step, no surprises |
| **Analytical (C)** | Detail-oriented, systematic | Data-backed, documented, deliberate |
| **Undetermined** | Insufficient signal | Balanced, neutral — gather more turns |

---

## RFMAP Loyalty Tiers

| Score | Tier | Churn Risk |
|---|---|---|
| ≥ 80 | Champion | Low |
| 60–79 | High Value | Low / Medium |
| 40–59 | At Risk | Medium |
| < 40 | Low Value | High |

---

## Flags

| Flag | Meaning |
|---|---|
| `LOW_TURN_COUNT` | Fewer than `--min-turns` callee turns; archetype is unreliable |
| `UNDETERMINED_ARCHETYPE` | Top two DISC dimensions are within the margin; archetype is `Undetermined` |
| `CHURN_RISK_ELEVATED` | RFMAP score is below 55 |
| `REQUIRES_HUMAN_REVIEW` | Call driver is medical, legal, financial, or emergency |

---

## Command-Line Reference

```
usage: profile_caller.py [-h] --transcript TRANSCRIPT
                         [--profile-dir PROFILE_DIR]
                         [--caller-id CALLER_ID]
                         [--playbook PLAYBOOK]
                         [--min-turns MIN_TURNS]
                         [--dry-run]
                         [--out OUT]

options:
  --transcript    Path to the transcript JSON file (required)
  --profile-dir   Directory to read/write persistent caller profiles
                  (default: ./profiles)
  --caller-id     Explicit caller identity string (hashed before storage)
                  (default: auto-derived from transcript metadata)
  --playbook      Path to the DISC playbooks JSON file
                  (default: references/disc-playbooks.json)
  --min-turns     Minimum callee turns before emitting an archetype label
                  (default: 4)
  --dry-run       Analyse without writing to the profile store
  --out           Write persona card JSON to this path (default: stdout)
```

---

## Privacy & Safety

- **One-way hashing**: The `caller_id` is SHA-256 hashed before storage. Raw identity never reaches disk or output.
- **No PII in output**: `validate_profile.py` scans for phone numbers and email addresses and fails if any are found.
- **Local storage only**: Profiles are stored as `.jsonl` files on the local filesystem. No cloud, no external API.
- **Protected attributes excluded**: Race, ethnicity, religion, political views, and health status are explicitly outside scope.
- **Advisory only**: The `recommended_playbook` is a suggestion, not an automated action. A human decides whether and how to apply it.

Full safety reference: [`references/safety.md`](references/safety.md)

---

## Files

```
skills/client-persona-profiler/
├── SKILL.md                              ← This file
├── scripts/
│   ├── profile_caller.py                 ← Main analysis runner
│   ├── validate_profile.py               ← Output schema validator
│   └── test_persona_profiler.py          ← Test suite (165+ assertions)
└── references/
    ├── disc-playbooks.json               ← Archetype strategy playbooks
    ├── example-transcript.json           ← Sample transcript
    ├── examples.md                       ← Usage examples
    ├── research-papers.md                ← Scientific citations
    └── safety.md                         ← Privacy and ethics reference
```

---

## Running Tests

```bash
# Run via pytest (recommended)
python3 -m pytest skills/client-persona-profiler/scripts/test_persona_profiler.py -v

# Or run directly
python3 skills/client-persona-profiler/scripts/test_persona_profiler.py
```

Expected: **all tests pass**, zero network calls, zero file writes (dry-run by default).

---

## Integration with CALL-E

In a CALL-E pipeline, invoke this skill as a **post-call step**:

```
[call ends] → [transcribe] → [profile_caller.py] → [persona card] → [agent uses playbook on next call]
```

The persona card can be stored in the agent's context store and injected into
the system prompt at the start of the next call:

```
System: The caller's DISC archetype is Analytical. 
Open with data. Avoid emotional appeals. Offer written confirmation.
```
