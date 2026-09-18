# Safety & Compliance Reference

This document describes safety boundaries for appointment-backfill phone-call workflows. The current app is a reference demo and does not fully implement production medical, legal, compliance, or security controls.

## Current Implementation Boundary

Implemented in this demo:

- Bearer authentication is required on `/api/*` routes.
- Cancellation routes require an exact patient ID and appointment ID match.
- Phone numbers are validated with strict E.164 format before outbound calls.
- Real outbound calls require `ALLOW_LIVE_CALLS=true`, a configured CALL-E API key from an approved origin, and exact destinations listed in `ALLOWED_LIVE_RECIPIENTS`.
- Phone numbers are masked in logs, dashboard responses, and raw call-result payloads stored by this app.
- Backfill calls are sequential.
- Timeout, no-answer, failed, and ambiguous results stop the cascade for manual review.
- Accepted waitlist results are advisory only; this app does not finalize clinical booking or rescheduling.

Not implemented in this demo:

- HIPAA-ready storage or audit controls.
- Consent management.
- Encryption at rest for SQLite data.
- EHR integration or system-of-record writes.
- Production job queue, durable retries, or distributed locks.
- Quiet hours, call-frequency limits, or opt-out enforcement.
- Legal review for TCPA, HIPAA, GDPR, or regional call recording rules.

## Live Call Requirements

Before enabling real calls:

1. Use only consented, reachable E.164 numbers.
2. Set `ALLOW_LIVE_CALLS=true` only for an approved run.
3. Set `CALLE_API_KEY` from a secure configured origin.
4. Set `CALLE_API_KEY_SOURCE` to `env`, `secret-manager`, or `vault`.
5. Put every exact allowed destination in `ALLOWED_LIVE_RECIPIENTS`.
6. Keep provider credentials out of request bodies, logs, and browser code.
7. Monitor outbound activity while the run is active.

## Clinical Boundary

AI phone-call results must not be treated as final medical scheduling decisions. A patient saying yes to an offered slot is evidence for staff review. Clinic staff or the system of record must finalize any booking, cancellation, or rescheduling according to clinic policy.

## Required Production Controls

A production deployment should add, at minimum:

- Written consent tracking and opt-out handling.
- Immutable audit logs with user attribution.
- Encrypted storage and transport controls.
- EHR integration with conflict checks.
- Human approval gates where required by clinic policy.
- Rate limits, quiet hours, retry policy, and duplicate-job prevention.
- Incident response and data retention policy.
- Legal and compliance review for every operating region.

Phone calls are real-world side effects. Keep mock mode on until the run is explicitly authorized and monitored.
