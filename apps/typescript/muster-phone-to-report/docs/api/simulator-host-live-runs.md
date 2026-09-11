# Simulator Host Live Observation REST Contract

This contract belongs only to the non-production simulator host. It is separate from
`docs/api/openapi.yaml`; simulator-host routes and provider composition must remain absent from
production artifacts and the generated production client.

Every response is `Cache-Control: no-store`. JSON requests and responses are bounded, and error
messages are fixed client-owned text. Permits, credentials, target addresses, transcripts,
provider payloads, and custody contents must never be logged or placed in URLs.

## `GET /api/v1/live-simulator/capability`

Returns `200 application/json` with:

- `enabled`: whether the fail-closed host capability is enabled.
- `runtimeProfile`: `development` or `test` (`ci` is exposed as `test`).
- `supportedScenarioRevisions`: exact `{ scenarioId, revision }` pairs whose catalog entry
  includes `LIVE_SMOKE`.

The web UI enables live observation only when the host is enabled and the selected scenario's
exact ID and revision appear in this response. Deterministic replay remains the default.

## `POST /api/v1/live-simulator/operations`

Requires `application/json` with exactly `scenarioId`, `scenarioRevision`, and `permit`. The
one-use permit is minted and reserved inside
`corepack pnpm simulator:live-smoke:run -- --scenario <scenarioId>` after its immediate confirmation prompt. Admission verifies
its signature and exact scenario, revision, audience, endpoint alias, expiry, and optional opaque
recovery predecessor. The queued run atomically reserves its nonce before provider construction;
only that reservation authorizes at most one dispatch.

The host establishes the durable simulated `CallAttempt` before enqueueing the bounded job. A
successful response is `202` with `{ operationId, resourceVersion }`, `Retry-After: 1`, and a
required relative `Location` header:

```text
Location: /api/v1/live-simulator/operations/{operationId}
```

The guarded operator process performs one POST activation only after immediate confirmation. The browser cross-checks `Location` against the returned
opaque operation ID, clears the permit from UI state, and uses GET-only status recovery.

## Recording-safe Demo Review handoff

The one supported recording-safe journey starts from the repository root with this exact guarded
invocation:

```text
corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal
```

After the server establishes the exact `{ operationId, scenarioId, scenarioRevision }`, the
guarded supervisor opens Simulator Lab automatically with that tuple in a URL fragment, never in a
query string. The browser validates and retains only the tuple in session storage, then removes the
fragment from the address bar before ordinary interaction. The dispatch gate remains closed until
the server observes its first successful exact-operation GET with that same tuple. Browser launch,
readiness timeout, or any operation, scenario, or revision mismatch ends with zero provider
dispatches. Browser state never receives the one-use permit, and a fragment alone, browser-local
acknowledgment, POST, or timer cannot establish viewer readiness.

After terminal reconciliation and verified external cleanup, the provider-incapable loopback
review displays **External call capability closed—review available for 30 minutes**. The complete
state uses **Live simulated observation complete** and this fact-backed evidence order:

```text
CALL-E dispatched -> Twilio synthetic device answered -> transcript admitted -> four readings grounded -> routing safely restored
```

The fixed 30-minute review ceiling begins at persisted review readiness; polling, refresh, and
reconnect cannot extend it. The operator may end it earlier with **Finish demo and delete result**.
Successful exact custody and disposable-persistence teardown reports **Protected demo result
deleted**, revokes the in-memory projection, flushes that response, and then closes the review HTTP
host and observability owner. Partial or uncertain teardown reports **Cleanup requires attention**
and retains only the bounded exact recovery identity. Expired review GETs never return transcript
data: successful TTL cleanup returns `410` before host closure, while blocked TTL cleanup returns
`503` with the attention state. Both paths preserve the `SIMULATED`, non-production, and
physical-hardware-unproven claim ceilings.

The review-only loopback process exposes exactly two routes:

- `GET /api/v1/live-simulator/operations/{operationId}` reads only the configured exact terminal
  operation. A different operation is concealed, identity drift fails closed, and every response
  uses `Cache-Control: no-store`. The runtime reconstructs the response from bounded allowlisted
  fields; provider payloads, credentials, and custody identifiers are discarded. An
  `observation_recorded` result is admitted only with complete evidence, exactly four uniquely
  reconciled grounded readings, and known required auxiliary state.
- `DELETE /api/v1/live-demo-review/sessions/{sessionId}` invokes the single idempotent cleanup
  owner for the configured exact session. Success returns **Protected demo result deleted** and
  closes the host after the response flush; partial or uncertain cleanup returns `503` with
  **Cleanup requires attention**.

The review process has no capability, dispatch, callback, list, latest-operation, or operation
creation route. It binds only to loopback and receives no CALL-E/Twilio client, credential loader,
tunnel owner, authorization minter, or observation mutation dependency.

For refresh recovery, the browser may retain only the server-established `{ operationId,
scenarioId, scenarioRevision }` tuple in session storage. It never stores the permit, target,
transcript, or provider payload. Reload and remount select the exact admitted scenario and resume
with GET only; selecting a different scenario clears the retained tuple. A status projection whose
operation, scenario, or revision differs from that tuple is rejected, and a non-increasing
`resourceVersion` cannot regress the last confirmed presentation.

