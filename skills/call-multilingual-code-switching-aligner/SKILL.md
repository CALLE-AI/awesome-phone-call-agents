---
name: call-multilingual-code-switching-aligner
description: A multilingual phone-call agent skill that dynamically analyzes and mirrors a caller's code-switching (e.g., Spanglish, Hinglish) to build rapport and reduce cognitive load.
version: 1.0.0
---

# Multilingual Code-Switching Aligner

This skill enhances the inclusivity and effectiveness of AI phone-call agents interacting with bilingual or multilingual populations. Instead of forcing the user into a strict monolingual path (e.g., "Press 1 for English, 2 for Spanish"), this skill dynamically tracks the caller's "Matrix Language" and their frequency of "Code-Switching" (mixing languages). 

The LLM is then prompted to mirror the caller's language mixing ratio, creating a deeply personalized and high-rapport conversational experience.

## Scientific Foundation

| Paper / Framework | Relevance |
|---|---|
| **Output Language Alignment for CSW** | Demonstrates that AI mirroring code-switching frequencies increases user trust and reduces linguistic anxiety. |
| **Matrix Language Frame (MLF) model** | Myers-Scotton framework for distinguishing embedded words vs the matrix language. |
| **FCA Consumer Duty (Vulnerability)** | Reduces cognitive load for non-native speakers by allowing them to use their natural hybrid dialects. |

## How it works

1. The agent transcribes the user's speech using a multilingual ASR (Automatic Speech Recognition) model.
2. It strips punctuation and detects embedded vocabularies to calculate a **Code-Mixing Index (CMI)**.
3. The system returns a structured `CodeSwitchingReport` containing the CMI and the suggested `PromptStyle`.
4. The system updates the agent's generative parameters (System Prompt) to instruct the LLM to output speech at a similar CMI.

## Decision Matrix

| Code-Mixing Index (CMI) | Derived Prompt Style | Expected LLM Output Behavior |
|---|---|---|
| `CMI == 0.0` | `monolingual_english` | Strict monolingual English (standard). |
| `0.0 < CMI < 0.30` | `low_code_switching` | Occasional embedded loan words (e.g., "gracias", "pero"). |
| `CMI >= 0.30` | `high_code_switching` | Fluid Spanglish; alternating sentence clauses. |

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| CMI Computation Latency | < 5ms | Runs via ultra-fast lexicon matching. |
| Rapport / Trust Score | +25% | Based on typical A/B tests with bilingual demographics. |

## Limitations & Known Constraints

- **Lexicon Coverage**: The prototype uses a hardcoded vocabulary set. Production systems should use dynamic NLP models to classify embedded words for any language pair.
- **ASR Dependency**: Requires an ASR model capable of transcribing code-switched audio without forcing translations (e.g. Whisper large-v3).

## Integration
This skill runs as a real-time middleware that alters the LLM generation prompt on the fly.
