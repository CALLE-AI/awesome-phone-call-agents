---
name: call-prosodic-entrainment-optimizer
description: A phone-call agent skill that measures real-time vocal entrainment between agent and caller and dynamically adjusts TTS speech parameters to maximize convergence, increasing rapport, trust, and call outcome success rates.
version: 1.0.0
---

# Prosodic Entrainment Optimizer

**Vocal entrainment** is the natural, subconscious phenomenon where people synchronize their speech patterns — pitch, pace, rhythm, and intensity — with their conversation partner. This synchronization is a well-documented proxy for **rapport, trust, and cooperative intent** in human communication.

This skill applies this principle to AI phone-call agents: it continuously measures the degree of entrainment between the caller's voice and the agent's voice, and **dynamically adjusts the Text-to-Speech (TTS) synthesis parameters** to maintain optimal convergence. The result is a caller who feels heard, mirrored, and comfortable — leading to measurably better CSAT scores, higher conversion rates in sales calls, and lower early hang-up rates.

## Scientific Foundation

This skill is grounded in two decades of entrainment research:

- **Communication Accommodation Theory (CAT)** (Giles et al., 2023): Formalized the principle that speakers converge their speech toward their partner's style as a fundamental social bonding mechanism.
- **Deep Unsupervised Entrainment Modeling** (Nasir et al., IEEE TAFFC 2022): Demonstrated that vocal entrainment can be quantified using learned feature representations and is strongly correlated with positive behavioral outcomes (empathy, therapeutic alliance, sales success).
- **Context-Aware Entrainment Measurement** (Lahiri et al., arXiv 2022): Introduced cross-subject attention models for real-time entrainment tracking in dyadic conversations — exactly the setting of a phone call.

## How It Works

The skill operates as a real-time speech analysis and TTS control layer:

### Step 1: Feature Extraction (per 1-second window)
From the caller's audio, the system extracts three prosodic features:
- **Fundamental Frequency (F0)**: The perceived pitch of the voice, in Hz.
- **Speech Rate**: Words (or syllables) per minute.
- **Root Mean Square Energy (RMS Energy)**: The loudness/intensity of speech.

### Step 2: Entrainment Score Computation
The skill computes **cosine similarity** between the caller's and agent's prosodic feature vectors for each window. An `entrainment_score` of `1.0` indicates perfect synchrony; `0.0` indicates complete divergence.

### Step 3: TTS Parameter Injection
If the `entrainment_score` falls below the `target_threshold` (default `0.75`), the skill generates a `TTSDirective` — a set of parameter deltas to pass to the TTS engine:

| Agent Prosody | Caller Prosody | Directive |
|---|---|---|
| Pitch too high | Lower pitch | `pitch_shift_semitones = -1.5` |
| Speaking too fast | Slower pace | `rate_multiplier = 0.90` |
| Too loud | Softer voice | `energy_scale = 0.85` |

### Step 4: Continuous Monitoring
The system monitors `entrainment_score` throughout the call, applying gentle adjustments every 5 seconds to avoid jarring shifts while gradually converging toward the caller's style.

## Key Features

- **Non-intrusive**: Adjustments are gradual (max 15% per window) to avoid the "uncanny valley" effect of over-rapid voice shifting.
- **Per-speaker calibration**: The system buffers the first 5 seconds of the call to establish a baseline before making any adjustments.
- **Bidirectional awareness**: The system avoids over-convergence (complete mirroring). When `entrainment_score >= 0.90`, it backs off to maintain natural conversational dynamics.
- **Use-case presets**: `SALES` mode optimizes for warm, high-energy convergence; `SUPPORT` mode prioritizes calm, slow-paced convergence; `DEFAULT` mode applies balanced adjustments.

## Use Cases

- **Outbound sales calls**: Mirror the prospect's energy to build trust before pitching.
- **Healthcare intake**: Automatically slow the agent's pace and lower pitch to match an elderly or anxious caller, reducing cognitive load.
- **Debt collection**: Reduce confrontational dynamics by actively converging toward a calm, measured pace even when the caller is agitated.
- **Mental health support lines**: Gently mirror distressed caller's cadence while guiding them toward a slower, more regulated rhythm.

## Integration

This skill integrates as middleware between the ASR (transcript) output and the TTS synthesis engine:

```
[Caller Audio]
      |
[ASR + Prosodic Feature Extractor]
      |
[call-prosodic-entrainment-optimizer]  <-- this skill
      |
  TTSDirective { pitch=-1.0, rate=0.92, energy=0.95 }
      |
[TTS Synthesis Engine]  <-- applies directive
      |
[Agent Voice → Caller]
```
