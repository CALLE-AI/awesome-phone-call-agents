# Examples

## Example 1: Outbound Sales Call — Low-Energy Prospect Gradually Lifted

**Scenario**: An outbound sales agent calls a prospect. The prospect sounds tired and speaks slowly at ~98 WPM, low pitch (92 Hz average F0), soft energy.

**Initial Measurement (t=5s baseline)**:
```json
{
  "caller_number": "555-0122",
  "caller_features": { "f0_hz": 92.0, "speech_rate_wpm": 98, "rms_energy": 0.18 },
  "agent_features":  { "f0_hz": 145.0, "speech_rate_wpm": 165, "rms_energy": 0.61 },
  "entrainment_score": 0.41,
  "status": "LOW_ENTRAINMENT"
}
```

**TTS Directive Issued (t=6s)**:
```json
{
  "pitch_shift_semitones": -2.1,
  "rate_multiplier": 0.88,
  "energy_scale": 0.73
}
```

**Result at t=30s**:
```json
{
  "entrainment_score": 0.79,
  "status": "TARGET_REACHED"
}
```

**Outcome**: The agent's voice is now perceived as warmer and more in sync with the prospect. Their engagement increases — they start asking questions about the product. Call ends with a demo booked.

---

## Example 2: Healthcare Intake — Anxious Elderly Caller Calmed via Match & Lead

**Scenario**: An elderly caller (82 years old) is speaking rapidly (175 WPM) and at high pitch (220 Hz F0) due to anxiety about a medical appointment.

**SUPPORT Mode — Match & Lead Strategy**:

| Phase | Agent rate | Agent pitch | Entrainment score |
|---|---|---|---|
| t=0s (calibrate) | 140 WPM | 140 Hz | — |
| t=6s (match up) | 155 WPM | 155 Hz (↑ toward caller) | 0.81 |
| t=15s (lead down) | 140 WPM | 140 Hz (↓ gradually) | 0.77 |
| t=30s (settled) | 125 WPM | 128 Hz (↓ further) | 0.83 |

```json
{
  "caller_number": "555-0188",
  "mode": "SUPPORT",
  "final_directive": {
    "pitch_shift_semitones": -0.9,
    "rate_multiplier": 0.93,
    "energy_scale": 0.88
  },
  "status": "TARGET_REACHED"
}
```

**Outcome**: By first mirroring the caller's anxious pace (Match) then gradually decelerating (Lead), the agent guides the caller toward a calmer rhythm. The caller's speech rate drops from 175 to 130 WPM over 45 seconds. Intake completed successfully with no call abandonment.

---

## Example 3: High Entrainment — No Adjustment Needed (OPTIMAL)

**Scenario**: A returning customer calls back the same agent they spoke to last week. Their speech is naturally well-matched to the agent's default parameters.

**Measurement**:
```json
{
  "caller_number": "555-0134",
  "caller_features": { "f0_hz": 138.0, "speech_rate_wpm": 142, "rms_energy": 0.48 },
  "agent_features":  { "f0_hz": 140.0, "speech_rate_wpm": 145, "rms_energy": 0.50 },
  "entrainment_score": 0.927,
  "status": "OPTIMAL"
}
```

**Action**: Score `0.927` exceeds the `0.90` upper ceiling. The system enters **HOLD** mode — no TTS adjustments are applied to avoid over-mirroring artifacts (the "uncanny valley" effect).

**Outcome**: The call proceeds naturally. The caller experiences the agent as a trusted, familiar voice without any artificial-feeling prosodic shifts.

---

## Example 4: Edge Case — Whispering / Near-Muted Caller (CALIBRATING Extended)

**Scenario**: A caller is in a library and whispering. Their RMS energy is near-zero (0.01) and F0 is barely detectable (65 Hz).

**Measurement at t=5s**:
```json
{
  "caller_number": "555-0171",
  "caller_features": { "f0_hz": 65.0, "speech_rate_wpm": 72, "rms_energy": 0.01 },
  "agent_features":  { "f0_hz": 140.0, "speech_rate_wpm": 155, "rms_energy": 0.50 },
  "entrainment_score": 0.63,
  "status": "LOW_ENTRAINMENT"
}
```

**TTS Directive Issued**:
```json
{
  "pitch_shift_semitones": -1.8,
  "rate_multiplier": 0.92,
  "energy_scale": 0.73,
  "note": "Energy scale reduced significantly to match near-muted caller; pitch lowered toward their estimated F0"
}
```

**Safety check**: `energy_scale = 0.73` is within the safety cap `[0.70, 1.30]`. No division-by-zero error occurs despite near-zero caller energy (guarded by `max(agent.rms_energy, 0.01)` in the energy ratio computation).

**Outcome**: The agent adopts a softer, quieter voice to match the caller's whispered speech. The caller feels the agent "gets" their situation without them having to explain it.
