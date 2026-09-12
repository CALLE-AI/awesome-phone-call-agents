# Implementation plan

Written at the start of the build (Phase B) and kept updated as the work landed.

## Starting state

`d:/Call-E App` was empty. A related project existed at `d:/Call-E`
("CALL-E FrontDesk") with a working CALL-E integration, a Drizzle/PGlite
database and an Expo app — but built around a different product (restaurant
front-desk waitlist backfill plus single-call delegation).

Its **research** into the CALL-E API was independently re-verified against the
shipped `@call-e/calle@0.7.0` type definitions and proved accurate; that
knowledge was reused. None of its code was.

The decision to build fresh rather than extend it was the user's, taken with the
trade-off stated explicitly.

## Gap analysis

What the brief requires that did not exist anywhere:

| Capability | Status at start |
| --- | --- |
| Business / internet discovery | absent |
| Geocoding and location constraints | absent |
| Candidate verification and ranking | absent |
| Universal `DialTask` interpreter | absent |
| Multi-business call waves | absent |
| Comparison and evidence engine | absent |
| Durable queue + separate worker process | absent |
| Authorization policy engine | absent |
| The screenshot's UI | absent |

That is the majority of the product. The phone-call mechanics were the smaller
half.

## Target architecture

Dial orchestrates; CALL-E executes phone work. A TypeScript monorepo with the
domain logic in pure, testable packages and two thin processes (API, worker)
over one Postgres database. Full detail in `ARCHITECTURE.md`.

## Risks identified up front, and how each was handled

| Risk | Handling |
| --- | --- |
| No Google Places key → discovery becomes a mock | Used OpenStreetMap, which is real and keyless. Verified live before building on it. |
| No Redis → queue becomes an in-memory fake | Built the queue on Postgres with `SKIP LOCKED`. Durable, no new infrastructure. |
| No LLM key → interpretation becomes a hard-coded classifier | Refused to build a fallback. Task creation fails with a precise 503. |
| Real calls to real businesses during development | Fake provider by default; `TEST_PROVIDER=real` without a key refuses to boot; the only real-call path takes a number on the command line. |
| CALL-E docs lagging the package | Read the shipped `.d.ts` and generated OpenAPI types instead. |

## Order of work

1. **Reconnaissance** — inspected `d:/Call-E`, verified the CALL-E package
   surface directly from `node_modules`.
2. **Foundation** — config with boot-time coherence checks, schemas, pure domain
   logic. **Tested before anything depended on them** (76 tests).
3. **Database** — schema, forward-only migrations, Postgres job queue. Tested
   against real Postgres (7 tests) — which is where the migration splitter bug
   surfaced.
4. **Discovery** — provider interfaces, OSM implementation, SSRF-guarded HTTP.
   **Verified against the live internet** before writing anything on top of it.
5. **CALL-E adapter** — real provider, fake provider, call planner.
6. **Interpreter** — Gemini, schema-constrained output, no fallback.
7. **Orchestrator** — the pipeline, the runner, the webhook receiver.
8. **API** — auth, REST, SSE, webhook endpoint. Then 34 integration tests, which
   found four real defects.
9. **Web** — BFF proxy, then the screenshot's shell, composer, task view,
   history and settings.
10. **Mobile** — Expo Router, secure-store auth, native permissions. Bundled for
    both platforms.
11. **Hardening and verification** — lint, typecheck, full build, 24 e2e checks
    against a running stack.
12. **Documentation** — including an honest BLOCKED list.

## What landed

- 11 packages, 4 apps, 141 automated checks, lint and typecheck clean.
- Real discovery working against the live internet.
- Real CALL-E adapter, built against verified types, exercised only through the
  fake provider so far.
- Web and mobile on one account, one database, one set of contracts.

## What did not land, and why

| Item | Blocker |
| --- | --- |
| Real task interpretation | `LLM_API_KEY` not supplied |
| Any real phone call | `CALLE_API_KEY` and an authorised number not supplied |
| The four acceptance scenarios end-to-end | both of the above |
| Signed store builds | developer credentials |
| Push notification delivery | FCM/APNs credentials |
| Multi-worker queue contention | needs a real Postgres server |
| Visual/responsive verification | no browser driver here |

Every one of these is a missing credential or a missing device, not missing
code. `docs/TESTING.md` names exactly what each needs.

## Deferred deliberately

- **Google Places** — the adapter is written and activates on a key; not
  exercised.
- **Web search cross-verification** — the `WebSearchProvider` interface exists;
  no implementation, since the second corroborating source is currently OSM
  versus Google Places.
- **CSRF tokens** — mitigated by same-origin proxy plus `SameSite=Lax`; an
  explicit token is the next hardening step.
- **BullMQ driver** — the seam is there, unused without Redis.
- **Voice input** — the microphone permission is declared; no dictation UI.
