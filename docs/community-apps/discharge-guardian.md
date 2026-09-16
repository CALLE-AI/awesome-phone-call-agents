# Discharge Guardian — proposed design reference

This documentation-only contribution describes an author-proposed CALL-E
post-discharge follow-up workflow. It is not a runnable app package or a verified
offline pipeline. The [author-supplied source link](https://github.com/arvindkumar-ship-it/Discharge-Guardian)
was not publicly accessible during review on 2026-09-15; no replacement source or
working setup instructions are available here.

## Proposed workflow

The design would contact authorized patients within 48 hours of discharge, collect
reported medication, symptom, and follow-up information through a bounded phone
conversation, and present advisory care-gap flags in a clinical review dashboard.
The author's proposed stack is FastAPI, async SQLAlchemy, SQLite, a Next.js
dashboard, and Docker Compose. These are design descriptions, not independently
verified implementation or safety claims.

## No-call review and limits

Read this note as an architecture sketch only. A manual, fictional walkthrough
can follow: discharge event → simulated conversation → advisory summary → human
care-team review. No code, persistence, dashboard, credentials, or calls are
provided or required by this contribution.

Any future implementation should default to synthetic, no-call data and require
explicit operator approval and authorized destinations before live calls. Clinical
decisions and escalations need qualified human review; this note is not medical
advice, emergency monitoring, or a production care system. Cancellation and live
side-effect behavior cannot be verified until an implementation is available.
