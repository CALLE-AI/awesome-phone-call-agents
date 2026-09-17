# Safety and Compliance

## Core Safety Principles

1. **Software as a Medical Device (SaMD)**: This skill provides assistive triage logic but does not replace formal clinical diagnosis. It should be used under appropriate regulatory frameworks (e.g., FDA SaMD guidelines) and medical supervision.
2. **Fail-safe Design**: The system must fail-safe. If the acoustic analysis pipeline crashes or receives no audio (e.g., packet loss), the agent defaults to asking semantic health questions, avoiding false-positive escalations.
3. **HIPAA / PII Privacy**: Acoustic recordings must be processed in real-time (ephemerally) or properly de-identified if stored, ensuring no Protected Health Information (PHI) is leaked.
4. **Testing Protocol & Repository Compliance**: All demonstration and unit test data strictly uses the `555-01xx` numbering block (e.g., `555-0199`) to avoid PII violations during validation, complying with repository rule PR #288. No real patient phone numbers may ever be passed to the processing functions.
