---
name: call-prosodic-entrainment-optimizer
description: Offline experimental phone-workflow helper that compares supplied prosodic features and suggests bounded TTS parameter changes. Use for synthetic demonstrations and host integration planning.
version: 1.0.0
---

# Prosodic Entrainment Optimizer

**Vocal entrainment** is the natural, subconscious phenomenon where people synchronize their speech patterns — pitch, pace, rhythm, and intensity — with their conversation partner. This synchronization is one of the most robustly documented proxies for **rapport, trust, and cooperative intent** in human communication, first formalized by Howard Giles' *Communication Accommodation Theory* (1973) and now computationally validated through deep learning (Nasir et al., IEEE TAFFC 2022).

The supplied Python helper is an offline, stateless heuristic over supplied numeric features. It returns a score and suggested TTS deltas; it does not capture audio, inject TTS settings, log adjustments, or measure caller rapport. Audio extraction, timing, consent, and any application of suggestions belong to a separate host integration. It is not a clinical, crisis-response, or financial decision tool.

> Research-inspired prototype: the studies below motivate the design but do not validate this implementation or its outcomes.

## Scientific Foundation

| Paper | Venue | Year | Contribution to This Skill |
|---|---|---|---|
| Communication Accommodation Theory | *Language Sciences*, Elsevier | 2023 | Theoretical framework: convergence/divergence mechanisms, mediated communication model |
| Modeling Vocal Entrainment via Deep Unsupervised Learning | IEEE Transactions on Affective Computing | 2022 | Triplet-network entrainment distance → basis for cosine similarity aggregation |
| Context-Aware Computational Entrainment in Dyadic Conversations | arXiv | 2022 | Cross-subject attention model for real-time dyadic entrainment tracking |
| ISO/IEC 42001:2023 AI Management System | ISO | 2023 | Transparency, logging, and auditability requirements for adaptive AI systems |

## How It Works

A proposed host integration could place this helper between feature extraction and TTS. The shipped helper only computes suggestions:

### Step 1: Baseline Calibration (first 5 seconds)
The host may set `is_calibrating=True` during a chosen warm-up window. This returns `CALIBRATING` and an identity directive; the helper itself has no clock, feature collection, or automatic five-second calibration.

### Step 2: Feature Extraction (per 1-second window)
The host must supply three features; no audio extractor is included:
- **Fundamental Frequency (F0, Hz)**: Perceived pitch — speaker identity and emotional state marker.
- **Speech Rate (WPM)**: Cognitive load and urgency indicator.
- **RMS Energy (normalized)**: Loudness and engagement level.

### Step 3: Entrainment Score Computation
Cosine similarity is computed between the L2-normalized caller and agent prosodic feature vectors. `entrainment_score` ∈ [0.0, 1.0]:
- `1.0` = perfect prosodic synchrony
- `0.0` = complete divergence

### Step 4: Status Classification & TTS Directive Generation

| `entrainment_score` | Status | Action |
|---|---|---|
| `>= 0.90` | `OPTIMAL` | **No directive** — back off to avoid over-mirroring |
| `0.75 – 0.89` | `TARGET_REACHED` | Bounded directive may still be returned |
| `< 0.75` | `LOW_ENTRAINMENT` | Issue `TTSDirective` with bounded parameter deltas |
| First 5s | `CALIBRATING` | Identity directive — no adjustment |

### Step 5: Safety-Bounded TTS Directive

| Parameter | Adjustment Logic | Safety Cap |
|---|---|---|
| `pitch_shift_semitones` | Proportional to F0 delta (Hz → semitones) | ±3.0 semitones/window |
| `rate_multiplier` | Proportional to WPM ratio | [0.80, 1.20] |
| `energy_scale` | Proportional to RMS energy ratio | [0.70, 1.30] |

The formula uses a fixed `0.05` fraction of the feature difference, subject to the caps above. This is not a 5% output cap or a time-based rate limit; the host controls invocation timing.

## Mode Presets

| Mode | Use Case | Behavior |
|---|---|---|
| `DEFAULT` | General inbound/outbound | Balanced bidirectional convergence |
| `SALES` | Outbound sales, lead qualification | Converge toward caller's energy to build rapport |
| `SUPPORT` | Synthetic downward-only demonstration | Never raises pitch, rate, or energy; no clinical de-escalation efficacy is established |

## Key Features

