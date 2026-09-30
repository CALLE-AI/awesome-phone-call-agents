# Safety & Privacy

## Advisory Scope
This skill calculates on-topic keyword overlap and detects consecutive off-topic agent turns. It does NOT understand semantic nuance, sarcasm, or complex contextual reasoning. A `SIGNIFICANT_DRIFT` verdict is a heuristic warning, not a definitive regulatory or compliance ruling.

## PII Masking
All extracted off-topic evidence strings are routed through `mask_pii()` to ensure 7+ digit sequences (such as account numbers or phone numbers) are masked before being included in the JSON card.

## Action Boundaries
The tool only outputs a structural analysis and a recommended bounding goal. It does not automatically intervene in live calls, alter system prompts on the fly, or penalize agents autonomously. Output should be used for retrospective QA and prompt refinement.
