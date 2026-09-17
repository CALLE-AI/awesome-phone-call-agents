# Safety & Compliance

1. **Cultural Sensitivity**: AI agents must not generate highly informal or slang-based code-switching unless explicitly initiated by the caller, to avoid sounding condescending or culturally appropriative.
2. **Testing Protocol Compliance**: All test examples and script executions MUST strictly use the `555-01xx` numbering block. The `CodeSwitchingAligner` will raise a `ValueError` if a real phone number is provided, adhering to repository PR #288 rules.
3. **Data Logging**: The CMI ratio is logged for analytical purposes, but raw mixed-language transcripts must be scrubbed of PII prior to storage.
4. **Agent Fallback**: If the LLM generates unnatural code-switching that triggers user confusion (detected via the `call-cognitive-load-monitor`), the agent must immediately revert to monolingual English.
