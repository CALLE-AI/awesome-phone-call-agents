---
name: call-rlhf-self-reflection-scorer
description: Offline experimental post-call feedback scorer using supplied ratings and text heuristics. Use to demonstrate advisory review suggestions; no LLM inference, RLHF training, or memory integration is included.
version: 1.0.0
---

# RLHF Self-Reflection Scorer

This skill demonstrates post-call QA with a small lexical scorer. It accepts a supplied transcript and optional rating, then returns predefined review suggestions. It does not collect user feedback, call an LLM, train a model, store RAG memories, or apply prompt changes. These are possible future host integrations, not delivered behavior.

## Scientific Foundation

| Paper / Concept | Relevance |
|---|---|
| **LLM-as-a-Judge** | Using a strong LLM to evaluate the outputs of an agentic LLM correlates highly with human CSAT (Customer Satisfaction). |
| **Self-Reflection (Reflexion)** | Agents that critique their own past transcripts and generate "verbal reinforcement" prompts perform significantly better on subsequent tasks. |
| **RLHF (Reinforcement Learning from Human Feedback)** | Incorporating explicit user scores (if provided post-call) alongside automated critiques bridges the gap between simulated and real-world quality. |

## How it works

1. The skill receives the transcript and any explicit CSAT score given by the user (if applicable).
2. If the user gave a high score (>= 4), the interaction is marked as successful.
3. If the score is low or missing, the skill checks a small set of text patterns and returns a mocked critique; it cannot establish a root cause.
4. It outputs an `EvaluationResult` containing the score, the identified critique, and a specific system prompt recommendation to fix the behavior.

## Decision Matrix

| Explicit Score | Transcript Sentiment | Outcome | Action |
|---|---|---|---|
| `>= 4` | Any | `EXPLICIT_USER` (High) | Maintain current strategy |
| `< 4` | Any | `SELF_CRITIQUE` | Return a heuristic critique; not an explanation of the user's rating |
| `None` | Smooth | `SELF_CRITIQUE` (High) | Baseline evaluation |
| `None` | Friction detected | `SELF_CRITIQUE` (Low) | Flag friction point and generate patch |

## Expected Outcomes & Metrics

These are unvalidated targets for a possible future evaluator, not measurements of this mock scorer.

| Metric | Target | Notes |
|---|---|---|
| Critique Relevance | > 90% | The LLM-generated critique should match human QA audits. |
| Recommendation Actionability | > 85% | Recommendations must be directly usable as system prompt instructions. |

## Limitations & Known Constraints
- **Self-Correction Loop**: This skill only generates the critique. A separate meta-agent is required to actually update the core agent's prompt based on these recommendations.
- **Cost**: The local helper has no LLM dependency. A future LLM integration would have separate costs and evaluation needs.
