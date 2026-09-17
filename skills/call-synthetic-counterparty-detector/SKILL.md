---
name: call-synthetic-counterparty-detector
description: Detects if the counterparty in a phone call is an AI agent using acoustic fingerprints (PDSM, micro-latency variance) to prevent infinite politeness loops and enable M2M protocol switching.
version: 1.0.0
---

# Synthetic Counterparty Detector

This skill analyzes acoustic metadata and transcripts to detect if the caller/callee is another AI system rather than a human.

## Background
When two polite conversational AI agents interact without terminal conditions, they can easily fall into an "infinite politeness loop". Identifying the counterparty as an AI allows the system to switch to a highly efficient Machine-to-Machine (M2M) protocol.

## Scientific Basis
- **PDSM (Phoneme Discretized Saliency Maps)**: Explainable detection of AI-generated voice based on phoneme boundaries.
- **Latency Variance**: Human responses exhibit natural, biologically driven variance in latency and turn-taking. Current TTS/STT pipelines show highly deterministic, near-zero variance micro-latencies.
- **Zero-Breath Phrasing**: AI models often generate impossibly long uninterrupted sentences that a human biological respiratory system cannot produce without pausing for breath.

## Usage
```python
from synthetic_detector import analyze_call_for_synthetic_voice

report = analyze_call_for_synthetic_voice(metadata, transcript)
if report["SYNTHETIC_COUNTERPARTY"]:
    switch_to_m2m_protocol()
```
