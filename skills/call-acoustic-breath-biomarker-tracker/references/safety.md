# Safety and Compliance

## Core Safety Principles

1. **Nonclinical Scope**: This synthetic offline demonstration is not a medical device, diagnostic test, triage system, or emergency service. Its enum names do not establish clinical facts or a regulatory status.
2. **No Clinical Fail-safe Claim**: Empty durations return `INDETERMINATE`; this does not establish safety. The helper does not ask health questions, monitor patients, or transfer calls.
3. **HIPAA / PII Privacy**: Acoustic recordings must be processed in real-time (ephemerally) or properly de-identified if stored, ensuring no Protected Health Information (PHI) is leaked.
4. **Testing Protocol & Repository Compliance**: All demonstration and unit test data strictly uses the `555-01xx` numbering block (e.g., `555-0199`) to avoid PII violations during validation, complying with repository rule PR #288. No real patient phone numbers may ever be passed to the processing functions.
