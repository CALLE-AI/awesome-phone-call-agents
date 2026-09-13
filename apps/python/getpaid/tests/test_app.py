"""All tests run against CALLE_MODE=fixture, so no live calls are ever
placed and no CALL-E credentials are required — matches this repo's
"safe to try without a real call when possible" convention.
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

os.environ["CALLE_MODE"] = "fixture"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

import ratelimit
import storage


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    """Point storage at a throwaway file per test so tests don't touch
    real demo data and don't leak state between tests."""
    monkeypatch.setattr(storage, "DATA_DIR", tmp_path)
    monkeypatch.setattr(storage, "DATA_FILE", tmp_path / "invoices.json")
    yield


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """The rate limiter's ip -> timestamps log is module-level state shared
    across tests (and TestClient always uses the same fake client IP), so it
    must be cleared before every test."""
    ratelimit.reset()
    yield


@pytest.fixture
def client():
    from main import app  # imported after env var + monkeypatch are in place

    return TestClient(app)


SAMPLE_INVOICE = {
    "freelancer_name": "Priya Shah",
    "client_name": "Bram at Fenwick Studio",
    "client_phone": "+14155550123",
    "invoice_number": "INV-0042",
    "amount": "2,400",
    "currency": "USD",
    "due_date": "2026-08-20",
    "region": "US",
    "locale": "en-US",
}


def test_create_and_list_invoice(client):
    resp = client.post("/api/invoices", json=SAMPLE_INVOICE)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "not_called"
    assert body["client_name"] == "Bram at Fenwick Studio"

    listed = client.get("/api/invoices").json()
    assert len(listed) == 1
    assert listed[0]["id"] == body["id"]


def test_place_call_returns_valid_status(client):
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    result = client.post(f"/api/invoices/{created['id']}/call").json()

    assert result["status"] in {
        "paid",
        "promised",
        "disputed",
        "voicemail",
        "no_answer",
        "wrong_number",
        "declined",
    }
    assert len(result["attempts"]) == 1
    assert result["attempts"][0]["mode"] == "fixture"


def test_call_missing_invoice_404s(client):
    resp = client.post("/api/invoices/does-not-exist/call")
    assert resp.status_code == 404


def test_delete_invoice(client):
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    client.delete(f"/api/invoices/{created['id']}")
    assert client.get("/api/invoices").json() == []


def test_follow_up_skips_non_eligible_statuses(client):
    """An invoice marked 'disputed' must never be auto-called again —
    that's routed to a human, per the repo's safety conventions."""
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    storage.update_invoice_fields(
        created["id"], status="disputed", promised_date="2020-01-01"
    )
    result = client.post("/api/follow-ups/run").json()
    assert result["follow_ups_placed"] == 0


def test_follow_up_fires_for_overdue_promise(client):
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    storage.update_invoice_fields(
        created["id"], status="promised", promised_date="2020-01-01"
    )
    result = client.post("/api/follow-ups/run").json()
    assert result["follow_ups_placed"] == 1


def test_follow_up_ignores_future_promise(client):
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    storage.update_invoice_fields(
        created["id"], status="promised", promised_date="2099-01-01"
    )
    result = client.post("/api/follow-ups/run").json()
    assert result["follow_ups_placed"] == 0


def test_follow_up_fires_for_stale_voicemail(client):
    """A voicemail invoice becomes eligible for one automatic retry once
    RETRY_AFTER_HOURS (default 24h) has passed since the last attempt."""
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    stale = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    storage.update_invoice_fields(
        created["id"], status="voicemail", last_attempt_at=stale
    )
    result = client.post("/api/follow-ups/run").json()
    assert result["follow_ups_placed"] == 1


def test_follow_up_skips_recent_voicemail(client):
    """A voicemail invoice must NOT be retried before the retry window has
    elapsed — this was the bug: the status implied eligibility but nothing
    ever checked timing, so these silently never retried."""
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    storage.update_invoice_fields(
        created["id"], status="voicemail", last_attempt_at=recent
    )
    result = client.post("/api/follow-ups/run").json()
    assert result["follow_ups_placed"] == 0


def test_follow_up_cap_blocks_further_calls(client):
    """An invoice that already has 2 automatic follow-ups (the cap) must
    never be auto-called again, even if it's otherwise eligible."""
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    stale = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    storage.update_invoice_fields(
        created["id"],
        status="voicemail",
        last_attempt_at=stale,
        follow_up_count=2,
    )
    result = client.post("/api/follow-ups/run").json()
    assert result["follow_ups_placed"] == 0


