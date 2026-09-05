import pytest

import fieldline.calle_client as cc
from fieldline.calle_client import (
    DemoCalleDispatcher,
    LiveCalleDispatcher,
    ScriptExhaustedError,
)
from fieldline.demo_data import SCENARIOS

CALL_STATUSES = {"queued", "in_progress", "completed", "failed", "canceled"}


def _dispatch_all(scenario):
    d = DemoCalleDispatcher(SCENARIOS[scenario], turn_delay=0.0)
    return [
        d.create_and_wait(
            task="t",
            recipient={"phone": "+15555550100"},
            result_schema={},
            metadata={"i": i},
            idempotency_key=f"k{i}",
        )
        for i in range(len(SCENARIOS[scenario]))
    ]


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_demo_calls_match_call_task_shape(scenario):
    """DEMO dicts must be indistinguishable from real terminal call_tasks."""
    for call in _dispatch_all(scenario):
        assert call["object"] == "call_task"
        assert call["status"] in CALL_STATUSES
        assert isinstance(call["recipients"], list) and call["recipients"]
        for recipient in call["recipients"]:
            assert recipient["phones"]
            for attempt in recipient["attempts"]:
                for turn in attempt["transcript_turns"]:
                    assert turn["speaker"] in {"bot", "user", "unknown"}
                    assert isinstance(turn["text"], str)
        assert "structured_result" in call
        assert "task_completed" in call
        assert "evidence" in call
        assert call["metadata"] is not None  # request metadata echoed


def test_demo_checkin_results_match_result_schema_enum():
    for call in _dispatch_all("full"):
        sr = call["structured_result"]
        if sr and "checkin_status" in sr:
            assert sr["checkin_status"] in {"safe", "needs_assistance", "emergency", "unclear"}
            assert isinstance(sr["duress_phrase_detected"], bool)


def test_demo_scripts_pop_in_order_and_exhaust():
    d = DemoCalleDispatcher(SCENARIOS["duress"], turn_delay=0.0)
    for _ in SCENARIOS["duress"]:
        d.create_and_wait(task="t", recipient={"phone": "+15555550100"})
    with pytest.raises(ScriptExhaustedError):
        d.create_and_wait(task="t", recipient={"phone": "+15555550100"})


def test_demo_streams_turns():
    seen = []
    d = DemoCalleDispatcher(SCENARIOS["safe"], on_turn=lambda s, t: seen.append((s, t)), turn_delay=0.0)
    d.create_and_wait(task="t", recipient={"phone": "+15555550100"})
    assert seen and seen[0][0] == "bot"


# --- live dispatcher fail-soft ---------------------------------------
class _ExplodingCalls:
    def __init__(self):
        self.attempts = 0

    def create_and_wait(self, **kwargs):
        self.attempts += 1
        raise ConnectionError("provider down")


class _ExplodingClient:
    def __init__(self):
        self.calls = _ExplodingCalls()


def test_live_dispatcher_fails_soft(monkeypatch):
    monkeypatch.setattr(cc.time, "sleep", lambda s: None)
    client = _ExplodingClient()
    d = LiveCalleDispatcher(api_key="k", client=client)
    call = d.create_and_wait(task="t", recipient={"phone": "+15555550100"}, metadata={"kind": "checkin"})
    assert client.calls.attempts == 2  # one retry, idempotency-key safe
    assert call["status"] == "failed"
    assert call["failure_code"] == "client_unreachable"
    assert call["metadata"] == {"kind": "checkin"}
