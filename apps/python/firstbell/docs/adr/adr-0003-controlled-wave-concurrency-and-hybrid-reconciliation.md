# ADR-0003: Controlled Wave Concurrency and Hybrid Webhook-Polling Reconcile Architecture

## Status

Partly accepted, partly proposed, and the split matters.

**Accepted and shipped:** the concurrency cap as the only operational brake on dialling,
because CALL-E has no cancel endpoint and a call it accepted runs to completion.
`dispatch/scheduler.py` enforces it and `firstbell/cli.py` refuses a live run over the
call ceiling without the number being named on purpose.

**Proposed, and not built:** the webhook half. A worker still blocks on `calls.get`
every two seconds to a deadline, and nothing in this repository consumes an inbound
webhook to wake a waiting future. `--webhook-url` is passed through to the platform and
`calle_double` delivers events against it, so the request side exists and the receiving
side does not.

It is marked proposed rather than accepted because an architecture record that says
"hybrid" while the code polls is a record that describes software nobody can run. The
throughput consequence is real and is published in the Performance Implications section
below rather than hidden behind the design that would fix it. Rewriting the wait path is
not a change to make in the last two days before a submission deadline, and saying so is
cheaper than shipping a half-converted one.

## Date
2026-09-07

## Context

### Problem Statement
In the CALL-E telephony engine, outbound calls cannot be recalled or cancelled once `POST /v1/calls` is accepted. The platform documentation confirms that calls in flight run to completion regardless of whether the requesting application needs the outcome. Consequently, concurrency caps serve as the sole operational safety brake on dialling.
Currently, [`dispatch.scheduler.WaveDispatcher`](../../dispatch/scheduler.py) schedules work through a Python `ThreadPoolExecutor` bounded by `concurrency` (default 3, up to 4). Each worker thread blocks on `_await_terminal(call_id)`, executing a loop that polls `calls.get(call_id)` every 2.0 seconds (`time.sleep`) up to a 600-second deadline.
In district deployments handling 500 absentees, thread-pool sleep polling presents technical liabilities:
1. Thread starvation: OS threads remain blocked in sleep states rather than multiplexing network requests.
2. Polling overhead: eleven real calls measured a mean of 51.0 seconds (`tools/throughput.py`, printed at `README.md`), so at the 2.0-second poll interval declared in `dispatch/scheduler.py` each call generates about 26 GET requests. A 500-call run generates about 13,000 HTTP requests, risking API rate limiting (`rate_limit_exceeded`).
3. Window elongation: at concurrency 4, dialling 500 families takes 110.4 minutes, measured by `tools/throughput.py` from real call lengths and printed at `README.md`, which overruns the school morning attendance window. This document used to put that window
at 08:30 to 09:15, which is 45 minutes, while quoting the seventy-five minute measurement a
hundred lines further down. The window used here is now the one the instrument uses:
`tools/throughput.py` starts at 08:00 against a 09:15 cutoff, which North Carolina leaves
for a school to set and 09:15 is a common choice, so seventy-five minutes.

### Constraints
- Outbound calls cannot be aborted mid-flight by an API endpoint.
- CALL-E webhooks are currently unsigned: the SDK deprecates `webhooks.verify` and `webhooks.unwrap`, documenting that webhook payloads cannot be trusted as an unauthenticated transport.
- Pure webhook reliance is brittle: dropped packets, network partitions, or corporate firewalls can strand in-flight calls permanently.

### Requirements
- Maintain strict concurrency caps on active outbound calls to prevent unchecked dialling waves.
- Minimize redundant HTTP GET polling loops against `https://api.heycall-e.com`.
- Guarantee that every placed call reaches a deterministic terminal state within the configured deadline.
- Treat incoming webhooks as untrusted notifications requiring single-flight authenticated re-fetch validation.

## Decision

Firstbell adopts a Controlled Wave Concurrency model backed by a Hybrid Webhook-Polling Reconciliation Architecture.
1. Concurrency control: The system maintains strict worker caps via [`WaveDispatcher`](../../dispatch/scheduler.py). The cap is enforced per callee rather than per request.
2. Webhook notification path: When `--webhook-url` is configured, CALL-E posts `call.completed` and `call.failed` events to the receiver. Receipt of an event instantly wakes the awaiting task.
3. Authenticated re-fetch verification: Because CALL-E webhooks are unsigned, Firstbell treats the incoming webhook as a hint. Upon receiving an event, Firstbell issues a single authenticated `calls.get(call_id)` request to retrieve the canonical response directly from the platform origin.
4. Fallback polling reconciliation: For deployments where webhooks are disabled, or when an in-flight call exceeds expected duration without an event, Firstbell runs an asynchronous reconciliation loop at extended intervals (10 to 15 seconds) as a safety backstop.

### Architecture Diagram

```text
[Outbound Dispatch Wave] (Concurrency Cap: N)
       |
       v
CalleClient.calls.create() --> CALL-E Platform
       |                             |
       |                             | (Call completes)
       |                             v
       |                    [Inbound Webhook Event]
       |                             |
       |                     (Untrusted Hint)
       v                             |
[Await Event / Timeout] <------------+
       |
       +--> Authenticated Single-Flight: CalleClient.calls.get(call_id)
       |           |
       |           v
       |    Canonical Verification & Tri-State Classification
       |
  (If no webhook received before SLA)
       |
       +--> Extended Reconcile Sweep (Poll fallback every 15s)
```

