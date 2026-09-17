# Examples

## Example 1: CEO / Executive Impersonation Attempt (Fully Synthetic)

**Scenario**: A call arrives from a number spoofed to look like the CEO's mobile. The voice claims to authorize an urgent wire transfer.

**Acoustic Analysis Result**:
```json
{
  "caller_number": "555-0101",
  "spectral_flatness_variance": 0.003,
  "phase_noise_floor_db": -92.4,
  "pitch_jitter_coefficient": 0.0018,
  "liveness_score": 0.21,
  "classification": "SYNTHETIC",
  "confidence": "HIGH"
}
```

**Agent Action**: Liveness score `0.21` is well below the `0.35` threshold. The agent does **not** proceed with the wire transfer. It inserts a friction challenge: *"To authorize this transaction, I need to verify your identity. Can you provide your employee PIN and call back on the number registered in our system?"* The event is flagged for the security team.

---

## Example 2: Grandparent Scam — Cloned Family Voice

**Scenario**: An elderly person's phone agent receives a call. The voice closely resembles the caller's grandson, claiming to be in a medical emergency and asking for money.

**Acoustic Analysis Result**:
```json
{
  "caller_number": "555-0177",
  "spectral_flatness_variance": 0.008,
  "phase_noise_floor_db": -85.1,
  "pitch_jitter_coefficient": 0.0042,
  "liveness_score": 0.29,
  "classification": "LIKELY_SYNTHETIC",
  "confidence": "MEDIUM"
}
```

**Agent Action**: Score `0.29` is below threshold. The agent gently interrupts: *"I want to make sure I'm speaking with the right person. Can you tell me the name of your family's pet?"* — a challenge question only the real person would know. The call is simultaneously logged for review.

---

## Example 3: Legitimate Human Caller — Pass

**Scenario**: A genuine customer calls to check their account balance.

**Acoustic Analysis Result**:
```json
{
  "caller_number": "555-0145",
  "spectral_flatness_variance": 0.074,
  "phase_noise_floor_db": -52.3,
  "pitch_jitter_coefficient": 0.0341,
  "liveness_score": 0.87,
  "classification": "HUMAN",
  "confidence": "HIGH"
}
```

**Agent Action**: Score `0.87` is well above the threshold. The conversation proceeds normally with zero friction added. The caller experiences no disruption.

---

## Example 4: Indeterminate — Low Quality Audio

**Scenario**: A caller is connecting via a very poor quality VoIP link with heavy packet loss.

**Acoustic Analysis Result**:
```json
{
  "caller_number": "555-0133",
  "spectral_flatness_variance": null,
  "phase_noise_floor_db": null,
  "pitch_jitter_coefficient": null,
  "liveness_score": null,
  "classification": "INDETERMINATE",
  "confidence": "LOW"
}
```

**Agent Action**: System defaults to `INDETERMINATE`. The agent falls back to standard identity verification procedures without inserting additional AI-specific friction, avoiding false positives for legitimate callers with poor connectivity.
