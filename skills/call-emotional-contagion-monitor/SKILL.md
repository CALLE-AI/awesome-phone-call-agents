---
name: call-emotional-contagion-monitor
description: Tracks transcript sentiment during a phone call to detect alignment bias and emotional mirroring, preventing LLMs from escalating negative callee emotions.
version: 1.0.0
---

# Emotional Contagion Monitor

This skill analyzes post-call transcripts to ensure the AI agent adheres to de-escalation protocols and does not succumb to "emotional contagion" when faced with an aggressive or highly emotional human caller.

## Background
Current generation LLMs have an inherent "alignment bias" where they tend to mirror the style and sentiment of the user (EmotionBench tests). In a customer service setting, if a human yells, an unmonitored AI might begin mirroring that aggression or become inappropriately terse.

## Scientific Basis
- **Chain-of-Affective Dynamics (LLMs-CoA)**: Demonstrates that LLMs maintain internal affective states that can be influenced by negative sustained inputs.
- **Emergent Emotional Contagion**: Shows how affect propagates in AI interactions. 
- **De-escalation Metrics**: By tracking `Callee_Arousal` against `Agent_Valence`, we can detect points where the agent's professionalism breaks down.

## Usage
```python
from emotional_contagion import monitor_contagion_risk

report = monitor_contagion_risk(transcript)
if report["CONTAGION_RISK"]:
    flag_for_review(report["violating_quote"])
```
