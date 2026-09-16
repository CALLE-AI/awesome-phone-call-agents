# ADR-0001: Native CALL-E Server SDK Integration vs Subprocess CLI Shelling

## Status
Accepted

## Date
2026-09-07

## Context

### Problem Statement
Firstbell must coordinate automated attendance triage phone calls across student absentee records. The system requires initiating calls, enforcing idempotency across retries, monitoring call execution, capturing structured JSON schema outcomes, and handling network or provider faults safely.
A common shape in prototypes against a new telephony API is to shell out to an external CLI tool or curl wrapper via `subprocess.run(["calle", "call", ...])`. CLI shelling parses unstructured terminal text and treats exit codes as crude status indicators. Firstbell requires an enterprise architecture that eliminates subprocess overhead, protects secrets, guarantees memory safety, and adopts the official `calle-ai` Python SDK.

### Constraints
- Must meet Hackathon Stage One criteria: CALL-E must be imported and called at runtime, not merely referenced in documentation or piped through external shell scripts.
- Must execute deterministically in offline environments and CI without live API credentials or billable telephony costs.
- Must maintain strict process isolation: credentials must never leak into command-line arguments visible in process tables.
- Pinned to `calle-ai==0.7.0`.

### Requirements
- Directly import and instantiate `calle.CalleClient`.
- Invoke native SDK resource methods: `calls.create` and `calls.get`.
- Intercept and categorize typed SDK exceptions (`CalleAPIError`, `CalleTimeoutError`, `CalleConnectionError`) without collapsing them into generic catch-alls.
- Support in-process transport injection (`http_client=httpx.Client(transport=...)`) to mount local test doubles directly on the SDK client.

## Decision

Firstbell integrates exclusively with the native `calle-ai` Python SDK via [`dispatch.scheduler.WaveDispatcher`](../../dispatch/scheduler.py) and [`firstbell.cli`](../../firstbell/cli.py).
Firstbell rejects subprocess shelling, wrapper scripts, and CLI piping.
The CLI establishes an explicit execution gate verifying whether the target origin matches `https://api.heycall-e.com` before permitting live API keys. When running offline, Firstbell constructs a genuine `calle.CalleClient` wired to an in-process mock transport ([`calle_double.CalleDouble`](../../calle_double)), ensuring that request construction, payload validation, response deserialization, and error handling run CALL-E's actual library code.

### Architecture Diagram

```text
WorkItem -> WaveDispatcher._handle()
              |
              +-> CalleClient.calls.create(task, recipients, result_schema, idempotency_key)
              |     |
              |     +--> [Live] -> HTTPS -> api.heycall-e.com
              |     |
              |     +--> [Offline/CI] -> httpx.MockTransport -> CalleDouble
              |
              +-> Typed Exception Interception
              |     |-- CalleAPIError (FATAL, PERMANENT, RETRYABLE)
              |     +-- CalleTimeoutError / CalleConnectionError -> UNDETERMINED
              |
              +-> WaveDispatcher._await_terminal()
                    +-> CalleClient.calls.get(call_id)
```

### Key Interfaces

```python
class CallsResource(Protocol):
    def create(
        self,
        *,
        task: str,
        recipients: list[dict[str, Any]],
        result_schema: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
        webhook_url: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]: ...

    def get(self, call_id: str) -> dict[str, Any]: ...
```

## Alternatives Considered

### Alternative 1: Subprocess CLI shelling
- **Description**: Shell out to `calle` executable via `subprocess.run` and scrape stdout JSON output.
- **Pros**: Quick to prototype; does not require understanding SDK internals or transport bindings.
- **Cons**: High performance penalty from continuous Python interpreter startup; sensitive API keys and phone numbers exposed in OS process listings; stdout scraping breaks on terminal logging changes; cannot distinguish socket timeouts from API rate limits.
- **Rejection Reason**: Violates enterprise security and reliability requirements. Unfit for high-volume automated dispatch.

### Alternative 2: Direct Unofficial HTTP REST Wrapper
- **Description**: Bypass the SDK and issue raw HTTP requests to `/v1/calls` via `urllib` or `requests`.
- **Pros**: Complete control over socket timeouts and serialization without external library dependencies.
- **Cons**: Duplicates authentication headers, retry policies, and endpoint schemas; fails the competition mandate to demonstrate thorough and skillful SDK adoption.
- **Rejection Reason**: The official SDK represents the tested vendor contract. Discarding it increases maintenance overhead.

### Alternative 3: Monkey-Patching / Mocking the SDK Module
- **Description**: Mock `calle.CalleClient` methods using `unittest.mock.MagicMock` for tests.
- **Pros**: Easy test setup without implementing an HTTP transport double.
- **Cons**: Fails to test whether the SDK actually parses real API response shapes; conceals syntax errors in SDK call sites; allows fake method signatures to pass CI silently.
- **Rejection Reason**: Fails [`tests/test_sdk_is_really_running.py`](../../tests/test_sdk_is_really_running.py). Only transport-level mocking proves the SDK runtime path functions.

## Consequences

### Positive
- Genuine SDK execution: every request passes through CALL-E's serialization and error mapping.
- Full type safety: native exceptions map cleanly into deterministic retry and escalation policies.
- Zero credential leakage: API keys remain in memory and pass directly into HTTP headers.
- Single codebase for offline testing and live dispatch: swapping `http_client` transport changes the network target without changing a line of dispatcher logic.

### Negative
- Direct dependency on upstream `calle-ai` package maintenance and breaking releases.
- Requires maintaining `calle_double` in sync with upstream API response shapes.

### Risks
- Upstream SDK updates could alter `CalleClient.__init__` arguments or internal httpx configuration. Mitigation: Pin dependency to exact version `calle-ai==0.7.0` in `requirements.txt`.

## Performance Implications
- **CPU**: Calling the SDK in process removes the per attempt cost of starting a
  subprocess. The size of that saving was never measured here, so no figure is given.
- **Memory**: One SDK client instance per run. Shared connection pool avoids socket churn.
- **Load Time**: One Python module import at start up, not measured.
- **Network**: HTTP/1.1 or HTTP/2 keep-alive connections reuse TLS sessions across requests.

## Migration Plan
The codebase already implements native SDK usage across [`dispatch/scheduler.py`](../../dispatch/scheduler.py) and [`firstbell/cli.py`](../../firstbell/cli.py). Tests in [`tests/test_sdk_is_really_running.py`](../../tests/test_sdk_is_really_running.py) guard against regression.

## Validation Criteria
- [`tests/test_sdk_is_really_running.py`](../../tests/test_sdk_is_really_running.py) passes, verifying `isinstance(client, calle.CalleClient)` and `type(client).__module__.startswith("calle.")`.
- [`dispatch/scheduler.py`](../../dispatch/scheduler.py) explicitly handles `CalleAPIError`, `CalleTimeoutError`, and `CalleConnectionError`.
- No `subprocess` or `os.system` calls exist in the telephony dispatch pipeline.

## Related Decisions
- [ADR-0002](adr-0002-tri-state-call-resolution-lifecycle.md): Tri-State Call Resolution Lifecycle
- [ADR-0004](adr-0004-in-process-mock-transport-double.md): In-Process Mock Transport Double
