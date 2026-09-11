"""Regressions for the four findings in the review of 24ae0749.

Each test fails on that commit and passes here.
"""
import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from crc import review, sanitize, security, store
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
    monkeypatch.setenv("CRC_WEBHOOK_TOKEN", "hook")
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    r = client.post(
        "/calle/webhook",
        headers={"X-CRC-Token": "hook"},
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


def test_console_is_never_anonymous_even_unconfigured(client, monkeypatch):
    """With no token configured the console still refuses anonymous callers.

    It generates one per process and prints it, rather than either serving
    openly or returning 503 and breaking the documented fixture demo.
    """
    monkeypatch.delenv("CRC_CONSOLE_TOKEN", raising=False)
    assert client.get("/api/calls").status_code == 401
    generated = security.console_token()
    assert generated and security.console_token_is_ephemeral()
    assert client.get("/api/calls", headers={"X-CRC-Console": generated}).status_code == 200


def test_startup_banner_shows_the_generated_token(monkeypatch):
    monkeypatch.delenv("CRC_CONSOLE_TOKEN", raising=False)
    assert security.console_token() in security.startup_banner()
    monkeypatch.setenv("CRC_CONSOLE_TOKEN", "configured")
    assert "configured" not in security.startup_banner()  # never echo a real secret


# --- superseding review: webhook must fail closed ---------------------------

def test_webhook_refuses_when_no_token_is_configured(client, monkeypatch, tmp_path):
    monkeypatch.delenv("CRC_WEBHOOK_TOKEN", raising=False)
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    body = {"type": "call.completed",
            "data": {"object": "call_task", "id": "call_x1", "status": "completed"}}
    r = client.post("/calle/webhook", json=body)
    assert r.status_code == 503
    assert not list(tmp_path.rglob("call_x1*"))


def test_webhook_requires_the_token_when_configured(client, monkeypatch, tmp_path):
    monkeypatch.setenv("CRC_WEBHOOK_TOKEN", "hook-secret")
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    body = {"type": "call.completed",
            "data": {"object": "call_task", "id": "call_x2", "status": "completed"}}
    assert client.post("/calle/webhook", json=body).status_code == 401
    assert client.post("/calle/webhook", json=body,
                       headers={"X-CRC-Token": "hook-secret"}).status_code == 200


# --- superseding review: redaction happens before persistence ---------------

def test_snapshot_on_disk_carries_no_pii(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    task = {
        "object": "call_task", "id": "call_pii", "task": "call +15550100123",
        "result": {"callback": "+15550100999", "card": "4111 1111 1111 1111"},
        "recipients": [{"phones": ["+15550100123"], "attempts": [{"phone": "+15550100123",
            "transcript_turns": [
                {"speaker": "agent", "text": "reading back 4111 1111 1111 1111"},
                {"speaker": "callee", "text": "my ssn is 123-45-6789"}]}]}],
    }
    path = store.save(task)
    raw = path.read_text()
    for secret in ("+15550100123", "+15550100999", "4111 1111 1111 1111", "123-45-6789"):
        assert secret not in raw, f"{secret} was written to disk"
    assert "[redacted-card]" in raw and "[redacted-gov-id]" in raw


def test_redaction_keeps_the_compliance_finding(tmp_path, monkeypatch):
    """The digits go, the verdict stays: a card read aloud is still reported."""
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    task = {
        "object": "call_task", "id": "call_rb",
        "recipients": [{"attempts": [{"transcript_turns": [
            {"speaker": "agent", "text": "confirming 4111 1111 1111 1111"}]}]}],
    }
    store.save(task)
    stored = store.load_all()["call_rb"]
    assert stored["metadata"]["pii"]["card"] is True
    assert review.review(stored)["compliance"]["sensitive_readback"] is True


def test_redaction_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    task = {"object": "call_task", "id": "call_idem", "task": "call +15550100123"}
    once = sanitize.redact(task)
    assert sanitize.redact(once) == once


def test_ping_stays_open_but_leaks_nothing(client):
    body = client.get("/api/ping").json()
    assert body == {"ok": True, "auth_required": True, "demo": False}
    # Exact equality on purpose: a new key on this unauthenticated route is
    # how a leak would arrive, so it has to be declared here to pass.


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


# --- third pass: formatted contact details, and what must survive -----------

@pytest.mark.parametrize(
    "raw",
    [
        "+15550100123",            # E.164
        "+1 555 010 0123",         # spaced international
        "+1-555-010-0123",         # hyphenated international
        "(555) 010-0123",          # national with parens
        "555.010.0123",            # dotted
        "555 010 0123",            # spaced national
        "0555 010123",             # leading zero, local
    ],
)
def test_every_written_phone_form_is_redacted(raw):
    out = sanitize._redact_text(f"reach me on {raw} tomorrow")
    assert raw not in out, f"{raw!r} survived as {out!r}"
    assert "*" in out


def test_emails_and_ids_are_redacted():
    out = sanitize._redact_text("mail bob.smith+tag@mail.example.org or ssn 123-45-6789 card 4111 1111 1111 1111")
    assert "bob.smith+tag@mail.example.org" not in out
    assert "123-45-6789" not in out
    assert "4111 1111 1111 1111" not in out
    assert "[redacted-email]" in out and "[redacted-gov-id]" in out and "[redacted-card]" in out


@pytest.mark.parametrize(
    "keep",
    [
        "2026-09-04T15:03:06Z",    # the created_at on every snapshot
        "2026-09-04T15:03:06+05:30",
        "2026-09-04",
        "15:03",
        "9:30 am",
        "12.5",
    ],
)
def test_timestamps_and_times_survive_redaction(keep):
    """A loose digit matcher would eat these; the timing analysis depends on them."""
    assert keep in sanitize._redact_text(f"at {keep} the call ended")


def test_findings_see_formatted_forms_too():
    f = sanitize.findings({"t": "call (555) 010-0123 or mail a@example.net"})
    assert f["phone"] and f["email"]


def test_no_contact_detail_of_any_form_reaches_disk(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path / "data")
    task = {
        "object": "call_task", "id": "call_forms",
        "created_at": "2026-09-04T15:03:06Z",
        "task": "call (555) 010-0123 and confirm",
        "result": {"callback": "+1 555 010 0999", "email": "ops@example.com"},
        "recipients": [{"attempts": [{"transcript_turns": [
            {"offset_seconds": 0, "speaker": "callee", "text": "try 555.010.0777 after 9:30 am"},
            {"speaker": "agent", "text": "card is 4111-1111-1111-1111"}]}]}],
    }
    raw = store.save(task).read_text()
    for secret in ("555) 010-0123", "555 010 0999", "ops@example.com",
                   "555.010.0777", "4111-1111-1111-1111"):
        assert secret not in raw, f"{secret} was written to disk"
    assert "2026-09-04T15:03:06Z" in raw  # timestamp intact
    assert "9:30 am" in raw               # spoken time intact


# --- demo mode: a published fixtures-only deployment ------------------------
# The hosted demo was unreachable: the console token is minted per process and
# printed to stdout, which nobody visiting a Cloud Run URL can read. Demo mode
# publishes a token that was set on purpose, and nothing else.


def _ping(monkeypatch, **env):
    for k in ("CRC_DEMO", "CRC_CONSOLE_TOKEN", "CALLE_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    from fastapi.testclient import TestClient

    from crc.app import app
    return TestClient(app).get("/api/ping").json()


def test_ping_publishes_nothing_by_default(monkeypatch):
    body = _ping(monkeypatch)
    assert body["demo"] is False and "demo_token" not in body


def test_demo_flag_alone_publishes_nothing(monkeypatch):
    """Without an explicitly set token there is only the random per-process one,
    and that must never be published."""
    body = _ping(monkeypatch, CRC_DEMO="true")
    assert body["demo"] is False and "demo_token" not in body


def test_demo_mode_refuses_when_a_live_key_is_present(monkeypatch):
    """A deployment that can reach real calls is not a fixtures-only demo."""
    body = _ping(monkeypatch, CRC_DEMO="true", CRC_CONSOLE_TOKEN="demo", CALLE_API_KEY="iams_x")
    assert body["demo"] is False and "demo_token" not in body


def test_demo_mode_publishes_only_the_configured_token(monkeypatch):
    body = _ping(monkeypatch, CRC_DEMO="true", CRC_CONSOLE_TOKEN="open-sesame")
    assert body["demo"] is True and body["demo_token"] == "open-sesame"


def test_demo_mode_does_not_weaken_the_routes(monkeypatch):
    """Publishing the token is not the same as dropping the check: a request
    without it is still refused."""
    from fastapi.testclient import TestClient

    from crc.app import app
    for k, v in (("CRC_DEMO", "true"), ("CRC_CONSOLE_TOKEN", "open-sesame")):
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("CALLE_API_KEY", raising=False)
    c = TestClient(app)
    assert c.get("/api/calls").status_code == 401
    assert c.get("/api/calls", headers={"X-CRC-Console": "open-sesame"}).status_code == 200
