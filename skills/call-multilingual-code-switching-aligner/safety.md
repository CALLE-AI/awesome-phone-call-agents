# Safety and Compliance

1. **Bias and Stereotyping (ISO/IEC 42001)**: The agent must mathematically mirror the user's *actual* code-switching behavior. It must NEVER assume code-switching based on a caller's accent, name, or phone number area code, as this constitutes stereotyping and bias.
2. **Grammar and Hallucination**: The LLM must adhere to the Matrix Language Frame (MLF) theory to ensure code-switching happens at natural syntactic boundaries, avoiding offensive or non-sensical language generation.
3. **Emergency Hand-offs**: If the conversation turns to critical matters (e.g., medical symptoms, legal terms), the agent should gracefully revert to the user's dominant monolingual preference to avoid fatal misunderstandings.
4. **Testing Protocol**: All demonstration and unit test data strictly uses the `555-01xx` numbering block to ensure privacy compliance.
