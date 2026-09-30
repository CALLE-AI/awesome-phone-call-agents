# Project Evidence and Judge Access

## Scope

This directory is the public, safety-locked companion for **Navigator Outreach**. It is intentionally no-call. It demonstrates CALL-E SDK availability plus fail-closed safeguards, fictional mock behavior, and verification steps without credentials, phone numbers, live transport, or call dispatch.

It is **not** the private canonical application and must not be treated as proof of a completed outbound CALL-E call.

## Corrected canonical evidence

The following private-release results are author-reported and have not been
independently verified as part of this public contribution. The author identifies
the corrected private canonical release by:

- Filename: `Navigator_Outreach_Gate6_Phase4_5PM-9PM_BINDING_R1_CORRECTED.zip`
- SHA-256: `cabc54c57e90f69e3e75a616e69aa02af0b4545f9027915b150643499b31ee63`
- Closed verification result: **158/158 mock/no-call tests passed**
- TypeScript: PASS
- Production build: PASS with Vite's runner config loader, 48 modules
- Verified: September 5, 2026

The author reports these results for the corrected canonical package's mock/no-call
and safety behavior. They **do not establish successful live outbound CALL-E execution**.

The private canonical archive is intentionally not included in this public contribution.

## Historical authenticated CALL-E runtime evidence

The author reports a retained private project evidence record dated **August 9, 2026**
for an authenticated CALL-E SDK/API operation using the following read-only request.
This historical account has not been independently verified as part of this contribution:

`GET /v1/goals?limit=1`

The record states that authentication was accepted and the response structure was validated. No call was created, scheduled, initiated, or attempted, and no credential was retained in that evidence record.

This is historical runtime evidence. It is not a fresh execution of the corrected September 5 canonical ZIP and it is not proof of a completed outbound telephone call.

## Live outbound status

Live end-to-end outbound CALL-E validation remains **PENDING**. Navigator Outreach does not claim a successfully completed live outbound call.

## Judge-access build

A separate static judge-access ZIP is prepared from the application's frontend/mock workflow. It contains only a fictional local walkthrough plus instructions, static assets, notices, and checksums. It contains no backend, credentials, private canonical source, real participant data, or live calling capability.

- Judge build filename: `Navigator_Outreach_Judge_Access_Build.zip`
- Judge build SHA-256: `7e6f402efb479be5d57505ce47dcc5c901c8124c8b4ad5a2c2bf28ce9c36d3fd`
- Judge download URL: https://github.com/Stige-63/awesome-phone-call-agents/releases/download/navigator-outreach-judge-v1.0/Navigator_Outreach_Judge_Access_Build.zip

Judges can use that build to review the implemented fictional consent → approval → mock result → human-review workflow locally. It is mock/no-call access only.

## Public companion verification

From this directory:

```bash
npm ci
npm run verify
```

The default verification is offline/no-call and requires no credentials.

## Evidence boundaries

Please keep these claims separate:

1. **Public companion:** SDK import + permanent no-call safeguards + fictional mock verification.
2. **Author-reported canonical evidence (not independently verified):** 158/158 mock/no-call tests, TypeScript PASS, production build PASS.
3. **Author-reported historical runtime evidence (not independently verified):** read-only authenticated `GET /v1/goals?limit=1` on August 9, 2026.
4. **Live outbound execution:** pending; not established by the evidence above.
