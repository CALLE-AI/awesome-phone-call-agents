import copy
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from leadpulse import webhook
from leadpulse.client import CalleAPIError

TOKEN = "t0ken-for-tests"


class StubClient:
    def __init__(self, snapshots):
        self.snapshots = snapshots
        self.fetched: list[str] = []

    def get_call(self, call_id):
        self.fetched.append(call_id)
        snap = self.snapshots.pop(0) if len(self.snapshots) > 1 else self.snapshots[0]
        if isinstance(snap, Exception):
            raise snap
        return snap


@pytest.fixture
def db(tmp_path, monkeypatch):
    path = tmp_path / "leadpulse.db"
    monkeypatch.setenv("LEADPULSE_DB", str(path))
    monkeypatch.setenv("LEADPULSE_WEBHOOK_TOKEN", TOKEN)
    return path


def _client(stub):
    webhook.app.state.client_factory = lambda: stub
    return TestClient(webhook.app)


def _event(event_id="evt_1", event_type="call.completed", call_id="call_fictional0001", **data):
    return {"id": event_id, "type": event_type, "data": {"id": call_id, **data}}


def _post(tc, event, token=TOKEN, header_id=None):
    return tc.post(
        f"/calle/webhook/{token}",
        content=json.dumps(event),
        headers={"CALL-E-Event-Id": event["id"] if header_id is None else header_id},
    )


def _decisions(path):
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT call_id, outcome, score, hot_lead, send_booking_link FROM lead_decisions").fetchall()


def test_wrong_token_is_404(db, completed_call):
    stub = StubClient([completed_call])
    assert _post(_client(stub), _event(), token="guess").status_code == 404
    assert stub.fetched == []


def test_unset_token_disables_the_endpoint(db, monkeypatch, completed_call):
    monkeypatch.delenv("LEADPULSE_WEBHOOK_TOKEN")
    assert _post(_client(StubClient([completed_call])), _event(), token="").status_code in (404, 405)


def test_event_id_header_must_match_body(db, completed_call):
    stub = StubClient([completed_call])
    assert _post(_client(stub), _event(), header_id="evt_other").status_code == 400
    assert stub.fetched == []


def test_forged_body_is_ignored_in_favor_of_the_refetch(db, completed_call):
    stub = StubClient([completed_call])
    forged = _event(status="completed", structured_result={"reached_lead": "yes", "interest_level": "low"})
    resp = _post(_client(stub), forged)
    assert resp.status_code == 200
    assert resp.json()["score"] == 89
    assert stub.fetched == ["call_fictional0001"]
    assert _decisions(db) == [("call_fictional0001", "qualified", 89, 1, 1)]


def test_duplicate_delivery_is_processed_once(db, completed_call):
    stub = StubClient([completed_call])
    tc = _client(stub)
    assert _post(tc, _event()).json()["outcome"] == "qualified"
    assert _post(tc, _event()).json() == {"ok": True, "duplicate": True}
    assert stub.fetched == ["call_fictional0001"]


def test_verification_failure_releases_the_claim_so_the_retry_works(db, completed_call):
    stub = StubClient([CalleAPIError(503, "unavailable", ""), completed_call])
    tc = _client(stub)
    assert _post(tc, _event()).status_code == 502
    assert _decisions(db) == []
    retry = _post(tc, _event())
    assert retry.status_code == 200 and retry.json()["outcome"] == "qualified"


def test_non_terminal_refetch_is_retried_later(db, completed_call):
    early = copy.deepcopy(completed_call)
    early["status"] = "in_progress"
    stub = StubClient([early, completed_call])
    tc = _client(stub)
    assert _post(tc, _event()).status_code == 409
    assert _post(tc, _event()).status_code == 200


def test_non_terminal_event_types_are_acknowledged_without_fetching(db, completed_call):
    stub = StubClient([completed_call])
    resp = _post(_client(stub), _event(event_type="call.started"))
    assert resp.json() == {"ok": True, "ignored": "call.started"}
    assert stub.fetched == []


def test_malformed_bodies_are_rejected(db, completed_call):
    tc = _client(StubClient([completed_call]))
    bad = tc.post(f"/calle/webhook/{TOKEN}", content="not json", headers={"CALL-E-Event-Id": "x"})
    assert bad.status_code == 400
    assert _post(tc, _event(call_id="nope")).status_code == 400
