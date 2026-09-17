# Examples

## Example 1: Outbound Sales Call — Low-Energy Prospect Lifted

**Scenario**: An outbound sales agent calls a prospect. The prospect sounds tired and speaks slowly at ~100 WPM, low pitch (90 Hz average F0), soft energy.

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

**TTS Directive Issued**:
```json
{
  "pitch_shift_semitones": -2.5,
  "rate_multiplier": 0.88,
  "energy_scale": 0.72
}
```

**Result at t=30s**:
```json
{
  "entrainment_score": 0.79,
  "status": "TARGET_REACHED"
}
```
**Outcome**: The agent's voice is now perceived as warmer and more in sync. The prospect's engagement increases — they start asking questions about the product. Call ends with a demo booked.

---

## Example 2: Healthcare Intake — Anxious Elderly Caller Calmed

**Scenario**: An elderly caller (82 years old) calls into a telehealth intake line. They are speaking rapidly (175 WPM) and at high pitch (220 Hz F0) due to anxiety.

**TTS Directive After Calibration**:
```json
{
  "caller_number": "555-0188",
  "pitch_shift_semitones": +1.8,
  "rate_multiplier": 1.10,
  "energy_scale": 1.05,
  "note": "Match then guide: temporarily converge UP toward caller, then gradually slow to de-escalate"
}
```

**Result**: By first mirroring the caller's anxious pace and then gradually decelerating, the agent guides the caller toward a calmer rhythm (this is the "Match & Lead" technique documented in the CAT literature).

**Outcome**: Caller's speech rate drops from 175 to 130 WPM over 45 seconds. They successfully complete the intake form without hanging up.

---

## Example 3: High Entrainment — No Adjustment Needed

**Scenario**: A regular customer calls back the same agent they spoke to yesterday. Their speech is naturally well-matched.

**Measurement**:
```json
{
  "caller_number": "555-0134",
  "entrainment_score": 0.91,
  "status": "OPTIMAL"
}
```

**Action**: Score `0.91` exceeds the `0.90` upper ceiling. The system enters **HOLD** mode — no TTS adjustments are applied to avoid over-mirroring artifacts.

**Outcome**: The call proceeds naturally. The agent is experienced by the caller as a trusted, familiar voice.
