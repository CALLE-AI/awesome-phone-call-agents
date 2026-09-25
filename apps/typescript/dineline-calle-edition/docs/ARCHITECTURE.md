# DineLine CALL-E Edition Architecture

## What the system does

DineLine turns a dinner idea into one reviewed phone action. The DineLine
Concierge collects the diner's preferences. n8n can use those preferences to
retrieve five Google Places results. The diner chooses one result and approves
the exact reservation request. Agent Jake then asks the restaurant for that
reservation and DineLine verifies the returned evidence before reporting an
outcome.

```text
Diner
  -> consent and Agent 1 request fingerprint
  -> CALL-E DineLine Concierge
  -> evidence-checked dining preferences
  -> n8n validation and Google Places search
  -> five cached choices
  -> diner selection and booking fingerprint
  -> CALL-E Agent Jake
  -> evidence-checked booking result
  -> diner
```

The two agents cannot substitute for one another. Agent 1 may gather dining
preferences, but it may not select a business or make a reservation. Agent Jake
receives only the exact booking contract the user approved.

## Public demo and integration workflow

The public web app is a complete no-call demonstration. It runs the real
contracts, fingerprints, journals, role boundaries, and evidence verifiers, but
uses deterministic CALL-E fixtures and five fictional restaurants with
standards-reserved phone numbers.

The generated n8n workflow is the separate integration path. It contains the
Google Places search, normalization, ranking, result cache, selected-result
recovery, and both CALL-E dispatch boundaries. It imports inactive and requires
operator configuration before it can make any network request.

This distinction is deliberate: judges can exercise the workflow safely in a
browser, while maintainers can inspect and run the native integration without
putting credentials or real destinations in the public deployment.

## Security boundaries

| Boundary | Enforcement |
| --- | --- |
| Consent | Agent 1 accepts only a request containing literal one-call consent. |
| Role separation | Separate prompts, schemas, provider factories, and real-call gates are used for Agent 1 and Agent Jake. |
| Language routing | Both CALL-E requests carry `region: US` and `locale: en-US`, and both tasks require clear United States English. CALL-E still controls the actual synthesized voice, so human audio QA remains mandatory. |
| User choice | A booking contract does not exist until the diner selects a restaurant. |
| Cached source | The n8n integration recovers the chosen restaurant from its cached Google result instead of trusting a caller-supplied phone number. |
| Exact approval | SHA-256 fingerprints bind approval to the restaurant, date, time, party size, guest, and call policy. |
| Destination allowlist | Each real provider checks its destination against a separate server-side E.164 allowlist immediately before dispatch. |
| Controlled booking proof | Real mode reveals an owned/authorized test-line field, hides fixture controls, and tells the recipient they are participating in a controlled demonstration. |
| Duplicate prevention | File journals reserve an idempotency key before each provider call. |
| Ambiguous dispatch | CALL-E creation is separate from the bounded five-minute result wait. Once accepted, the call ID is journaled. A timeout becomes `dispatch_unknown`; the system does not retry because the call may already have started. |
| Outer timeout | Real n8n dispatch waits 330 seconds around the provider's bounded 300-second result wait, preserving one-attempt behavior while avoiding a premature n8n timeout. |
| Safe reconciliation | The UI never supplies an arbitrary CALL-E ID. The server reads the ID already bound to the approved request and performs one status GET; reconciliation cannot create a call. |
| Evidence | Structured output, provider state, confidence, transcript evidence, and approved details must agree before DineLine reports success. |
| Wire schema | CALL-E-compatible primitive schemas use explicit unknown sentinels; DineLine normalizes them into strict internal values before verification. |
| Hosted safety | The Vercel adapter overwrites all runtime call settings and always creates fixture providers. |

## Important files

| Path | Purpose |
| --- | --- |
| `public/` | Responsive judge interface and the safe fixture journey. |
| `src/domain/dining-preferences.ts` | Agent 1 request and result contracts. |
| `src/providers/calle/calle-intake-provider.ts` | Native CALL-E task for the DineLine Concierge. |
| `src/domain/booking-contract.ts` | Immutable Agent Jake booking contract. |
| `src/providers/calle/calle-sdk-provider.ts` | Native CALL-E task for Agent Jake. |
| `src/providers/calle/call-runner.ts` | Create-then-wait execution, accepted-ID preservation, result mapping, and read-only status retrieval. |
| `src/providers/calle/phone-allowlist.ts` | Fail-closed real-call destination policy. |
| `tests/calle-schema-contract.test.ts` | Regression gate for CALL-E's supported JSON Schema subset and sentinel normalization. |
| `src/services/` | Idempotency and evidence verification. |
| `src/adapters/` | Strict request and response contracts for n8n. |
| `src/server.ts` | Browser and n8n HTTP routes. |
| `api/index.ts` | Fixture-only Vercel adapter. |
| `scripts/generate-n8n-workflows.mjs` | Reproducible workflow generator. |
| `n8n/` | Sanitized, inactive integration and fixture proof. |
| `tests/` | Contract, safety, unhappy-path, adapter, and workflow checks. |

## Current limits

- The public restaurant cards are fictional; they are not live Google Places
  responses.
- The file journal is suitable for a local demonstration, not distributed
  production idempotency.
- The generated n8n cache is an integration proof, not a durable production
  data store.
- A real call must run locally with a CALL-E key, the role-specific gate, and an
  exact owned or authorized destination allowlist.
- The real Agent Jake proof calls an authorized test participant who role-plays
  the restaurant; the public demo never contacts a listed business.
- DineLine never treats an ambiguous call as a confirmed reservation.
