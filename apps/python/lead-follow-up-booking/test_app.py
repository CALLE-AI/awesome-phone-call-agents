"""Tests for lead-follow-up-booking.

These tests never dial a phone and never touch Google or CALL-E servers.
The slot-availability test uses a fake Calendar service with canned events.
"""

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import app

KOLKATA = "Asia/Kolkata"
NEW_YORK = "America/New_York"


class FakeCalendarService:
    """Minimal stand-in for the googleapiclient Calendar service."""

    def __init__(self, items):
        self._items = items

    def events(self):
        return self

    def list(self, **kwargs):
        return self

    def execute(self):
        return {"items": self._items}


def _all_day(start, end):
    return {"start": {"date": start}, "end": {"date": end}}


def _timed(start, end):
    return {"start": {"dateTime": start}, "end": {"dateTime": end}}


def test_tz_friendly_name():
    assert app.tz_friendly_name(KOLKATA) == "IST (India Standard Time)"
    assert app.tz_friendly_name("Asia/Hong_Kong") == "HKT (Hong Kong Time)"
    assert app.tz_friendly_name("Etc/Unknown") == "Etc/Unknown"
    assert app.tz_friendly_name(None) is None


def test_get_lead_timezone_from_phone():
    assert app.get_lead_timezone("+12025550100") == NEW_YORK
    assert app.get_lead_timezone("+14155550100") == "America/Los_Angeles"
    assert app.get_lead_timezone("+447700900123") == "Europe/London"


def test_convert_lead_time_to_company():
    aware, lead_tz, company_tz = app.convert_lead_time_to_company(
        KOLKATA, NEW_YORK, "tomorrow", "15:00", date(2026, 8, 17)
    )
    assert aware is not None
    assert aware.strftime("%H:%M") == "05:30"
    assert aware.tzinfo == ZoneInfo(NEW_YORK)
    assert lead_tz == KOLKATA
    assert company_tz == NEW_YORK


def test_convert_without_lead_tz_uses_company_tz():
    aware, lead_tz, company_tz = app.convert_lead_time_to_company(
        None, NEW_YORK, "tomorrow", "15:00", date(2026, 8, 17)
    )
    assert aware is not None
    assert aware.strftime("%H:%M") == "15:00"
    assert lead_tz is None


def test_available_slots_with_conflict():
    day = date(2026, 8, 17)
    items = [_timed("2026-08-17T10:00:00-04:00", "2026-08-17T10:30:00-04:00")]
    service = FakeCalendarService(items)
    slots = app.get_available_slots(service, day, NEW_YORK)
    assert len(slots) == 15
    assert slots[0]["company"] == "10:30"
    assert slots[-1]["company"] == "17:30"
    assert all(s["start"].tzinfo == ZoneInfo(NEW_YORK) for s in slots)


def test_all_day_event_blocks_everything():
    day = date(2026, 8, 17)
    service = FakeCalendarService([_all_day("2026-08-17", "2026-08-18")])
    slots = app.get_available_slots(service, day, NEW_YORK)
    assert slots == []


def test_slots_shown_in_lead_timezone():
    day = date(2026, 8, 17)
    service = FakeCalendarService([])
    slots = app.get_available_slots(service, day, NEW_YORK, lead_tz=KOLKATA)
    first_company = datetime.combine(day, datetime.min.time()).replace(
        hour=app.BUSINESS_START_HOUR, tzinfo=ZoneInfo(NEW_YORK)
    )
    assert slots[0]["lead"] == first_company.astimezone(ZoneInfo(KOLKATA)).strftime("%H:%M")


def test_format_slots_for_message():
    assert app.format_slots_for_message([]) == "no available slots at the moment"
    slots = [{"lead": "10:00"}, {"lead": "10:30"}]
    assert app.format_slots_for_message(slots) == "10:00, 10:30"


def test_generate_call_message_mentions_free_slots_and_ai_disclosure():
    msg = app.generate_call_message(
        "John",
        "Acme Corp",
        lead_company="XYZ Inc",
        lead_tz=KOLKATA,
        slots=[{"lead": "10:00"}, {"lead": "10:30"}],
        slot_day="tomorrow",
    )
    assert "John" in msg
    assert "10:00" in msg and "10:30" in msg
    assert "IST" in msg
    assert "10:30" in msg
    assert "AI" in msg and "AI voice assistant" in msg


def test_validate_e164_strict():
    assert app.validate_e164("+12025550100") == "+12025550100"
    assert app.validate_e164("+1 202 555 0100") == "+12025550100"
    assert app.validate_e164("+12345") is None
    assert app.validate_e164("not-a-number") is None
    assert app.validate_e164("") is None
    assert app.validate_e164(None) is None


def test_mask_phone():
    dot = chr(0x2022)
    assert app.mask_phone("+12025550100") == "+1" + dot * 4 + " " + dot * 4 + " 0100"
    assert app.mask_phone("") == ""
    assert app.mask_phone("+1234") == "+1" + dot * 4


