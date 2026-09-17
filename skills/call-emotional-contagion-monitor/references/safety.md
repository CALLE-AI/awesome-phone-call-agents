# Safety and Compliance

1. **Emotional Manipulation Guardrails**: The system must never encourage the agent to artificially "gaslight" the user or exhibit toxic positivity when a genuine grievance is raised.
2. **PII and Data Handling**: Transcripts used for evaluating contagion risk must be ephemeral or fully redacted of PII before being written to persistent storage.
3. **Testing Protocol Compliance**: All unit test files and example transcripts must use the `555-01xx` phone number block to adhere to repository standard PR #288. Real phone numbers are strictly prohibited.
4. **Bias in Sentiment Detection**: Keyword-based heuristics can exhibit sociolinguistic bias. Arousal dictionaries must be validated against diverse demographics to ensure dialects or culturally-specific expressions of urgency are not systematically flagged as "aggression".
