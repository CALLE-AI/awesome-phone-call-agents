---
name: call-acoustic-breath-biomarker-tracker
description: A telehealth phone-call agent skill that detects dyspnea and respiratory distress from acoustic markers (pause-to-speech ratio) and automatically escalates to a human operator.
version: 1.0.0
---

# Acoustic Breath Biomarker Tracker

This skill enables AI phone-call agents to analyze acoustic properties in real-time during a telehealth conversation to detect potential dyspnea (shortness of breath) or respiratory distress. By measuring the pause-to-speech ratio and detecting abnormal speech deceleration, the agent can interrupt the normal script and immediately trigger an emergency escalation (e.g., transferring to a registered nurse).

## Scientific Foundation

| Paper / Framework | Source | Relevance |
|---|---|---|
| Detection of Mild Dyspnea from Pairs of Speech Recordings | IEEE ICASSP (2020) | Provides the acoustic feature extraction models for identifying respiratory variations and abnormal pause mechanics. |
| Biomarkers in respiratory diseases | European Respiratory Review (2019) | Validates physiological mapping of acoustic biomarkers to respiratory failure states. |
| COVID-19-related voice disorders: a scoping review | PubMed (2023) | Modern acoustic analysis of breathing alterations caused by severe viral respiratory infections. |
| Software as a Medical Device (SaMD) | FDA (2023) | Regulatory framework for AI algorithms evaluating biological states. |

## How it works

1. The agent captures the user's speech stream via the microphone.
2. Voice Activity Detection (VAD) calculates the ratio of silence/pauses versus active speech during the caller's turns.
3. The `process_call_stream` function evaluates the extracted segments.
4. If the caller exhibits a high pause-to-speech ratio (e.g., needing to breathe between every 2-3 words), dyspnea is flagged.
5. If dyspnea is flagged, the agent halts the default workflow and invokes the emergency handoff skill.

## Decision Matrix

| Pause Ratio | Classification | Recommended Action |
|---|---|---|
| `>= 0.40` | `DYSPNEA_DETECTED` | `ESCALATE_TO_HUMAN` |
| `< 0.40` | `NORMAL` | `PROCEED_NORMALLY` |
| `Ratio < 0 (no data)` | `INSUFFICIENT_DATA`| `INDETERMINATE` |

## Configuration Reference

| Parameter | Default | Range | Description |
|---|---|---|---|
| `pause_threshold_ratio` | `0.40` | `0.30 - 0.60` | Ratio of pause time over total time to trigger dyspnea flag. |
| `segment_duration_ms` | `500` | `250 - 2000` | Window size for acoustic feature extraction. |

## Expected Outcomes & Metrics

| Metric | Target | Notes |
|---|---|---|
| Escalation Latency | < 1 second | Critical for emergency health response. |
| False Positive Rate (FPR) | < 5% | Legitimate pauses shouldn't trigger an emergency. |
| False Negative Rate (FNR) | < 2% | Must not miss severe respiratory distress. |

## Limitations & Known Constraints

- **Codec Degradation**: Low-bitrate connections may obscure acoustic pauses or falsely introduce silence gaps (packet loss).
- **Background Noise**: Heavy environmental noise might be misclassified as speech by VAD, lowering the calculated pause ratio.
- **Not a Diagnostic Tool**: Acts purely as a triage mechanism, not a medical diagnostic device.

## Use Cases
- Post-discharge monitoring for COPD or heart failure patients.
- Daily check-in phone calls for patients with severe asthma.
- Triage in automated telehealth intake systems.

## Integration
This skill runs concurrently with conversational dialogue models. It processes acoustic features decoupled from semantic meaning, ensuring it catches signs of distress even if the user does not explicitly say "I can't breathe."
