"""Regressions for the four findings in the review of 24ae0749.

Each test fails on that commit and passes here.
"""
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from crc import security, store
from crc.app import app
from crc.security import UnsafeCallId, UnsafeOrigin, safe_call_id

TOKEN = "test-console-token"


@pytest.fixture(autouse=True)
def _console_token(monkeypatch):
    monkeypatch.setenv("CRC_CONSOLE_TOKEN", TOKEN)


@pytest.fixture
def client():
    return TestClient(app)


def auth(**kw):
    return {"X-CRC-Console": TOKEN, **kw}


# --- finding 4: call ids reaching the filesystem -----------------------------

@pytest.mark.parametrize(
    "bad",
    ["../escape", "a/b", "..", ".", "", "with space", "quote'break", 'dquote"break',
     "back`tick", "nul\x00byte", "/absolute", "x" * 129, ".hidden"],
)
def test_unsafe_call_ids_are_refused(bad):
    with pytest.raises(UnsafeCallId):
        safe_call_id(bad)


def test_ordinary_call_ids_still_pass():
    for good in ["call_fx_001", "abc-123", "A.b_c-9", "0"]:
        assert safe_call_id(good) == good


def test_webhook_traversal_id_is_rejected_and_writes_nothing(client, tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    r = client.post(
        "/calle/webhook",
        json={"type": "call.completed",
              "data": {"object": "call_task", "id": "../../pwned", "status": "completed"}},
    )
    assert r.status_code == 400
    assert not list(tmp_path.rglob("*pwned*"))


def test_store_save_refuses_to_escape_the_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    with pytest.raises(UnsafeCallId):
        store.save({"object": "call_task", "id": "../../../etc/pwned"})


def test_review_note_read_cannot_traverse(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    (tmp_path / "secret.review.json").write_text(json.dumps({"verdict": "leaked"}))
    assert store.review_note("../secret") is None


# --- finding 1: authentication --------------------------------------------

@pytest.mark.parametrize(
    "method,path",
    [("get", "/api/calls"), ("get", "/api/calls/call_fx_001"), ("get", "/api/benchmark"),
     ("get", "/api/health"), ("post", "/api/fetch"), ("post", "/api/calls/call_fx_001/note")],
)
def test_every_data_route_requires_the_console_token(client, method, path):
    r = client.post(path, json={}) if method == "post" else client.get(path)
    assert r.status_code == 401, f"{path} answered {r.status_code} without a token"


def test_routes_answer_with_the_token(client):
    assert client.get("/api/calls", headers=auth()).status_code == 200


def test_console_refuses_rather_than_defaulting_open(client, monkeypatch):
    monkeypatch.delenv("CRC_CONSOLE_TOKEN", raising=False)
    assert client.get("/api/calls").status_code == 503


def test_ping_stays_open_but_leaks_nothing(client):
    body = client.get("/api/ping").json()
    assert body == {"ok": True, "auth_required": True}


# --- finding 2: the API key's destination ---------------------------------

@pytest.mark.parametrize(
    "bad", ["http://api.heycall-e.com", "https://evil.example.com", "ftp://api.heycall-e.com", ""]
)
def test_api_key_is_not_sent_to_unapproved_origins(bad):
    with pytest.raises(UnsafeOrigin):
        security.check_api_origin(bad)


def test_official_origin_is_allowed():
    assert security.check_api_origin("https://api.heycall-e.com")


def test_private_deployment_can_be_allow_listed(monkeypatch):
    monkeypatch.setenv("CALLE_ALLOWED_HOSTS", "calle.internal")
    assert security.check_api_origin("https://calle.internal")
    with pytest.raises(UnsafeOrigin):
        security.check_api_origin("https://api.heycall-e.com")


# --- finding 3: deep masking ----------------------------------------------

def test_phone_numbers_are_masked_in_transcripts_and_results():
    task = {
        "object": "call_task", "id": "x", "task": "call +15550100123",
        "summary": "reached +15550100123",
        "result": {"callback": "+15550100999", "nested": [{"n": "+15550100777"}]},
        "recipients": [{"phones": ["+15550100123"], "attempts": [
            {"phone": "+15550100123",
             "transcript_turns": [{"speaker": "callee", "text": "my number is +15550100456"}]}]}],
    }
    blob = json.dumps(store.masked(task))
    for raw in ("+15550100123", "+15550100456", "+15550100999", "+15550100777"):
        assert raw not in blob, f"{raw} survived masking"
    assert "+1********23" in blob
