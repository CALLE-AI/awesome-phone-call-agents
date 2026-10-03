# Changelog

## 1.0.0 — 2026-09-13

### Added

- One authorized, disclosed warranty-claim inquiry with a four-layer kernel,
  typed gates, human review, source-version write-back protection, and
  idempotent delivery.
- CALL-E adapter with Calls API as the primary runtime, a conditional
  probe-gated Goal path, bounded GET reconciliation, and no runtime failover.
- Recorded evidence for R1 and R4; failed R8/R3 attempts are disclosed as
  limitations and are never used as evidence.
- Eighteen adversarial rejection families, property suites, concurrency and
  fault-injection tests, structured observability, hash-chained audit events,
  and an operations runbook.
- Offline quality and judge paths, a 95% branch-coverage floor, strict typing,
  lint, dependency auditing, accessibility checks, and a contribution CI
  workflow.

### Security

- Credentials are environment-only; raw live-call artifacts remain outside the
  repository; public evidence passes deterministic scrubbing and leak gates;
  every public evidence field carries exactly one evidence class.

### Known Limitations

- There is no DMS/ERP connector, Goal-primary runtime, campaign, retry ladder,
  runtime failover, or recovered-money claim.
- R8 and R3 were authorized attempts that failed before conversation and
  produce no platform evidence; neither is retried.
- Independent third-party execution, release tag/publication, video, PR, and
  Devpost submission remain separately gated by the owner.
