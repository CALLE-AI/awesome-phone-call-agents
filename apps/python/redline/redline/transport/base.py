"""The boundary between "how the call happened" and "what it means".

A transport puts a persona at the other end of the line and returns a
:class:`~redline.types.CallRecord`. It never judges the result -- that is the
evaluator's job, and keeping the two apart is what lets the same assertions run
against a static model, a recorded payload, and a real call.

Three implementations ship:

``static``
    No call, no account, no credentials. Simulates the conversation from the
    goal's stated defences. The default.

``replay``
    Replays a recorded CALL-E payload from ``fixtures/``. Used to pin real
    platform behaviour into the test suite without spending a call.

``live``
    Dials for real through the CALL-E SDK, under an explicit budget and an
    exact-match allowlist.

The interface is synchronous. The CALL-E Python SDK is synchronous
(``CalleClient`` wraps ``httpx.Client``), a static run has nothing to wait for,
and the real constraint on a live run is a call budget measured in single
digits rather than throughput. Async here would buy nothing and cost every
reader a mental model.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from redline.scenario.model import Scenario
from redline.subject import SubjectUnderTest
from redline.types import CallRecord

__all__ = ["BudgetExceededError", "Transport", "TransportError"]


class TransportError(RuntimeError):
    """A call could not be placed or read."""


class BudgetExceededError(TransportError):
    """A run asked for more real calls than it was allowed.

    Raised rather than silently truncating: a partial suite that looks complete
    is worse than a run that stops and says why.
    """


@runtime_checkable
class Transport(Protocol):
    """Places one scenario against one subject and reports what happened."""

    name: str
    places_real_calls: bool

    def run(
        self,
        subject: SubjectUnderTest,
        scenario: Scenario,
        *,
        idempotency_key: str,
    ) -> CallRecord:
        """Run ``scenario`` against ``subject`` and return the outcome.

        ``idempotency_key`` is stable for a given (subject, scenario, attempt)
        so that a retried run cannot place the same call twice. It is required
        on every transport, not just the live one, so that a fixture recorded
        offline carries the same key it would have used on the wire.
        """
        ...
