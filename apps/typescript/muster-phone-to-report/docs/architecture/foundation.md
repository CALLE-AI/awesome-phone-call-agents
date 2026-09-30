# Application foundation architecture

Muster is a TypeScript modular monolith with separately startable API and worker processes, a dedicated non-production simulator-host process, and a separately built web application. PostgreSQL is authoritative for foundation audit evidence, evidence-backed observation persistence, simulator authorization/result state, and pg-boss work. This document describes repository ownership and extension rules; it does not describe a deployed production topology.

## Dependency direction and ownership

Arrows below point from importer to dependency. The server and browser graphs are separate:

```text
apps/api and apps/worker production composition roots
apps/simulator-host non-production composition root
                         |
                         v
          infrastructure and interface adapters
                         |
                         v
packages/application --------------------> packages/contracts
                         |
                         v
                 packages/domain

apps/web ----------> packages/api-client
docs/api/openapi.yaml --generates--> packages/api-client
```

- `packages/domain` owns framework-free values and invariants.
- `packages/contracts` owns versioned, client-safe wire and job carriers.
- `packages/application` owns use cases and capability-specific ports. It depends on `packages/domain` and `packages/contracts`, and imports no framework, database, queue, telemetry, or UI implementation.
- `packages/infrastructure-postgres` owns Prisma generation, mapping, repositories, and database readiness.
- `packages/infrastructure-jobs` owns pg-boss scheduling, delivery, recovery, and queue readiness.
- `packages/infrastructure-calle` alone owns exact-pinned CALL-E `0.6.0`, constructs the documented generic-call request with separate task and per-recipient result schemas, propagates W3C context, validates terminal recipient evidence/anchors, and writes transcript custody before returning provider-neutral output.
- `packages/infrastructure-twilio-simulator` owns Twilio public-root use, signed simulator authorization, synthetic TwiML callbacks, guarded CALL-E terminal mapping, and the optional live-smoke gate. It is not present in production composition.
- `packages/infrastructure-local-evidence` owns bounded transcript custody outside Git and operational PostgreSQL.
- `packages/observability` owns Pino and OpenTelemetry implementations behind vendor-free application types.
- `apps/api/src/composition` and `apps/worker/src/composition` are the only application roots that construct concrete adapters.
- `apps/simulator-host` is the separate non-production root that composes PostgreSQL, pg-boss, local custody, CALL-E, signed Twilio callback HTTP, safe observability, and bounded reverse-order cleanup. Production API/worker/web composition cannot import it or its provider adapters.
- `apps/web` consumes only `@muster/api-client`; it does not import `packages/contracts` or any server package. `docs/api/openapi.yaml` remains the transport source of truth from which the client is generated.

Every workspace publishes an explicit root export. Cross-workspace `src` or `dist` imports, generic repositories, raw Prisma queries, inline SQL, and production `console.*` calls are policy failures.

## Foundation verification path

The health HTTP operation is deliberately read-only. `GET /api/v1/system/health` probes the real PostgreSQL and job adapters and returns only `ready` (`200`) or `degraded` (`503`). It never enqueues work.

The independent `foundation-health.v1` application port proves the asynchronous boundary. Phase 6 schedules two correlation-distinct requests through the real pg-boss adapter, consumes them through the worker use case, persists both audit results through Prisma, and verifies the W3C carrier at the consumer seam. A separate degraded-path case leaves the real job backend stopped and verifies that the generated client observes `degraded`. The Playwright journey checks only the status shell's ready/degraded accessibility; it does not simulate a product or device workflow.

Evidence-backed device observation Phase 2 extends the persistence boundary. Application-owned profile, call-attempt, evidence, and observation ports map through aggregate-specific Prisma repositories to normalized, organization-scoped tables. PostgreSQL constraints establish idempotency and lineage; repository transactions keep evidence and observation corrections append-only and unbranched.

Phase 3 adds request, lost-enqueue recovery, dispatch, result-recording, and operation-projection use cases. The provider-neutral `observation-request.v1` carrier runs on the same owned pg-boss client as `foundation-health.v1`; its singleton key is only an admission hint because PostgreSQL-established operation, provider-dispatch, evidence-revision, and derivation identities remain authoritative. Current profile and authorization/DTMF/capacity/kill-switch/provider-binding gates run before provider construction. Safe retry metadata permits redelivery with one stable provider identity, terminalizes exhaustion, and preserves terminal failures without fabricating observations.

