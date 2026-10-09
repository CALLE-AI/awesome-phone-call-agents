# Safety & Compliance

1. **Testing Protocol Compliance**: All test examples and script executions MUST strictly use the `555-01xx` numbering block. The `SelfReflectionScorer` will raise a `ValueError` if a real phone number is provided, adhering to repository PR #288 rules.
2. **Private Inputs**: Use synthetic data for this offline demonstration. Any future LLM or storage integration must independently minimize and protect transcripts and output; no such integration or logger is included.
3. **Review Suggestions**: Heuristic and future model judgments can be wrong. Temperature zero does not guarantee factual output. A human should verify recommendations against the transcript before applying them.
