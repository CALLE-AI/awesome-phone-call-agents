---
name: call-acoustic-breath-biomarker-tracker
description: Offline nonclinical phone-workflow demonstration over supplied speech/pause durations. Returns illustrative pause-ratio labels, not medical findings or an actual emergency handoff.
version: 1.0.0
---

# Acoustic Breath Biomarker Tracker

This experimental helper calculates a pause ratio from synthetic, pre-segmented durations. It does not capture audio, run VAD, detect a medical condition, assess patient safety, or execute a handoff. Its `DYSPNEA_DETECTED`, `NORMAL`, and action enums are illustrative legacy labels, not clinical conclusions. Do not use this prototype for patient triage or emergency decisions.

## Scientific Foundation

| Paper / Framework | Source | Relevance |
|---|---|---|
| Detection of Mild Dyspnea from Pairs of Speech Recordings | IEEE ICASSP (2020) | Provides the acoustic feature extraction models for identifying respiratory variations and abnormal pause mechanics. |
| Biomarkers in respiratory diseases | Breathe editorial (2019) | General background, not validation of pause-ratio clinical inference. |
| COVID-19-related voice disorders: a scoping review | PubMed (2026) | Background on voice disorders, not validation of this helper. |
| Software as a Medical Device (SaMD) | FDA (2023) | Regulatory framework for AI algorithms evaluating biological states. |

## How it works

1. Supply synthetic `AudioSegment` durations to the helper.
2. Audio capture and VAD are not included; any future host would provide its own inputs.
3. The `process_call_stream` function evaluates the extracted segments.
4. A pause ratio at or above the illustrative threshold selects the legacy `DYSPNEA_DETECTED` enum; it does not establish dyspnea.
5. `ESCALATE_TO_HUMAN` is returned as a demo label only. No workflow is halted and no nurse transfer or emergency handoff occurs.

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

The figures below are unvalidated design aspirations, not clinical sensitivity, specificity, or handoff guarantees.

| Metric | Target | Notes |
|---|---|---|
| Escalation Latency | < 1 second | Critical for emergency health response. |
| False Positive Rate (FPR) | < 5% | Legitimate pauses shouldn't trigger an emergency. |
| False Negative Rate (FNR) | < 2% | Must not miss severe respiratory distress. |

## Limitations & Known Constraints

- **Codec Degradation**: Low-bitrate connections may obscure acoustic pauses or falsely introduce silence gaps (packet loss).
- **Background Noise**: Heavy environmental noise might be misclassified as speech by VAD, lowering the calculated pause ratio.
- **Not a Clinical Tool**: This is not a diagnostic or patient-triage mechanism. Low scores do not establish that a person is safe.

## Possible Future Research Contexts

These contexts require separate clinical evaluation and human-governed systems; they are not supported patient-care uses of this prototype.
- Post-discharge monitoring for COPD or heart failure patients.
- Daily check-in phone calls for patients with severe asthma.
- Triage in automated telehealth intake systems.

## Integration
No dialogue-model or telephony integration is included. For a future host, this numeric demonstration must not delay human review or override an explicit report of distress.