def test_lead_idempotency_key_deterministic():
    k1 = app.lead_idempotency_key("John", "jane.doe@example.com", "+12025550100", "XYZ", "Acme", "tomorrow")
    k2 = app.lead_idempotency_key("John", "jane.doe@example.com", "+12025550100", "XYZ", "Acme", "tomorrow")
    k3 = app.lead_idempotency_key("John", "jane.doe@example.com", "+12025550100", "XYZ", "Acme", "today")
    assert k1 == k2
    assert k1 != k3
    assert k1.startswith("lead-")


def _structured(**overrides):
    base = {
        "wants_appointment": "yes",
        "preferred_day": "tomorrow",
        "preferred_time": "15:00",
        "time_confirmed": "yes",
        "timezone": "Asia/Kolkata",
    }
    base.update(overrides)
    return base


def test_booking_decision_accepts_complete_evidence():
    decision = app.booking_decision("completed", _structured())
    assert decision == ("tomorrow", "15:00", "Asia/Kolkata")


def test_booking_decision_fails_closed():
    assert app.booking_decision("pending", _structured()) is None
    assert app.booking_decision("failed", _structured()) is None
    assert app.booking_decision("completed", None) is None
    assert app.booking_decision("completed", {}) is None
    assert app.booking_decision("completed", _structured(wants_appointment="no")) is None
    assert app.booking_decision("completed", _structured(time_confirmed="no")) is None
    assert app.booking_decision("completed", _structured(time_confirmed="unknown")) is None
    assert app.booking_decision("completed", _structured(preferred_day="yesterday")) is None
    assert app.booking_decision("completed", _structured(preferred_day="sunday")) is None
    assert app.booking_decision("completed", _structured(preferred_time="")) is None
    assert app.booking_decision("completed", _structured(preferred_time="unknown")) is None
    assert app.booking_decision("completed", _structured(preferred_time="25:99")) is None
    assert app.booking_decision("completed", _structured(preferred_time="not-a-time")) is None
    assert app.booking_decision("completed", _structured(timezone="unknown")) is None
    assert app.booking_decision("completed", _structured(timezone="")) is None
    # A simulated/shim call never books, even with perfect evidence.
    assert app.booking_decision("completed", _structured(), simulated=True) is None


def test_require_token_fails_closed_without_token(monkeypatch):
    monkeypatch.setattr(app, "APP_TOKEN", "s3cret-app-token-123456")
    from flask import Flask
    from app import require_token

    flask_app = Flask(__name__)

    with flask_app.test_request_context("/", headers={"Authorization": "Bearer wrong"}):
        resp = require_token()
        assert resp is not None and resp[1] == 401

    with flask_app.test_request_context("/", headers={"Authorization": "Bearer s3cret-app-token-123456"}):
        assert require_token() is None

    with flask_app.test_request_context("/"):
        resp = require_token()
        assert resp is not None and resp[1] == 401


def test_require_token_strict_enforced_even_in_preview(monkeypatch):
    # Credential-free preview (live off, no APP_TOKEN): non-strict opens,
    # but strict (call-result / OAuth / batch / data) still fails closed.
    monkeypatch.setattr(app, "LIVE_CALLS_ENABLED", False)
    monkeypatch.setattr(app, "APP_TOKEN", "")
    from flask import Flask
    from app import require_token

    flask_app = Flask(__name__)
    with flask_app.test_request_context("/"):
        assert require_token() is None
        resp = require_token(strict=True)
        assert resp is not None and resp[1] == 401


