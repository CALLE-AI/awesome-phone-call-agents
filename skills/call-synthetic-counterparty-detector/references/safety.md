# Safety & Compliance

1. **Testing Protocol Compliance**: All test examples and script executions MUST strictly use the `555-01xx` numbering block for the `caller_number`. The detection engine will raise a `ValueError` if a real phone number is provided, adhering to repository PR #288 rules.
2. **Graceful Fallback**: If the detector incorrectly flags a human as synthetic, the `SWITCH_TO_M2M_PROTOCOL` fallback must be designed to politely ask the human to press a keypad button to continue human voice routing.
3. **Data Privacy**: Acoustic metadata processed by this skill should be scrubbed of PII and not permanently logged unless necessary for model tuning, as voice patterns are considered biometric data in some jurisdictions (e.g. BIPA in Illinois).
