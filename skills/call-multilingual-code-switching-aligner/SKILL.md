---
name: call-multilingual-code-switching-aligner
description: A multilingual phone-call agent skill that dynamically analyzes and mirrors a caller's code-switching (e.g., Spanglish, Hinglish) to build rapport and reduce cognitive load.
version: 1.0.0
---

# Multilingual Code-Switching Aligner

This skill enhances the inclusivity and effectiveness of AI phone-call agents interacting with bilingual or multilingual populations. Instead of forcing the user into a strict monolingual path (e.g., "Press 1 for English, 2 for Spanish"), this skill dynamically tracks the caller's "Matrix Language" and their frequency of "Code-Switching" (mixing languages). 

The LLM is then prompted to mirror the caller's language mixing ratio, creating a deeply personalized and high-rapport conversational experience.

## How it works

1. The agent transcribes the user's speech using a multilingual ASR (Automatic Speech Recognition) model.
2. It detects the primary language (Matrix Language) and any secondary embedded languages.
3. The skill calculates a Code-Mixing Index (CMI).
4. The system updates the agent's generative parameters (System Prompt) to instruct the LLM to output speech at a similar CMI, inserting culturally appropriate embedded words exactly where natural bilingual speakers would.

## Use Cases
- Customer support for immigrant or highly bilingual demographics (e.g., Miami, Texas, London).
- Healthcare intake to reduce the cognitive load on elderly bilingual patients.
- Sales calls where building rapport is critical.

## Integration
This skill runs as a real-time middleware that alters the LLM generation prompt on the fly. It relies heavily on recent linguistic alignment research (e.g., Output Language Alignment for CSW).
