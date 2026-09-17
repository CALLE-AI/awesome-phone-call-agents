# Safety and Compliance

## Core Safety Principles

### 1. False Positive Prevention (Fail-Safe Design)
A wrongly flagged legitimate caller is a significant customer experience failure. This skill is designed to **fail open** (let through) in ambiguous cases rather than block legitimate callers:
- Audio quality below a minimum SNR threshold yields `INDETERMINATE`, not `SYNTHETIC`.
- The system requires at least 2 out of 3 acoustic features to converge on `SYNTHETIC` before flagging.
- Friction challenges are phrased as natural verification questions, not accusations.

### 2. No Voice Data Retention
- Audio segments processed for liveness detection are **analyzed ephemerally in memory** and never written to disk or transmitted to external APIs.
- Only the derived numerical feature vectors (not raw audio) are logged.
- This design ensures compliance with GDPR (EU) and CCPA (California) biometric data protection requirements.

### 3. Bias and Equity
- The skill must be validated across diverse speaker demographics (age, accent, native language) to ensure the liveness threshold does not disproportionately flag speakers with non-standard vocal characteristics (e.g., elderly voices, non-native accents) as synthetic.
- Threshold calibration must include diverse validation datasets before deployment.

### 4. Regulatory Alignment
- All FTC guidelines on AI voice cloning protection are followed, as outlined in the FTC's Voice Cloning Challenge (2024).
- The skill is positioned as a **risk-mitigation tool**, not a definitive forensic system. All SYNTHETIC flags must route to human review for final decision.

### 5. Testing Protocol
All demonstration data and unit tests strictly use the `555-01xx` numbering block (e.g., `555-0101`, `555-0177`) to prevent accidental targeting of real individuals during development and validation (compliance per PR #288).
