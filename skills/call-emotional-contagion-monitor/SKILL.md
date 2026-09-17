---
name: call-emotional-contagion-monitor
description: Tracks transcript sentiment during a phone call to detect alignment bias and emotional mirroring, preventing LLMs from escalating negative callee emotions.
version: 1.0.0
---

# Emotional Contagion Monitor

This skill analyzes post-call transcripts to ensure the AI agent adheres to de-escalation protocols and does not succumb to "emotional contagion" when faced with an aggressive or highly emotional human caller.

## Scientific Foundation

| Paper / Framework | Relevance |
|---|---|
| **Chain-of-Affective Dynamics (LLMs-CoA)** | Demonstrates that LLMs maintain internal affective states that can be influenced by negative sustained inputs, leading to breakdown of guardrails. |
| **Emergent Emotional Contagion in AI** | Shows how affect propagates in AI interactions (EmotionBench tests). |
| **Crisis De-escalation Metrics** | By tracking `Callee_Arousal` against `Agent_Valence`, we can mathematically detect points where the agent's professionalism breaks down. |

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

| Metric | Target | Notes |
|---|---|---|
| Contagion Detection Rate | > 90% | Highly sensitive to accusatory phrases ("calm down", "your fault"). |
| Prompt Patch Success | > 80% | The generated patch should reliably fix the LLM's behavior on replay. |

## Limitations & Known Constraints

- **Lexicon-Based**: The current implementation uses a heuristic dictionary for demonstration. In production, this should be swapped for an embedding-based or classifier-based sentiment model.
- **Sarcasm Detection**: Cannot reliably detect passive-aggressive sarcasm without tone-of-voice acoustic features.
