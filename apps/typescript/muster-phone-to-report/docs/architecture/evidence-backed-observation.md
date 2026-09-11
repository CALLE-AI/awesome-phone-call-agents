# Evidence-backed observation architecture

This slice proves a provider-neutral repository workflow with reviewed `SIMULATED` fixtures. It
does not describe a deployed topology and does not prove provider, CALL-E, Sensaphone, hardware,
device, deployment, or production-readiness behavior.

## Ownership and flow

```text
generated @muster/api-client          scheduled trigger
             |                              |
             v                              v
NestJS/Fastify observation adapter --> RequestObservation
                                          |
                 PostgreSQL CallAttempt <-+-> pg-boss observation-request.v1
                                                   |
                                                   v
                                      ObservationJobHandler / worker
                                                   |
                                  dispatch policy -> VoiceCallPort
                                                   |
                                                   v
                              EvidenceRecord -> reconciliation -> Observation/Reading
                                                   |
                                                   v
                                GET /api/v1/observations/{operationId}
```

Composition roots construct concrete interface and infrastructure adapters. Application use cases
depend only on domain/contracts and capability ports. Prisma, pg-boss, NestJS/Fastify, Pino,
OpenTelemetry, provider, and generated-client types do not enter domain or application public
contracts. The web application can consume only `@muster/api-client`.

## Durable identity and restart behavior

`CallAttempt` is both the database authority and REST `operationId`. Manual and scheduled requests
share a semantic fingerprint and one provider-dispatch identity. The attempt is persisted before
enqueue, so recovery can resubmit a lost scheduled intent. Queue singleton state limits duplicate
delivery but never replaces database idempotency. Redelivery and worker restart re-read the attempt;
a terminal attempt returns without another provider dispatch.

Stage is monotonic: `scheduled` to `calling` to `extracting` to `terminal`. Source evidence is
retained before derivation. Provider/evidence revisions and derived observations append versions
with predecessor links; they do not overwrite prior records or move the attempt backward.

## Failure topology and evidence safety

Authorization, immutable profile eligibility, DTMF policy, capacity, kill switch, and provider
binding are evaluated before provider construction. A block persists a safe terminal attempt. A
provider or evidence failure also persists a closed terminal outcome with `observation: null`; it
creates no Reading, normal state, threshold result, recovery result, or synthetic evidence.

Routine responses, logs, spans, and metric attributes exclude telephone numbers, credentials,
authorization material, transcripts, raw provider payloads, evidence content, and organization,
endpoint, provider, or evidence identifiers. Metrics use closed route, method, status-class, stage,
quality, and safe-outcome labels. Telemetry failure cannot change a business result. W3C
`traceparent`/`tracestate` is the only cross-boundary carrier; invalid carriers start fresh context.

## Polling handoff

Nonterminal POST/GET responses expose `Retry-After` from the validated
`OBSERVATION_RETRY_AFTER_SECONDS` value (1-60 seconds, local/test default 2). It is bounded guidance,
not a production SLO. Generated-client consumers stop on `terminal: true`, use bounded backoff for
transport/503 failures, ignore stale lower `resourceVersion` responses, and never issue a new POST
merely because GET timed out.

Fleet Health Phase 2 now owns authorized endpoint/list discovery through `GET /api/v1/fleet`.
The later presentation phase must:

1. link the endpoint summary to the latest operation ID;
2. display last attempt separately from last complete observation;
3. compute freshness from explicit timestamps and policy;
4. keep `SIMULATED` visible;
5. never map `observation: null`, partial, unknown, or invalid to normal; and
6. keep manual control, notifications, incident policy, and recovery out of this slice.

## Verification boundaries

Four cross-cutting Vitest cases cover generated-client manual completion, scheduled restart and
idempotency, provider-failure/no-observation plus pre-dispatch blocking, and redacted observability
with disposable architecture/OpenAPI/migration mutations. PostgreSQL and pg-boss run through the
guarded serial workspace configuration. Generated-client and Prisma mutations use temporary copies
and verify committed sources remain byte-identical.
