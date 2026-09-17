# Safety & Compliance

1. **Test Data Phone Numbers**: The auditor actively scans the input script for phone number patterns. If a phone number is found, it **must** belong to the `555-01xx` range. If a real phone number is detected, the auditor will immediately raise a `ValueError` (PR #288 Compliance).
2. **False Positive Disclaimer**: The output JSON explicitly includes a `false_positive_disclaimer`. This ensures that downstream users do not treat the heuristic output as formal legal clearance.
3. **Fail-Closed Design**: If an unknown jurisdiction is passed, the auditor fails immediately rather than skipping checks. If the `overall_verdict` is `FAIL`, the agent should block the outbound call.