def test_preview_lead_submission_runs_without_credentials():
    client = app.app.test_client()
    resp = client.post("/lead-submission", json={
        "name": "Alice Example",
        "phone": "+12025550100",
        "email": "alice.example@example.com",
        "company": "XYZ Inc",
        "your_company": "Acme Corp",
        "consent": "yes",
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["mode"] == "simulated"


def test_preview_protected_routes_require_auth(monkeypatch):
    monkeypatch.setattr(app, "LIVE_CALLS_ENABLED", False)
    monkeypatch.setattr(app, "APP_TOKEN", "")
    client = app.app.test_client()
    for path in (
        "/call-status/null",
        "/batch-status/nope",
        "/batch-download/nope",
        "/oauth-status",
        "/detect-timezone?phone=%2B12025550100",
    ):
        resp = client.get(path)
        assert resp.status_code == 401, path


def test_preview_protected_routes_pass_with_token(monkeypatch):
    monkeypatch.setattr(app, "LIVE_CALLS_ENABLED", False)
    monkeypatch.setattr(app, "APP_TOKEN", "local-dev-token-please-change-42")
    client = app.app.test_client()
    headers = {"Authorization": "Bearer local-dev-token-please-change-42"}
    assert client.get("/call-status/null", headers=headers).status_code == 200
    assert client.get("/detect-timezone", headers=headers).status_code == 200
    assert client.get("/batch-status/nope", headers=headers).status_code == 404
    assert client.get("/oauth-status", headers=headers).status_code == 200


class _FakeCreds:
    scopes = [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/gmail.send",
    ]


_LIVE_HEADERS = {
    "Authorization": "Bearer s3cret-app-token-123456",
    "X-Confirm-Live-Call": "I understand this places a real phone call",
}


def _live_monkeypatch(monkeypatch, service):
    monkeypatch.setattr(app, "LIVE_CALLS_ENABLED", True)
    monkeypatch.setattr(app, "APP_TOKEN", "s3cret-app-token-123456")
    monkeypatch.setattr(app, "get_google_credentials", lambda session_id=None: _FakeCreds())
    monkeypatch.setattr(app, "build", lambda *args, **kwargs: service)


def test_live_submission_fails_closed_when_availability_lookup_fails(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("calendar API down")

    _live_monkeypatch(monkeypatch, boom)
    dialed = {"count": 0}

    def track_call(**kwargs):
        dialed["count"] += 1
        return {"sid": "CAx", "simulated": False, "status": "completed"}

    monkeypatch.setattr(app, "place_call_e_call", track_call)
    client = app.app.test_client()
    resp = client.post(
        "/lead-submission",
        headers=_LIVE_HEADERS,
        json={
            "name": "Alice Example",
            "phone": "+12025550100",
            "email": "alice.example@example.com",
            "consent": "yes",
        },
    )
    assert resp.status_code == 502
    assert "no call was placed" in resp.get_json()["error"]
    assert dialed["count"] == 0


def test_live_submission_fails_closed_when_no_free_slots(monkeypatch):
    tomorrow = (datetime.utcnow() + timedelta(days=1)).date()
    service = FakeCalendarService([
        _all_day(tomorrow.isoformat(), (tomorrow + timedelta(days=1)).isoformat())
    ])
    _live_monkeypatch(monkeypatch, service)
    dialed = {"count": 0}

    def track_call(**kwargs):
        dialed["count"] += 1
        return {"sid": "CAx", "simulated": False, "status": "completed"}

    monkeypatch.setattr(app, "place_call_e_call", track_call)
    client = app.app.test_client()
    resp = client.post(
        "/lead-submission",
        headers=_LIVE_HEADERS,
        json={
            "name": "Alice Example",
            "phone": "+12025550100",
            "email": "alice.example@example.com",
            "consent": "yes",
        },
    )
    assert resp.status_code == 502
    assert "No calendar-confirmed free slots" in resp.get_json()["error"]
    assert dialed["count"] == 0


def _mk_rows():
    return [
        {
            "name": "Alice Example", "phone": "+12025550100",
            "email": "alice.example@example.com", "company": "",
            "your_company": "Acme Corp", "company_tz": "UTC",
            "consent": "yes", "consent_recorded_at": "2026-01-01T00:00:00Z",
            "lead_tz": None,
        },
        {
            "name": "Bob Fiction", "phone": "+14155550100",
            "email": "bob.fiction@example.com", "company": "",
            "your_company": "Acme Corp", "company_tz": "UTC",
            "consent": "yes", "consent_recorded_at": "2026-01-01T00:00:00Z",
            "lead_tz": None,
        },
    ]


def _mk_job():
    rows = _mk_rows()
    return {
        "rows": rows,
        "total": len(rows),
        "done_count": 0,
        "running": True,
        "stop": False,
        "session_id": "test-session",
    }


class _BoomImpl:
    class calls:
        @staticmethod
        def get(call_id):
            raise RuntimeError("provider unreachable")


class _PendingImpl:
    class calls:
        @staticmethod
        def get(call_id):
            return {"status": "pending", "structured_result": None}


class _FakeClient:
    using_real_sdk = True

    def __init__(self, impl):
        self._impl = impl


def test_batch_stops_on_status_fetch_error(monkeypatch):
    monkeypatch.setattr(app, "LIVE_CALLS_ENABLED", False)
    monkeypatch.setattr(app.time, "sleep", lambda s: None)
    monkeypatch.setattr(app, "place_call_e_call", lambda **kw: {"sid": "CAfake", "simulated": False})
    monkeypatch.setattr(app, "call_e_client", _FakeClient(_BoomImpl()))
    job = _mk_job()
    app.batch_jobs["b_amb_err"] = job
    app.process_batch("b_amb_err")
    assert job["rows"][0]["status"] == "error"
    assert "lookup failed" in job["rows"][0]["error"]
    assert job["status"] == "stopped"
    assert job["stopped_reason"]
    assert job["rows"][1]["status"] == "stopped"
    assert job["running"] is False


def test_batch_stops_on_polling_timeout(monkeypatch):
    monkeypatch.setattr(app, "LIVE_CALLS_ENABLED", False)
    monkeypatch.setattr(app.time, "sleep", lambda s: None)
    monkeypatch.setattr(app, "place_call_e_call", lambda **kw: {"sid": "CAfake", "simulated": False})
    monkeypatch.setattr(app, "call_e_client", _FakeClient(_PendingImpl()))
    job = _mk_job()
    app.batch_jobs["b_amb_to"] = job
    app.process_batch("b_amb_to")
    assert job["rows"][0]["status"] == "error"
    assert "timed out" in job["rows"][0]["error"]
    assert job["status"] == "stopped"
    assert job["stopped_reason"]
    assert job["rows"][1]["status"] == "stopped"
    assert job["running"] is False