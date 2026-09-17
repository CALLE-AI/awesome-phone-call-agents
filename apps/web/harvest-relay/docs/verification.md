# Verification record

## Real provider connectivity

On 2026-09-14 at 14:18:04 UTC, the project's actual Node CLI authenticated with the production CALL-E API and completed `GET /v1/goals?limit=1`. The response was successful and contained zero goals. The sanitized receipt is [connection-check.json](connection-check.json).

This proves API connectivity and access for the configured account. It does not prove a completed telephone call, a working carrier route, or an operational food-rescue outcome. No real destination was dialed for this submission.

Credentials were obtained from the CALL-E dashboard using its normal Google login and key-creation interface. The API key remains in a private local file and is excluded from all public source, demo assets, and recordings.

On Node 24 behind an HTTP proxy, run with `NODE_USE_ENV_PROXY=1` so the built-in HTTP client uses the configured proxy. No proxy is required by the application itself.

## Reproducible functional evidence

`npm test` tests the actual shared solver, API client and reviewed result importer. `npm run integration-demo` imports two explicitly synthetic, CALL-E-shaped TEST results, clears unrelated fixture facts, and evaluates the resulting scenario. The number of compatible pairs changes from zero, to zero after storage alone, to one after both providers have been imported. The result is $310, with a 14:25 handoff.

The integration demo makes zero network requests and places zero calls. Its purpose is to make the result-to-decision path reproducible without account credentials.

The browser uses the same `web/engine.js` evaluator. Its visible demonstration checks all six pairs, selects Riverside and Swift for 900 kg, selects Orchard and the local van for 650 kg, and returns no compatible full-load handoff when the deadline is 14:00. Source conversations and exported evidence are explicitly synthetic.

## Scope of claims

- Implemented: request generation, opt-in call creation, private operation reservation, status/event reads, operator-reviewed result ingestion, deterministic pair evaluation, browser rehearsal, evidence export.
- Verified live: read-only API connectivity and account access.
- Verified without calls: request/response contracts, duplicate prevention, unknown/expired facts, service-date checks, all solver constraints, result ingestion and complete browser rehearsal.
- Not claimed: completed PSTN pilot, real provider capacity, verified road travel time, actual produce rescued, food safety certification, or automated booking.
