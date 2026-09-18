---
name: call-synthetic-counterparty-detector
description: Offline experimental pattern checks on supplied call metadata and text, returning advisory synthetic-voice hints without certifying identity or switching live protocols.
version: 1.0.0
---

# Synthetic Counterparty Detector

The `call-synthetic-counterparty-detector` skill computes a heuristic score from supplied metadata and text. It does not extract audio features, implement PDSM, authenticate identity, or switch protocols. Its recommendation is an experimental hint for human review, not a calibrated probability or permission to bypass safeguards.

## Research Scope

The latency, duration and filler-word thresholds are demonstration choices, not a reproduced or validated deepfake model. See [research scope](references/research-papers.md).

## How it works

The detector ingests the call transcript and a metadata payload containing acoustic telemetry:
1. **Micro-latency variance**: Checks if the turn-taking latency is too consistent (variance < 500ms). Humans naturally vary their response times based on cognitive load.
2. **Zero-breath phrasing**: Checks if the caller spoke for an impossibly long duration (e.g. >15 seconds) without a biological pause (PDSM anomaly).
3. **Linguistic determinism**: Checks if the caller uses zero filler words ("um", "ah") over a long, complex sequence of speech.

If the combined confidence score is >= 0.7, it flags `SYNTHETIC_COUNTERPARTY = True` and recommends `SWITCH_TO_M2M_PROTOCOL`.

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| Detection Accuracy | > 92% aspiration | Unvalidated target; no TTS benchmark is supplied. |
| False Positive Rate | < 2% aspiration | Unvalidated target; false classifications are possible. |

## Limitations & Known Constraints
- **Metadata Dependency**: This skill relies entirely on the telephony provider (e.g., Twilio, Deepgram) supplying accurate turn latency and speech duration metadata.
- **Evolving AI**: As TTS systems introduce artificial breath sounds and randomized latencies, the heuristic thresholds must be continuously updated.
