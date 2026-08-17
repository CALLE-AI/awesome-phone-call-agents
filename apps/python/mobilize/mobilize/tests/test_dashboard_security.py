"""A reviewer found that the coordinator dashboard's real-call path had no
server-side guard at all: any client could open the WebSocket and send
simulate:false to reach CalleTransport directly, bypassing the confirmation
that only existed in browser JavaScript, with no governance applied. These
tests exercise the actual FastAPI app (not just the functions in isolation)
to prove the fix holds at the transport layer, not just in a unit test that
could drift from what the WebSocket handler actually does.
"""

from __future__ import annotations

import json
import os

import pytest
from fastapi.testclient import TestClient

import mobilize.app.dashboard as dashboard_module
from mobilize.app.dashboard import app

TRUSTED_ORIGIN = "http://127.0.0.1:8731"


@pytest.fixture(autouse=True)
def _isolated_state(tmp_path, monkeypatch):
    """Every test gets its own registry/governance state files, so tests
    can't see each other's persisted state and don't touch the developer's
    real /tmp files."""
    monkeypatch.setattr(dashboard_module, "REGISTRY_STATE_PATH", tmp_path / "registry.json")
    monkeypatch.setattr(dashboard_module, "REGISTRY_SOURCE_MARKER_PATH", tmp_path / "registry_source.txt")
    monkeypatch.setattr(dashboard_module, "GOVERNANCE_STATE_PATH", tmp_path / "governance.json")
    yield


def test_untrusted_origin_is_rejected():
    client = TestClient(app)
    with client.websocket_connect("/ws/run", headers={"origin": "http://evil.example.com"}) as ws:
        msg = ws.receive_json()
    assert msg["event"] == "error"
    assert "origin" in msg["data"]["message"].lower()


def test_real_dispatch_without_confirm_is_refused_and_places_no_calls(monkeypatch):
    """The core of the reported vulnerability: simulate:false with no
    confirm field must not reach CalleTransport at all."""
    calle_constructed = {"count": 0}

    class _ExplodingCalleTransport:
        def __init__(self, *a, **kw):
            calle_constructed["count"] += 1
            raise AssertionError("CalleTransport must never be constructed without confirm:true")

    monkeypatch.setattr("mobilize.transports.calle.CalleTransport", _ExplodingCalleTransport)

    client = TestClient(app)
    with client.websocket_connect("/ws/run", headers={"origin": TRUSTED_ORIGIN}) as ws:
        ws.send_json({
            "need_label": "test", "need_count": 1, "deadline_minutes": 60,
            "max_calls": 5, "simulate": False,  # no "confirm" field at all
        })
        msg = ws.receive_json()

    assert msg["event"] == "error"
    assert "confirm" in msg["data"]["message"].lower()
    assert calle_constructed["count"] == 0


def test_real_dispatch_with_confirm_false_is_also_refused(monkeypatch):
    """Explicit confirm:false must behave identically to a missing field --
    a client cannot bypass the gate by sending the field with a falsy value."""
    class _ExplodingCalleTransport:
        def __init__(self, *a, **kw):
            raise AssertionError("must not be constructed")

    monkeypatch.setattr("mobilize.transports.calle.CalleTransport", _ExplodingCalleTransport)

    client = TestClient(app)
    with client.websocket_connect("/ws/run", headers={"origin": TRUSTED_ORIGIN}) as ws:
        ws.send_json({
            "need_label": "test", "need_count": 1, "deadline_minutes": 60,
            "max_calls": 5, "simulate": False, "confirm": False,
        })
        msg = ws.receive_json()

    assert msg["event"] == "error"


def test_simulated_dispatch_works_without_confirm():
    """The free rehearsal path must not require confirm -- that gate is
    specifically for real calls."""
    client = TestClient(app)
    with client.websocket_connect("/ws/run", headers={"origin": TRUSTED_ORIGIN}) as ws:
        ws.send_json({
            "need_label": "test", "need_count": 1, "deadline_minutes": 60,
            "max_calls": 5, "simulate": True,
        })
        events = []
        while True:
            msg = ws.receive_json()
            events.append(msg["event"])
            if msg["event"] == "final":
                break
    assert "final" in events


def test_default_bind_host_is_localhost_not_all_interfaces():
    """Regression guard against silently reverting to 0.0.0.0. Reads the
    actual source rather than re-deriving the same default separately,
    since the bind call only runs under `if __name__ == "__main__"` and
    isn't otherwise exercised by importing the module."""
    import inspect

    source = inspect.getsource(dashboard_module)
    assert 'os.environ.get("MOBILIZE_DASHBOARD_HOST", "127.0.0.1")' in source
    assert 'host="0.0.0.0"' not in source


def test_real_dispatch_passes_persisted_governance_state(monkeypatch):
    """The other half of the reported gap: even once confirm:true is
    supplied, the real path was calling mobilize() with no governance_state
    at all, silently disabling DNC/cooldown/fatigue/timezone enforcement.
    This captures the actual kwargs mobilize() receives on the real path."""
    captured = {}

    async def _fake_mobilize(need, candidates, transport, **kwargs):
        captured.update(kwargs)
        from mobilize.core.types import MobilizeResult
        return MobilizeResult(need=need, confirmed=[], all_results=[], waves=[],
                               calls_used=0, time_to_fill_seconds=None, filled=False,
                               over_recruitment_ratio=0.0)

    class _FakeCalleTransport:
        def __init__(self, *a, **kw):
            pass

    monkeypatch.setattr(dashboard_module, "mobilize", _fake_mobilize)
    monkeypatch.setattr("mobilize.transports.calle.CalleTransport", _FakeCalleTransport)

    client = TestClient(app)
    with client.websocket_connect("/ws/run", headers={"origin": TRUSTED_ORIGIN}) as ws:
        ws.send_json({
            "need_label": "test", "need_count": 1, "deadline_minutes": 60,
            "max_calls": 5, "simulate": False, "confirm": True,
        })
        while True:
            msg = ws.receive_json()
            if msg["event"] == "final":
                break

    assert captured.get("governance_state") is not None
    assert captured.get("governance_policy") is not None
    assert captured.get("governance_state_path") is not None
    # Also the deterministic-ID fix: not id(ws)-based, which changes on
    # every reconnect and would break idempotent retry after a crash.
    assert not captured.get("mobilization_id", "").startswith("dash_sim_")


def test_registry_upload_xss_payload_is_not_executed_unescaped():
    """The registry name field is a coordinator's own CSV input -- this
    proves the API returns it as inert data (the escaping fix lives in the
    JS layer, so this test asserts the raw value passes through the API
    unmodified, which is what the client-side esc() then neutralizes; the
    contract this test protects is that the server does not strip or
    otherwise silently "fix" the field in a way that would mask a
    regression if the client-side escaping were ever removed)."""
    payload = '<img src=x onerror=alert(1)>'
    csv = f"name,phone,timezone\n{payload},+15550101234,UTC\n"

    client = TestClient(app)
    resp = client.post("/api/registry/upload", json={"csv": csv})
    assert resp.json()["count"] == 1

    resp = client.get("/api/registry")
    people = resp.json()["people"]
    assert people[0]["name"] == payload  # server stores it verbatim...
    # ...which is exactly why the dashboard's JS must escape it before any
    # innerHTML use -- see the esc() function in dashboard.py's _PAGE.
