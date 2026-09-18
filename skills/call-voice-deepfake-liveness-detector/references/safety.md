# Safety and Compliance

## Core Safety Principles

### 1. Missing-Feature Handling
A wrongly flagged legitimate caller can be harmed by an incorrect decision. The helper returns advisory labels only and does not enforce a fail-open or fail-closed call policy:
- The shipped helper only treats missing (`None`) features as unavailable; it has no SNR quality gate. A future host must handle unreliable/non-finite inputs separately.
- At least two supplied features are averaged; this is not a two-feature consensus or identity check.
- Friction challenges are phrased as natural verification questions, not accusations.

### 2. No Voice Data Retention
- This helper processes numeric inputs only and performs no audio collection, storage, network requests, or logging.
- Any host integration must independently govern audio/feature retention and access; numerical voice features may still be identifying.
- No GDPR, CCPA, or other legal compliance is established by this prototype.

### 3. Bias and Equity
- The skill must be validated across diverse speaker demographics (age, accent, native language) to ensure the liveness threshold does not disproportionately flag speakers with non-standard vocal characteristics (e.g., elderly voices, non-native accents) as synthetic.
- Threshold calibration must include diverse validation datasets before deployment.

### 4. Regulatory Alignment
- FTC materials are background reading, not certification that this prototype satisfies any regulatory obligation.
- The skill is positioned as a **risk-mitigation tool**, not a definitive forensic system. All SYNTHETIC flags must route to human review for final decision.

### 5. Testing Protocol
All demonstration data and unit tests strictly use the `555-01xx` numbering block (e.g., `555-0101`, `555-0177`) to prevent accidental targeting of real individuals during development and validation (compliance per PR #288).