Phase 4 publishes the workflow through optional NestJS/Fastify POST request and GET operation-status routes. Composition must supply the observation use cases and an organization-scoped authorizer before the module registers. The controller maps application outcomes into safe envelopes and bounded completion telemetry; denied or failed authorization is concealed as `404`, matching replay returns repository-established lifecycle truth, and provider or evidence failure never fabricates an Observation. `docs/api/openapi.yaml` is canonical, generated output is checked for semantic and byte drift, and the stable client bounds returned headers and errors. Executable production startup still does not register observation dependencies, and there is no production provider adapter, approved live-device binding, observation UI, or device call.

Transparent device simulator Phase 3 adds the isolated signed Twilio/live-smoke adapter boundary. Hackathon Live CALL-E Observation Phases 2-3 supply durable PostgreSQL authorization, bounded local transcript custody, the exact-pinned CALL-E `0.6.0` adapter, and the dedicated non-production host that binds the real repository/job/listener/observability seams. Signed exact claims are atomically reserved before CALL-E construction, signed callbacks bind one provider call, transcripts and exact-shape evidence are admitted before interpretation, and the final result uses transaction-scoped repositories with a DTMF disposition check immediately before commit. A blocked canary rolls back the result transaction and records a safe terminal failure. The host exposes only the separately documented `POST /twilio/voice` and `POST /twilio/canary/{callbackHandle}` callbacks; `docs/api/openapi.yaml` and generated production clients remain unchanged. The runtime is loopback-hosted, production-forbidden, one-call/concurrency-one, timeout-bounded, retry-free at the provider boundary, and DTMF-forbidden. Verification used injected/synthetic boundaries only; no credential, external provider call, tunnel, deployment, or hardware evidence was used.

## Extension rules

1. Add domain rules without framework or vendor imports.
2. Define a narrow application-owned port for each required capability; do not expose Prisma, pg-boss, Fastify, Pino, or OpenTelemetry types.
3. Implement the port in the owning infrastructure or interface-adapter package.
4. Export only the stable package root and add a dependency-policy mutation proving forbidden directions still fail.
5. Bind the concrete adapter in an approved API/worker production root or the dedicated non-production simulator host, with fail-closed configuration and owned cleanup. Never move simulator/provider dependencies into production API, worker, or web composition.
6. Add unit/contract tests with the behavior and real integration coverage at the infrastructure boundary. Product-facing journeys add browser coverage in addition to, never instead of, those tests.
7. Change OpenAPI first, regenerate the committed client, and verify zero drift. Change Prisma schema and migration together, then validate against an empty disposable database.

## Contributor workflows

- Install: `corepack pnpm install --frozen-lockfile` using Node `24.18.0` and pnpm `11.20.0`.
- Browser prerequisite: `corepack pnpm exec playwright install chromium`.
- Complete local/CI gate: `corepack pnpm verify:foundation`.
- Simulator host build/start: `corepack pnpm --filter @muster/simulator-host build`, then `corepack pnpm --filter @muster/simulator-host start` only with the complete fail-closed local configuration documented in `docs/api/simulator-host-webhooks.md`.
- OpenAPI: edit `docs/api/openapi.yaml`, run `corepack pnpm generate:api-client`, then run the complete gate.
- Prisma: edit `prisma/schema.prisma`, create and review a generated migration, run `corepack pnpm prisma:validate`, `corepack pnpm prisma:generate`, and then the complete gate. The generation wrapper normalizes committed TypeScript to LF with no trailing whitespace and repeated generation must remain byte-stable. Migration deployment requires an explicit `MIGRATION_DATABASE_URL` and never uses the schema-only fallback.

CI pins actions to full commit SHAs, grants read-only contents permission, installs the exact toolchain and browser prerequisite, performs a frozen install, and invokes the same aggregate once. Integration data, credentials, database names, and job schemas are synthetic and run-owned.

## Explicit limitations and downstream handoff

The current repository implements observation persistence plus provider-neutral request, recovery, dispatch, result, projection, job, authorized REST, generated-client behavior, and a dedicated local non-production simulator host. The host has signed Twilio callbacks and a concrete CALL-E adapter but no browser live-run admission/status route in Phase 3. It is not a production provider adapter or deployed service and does not establish approved external calling, live-provider success, telephone/network behavior, Sensaphone compatibility, or device interaction. Production observation registration, approved live-device behavior, incidents, escalation, consent, tenant roles, billing, deployment, backup, retention, and production authentication remain unimplemented. Production health remains disabled unless a reviewed internal-policy adapter is composed. Local/CI pool, concurrency, retry, and timing values, including the current two-second observation polling guidance, are verification defaults rather than production SLOs.

The predecessor CALL-E and Sensaphone evidence decisions remain `NO-GO`. Green repository, integration, and browser checks do not upgrade provider lifecycle, hardware compatibility, authorization, production-readiness, compliance, or safety evidence. Downstream features must preserve unknown/unavailable evidence explicitly and satisfy their own acceptance and UAT gates.
