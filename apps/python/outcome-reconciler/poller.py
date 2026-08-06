"""Polling with backoff and two independent budgets.

Guarantee: polling always terminates. Two budgets run concurrently — wall clock
and observation count — and whichever trips first ends polling. There is no
code path that waits indefinitely.

The clock, the sleep function, and the jitter source are injected. Tests drive a
five-day stuck call to exhaustion in microseconds without sleeping, and the
result is deterministic.

Transport errors are retried within budget and recorded as evidence. They never
themselves produce a semantic outcome.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Sequence

from clients import AuthUnavailableError, PlanTimeoutError, StatusClient, TransportError
from mapping import OutcomeMap
from record import Observation


@dataclass(frozen=True)
class PollingPolicy:
    """Budgets and backoff shape. Defaults live here, not in call sites."""

    max_wall_clock_seconds: float = 900.0
    max_observations: int = 60
    initial_backoff_seconds: float = 2.0
    max_backoff_seconds: float = 60.0
    jitter_ratio: float = 0.1

    def __post_init__(self) -> None:
        if self.max_wall_clock_seconds <= 0:
            raise ValueError("max_wall_clock_seconds must be positive")
        if self.max_observations <= 0:
            raise ValueError("max_observations must be positive")
        if self.initial_backoff_seconds <= 0:
            raise ValueError("initial_backoff_seconds must be positive")
        if self.max_backoff_seconds < self.initial_backoff_seconds:
            raise ValueError("max_backoff_seconds must not be below initial_backoff_seconds")
        if not 0.0 <= self.jitter_ratio < 1.0:
            raise ValueError("jitter_ratio must be in [0, 1)")


DEFAULT_POLICY = PollingPolicy()


@dataclass(frozen=True)
class PollResult:
    """What polling saw, and why it stopped."""

    observations: list[Observation]
    exhausted: bool
    exhaustion_reason: str | None
    recipient_phone: str | None = None


def _default_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def backoff_delays(policy: PollingPolicy, count: int, jitter: Callable[[], float]) -> list[float]:
    """The delay sequence this policy produces. Exposed so docs cannot drift."""
    delays: list[float] = []
    delay = policy.initial_backoff_seconds
    for _ in range(count):
        spread = delay * policy.jitter_ratio
        delays.append(max(0.0, delay + (jitter() * 2 - 1) * spread))
        delay = min(delay * 2, policy.max_backoff_seconds)
    return delays


def poll(
    call_ref: str,
    client: StatusClient,
    outcome_map: OutcomeMap,
    policy: PollingPolicy = DEFAULT_POLICY,
    *,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    timestamp: Callable[[], str] = _default_timestamp,
    jitter: Callable[[], float] = random.random,
) -> PollResult:
    """Poll until a terminal state is observed or a budget trips."""
    observations: list[Observation] = []
    started = clock()
    delay = policy.initial_backoff_seconds
    exhaustion_reason: str | None = None
    exhausted = False

    while True:
        if len(observations) >= policy.max_observations:
            exhausted = True
            exhaustion_reason = "polling_budget_exhausted"
            break
        if clock() - started >= policy.max_wall_clock_seconds:
            exhausted = True
            exhaustion_reason = "polling_budget_exhausted"
            break

        # Re-check auth every cycle: a token can expire mid-poll.
        try:
            client.check_auth()
        except AuthUnavailableError:
            # Failing before the first observation is a configuration error, not
            # an ambiguous call outcome. Let it propagate so the caller sees a
            # credential problem instead of an `unresolved` record that looks
            # like a stuck call.
            if not observations:
                raise
            observations.append(
                Observation(
                    surface=client.surface,
                    payload=None,
                    observed_at=timestamp(),
                    transport_error="authentication became unavailable mid-poll",
                )
            )
            exhausted = True
            exhaustion_reason = "polling_budget_exhausted"
            break

        try:
            payload = client.fetch(call_ref)
        except PlanTimeoutError as exc:
            observations.append(
                Observation(
                    surface=client.surface,
                    payload=None,
                    observed_at=timestamp(),
                    transport_error=f"request timed out: {exc}",
                )
            )
            exhausted = True
            exhaustion_reason = "plan_timeout"
            break
        except TransportError as exc:
            observations.append(
                Observation(
                    surface=client.surface,
                    payload=None,
                    observed_at=timestamp(),
                    transport_error=str(exc),
                )
            )
        else:
            observations.append(
                Observation(
                    surface=client.surface,
                    payload=payload,
                    observed_at=timestamp(),
                )
            )
            if outcome_map.is_terminal(client.surface, payload):
                break

        remaining = policy.max_wall_clock_seconds - (clock() - started)
        if remaining <= 0:
            exhausted = True
            exhaustion_reason = "polling_budget_exhausted"
            break

        spread = delay * policy.jitter_ratio
        jittered = max(0.0, delay + (jitter() * 2 - 1) * spread)
        sleep(min(jittered, remaining))
        delay = min(delay * 2, policy.max_backoff_seconds)

    return PollResult(
        observations=observations,
        exhausted=exhausted,
        exhaustion_reason=exhaustion_reason,
        recipient_phone=getattr(client, "recipient_phone", None),
    )


def replay(observations: Sequence[Observation]) -> PollResult:
    """Wrap already-recorded observations as a poll result."""
    return PollResult(observations=list(observations), exhausted=False, exhaustion_reason=None)
