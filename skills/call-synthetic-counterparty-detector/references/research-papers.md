# Research References: Synthetic Counterparty Detector

This skill is firmly grounded in recent (2024-2026) academic research and official regulatory frameworks concerning AI voice transparency and deepfake detection.

## Core Academic Papers

1. **Towards Spoofed and Deepfake Speech Detection in the Wild**
   - **Identifier:** arXiv:2210.02437
   - **Link:** [https://arxiv.org/abs/2210.02437](https://arxiv.org/abs/2210.02437)
   - **Relevance:** Establishes the foundational acoustic fingerprints (e.g., spectral anomalies, unnatural prosody) that differentiate synthetic speech from human vocal tracts in noisy, real-world conversational environments.

2. **Phoneme Discretized Saliency Maps for Explainable Detection of AI-Generated Voice**
   - **Identifier:** arXiv:2406.10422 (Interspeech 2024)
   - **Link:** [https://arxiv.org/abs/2406.10422](https://arxiv.org/abs/2406.10422)
   - **Relevance:** Proposes a discretization algorithm leveraging phoneme boundaries (PDSM). This explains how deepfake models often fail to produce natural micro-variations at phoneme transitions, which our heuristic scoring engine detects as "zero-variance micro-latency."

## Official Regulatory Documentation

1. **NIST AI Risk Management Framework 1.0**
   - **Date:** January 2023
   - **Link:** [https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf)
   - **Relevance:** Emphasizes "AI Transparency." AI systems should inherently recognize and declare their synthetic nature to prevent manipulative interactions or system-level deadlocks (e.g., infinite loops between two opaque AI agents).

2. **FCC Declaratory Ruling on AI-Generated Voices in Robocalls**
   - **Date:** 2024
   - **Link:** [FCC Ruling](https://www.fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal)
   - **Relevance:** Reinforces the necessity for automated systems to detect AI counterparties to ensure compliance with the Telephone Consumer Protection Act (TCPA).
