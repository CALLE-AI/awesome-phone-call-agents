# Safety and Compliance

1. **Feedback Loop Constraints**: The agent's reflection engine must be constrained by rigid system guardrails so that it cannot "learn" to bypass safety protocols (e.g., learning to share PII if a user rates it highly for doing so).
2. **NIST AI RMF (Continuous Monitoring)**: This skill strictly adheres to the NIST AI RMF guidelines for TE.1-2 by providing an audited, transparent mechanism for continuous AI monitoring and improvement.
3. **Data Retention**: Transcripts used for LLM-as-a-Judge evaluations must be purged of PII before the reflection step to ensure the long-term RAG memory bank contains zero sensitive data.
4. **Testing Protocol**: All demonstration and unit test data strictly uses the `555-01xx` numbering block to ensure privacy compliance.