def test_follow_up_cap_sets_needs_human_review(client):
    """Hitting the cap should flag the invoice for a human rather than just
    silently stopping."""
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    stale = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    storage.update_invoice_fields(
        created["id"], status="voicemail", last_attempt_at=stale, follow_up_count=1
    )
    result = client.post(f"/api/invoices/{created['id']}/call?follow_up=true").json()
    assert result["follow_up_count"] == 2
    assert result["needs_human_review"] is True

    # Even if the invoice landed back on a retry-eligible status, the cap
    # blocks any further automatic follow-up call.
    storage.update_invoice_fields(created["id"], status="voicemail", last_attempt_at=stale)
    run_result = client.post("/api/follow-ups/run").json()
    assert run_result["follow_ups_placed"] == 0


@pytest.fixture
def live_mode(monkeypatch):
    """Simulates CALLE_MODE=live without ever touching the network: patches
    CalleClient.place_call to return a canned result, and tracks how many
    times it was actually invoked (i.e. how many real CALL-E calls would
    have been placed)."""
    monkeypatch.setenv("CALLE_MODE", "live")
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    calls = {"count": 0}

    def fake_place_call(self, invoice, follow_up=False):
        calls["count"] += 1
        return {
            "status": "no_answer",
            "promised_date": None,
            "note": "",
            "calle_call_id": "fake_call_id",
            "mode": "live",
        }

    monkeypatch.setattr("calle_client.CalleClient.place_call", fake_place_call)
    return calls


def test_live_call_requires_consent(client, live_mode):
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()

    resp = client.post(f"/api/invoices/{created['id']}/call")
    assert resp.status_code == 403
    assert "Consent required" in resp.json()["detail"]
    assert live_mode["count"] == 0


def test_live_call_with_consent_succeeds(client, live_mode):
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()

    resp = client.post(f"/api/invoices/{created['id']}/call?consent=true")
    assert resp.status_code == 200
    assert live_mode["count"] == 1


def test_live_call_rate_limit_per_ip(client, live_mode, monkeypatch):
    """Per-IP limit (1) blocks a second call from the same visitor. Isolated
    from the global cap by raising it, so this test is only exercising the
    per-IP limiter."""
    monkeypatch.setattr(ratelimit, "MAX_TOTAL_LIVE_CALLS", 10)
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()

    resp = client.post(f"/api/invoices/{created['id']}/call?consent=true")
    assert resp.status_code == 200

    resp = client.post(f"/api/invoices/{created['id']}/call?consent=true")
    assert resp.status_code == 429
    assert "Demo limit reached" in resp.json()["detail"]
    assert live_mode["count"] == 1


def test_unconsented_requests_count_toward_rate_limit_without_calling_calle(client, live_mode, monkeypatch):
    """The rate limit is checked before consent, so even a bare, unconsented
    request (e.g. curl) consumes the per-IP budget (now 1) — the very next
    one 429s, without ever reaching CalleClient.place_call. Isolated from
    the global cap by raising it."""
    monkeypatch.setattr(ratelimit, "MAX_TOTAL_LIVE_CALLS", 10)
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()

    resp = client.post(f"/api/invoices/{created['id']}/call")
    assert resp.status_code == 403

    resp = client.post(f"/api/invoices/{created['id']}/call")
    assert resp.status_code == 429
    assert "Demo limit reached" in resp.json()["detail"]
    assert live_mode["count"] == 0


def test_global_cap_blocks_calls_regardless_of_ip(client, live_mode, monkeypatch):
    """Once the global cap is reached (e.g. by some other visitor), no
    further real call can be placed from any IP — verified by pre-seeding
    the global counter directly and confirming a fresh request is rejected
    before ever reaching CalleClient.place_call. Isolated from the per-IP
    limit by raising it."""
    monkeypatch.setattr(ratelimit, "MAX_LIVE_CALLS_PER_WINDOW", 10)
    ratelimit.check_and_record_global()  # simulate a call already placed elsewhere

    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    resp = client.post(f"/api/invoices/{created['id']}/call?consent=true")
    assert resp.status_code == 503
    assert "Demo credits exhausted" in resp.json()["detail"]
    assert live_mode["count"] == 0


def test_mode_reports_live_call_budget(client, live_mode):
    resp = client.get("/api/mode").json()
    assert resp["live_calls_placed"] == 0
    assert resp["live_calls_max"] == 1
    assert resp["live_calls_exhausted"] is False

    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    client.post(f"/api/invoices/{created['id']}/call?consent=true")

    resp = client.get("/api/mode").json()
    assert resp["live_calls_placed"] == 1
    assert resp["live_calls_exhausted"] is True


def test_follow_ups_disabled_in_live_mode(client, live_mode):
    created = client.post("/api/invoices", json=SAMPLE_INVOICE).json()
    storage.update_invoice_fields(
        created["id"], status="promised", promised_date="2020-01-01"
    )
    result = client.post("/api/follow-ups/run").json()
    assert result["follow_ups_placed"] == 0