### Key Interfaces

```python
class CallEventReceiver(Protocol):
    def register_waiter(self, call_id: str, future: Any) -> None: ...
    def notify_event(self, call_id: str, event_data: dict[str, Any]) -> None: ...

class ReconcilePolicy:
    def __init__(
        self,
        poll_fallback_interval: float = 15.0,
        call_timeout_seconds: float = 600.0,
        webhook_hint_enabled: bool = True,
    ) -> None: ...
```

## Alternatives Considered

### Alternative 1: Pure Synchronous Sleep Polling (Current Default)
- **Description**: Each thread sleeps 2 seconds between GET requests until terminal status.
- **Pros**: Zero external network listener configuration; works behind strict corporate firewalls and NAT.
- **Cons**: High request volume; blocks worker threads; trips rate limits under heavy batch sizes.
- **Rejection Reason**: Unacceptable resource waste and rate limit exposure in large school districts.

### Alternative 2: Pure Event-Driven Webhook Reliance
- **Description**: Eliminate polling entirely; wait exclusively for inbound webhooks.
- **Pros**: Zero polling traffic; immediate event processing.
- **Cons**: A dropped HTTP packet or firewall rule leaves calls permanently in undetermined state; trusting unsigned webhooks violates security policy.
- **Rejection Reason**: Fails reliability and security criteria in enterprise school environments.

### Alternative 3: Celery / Redis Distributed Task Queue
- **Description**: Offload dispatch and state checking to distributed Celery workers and Redis.
- **Pros**: Horizontal scale across multiple worker nodes.
- **Cons**: Heavy infrastructure dependency; violates the self-contained zero-dependency CLI requirement for school clerks and hackathon judges.
- **Rejection Reason**: Excessive operational complexity for single-school morning triage.

## Consequences

### Positive
- Drops polling HTTP traffic by 85% to 95% when webhooks are active.
- Frees Python threads to handle dispatch waves rather than sleeping.
- Maintains complete network traversal capability: falls back gracefully to scheduled polling when webhooks cannot reach the local machine.
- Enforces cryptographic hygiene by verifying all unsigned webhooks via authenticated API re-fetch.

### Negative
- Requires configuring an accessible callback URL or tunnel when webhook acceleration is desired.
- Increases state management complexity across event waiters and fallback timers.

### Risks
- Local webhook receiver port conflicts. Mitigation: Configurable port and automatic loopback detection in CLI flags.

## Performance Implications

### What the shipped design costs, measured

The numbers below describe the code as it is, not the design above, and they are computed
rather than estimated. `tools/throughput.py` reads the last turn offset out of every real
receipt, which is CALL-E's own timing for when the conversation stopped, adds one poll
interval read off `WaveDispatcher.__init__`, and divides.

```
11 real call(s) measured from their own turn offsets.
  mean 51.0s, median 47.0s, longest 106.0s
  plus one 2s poll interval a call, worst case, so 53.0s a worker a call

500 absences in one morning, against a 75-minute window:
  concurrency   3    147.5 min   MISSES THE CUTOFF
  concurrency   4    110.4 min   MISSES THE CUTOFF
  concurrency  12     37.1 min   fits
  concurrency  25     17.7 min   fits
```

Two conclusions, and the second one is the reason this record is only partly accepted.

**Polling is not what costs the time.** Two seconds a call, worst case, against a
fifty-one second call. An event-driven wait would recover about four per cent of the
morning. Selling the webhook design on throughput would be selling it on a number it does
not move.

**The concurrency cap is what costs the time, and it is the safety brake.** At the
documented maximum of four, five hundred absences take an hour and fifty minutes and miss
a nine-fifteen cutoff. Twelve fits inside the window. Raising it is one flag and no code,
and it is a decision about how many families this dials at once with no way to recall any
of them, which is why it is a flag and not a default.

So the honest statement to a district is: this fits your morning at concurrency twelve, and
here is what you are agreeing to when you set it.

### What the proposed design would cost

- **CPU**: negligible event notification dispatch.
- **Memory**: one dictionary mapping `call_id` to a waiting future.
- **Dependencies**: none added.
- **Network**: replaces 20 to 30 polling GETs a call with one authenticated verification
  GET, which is a load reduction on CALL-E rather than a speed-up here.

## Migration Plan
Retain the existing `_await_terminal` polling mechanism as the standard fallback. Expose the `--webhook-url` parameter in [`firstbell/cli.py`](../../firstbell/cli.py) and wire the event receiver to wake waiting workers immediately upon webhook receipt.

## Validation Criteria
- Offline suite passes without running network listeners.
- Webhook receipt triggers single-flight GET verification and immediate result classification.
- If webhooks fail to arrive, the reconciliation loop resolves terminal calls before timeout.

## Related Decisions
- [ADR-0001](adr-0001-native-calle-sdk-integration.md): Native CALL-E Server SDK Integration
- [ADR-0002](adr-0002-tri-state-call-resolution-lifecycle.md): Tri-State Call Resolution Lifecycle
