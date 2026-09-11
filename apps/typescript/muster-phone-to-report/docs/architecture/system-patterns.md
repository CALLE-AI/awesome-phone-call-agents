# Public system patterns

These are implementation contracts, not private development task history.

- **Repository-only persistence:** application policies depend on repository
  capabilities, not raw SQL or Prisma internals.
- **Secret-safe operations:** routine output uses bounded safe facts; secret
  references are resolved only in an explicitly enabled runtime boundary.
- **Dependency inversion:** application ports define required behavior and
  infrastructure adapters implement those contracts.
- **SOLID capability boundaries:** narrow interfaces isolate call dispatch,
  callbacks, evidence custody, persistence, authorization, and cleanup.
- **Versioned extensibility:** schema and policy versions are explicit; avoid
  silently treating a provider change as an equivalent result.
- **No speculative framework:** do not introduce service locators or generic
  repositories that hide the concrete capabilities required by a use case.
- **Mechanical evidence:** type, architecture, integration, and browser checks
  accompany claims; transport success does not prove transcript admission.

Production compositions exclude the non-production simulator host and its
provider capabilities. UI status must not upgrade missing evidence to healthy.
