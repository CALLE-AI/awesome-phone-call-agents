---
name: call-multilingual-code-switching-aligner
description: Offline experimental English/Spanish lexicon helper for phone-workflow demonstrations. Returns a code-mixing ratio and suggested style; no ASR or LLM prompt integration is included.
version: 1.0.0
---

# Multilingual Code-Switching Aligner

This offline prototype counts a small Spanish vocabulary in supplied text and suggests an English/Spanish mixing style. It does not identify arbitrary matrix languages, support Hinglish, or establish improvements in inclusivity, trust, or cognitive load.

The helper returns a style label only. A separate host could use it as a suggestion, subject to the caller's stated language preference; rapport or cognitive-load benefits are not established.

## Scientific Foundation

| Paper / Framework | Relevance |
|---|---|
| **Output Language Alignment for CSW** | Demonstrates that AI mirroring code-switching frequencies increases user trust and reduces linguistic anxiety. |
| **Matrix Language Frame (MLF) model** | Myers-Scotton framework for distinguishing embedded words vs the matrix language. |
| **FCA Consumer Duty (Vulnerability)** | Reduces cognitive load for non-native speakers by allowing them to use their natural hybrid dialects. |

## How it works

1. Supply a transcript string. An optional host ASR component is outside this contribution.
2. It strips punctuation and detects embedded vocabularies to calculate a **Code-Mixing Index (CMI)**.
3. The system returns a structured `CodeSwitchingReport` containing the CMI and the suggested `PromptStyle`.
4. A host may review the suggested style before updating a prompt; the helper performs no prompt or speech mutation.

## Decision Matrix

| Code-Mixing Index (CMI) | Derived Prompt Style | Expected LLM Output Behavior |
|---|---|---|
| `CMI == 0.0` | `monolingual_english` | Strict monolingual English (standard). |
| `0.0 < CMI < 0.30` | `low_code_switching` | Occasional embedded loan words (e.g., "gracias", "pero"). |
| `CMI >= 0.30` | `high_code_switching` | Fluid Spanglish; alternating sentence clauses. |

## Expected Outcomes & Metrics

Latency is a design target, not a measured integration benchmark.

| Metric | Target | Notes |
|---|---|---|
| CMI Computation Latency | < 5ms | Runs via ultra-fast lexicon matching. |
| Rapport / Trust Score | Not measured | No A/B evaluation of this helper is supplied. |

## Limitations & Known Constraints

- **Lexicon Coverage**: The prototype uses a hardcoded vocabulary set. Production systems should use dynamic NLP models to classify embedded words for any language pair.
- **ASR Dependency**: Requires an ASR model capable of transcribing code-switched audio without forcing translations (e.g. Whisper large-v3).

## Integration
This is an offline text helper. Real-time middleware, ASR, language preferences, and LLM prompt updates are proposed host integration work.
