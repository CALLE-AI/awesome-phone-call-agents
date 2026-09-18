---
name: call-emotional-contagion-monitor
description: Offline experimental keyword-based transcript review with suggested de-escalation prompts, without altering live calls or guaranteeing behavior.
version: 1.0.0
---

# Emotional Contagion Monitor

This skill checks supplied post-call transcripts using a small lexicon and suggests prompt changes for human review. It does not apply those changes, measure internal emotions, or guarantee de-escalation.

## Research Scope

Related literature is background inspiration, not validation of the prototype or its thresholds. See [research scope](references/research-papers.md). The scores are keyword heuristics, not calibrated measures of professionalism.

## Background

Current generation LLMs have an inherent "alignment bias" where they tend to mirror the style and sentiment of the user. In a customer service or crisis setting, if a human yells or uses abusive language, an unmonitored AI might begin mirroring that aggression, becoming inappropriately terse, or inappropriately defensive ("I am not to blame, you need to calm down"). This skill catches those instances.

## How It Works

1. The system scans each turn in the transcript.
2. When the `callee` speaks, it calculates a Negative Arousal score (0.0 to 1.0).
3. When the `agent` speaks, it calculates a Negative Valence score and derives the agent's Professionalism (1.0 - Negative Valence).
4. If `Callee_Arousal >= 0.6` (angry) and `Agent_Valence <= 0.6` (defensive/aggressive), the system triggers a `CONTAGION_RISK`.
5. It extracts the exact violating quote and automatically generates a system prompt patch to prevent recurrence.

## Decision Matrix

| Condition | Risk Status | Agent Response Quality |
|---|---|---|
| Arousal high, Valence high | `SAFE` | Agent maintained professional boundary |
| Arousal high, Valence low | `CONTAGION_RISK` | Agent mirrored aggression or became defensive |
| Arousal low, Valence high | `SAFE` | Normal interaction |
| Arousal low, Valence low | `WARNING` | Agent is unprovoked but being terse/negative |

## Configuration Reference

| Parameter | Default | Range | Description |
|---|---|---|---|
| `arousal_threshold` | `0.60` | `0.40 - 0.80` | Threshold above which callee is considered highly aroused/angry. |
| `valence_threshold` | `0.60` | `0.40 - 0.80` | Threshold below which agent is considered defensive/unprofessional. |

## Expected Outcomes & Metrics

The following numbers are unvalidated design targets, not measured results.

| Metric | Target | Notes |
|---|---|---|
| Contagion Detection Rate | > 90% | Highly sensitive to accusatory phrases ("calm down", "your fault"). |
| Prompt Patch Success | > 80% | The generated patch should reliably fix the LLM's behavior on replay. |

## Limitations & Known Constraints

- **Lexicon-Based**: The current implementation uses a heuristic dictionary for demonstration. In production, this should be swapped for an embedding-based or classifier-based sentiment model.
- **Sarcasm Detection**: Cannot reliably detect passive-aggressive sarcasm without tone-of-voice acoustic features.
