# ADR-0004: In-Process Mock Transport Double (calle_double) with Conformance-Gated Testing

## Status
Accepted

## Date
2026-09-07

## Context

### Problem Statement
The CALL-E developer platform ships no sandbox environment, no non-billing test API key, and no dry-run flag. Every call placed against `https://api.heycall-e.com` costs real money and triggers real carrier network connections to physical phones.
For competition judges, continuous integration pipelines, and educational software developers, running live test suites against production telephone carriers is cost-prohibitive, noisy, and nondeterministic.
Historically, developer solutions fell into two traps:
1. Stubbing out the entire vendor library with unittest mocks, which hides breaking serialization and deserialization bugs.
2. Building an unverified local HTTP server that slowly drifts away from the actual vendor payload schema.
Firstbell requires a high-fidelity local double that executes the official CALL-E SDK code path, mounts directly onto the SDK transport in memory, and remains strictly checked against verified production responses.

### Constraints
- Testing must cost zero dollars and require zero external credentials or network connectivity.
- The SDK client under test must be the genuine `calle.CalleClient`, running its actual response parsers, exception constructors, and parameter validators.
- The double must not drift from real platform behavior over time.

### Requirements
- Provide an in-process double mounted on `httpx.MockTransport` passed to `CalleClient(http_client=...)`.
- Provide a standalone HTTP server mode for testing cross-language components and external HTTP clients.
- Verify schema fidelity using committed production response recordings across all terminal call states.
- Package the double for distribution so the wider developer community can adopt it.

## Decision

Firstbell implements [`calle_double`](../../calle_double) as an in-process mock transport engine and loopback HTTP server.
1. In-process execution: `calle_double.build_client(double)` constructs a real `calle.CalleClient` wired to `httpx.Client(transport=build_transport(double))`. No HTTP sockets or loopback listeners are opened during standard unit testing.
2. Endpoint coverage: The double handles `POST /v1/calls`, `GET /v1/calls/{id}`, `GET /v1/calls`, `GET /v1/calls/{id}/events`, and `GET /v1/goals`. It implements regional phone validation, idempotency caching, attempt tracking, and structured result extraction.
3. Conformance verification: [`evidence/api-shape.json`](../../evidence/api-shape.json) records every key path and JSON type observed across 11 production API responses. [`tools/double_conformance.py --check`](../../tools/double_conformance.py) executes as an automated gate, confirming that the double emits every property returned by production.
4. Packaging roadmap: Extract `calle_double` into a standalone asset with `pyproject.toml` configuration to enable direct installation across the CALL-E community.

### Architecture Diagram

```text
[Unit Tests / CLI Offline]
            |
            v
     calle.CalleClient
            |
            v  (Internal HTTPX call)
     httpx.MockTransport
            |
            v
   CalleDouble Engine <====================> Conformance Gate
     - Endpoint Router                      tools/double_conformance.py
     - Idempotency Ledger                               |
     - Attempt History                                  v
     - Terminal State Simulator             evidence/api-shape.json
                                            (11 production call shapes)
```

### Key Interfaces

```python
class CalleDouble:
    def __init__(self, latency_seconds: float = 0.0) -> None: ...
    def handle_request(self, method: str, path: str, headers: dict, body: bytes) -> tuple[int, dict, bytes]: ...

def build_transport(double: CalleDouble) -> httpx.MockTransport: ...
def build_client(double: CalleDouble) -> calle.CalleClient: ...
```

## Alternatives Considered

### Alternative 1: Standard Unit Test Mocks (unittest.mock)
- **Description**: Replace `calls.create` and `calls.get` with mock return values.
- **Pros**: Minimal lines of test code; quick setup.
- **Cons**: The official SDK code is bypassed; parameter serialization is never tested; response shape mismatches pass silently.
- **Rejection Reason**: Fails [`tests/test_sdk_is_really_running.py`](../../tests/test_sdk_is_really_running.py). Proves nothing about real integration.

### Alternative 2: Generic Mock Servers (Prism / WireMock)
- **Description**: Run an external containerized mock server loaded with OpenAPI schemas.
- **Pros**: Independent of Python runtime.
- **Cons**: Requires Docker or JVM; introduces network latency and port allocation conflicts in CI; cannot execute dynamic state transitions (such as simulating in-progress to completed calls).
- **Rejection Reason**: Heavy infrastructure requirement; cannot run in zero-dependency local environments.

### Alternative 3: Paid Live Calls in CI
- **Description**: Place live phone calls on every test run using dedicated carrier numbers.
- **Pros**: Tests real carrier network behavior.
- **Cons**: High financial cost; carrier flakiness causes false CI failures; dials physical phones continuously.
- **Rejection Reason**: Unviable for community open-source contributors and CI matrix testing.

## Consequences

### Positive
- Allows full end-to-end testing of [`firstbell`](../../README.md) with no network dependency at all. The wall time is whatever the suite takes and is not
  claimed here.
- Verifies that `CalleClient` constructs valid requests and successfully parses vendor responses.
- Enables reproducible edge-case simulation (such as replayed calls, timeouts, and uninformative enum values).
- Provides a valuable testing utility for any developer building on CALL-E.

### Negative
- Requires maintaining the double as CALL-E releases new API endpoints and properties.
- Does not simulate voice audio quality or speech recognition accuracy.

### Risks
- Undetected API drift if production contracts change without updating recordings. Mitigation: Conformance checks run against committed response shape baselines.

## Performance Implications
- **CPU**: Extremely fast in-memory dictionary dispatch.
- **Memory**: The double holds the canned responses in memory, not measured.
- **Load Time**: Sub-millisecond initialization.
- **Network**: Zero bytes sent across the network interface during in-process tests.

## Migration Plan
The double is already functional in [`calle_double/`](../../calle_double). The next step is publishing it as a standalone package with dedicated distribution metadata.

## Validation Criteria
- `python tools/double_conformance.py --check` exits with status 0, proving zero missing response paths.
- `tests/test_calle_double.py` passes 100% of functional tests.
- `tests/test_double_guards.py` validates that all internal security and validation guards remain active.

## Related Decisions
- [ADR-0001](adr-0001-native-calle-sdk-integration.md): Native CALL-E Server SDK Integration
- [ADR-0003](adr-0003-controlled-wave-concurrency-and-hybrid-reconciliation.md): Controlled Wave Concurrency
