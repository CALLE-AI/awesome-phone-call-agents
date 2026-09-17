# Safety & Compliance

1. **Testing Protocol Compliance**: All test examples and script executions MUST strictly use the `555-01xx` numbering block. The `SelfReflectionScorer` will raise a `ValueError` if a real phone number is provided, adhering to repository PR #288 rules.
2. **PII in Critiques**: The LLM-as-a-Judge prompt must be instructed to NEVER include user PII (names, SSNs, phone numbers) in the generated `critique` or `recommendation` fields, as these fields are logged for agent tuning.
3. **Judge Hallucination**: The self-reflection model must be temperature 0.0 to avoid hallucinating mistakes that did not actually occur in the transcript.
