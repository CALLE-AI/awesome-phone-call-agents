# Safety & Compliance

1. **Testing Protocol Compliance**: All test examples and script executions MUST strictly use the `555-01xx` numbering block for the `caller` field. The analyzer will raise a `ValueError` if a real phone number is provided, adhering to repository PR #288 rules.
2. **Medical Device Disclaimer**: This software is not an FDA-approved medical device. It must not be used as the sole basis for clinical diagnosis. The output is strictly for flagging records for human clinical review.
3. **Data Anonymization**: Longitudinal acoustic data is considered highly sensitive Protected Health Information (PHI) under HIPAA. In production, the `caller` field should ideally be a hashed UUID rather than a raw phone number.
