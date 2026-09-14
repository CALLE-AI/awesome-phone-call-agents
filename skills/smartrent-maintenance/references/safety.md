# Safety Guidelines

- Consent-gated: Tenant submitted the request; calls are expected and authorized.
- Authorized vendors only: Calls go only to pre-vetted roster contacts, never scraped or cold numbers.
- Fictional numbers in samples: Use standards-reserved test numbers (+1-555-0100 to +1-555-0199) in all documentation, tests, and examples.
- Dry-run by default: DRY_RUN=true is enabled by default so no real phone calls are made unless explicitly enabled.
- Masked phone numbers: Tenant and vendor phone numbers are masked in logs and demo views.
- Secret protection: Never commit API keys or private tokens. All credentials must be read from environment variables.
- Human review: Workflows require tenant confirmation and coordinator visibility before scheduling.
- Idempotency: CALL-E idempotency keys prevent accidental repeated calls.
- Fail closed: If calls fail, result in low confidence, or encounter unexpected errors, the workflow transitions to FAILED for human intervention.
