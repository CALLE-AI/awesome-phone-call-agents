# ADR-0001: Use the official CALL-E server SDK behind a narrow adapter

## Status
Accepted

## Date
2026-08-10

## Context

### Problem Statement
IncidentBridge must place a real, explicitly authorized vendor-support phone call for the CALL-E
hackathon while remaining testable without calling a person or duplicating CALL-E's telephony layer.

### Constraints
- CALL-E must be imported and called at runtime, not referenced only in documentation.
- Tests must create no external phone call and require no credential.
- Credentials must remain server-side.
- A provider timeout after acceptance must not trigger an automatic redial.
- The contribution must be portable into `awesome-phone-call-agents`.

### Requirements
- Use the official `calle-ai` Python SDK.
- Keep provider calls behind one small interface.
- Produce a stable idempotency key and durable pre-dispatch reservation.
- Accept only the official HTTPS API origin in production; allow loopback HTTP in tests.

## Decision

Use `calle-ai==0.2.0` through `incidentbridge.runtime.execute`. The CLI validates authorization,
explicit live-call intent, an exact phone allowlist, environment switch, and API key before it
constructs `CalleClient`. It writes a SQLite reservation before calling `calls.create`, records the
provider call ID immediately after acceptance, then calls `calls.wait_for_result`.

### Architecture Diagram

```text
JSON request → validation/policy → preview or live gate → SQLite reservation
                                                    → CalleClient.calls.create
                                                    → wait_for_result
                                                    → strict route + redacted audit
```

### Key Interfaces

```python
class CallsAPI(Protocol):
    def create(self, **kwargs) -> dict: ...
    def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds) -> dict: ...
```

## Alternatives Considered

### Alternative 1: Direct HTTP client
- **Description**: Send requests to `/v1/calls` with a custom HTTP wrapper.
- **Pros**: Fewer dependencies and full transport control.
- **Cons**: Reimplements authentication, error handling, and supported SDK semantics.
- **Rejection Reason**: The challenge rewards real CALL-E integration; the official SDK is the
  smallest credible boundary and avoids rebuilding provider code.

### Alternative 2: CALL-E MCP only
- **Description**: Use `plan_call`, `run_call`, and `get_call_run` over MCP OAuth.
- **Pros**: Natural human-confirmation flow for interactive agent hosts.
- **Cons**: Harder to embed in a standalone server, requires browser OAuth, and weakens deterministic
  CI coverage.
- **Rejection Reason**: IncidentBridge is a reusable backend/CLI app. MCP remains a future host
  adapter, not the application runtime.

### Alternative 3: Simulated provider only
- **Description**: Demo structured outcomes without importing CALL-E.
- **Pros**: Easy and free.
- **Cons**: Fails the competition's actual-runtime requirement and proves no integration.
- **Rejection Reason**: Simulation is useful only as a safe demo mode beside a real SDK path.

## Consequences

### Positive
- Five-line provider boundary and a reproducible HTTP integration test.
- No custom telephony or polling client.
- Preview, simulation, and live modes share one task/schema policy.
- Provider ambiguity remains visible and locked against accidental retries.

### Negative
- Runtime is pinned to one SDK version and provider.
- Live verification still requires a CALL-E account, credits, and an authorized phone number.

### Risks
- SDK response contract changes: pinned version and capture-server test detect it.
- Call accepted but result poll fails: durable `outcome_unknown` reservation blocks a redial.
- Sensitive free text returned: recursive redaction and bounded schema reduce exposure.

## Performance Implications
- **CPU**: Negligible local validation and JSON processing.
- **Memory**: One SDK client and one SQLite connection per CLI operation.
- **Load Time**: Dominated by Python startup and SDK import.
- **Network**: One create request followed by provider polling until terminal or timeout.

## Migration Plan
This is a new project. Copy the standalone app into `apps/python/incidentbridge` for the required
upstream pull request while retaining the same test commands.

## Validation Criteria
- Published SDK emits an observed authenticated `POST /v1/calls` and subsequent GET in CI.
- Preview and all simulations create no phone call.
- Live execution refuses without every authorization gate.
- Duplicate idempotency key cannot acquire a second reservation.
- Every routed result has `incident_closed: "false"`.

## Related Decisions
- [CALL-E integrations](https://github.com/CALLE-AI/call-e-integrations)
- [Awesome Phone Call Agents design principles](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/docs/design-principles.md)
