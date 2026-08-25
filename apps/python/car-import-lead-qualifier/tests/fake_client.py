"""In-memory CALL-E stand-in. Tests never reach the network or a phone line.

`FakeCalls` mimics the two methods the runner needs: `create` and `get`. It
records every request, refuses to create a second call for an idempotency key it
has already seen, and walks through a queued -> in_progress -> terminal status
sequence so the polling loop is exercised for real.
"""

from __future__ import annotations

from typing import Any


def qualified_result() -> dict[str, Any]:
    return {
        "right_person": "yes",
        "continued_after_ai_disclosure": "yes",
        "buying_intent": "ready_to_buy",
        "vehicle_type": "pickup",
        "budget_band_usd": "10k_20k",
        "payment_blocker": "none",
        "destination_port": "maputo",
        "wants_human_callback": "yes",
        "evidence": "Wants a pickup landed in Maputo and asked for a specialist to call.",
    }


def blocked_result() -> dict[str, Any]:
    """Ready to buy, but the money cannot move yet."""
    return qualified_result() | {
        "payment_blocker": "forex_unavailable",
        "evidence": "Ready to order but waiting on foreign currency at the bank.",
    }


def opt_out_result() -> dict[str, Any]:
    return {
        "right_person": "yes",
        "continued_after_ai_disclosure": "no",
        "buying_intent": "unknown",
        "payment_blocker": "unknown",
        "evidence": "The person asked not to be called again.",
    }


class DuplicateCallError(AssertionError):
    """Raised when a test would place two calls for the same idempotency key."""


class FakeCalls:
    def __init__(
        self,
        *,
        structured_result: dict[str, Any] | None = None,
        status: str = "completed",
        pending_polls: int = 2,
        task_completed: bool = True,
        completion_confidence: float = 0.94,
        echo_phone_in_summary: bool = False,
    ) -> None:
        self.structured_result = (
            qualified_result() if structured_result is None else structured_result
        )
        self.status = status
        self.pending_polls = pending_polls
        self.task_completed = task_completed
        self.completion_confidence = completion_confidence
        self.echo_phone_in_summary = echo_phone_in_summary
        self.created: list[dict[str, Any]] = []
        self.polls: list[str] = []
        self._seen_keys: set[str] = set()
        self._remaining: dict[str, int] = {}

    def create(self, **kwargs: Any) -> dict[str, Any]:
        key = kwargs.get("idempotency_key")
        if key in self._seen_keys:
            raise DuplicateCallError(f"idempotency key reused for a new call: {key}")
        self._seen_keys.add(key)
        self.created.append(kwargs)
        call_id = f"call_fake_{len(self.created):03d}"
        self._remaining[call_id] = self.pending_polls
        return {"id": call_id, "status": "queued"}

    def get(self, call_id: str) -> dict[str, Any]:
        self.polls.append(call_id)
        if call_id not in self._remaining:
            raise AssertionError(f"unknown call id: {call_id}")
        remaining = self._remaining[call_id]
        if remaining > 0:
            self._remaining[call_id] = remaining - 1
            return {"id": call_id, "status": "queued" if remaining > 1 else "in_progress"}

        structured = dict(self.structured_result)
        if self.echo_phone_in_summary:
            phone = self.created[-1]["recipients"][0]["phones"][0]
            structured["evidence"] = f"Reached the lead on {phone}."
        return {
            "id": call_id,
            "status": self.status,
            "task_completed": self.task_completed,
            "completion_confidence": self.completion_confidence,
            "structured_result": structured,
        }


class NeverTerminatingCalls(FakeCalls):
    """Always reports a non-terminal status so the timeout branch can be tested."""

    def get(self, call_id: str) -> dict[str, Any]:
        self.polls.append(call_id)
        return {"id": call_id, "status": "in_progress"}


class FakeClient:
    """Mirrors the shape used in production: `client.calls.create(...)`."""

    def __init__(self, calls: FakeCalls | None = None) -> None:
        self.calls = calls or FakeCalls()
