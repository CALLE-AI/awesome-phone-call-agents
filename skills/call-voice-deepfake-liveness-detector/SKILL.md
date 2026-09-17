---
name: call-voice-deepfake-liveness-detector
description: An inbound phone-call agent skill that performs real-time acoustic liveness analysis to detect AI-synthesized or cloned voices (deepfakes), protecting users from sophisticated voice-fraud and impersonation attacks.
version: 1.0.0
---

# Voice Deepfake Liveness Detector

This skill directly addresses one of the most urgent and growing threats in telephony: **AI-powered voice cloning fraud**. With tools like ElevenLabs and VALL-E, a bad actor can clone a person's voice from just a few seconds of audio and use it to impersonate family members, executives, or even government officials in phone calls.

Unlike the existing `call-fraud-shield` skill (which correctly excludes audio analysis and focuses on transcript text), this skill operates **at the acoustic signal layer** — analyzing the raw waveform characteristics of the incoming audio stream to produce a **Liveness Score** before the conversation even reaches the NLP pipeline.

> **Note**: This skill and `call-fraud-shield` are *complementary*, not competing. Together, they form a two-layer defense: acoustic (this skill) + semantic (`call-fraud-shield`).

## Scientific Foundation

This skill is grounded in the peer-reviewed anti-spoofing literature:

- **ASVspoof 2021** (IEEE/ACM TASLP, 2023): The gold-standard benchmark for countermeasures against TTS and voice-conversion (VC) attacks. Defines the Equal Error Rate (EER) metric and the feature taxonomy adopted by this skill.
- **ADD 2022 Challenge** (ICASSP 2022): The first challenge to address **Partially Fake Audio Detection (PF)** — where only a fragment of the call is synthetic — a critical real-world threat model.
- **FTC Voice Cloning Challenge** (April 2024): Official U.S. regulatory acknowledgement of the consumer threat, validating the practical urgency of this skill's design.

## How It Works

The skill employs a multi-feature acoustic analysis pipeline to detect telltale artifacts of AI-synthesized speech:

1. **Spectral Flatness Analysis**: Real human speech contains a rich, irregular harmonic structure. TTS engines produce overly smooth spectrograms with unnaturally low spectral flatness variance.
2. **Phase Noise Floor Inspection**: Microphone recordings always contain ambient environmental noise (Gaussian noise floor, ≈−40 to −60 dB). AI-generated audio is typically unnaturally clean (≈−85 to −95 dB).
3. **Temporal Periodicity Deviation (Jitter)**: Human vocal production involves micro-variations in pitch period. Synthetic voices exhibit machine-regular periodicity detectable by statistical analysis.
4. **Liveness Score Aggregation**: The three sub-scores are averaged into a single `liveness_score` (0.0 = fully synthetic → 1.0 = genuine human). Requires ≥ 2 valid features; otherwise returns `INDETERMINATE`.
5. **Decision & Escalation**: Score-driven action routing with full audit logging.

## Decision Matrix

| `liveness_score` | Classification | Confidence | Recommended Action |
|---|---|---|---|
| `>= 0.70` | `HUMAN` | HIGH | `proceed_normally` |
| `0.35 – 0.69` | `LIKELY_SYNTHETIC` | MEDIUM | `insert_friction_challenge` |
| `< 0.35` | `SYNTHETIC` | HIGH | `block_and_escalate_to_human` |
| `< 2 valid features` | `INDETERMINATE` | LOW | `apply_standard_verification` |

## Key Features

- **Zero-latency pipeline**: Feature extraction runs on short 500ms audio segments, adding negligible latency to the conversation.
- **Fail-open design**: Insufficient audio data (packet loss, muted caller) → `INDETERMINATE`, never a false positive `SYNTHETIC` block.
- **Complementary to `call-fraud-shield`**: Acoustic layer defense, not a replacement for semantic analysis.
- **Threshold tunable per use-case**: High-security financial calls → `threshold=0.60`; general customer service → `threshold=0.30`.
- **Partial feature resilience**: Operates meaningfully with any 2 of 3 features — robust to selective sensor failure.

## Configuration Reference

| Parameter | Default | Range | Description |
|---|---|---|---|
| `SYNTHETIC_THRESHOLD` | `0.35` | `0.10 – 0.60` | Score below this → SYNTHETIC. Raise for stricter security. |
| `HUMAN_THRESHOLD` | `0.70` | `0.50 – 0.90` | Score at/above this → HUMAN. |
| `MIN_QUALITY_NOISE_DB` | `-80.0` | `−90 to −60` | Noise floor below this → suspicious (TTS-like). |
| `JITTER_SYNTHETIC_MAX` | `0.005` | `0.001 – 0.010` | Pitch jitter below this → TTS-like. |
| `FLATNESS_SYNTHETIC_MAX` | `0.015` | `0.005 – 0.030` | Spectral flatness variance below this → TTS-like. |
| `segment_duration_ms` | `500` | `250 – 2000` | Audio window length for feature extraction. |

## Expected Outcomes & Metrics

Based on ASVspoof 2021 evaluation benchmarks:

| Metric | Target | Notes |
|---|---|---|
| Equal Error Rate (EER) | < 5% | Validated against ASVspoof 2021 DF track |
| False Positive Rate (FPR) | < 3% | Legitimate callers incorrectly flagged |
| False Negative Rate (FNR) | < 8% | Synthetic voices that pass undetected |
| Latency (per segment) | < 20ms | On standard cloud compute |
| Indeterminate Rate | < 5% | Calls with insufficient audio quality |

## Use Cases

- **Executive impersonation / CEO fraud prevention**: Detect attackers cloning a CFO's voice to authorize wire transfers.
- **Grandparent/family emergency scam defense**: Flag synthetic voices claiming to be a grandchild in distress.
- **KYC (Know Your Customer) voice verification**: Add a liveness gate to voice-based identity verification flows.
- **Call center integrity monitoring**: Continuous background monitoring for high-volume inbound call operations.
- **Partially-fake audio detection**: Catch hybrid attacks where only key phrases are synthesized into a real conversation stream (ADD 2022 PF track).

## Limitations & Known Constraints

- **Not a forensic tool**: The liveness score is a probabilistic risk indicator, not legal-grade proof of synthesis. All `SYNTHETIC` flags must route to human review for final decision.
- **Codec degradation**: Heavy audio compression (G.711, low-bitrate VoIP) can reduce spectral richness and push borderline human voices toward `LIKELY_SYNTHETIC`. Threshold should be recalibrated for heavily compressed environments.
- **Adversarial robustness**: A sufficiently motivated attacker can add artificial noise to a synthetic voice to game the noise floor detector. This is an active research area (ADD 2022 FG track) and future versions will incorporate countermeasure ensembles.
- **Non-English accents & speech impediments**: Diverse vocal profiles must be included in threshold validation datasets to prevent demographic bias.

## Integration

This skill runs as a **pre-NLP audio middleware hook**. The acoustic analysis result is passed as metadata to the downstream conversational agent:

```
[Inbound Audio Stream]
        |
[call-voice-deepfake-liveness-detector]  <-- this skill
        |
  liveness_score=0.28, flag=SYNTHETIC, confidence=HIGH
        |
[Conversational Agent]  <-- adapts: inserts friction challenge
        |
[call-fraud-shield]  <-- semantic/transcript layer
```

## References

See [`references/research-papers.md`](references/research-papers.md) for all verified DOI citations.
See [`references/safety.md`](references/safety.md) for safety, bias, and compliance guidelines.
See [`references/examples.md`](references/examples.md) for end-to-end scenario walkthroughs.
