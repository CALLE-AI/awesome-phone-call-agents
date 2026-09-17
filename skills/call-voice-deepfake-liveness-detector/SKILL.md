---
name: call-voice-deepfake-liveness-detector
description: An inbound phone-call agent skill that performs real-time acoustic liveness analysis to detect AI-synthesized or cloned voices (deepfakes), protecting users from sophisticated voice-fraud and impersonation attacks.
version: 1.0.0
---

# Voice Deepfake Liveness Detector

This skill directly addresses one of the most urgent and growing threats in telephony: **AI-powered voice cloning fraud**. With tools like ElevenLabs and VALL-E, a bad actor can clone a person's voice from just a few seconds of audio and use it to impersonate family members, executives, or even government officials in phone calls.

Unlike the existing `call-fraud-shield` skill (which correctly excludes audio analysis and focuses on transcript text), this skill operates **at the acoustic signal layer** — analyzing the raw waveform characteristics of the incoming audio stream to produce a **Liveness Score** before the conversation even reaches the NLP pipeline.

## How It Works

The skill employs a multi-feature acoustic analysis pipeline to detect telltale artifacts of AI-synthesized speech:

1. **Spectral Flatness Analysis**: Real human speech contains a rich, irregular harmonic structure. TTS engines often produce overly smooth spectrograms with unnaturally low spectral flatness variance.
2. **Phase Noise Floor Inspection**: Microphone recordings always contain ambient environmental noise (Gaussian noise floor). AI-generated audio clipped from a clean synthesis engine typically lacks this floor.
3. **Temporal Periodicity Deviation**: Human vocal production involves micro-variations in pitch period (jitter). Synthetic voices, while increasingly realistic, still exhibit unusually regular periodicity that can be statistically detected.
4. **Liveness Score Aggregation**: The three feature vectors are combined into a single `liveness_score` (0.0 = fully synthetic → 1.0 = genuine human).
5. **Decision & Escalation**: If `liveness_score < threshold` (default `0.35`), the agent flags the call as a potential deepfake, inserts a friction challenge ("Can you confirm the last 4 digits of your ID?"), and logs the event for human review.

## Key Features

- **Zero-latency pipeline**: Feature extraction runs on short 500ms audio segments, adding negligible delay to the conversation.
- **Complementary to `call-fraud-shield`**: The two skills form a layered defense — this skill guards the acoustic layer, `call-fraud-shield` guards the semantic layer.
- **Threshold tunable per use-case**: High-security financial calls may use `threshold=0.6`; general customer service may use `threshold=0.3`.
- **Graceful degradation**: If the audio quality is too low (e.g., heavy compression), the skill defaults to `INDETERMINATE` rather than a false positive.

## Use Cases

- **Executive impersonation / CEO fraud prevention**: Detect attackers cloning a CFO's voice to authorize wire transfers.
- **Grandparent/family emergency scam defense**: Flag synthetic voices claiming to be a grandchild in distress.
- **KYC (Know Your Customer) voice verification**: Add a liveness gate to voice-based identity verification flows.
- **Call center integrity monitoring**: Continuous background monitoring for high-volume inbound call operations.

## Integration

This skill runs as a **pre-NLP audio middleware hook**. The acoustic analysis result is passed as metadata to the downstream conversational agent, which can adapt its challenge questions and escalation behavior accordingly.

```
[Inbound Audio Stream]
        |
[call-voice-deepfake-liveness-detector]  <-- this skill
        |
  liveness_score=0.28, flag=SYNTHETIC
        |
[Conversational Agent]  <-- adapts response: inserts friction challenge
        |
[call-fraud-shield]  <-- semantic/transcript layer analysis
```