## `GET /api/v1/live-simulator/operations/{operationId}`

Returns the authoritative closed projection for the opaque operation ID. Non-terminal stages do
not expose partial derived data. A terminal evidence projection contains:

- exact scenario ID/revision and `SIMULATED` provenance;
- transcript before derived readings;
- the exact four named zones, each with value, unit, status, and disposition;
- reconciliation for those same four zones;
- sound, power, battery, and output status;
- evidence quality without its internal custody reference;
- a predecessor operation ID only for a recovery candidate.

Complete normal or recovery outcomes require a closed four-zone inventory, complete evidence,
grounded reconciliation, known statuses, transcript, and all auxiliary fields. Ambiguous,
truncated, unknown, or restart-degraded evidence is `evidence_incomplete` and never a normal
observation. Provider failure responses contain no fabricated evidence.

## Errors, origins, and tracing

Safe JSON errors use bounded codes such as `validation_error`, `not_found`, `conflict`,
`dependency_unavailable`, and `unexpected_error`; server-supplied text is not displayed by the
client. REST requests accept W3C `traceparent` and bounded `tracestate`. Spans and metrics use only
the fixed route templates above—never operation IDs, permits, scenarios, target addresses, or
provider values.

Review API requests require the exact configured loopback browser origin; a missing or different
`Origin` fails closed. An exact-origin `OPTIONS` preflight advertises only `GET`, `DELETE`, and
`OPTIONS`, plus the W3C trace headers. GET, DELETE, and OPTIONS accept only the exact path target;
any query string, fragment, absolute-form target, or unexpected URL component is rejected before
route matching, tracing, or metrics. For local same-origin development, Vite proxies exactly the
`/api/v1/live-simulator` and `/api/v1/live-demo-review` prefixes to the configured simulator-host
origin. Both the browser origin and proxy target must use an exact local HTTP origin on
`localhost`, `127.0.0.1`, or `[::1]`; the proxy rejects credentials, paths, query strings,
fragments, and non-loopback targets.

## Placeholder-only local configuration

```text
SIMULATOR_DEMO_ORIGIN=<placeholder>
SIMULATOR_HOST_PROXY_ORIGIN=<placeholder>
LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE=<absolute-path-placeholder>
```

For this automatic local review journey, `SIMULATOR_DEMO_ORIGIN` is the exact Vite browser origin
and must be a local loopback HTTP origin with an explicit port. The host uses that same exact value
for browser-origin checks. `SIMULATOR_HOST_PROXY_ORIGIN` is consumed only by Vite and must be the
exact local loopback HTTP origin of the simulator host. Both keys accept `localhost`, `127.0.0.1`,
or `[::1]` and reject credentials, paths, query strings, and fragments.
`LIVE_DEMO_DISPOSABLE_DATABASE_ATTESTATION_FILE` must be an absolute path to the independently
created provisioning/exclusivity attestation for the disposable PostgreSQL database; it is
required before the review cleanup owner may destroy that exact database. The repository-owned
`simulator:live-demo:database:start` command creates that database and a protected `activate.ps1`;
`simulator:live-demo:database:dispose` verifies database/container ownership and removes the
container only after guarded cleanup. See `docs/demo/hackathon-live-calle-observation.md` for the
operator sequence and recovery stop conditions.

The helper makes one 30-second, one-shot Docker create and never retries creation. A terminal create
without a usable CID retains `cleanup_required/state_created`; only a dispose retry may reconcile
that durable intent. It requires matching exact-name and full non-secret session-label snapshots at
least 10 seconds apart. A singleton is removable only after suppressed strict inspection and
durable container proof is persisted before `docker rm`; stable absence requires a final exact
absence recheck before lifecycle state deletion. The secret owner token is never a selector or
process argument. Persistent attention means never manually delete the protected files and never
start another session. This reconciliation is provider-free, constructs zero providers, makes zero
external calls, makes zero calls, and does not authorize a call.

Credentials such as `CALLE_API_KEY` and `TWILIO_AUTH_TOKEN` remain external to this document and
repository.

Build the host before minting a permit. Issuance is a local authorization action and does not make
a provider call:

```text
corepack pnpm simulator:live-smoke:prepare
corepack pnpm simulator:live-smoke:run -- --scenario synthetic-normal
corepack pnpm simulator:live-smoke:cleanup -- --operation <opaque-operation-id> --previous-owner-stopped
```

The cleanup command is only for recovery after an interrupted guarded operator process. Use
`--previous-owner-stopped` only after positive operator confirmation that the prior process is
stopped. Cleanup closes dispatch first and proves zero dispatch or the exact callback-bound inbound,
terminal, and trailing-grace sequence before restoring hosted Reject routing. It does not search for
a latest row or accept raw provider identity.

The run command is the only supported live authorization path: standalone live permit issuance is
disabled. Each provider dispatch still requires the command's fresh immediate confirmation and its
internally minted permit. Neither this contract, host startup, preflight, nor the displayed command
authorizes a tunnel, deployment, production use, credential use, or an external call. No observed provider-call records are bundled. A newly authorized
run must independently prove signed callbacks, zero DTMF, complete evidence and
observation, four grounded Readings, exact reconciliation, and supported cleanup.
Provider-free verification is not hardware or production-readiness evidence.
