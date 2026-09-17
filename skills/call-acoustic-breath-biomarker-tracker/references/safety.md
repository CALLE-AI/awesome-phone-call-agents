# Safety and Compliance

1. **Software as a Medical Device (SaMD)**: This skill provides assistive triage logic but does not replace formal clinical diagnosis. It should be used under appropriate regulatory frameworks and medical supervision.
2. **HIPAA / PII Privacy**: Acoustic recordings must be processed in real-time (ephemerally) or properly de-identified if stored, ensuring no Protected Health Information (PHI) is leaked.
3. **False Negatives**: The system must fail-safe. If the acoustic analysis pipeline crashes, the agent defaults to asking semantic health questions.
4. **Testing Protocol**: All demonstration and unit test data strictly uses the `555-01xx` numbering block to avoid PII violations during validation.
