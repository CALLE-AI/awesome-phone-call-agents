---
name: call-rlhf-self-reflection-scorer
description: A post-call skill where the agent requests user feedback, or defaults to an LLM-as-a-Judge self-critique. It extracts recommendations and saves them to a long-term Memory Bank (RAG) for continuous self-improvement.
version: 1.0.0
---

# RLHF Self-Reflection Scorer

This skill transforms static conversational agents into evolving entities capable of Reinforcement Learning from Human Feedback (RLHF) and AI Feedback (RLAIF). At the conclusion of a call, the agent actively seeks a score (CSAT/NPS) from the user. 

If the user declines or hangs up, the agent leverages the "LLM-as-a-Judge" technique to evaluate its own performance based on the call transcript. It then distills "Recommendations for Improvement" which are stored in a continuous RAG (Retrieval-Augmented Generation) memory stream. Subsequent calls retrieve these lessons to avoid repeating mistakes.

## How it works

1. **Explicit Feedback**: During the call wrap-up, the agent asks: "On a scale of 1 to 5, how would you rate my assistance today?"
2. **Implicit Feedback (Self-Critique)**: If the call ends abruptly, the agent runs a separate LLM prompt (the "Judge") over the transcript.
3. **Reflection**: The Judge LLM outputs a critique and a structured recommendation.
4. **Memory Injection**: The recommendation is embedded into the system's Long-Term Memory. In the next call with the same or similar profile, the agent's pre-prompt includes: "In previous calls, you made [Mistake X]. Ensure you do [Action Y] instead."

## Use Cases
- Sales agents that autonomously learn objection-handling techniques.
- Support agents that adjust their verbosity based on user frustration markers.

## Integration
This runs primarily as an asynchronous post-call webhook, utilizing a separate LLM invocation to guarantee unbiased judging and reflection.
