---
name: call-rlhf-self-reflection-scorer
description: A post-call Reinforcement Learning from Human Feedback (RLHF) scorer that acts as an LLM-as-a-Judge to evaluate call quality, identify mistakes, and recommend prompt patches.
version: 1.0.0
---

# RLHF Self-Reflection Scorer

This skill acts as an automated QA (Quality Assurance) evaluator for AI phone agents. By analyzing the transcript immediately after a call ends, it identifies friction points (e.g. asking for unavailable info, failing to de-escalate) and generates actionable recommendations for the agent's next interaction.

## Scientific Foundation

| Paper / Concept | Relevance |
|---|---|
| **LLM-as-a-Judge** | Using a strong LLM to evaluate the outputs of an agentic LLM correlates highly with human CSAT (Customer Satisfaction). |
| **Self-Reflection (Reflexion)** | Agents that critique their own past transcripts and generate "verbal reinforcement" prompts perform significantly better on subsequent tasks. |
| **RLHF (Reinforcement Learning from Human Feedback)** | Incorporating explicit user scores (if provided post-call) alongside automated critiques bridges the gap between simulated and real-world quality. |

## How it works

1. The skill receives the transcript and any explicit CSAT score given by the user (if applicable).
2. If the user gave a high score (>= 4), the interaction is marked as successful.
3. If the score is low or missing, the skill runs an LLM critique against the transcript to find the root cause of friction.
4. It outputs an `EvaluationResult` containing the score, the identified critique, and a specific system prompt recommendation to fix the behavior.

## Decision Matrix

| Explicit Score | Transcript Sentiment | Outcome | Action |
|---|---|---|---|
| `>= 4` | Any | `EXPLICIT_USER` (High) | Maintain current strategy |
| `< 4` | Any | `EXPLICIT_USER` (Low) | Generate critique to explain low score |
| `None` | Smooth | `SELF_CRITIQUE` (High) | Baseline evaluation |
| `None` | Friction detected | `SELF_CRITIQUE` (Low) | Flag friction point and generate patch |

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| Critique Relevance | > 90% | The LLM-generated critique should match human QA audits. |
| Recommendation Actionability | > 85% | Recommendations must be directly usable as system prompt instructions. |

## Limitations & Known Constraints
- **Self-Correction Loop**: This skill only generates the critique. A separate meta-agent is required to actually update the core agent's prompt based on these recommendations.
- **Cost**: Running an LLM-as-a-Judge on every call adds inference overhead.
