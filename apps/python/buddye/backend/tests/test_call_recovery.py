"""A call that was placed must always be read, even when the watcher falls over.

Both tests come from one live demo run. CALL-E held a call in `queued` for three minutes, one status
request then timed out after 30 s, the exception killed the task watching the call, and the case
page showed "Ringing" for fifteen minutes while the neighbour had already finished a good 28-turn
conversation that nobody recorded.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from app.calls.calle_sdk import CalleSdkProvider
from app.calls.provider import CallRequest, ProviderFatalError


class Flaky(Exception):
    """A transient failure: no `code`, so classify_api_error treats it as retryable."""


class Unauthorized(Exception):
    code = "unauthorized"


def _completed(call_id: str) -> dict[str, Any]:
    return {
        "id": call_id,
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.93, "label": "high"},
        "structured_result": {"is_safe_now": "no"},
        "recipients": [{"attempts": [{"status": "completed", "transcript_turns": [
            {"speaker": "user", "text": "The power has been off since the morning."},
        ]}]}],
    }


class FakeCalls:
    def __init__(self, script: list[Any]) -> None:
        self.script = script
        self.gets = 0

    def get(self, call_id: str) -> dict[str, Any]:
        self.gets += 1
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    def list_events(self, call_id: str, cursor: str | None = None) -> dict[str, Any]:
        return {"data": []}


def _provider(script: list[Any]) -> tuple[CalleSdkProvider, FakeCalls]:
    calls = FakeCalls(script)
    settings = SimpleNamespace(CALLE_POLL_INTERVAL_S=0.01, CALLE_CALL_TIMEOUT_S=5.0)
    provider = CalleSdkProvider.__new__(CalleSdkProvider)
    provider.settings = settings
    provider.client = SimpleNamespace(calls=calls)
    provider.poll_count = 0
    provider._webhook_results = {}
    provider.last_error_details = None
    return provider, calls


def _resume_request() -> CallRequest:
    return CallRequest(
        phone="+15555550100", region="US", locale="en-US", task="t", result_schema={},
        idempotency_key="k", employee_id="nbr_test", existing_provider_call_id="call_live",
    )


async def test_one_slow_status_check_does_not_abandon_the_call() -> None:
    provider, calls = _provider([Flaky("CALL-E API request timed out."), _completed("call_live")])
    events: list[str] = []

    async def sink(ev: Any) -> None:
        events.append(ev.type)

    outcome = await provider.place(_resume_request(), sink)

    assert outcome.status == "COMPLETED"            # the conversation was read, not dropped
    assert calls.gets == 2                           # it asked again after the timeout
    assert "call.poll_retry" in events               # and said so on the stream


async def test_a_fatal_api_error_still_stops_the_poll() -> None:
    """Retrying is for transient failures only; a revoked key must not be polled until the deadline."""
    provider, _ = _provider([Unauthorized("unauthorized")])

    async def sink(ev: Any) -> None:
        return None

    with pytest.raises(ProviderFatalError):
        await provider.place(_resume_request(), sink)


async def test_stuck_case_calls_are_resumed_at_their_own_attempt_and_only_once(db, monkeypatch) -> None:  # noqa: ANN001
    """The sweeper re-attaches through the original attempt number — a new one would ring the person
    again — and never starts a second watcher for a call that already has one."""
    from app.api import cases
    from app.config import get_settings
    from app.db import session_scope
    from app.models import CheckCall, Neighbour, Sweep
    from app.seed import seed
    from sqlmodel import select

    with session_scope() as s:
        hazard = seed(s, get_settings())
        s.flush()
        nbr = s.exec(select(Neighbour)).first()
        sweep = Sweep(hazard_id=hazard.id, is_active=False)
        s.add(sweep)
        s.flush()
        s.add(CheckCall(sweep_id=sweep.id, hazard_id=hazard.id, neighbour_id=nbr.id, callee="neighbour",
                        attempt=3, idempotency_key=f"{sweep.id}:{nbr.id}:neighbour:3", provider="calle_sdk",
                        provider_call_id="call_live", status="DIALING", task="t"))
        # a finished call and a call that never got a provider id are not stuck
        s.add(CheckCall(sweep_id=sweep.id, hazard_id=hazard.id, neighbour_id=nbr.id, callee="neighbour",
                        attempt=1, idempotency_key=f"{sweep.id}:{nbr.id}:neighbour:1", provider="calle_sdk",
                        provider_call_id="call_done", status="COMPLETED", task="t"))
        hazard_id, neighbour_id = hazard.id, nbr.id

    started: list[dict[str, Any]] = []
    release = asyncio.Event()

    async def fake_launch(hazard_id: str, neighbour_id: str, **kw: Any) -> dict[str, Any]:
        started.append({"hazard_id": hazard_id, "neighbour_id": neighbour_id, **kw})
        await release.wait()
        return {"status": "completed"}

    monkeypatch.setattr(cases, "launch_call", fake_launch)
    live = SimpleNamespace(CALL_PROVIDER="calle_sdk")

    assert len(cases.resume_stuck_calls(live)) == 1
    await asyncio.sleep(0)
    assert started == [{"hazard_id": hazard_id, "neighbour_id": neighbour_id, "settings": live, "resume_attempt": 3}]

    # a second pass while the first watcher is still running must not start another
    assert cases.resume_stuck_calls(live) == []
    await asyncio.sleep(0)
    assert len(started) == 1

    release.set()
    await asyncio.sleep(0.01)
    assert cases.resume_stuck_calls(SimpleNamespace(CALL_PROVIDER="mock")) == []  # nothing remote to re-attach to