- **Bounded suggestions**: Parameter caps are enforced per invocation; perceptual effects have not been measured.
- **Anti-over-mirroring**: Backs off automatically at `score >= 0.90` to prevent the "uncanny valley" of identical-sounding voices.
- **Host-controlled calibration**: `is_calibrating=True` suppresses adjustments.
- **Fail-safe on zero/silence**: Muted callers, zero-rate speech, and whispering are all handled without crashes or division-by-zero errors.
- **SUPPORT mode**: Only holds or lowers pitch, rate, and energy. It does not implement an upward matching phase or establish de-escalation efficacy.

## Configuration Reference

Source constants and proposed host settings are listed below, not a runtime configuration API. The helper has no window-duration or calibration-duration parameter.

| Parameter | Default | Range | Description |
|---|---|---|---|
| `TARGET_THRESHOLD` | `0.75` | `0.60 – 0.85` | Below this → issue TTSDirective |
| `OPTIMAL_CEILING` | `0.90` | `0.80 – 0.95` | Above this → back off (no directive) |
| `MAX_PITCH_DELTA` | `3.0` semitones | `1.0 – 5.0` | Safety cap on pitch adjustment per window |
| `MAX_RATE_DELTA` | `0.20` (±20%) | `0.10 – 0.30` | Safety cap on rate multiplier delta |
| `MAX_ENERGY_DELTA` | `0.30` (±30%) | `0.15 – 0.40` | Safety cap on energy scale delta |
| `step_factor` | `0.05` | Source edit only | Fixed interpolation factor, not an output/time cap |
| `window_duration_s` | `1.0` | `0.5 – 2.0` | Feature extraction window length |
| `calibration_duration_s` | `5.0` | `3.0 – 10.0` | Baseline collection period |

## Expected Outcomes & Metrics

The following are design hypotheses or operating targets, not measured outcomes of this helper:

| Metric | Expected Improvement | Notes |
|---|---|---|
| CSAT Score | Not measured | Requires a separate evaluation |
| Call Abandonment Rate | Not measured | No outcome improvement is established |
| First Call Resolution (FCR) | Not measured | No outcome improvement is established |
| Entrainment Score (avg call) | 0.78 – 0.85 | Target operating range |
| Directive latency | < 10ms | Synthesis parameter update time |

## Use Cases

Proposed research contexts only, not validated clinical, crisis-response, sales, or financial deployments:

- **Outbound sales calls**: Mirror the prospect's energy and cadence to build trust before pitching.
- **Healthcare intake**: Automatically slow pace and lower pitch to match an elderly or anxious caller, reducing cognitive load and improving information capture.
- **Debt collection**: Reduce confrontational dynamics by actively converging toward a calm, measured pace even when the caller is agitated.
- **Mental health support lines**: Gently mirror distressed caller's cadence (SUPPORT mode) while guiding toward slower, regulated rhythm via Match & Lead.
- **High-volume IVR exit**: Reduce caller frustration after a failed IVR interaction by rapidly entraining to their speech pattern when a live-agent-style AI picks up.

## Limitations & Known Constraints

- **Cosine similarity is angle-based**: Features that point in the same direction in feature space can score high even with different magnitudes. This is expected behavior — the system is measuring *style* convergence, not *energy* matching. The energy scale directive handles amplitude alignment separately.
- **TTS dependency**: The `TTSDirective` output requires a TTS engine that accepts real-time prosodic parameter overrides (e.g., SSML `<prosody>` tags or equivalent API). Not all TTS providers support this.
- **Non-verbal speakers**: The host must detect missing/unreliable features and choose whether to keep calibration enabled. The helper does not infer this condition.
- **Accent diversity**: Threshold calibration must include diverse vocal profiles to prevent systematic bias against non-standard prosodic patterns.

## Integration

```
[Caller Audio]
      |
[ASR + Prosodic Feature Extractor]
      |
[call-prosodic-entrainment-optimizer]  <-- this skill
      |
  TTSDirective { pitch=-1.2, rate=0.94, energy=0.91 }
      |
[TTS Synthesis Engine]  <-- applies SSML prosody overrides
      |
[Agent Voice → Caller]
```

## References

See [`references/research-papers.md`](references/research-papers.md) for research inspiration; citations are not implementation validation.
See [`references/safety.md`](references/safety.md) for safety and host responsibilities; no ISO conformity is established.
See [`references/examples.md`](references/examples.md) for end-to-end scenario walkthroughs.
