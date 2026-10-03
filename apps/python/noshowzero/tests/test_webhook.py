import copy
import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from noshowzero import webhook
from noshowzero.client import CalleAPIError

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
    path = tmp_path / "noshowzero.db"
    monkeypatch.setenv("NOSHOWZERO_DB", str(path))
    monkeypatch.setenv("NOSHOWZERO_WEBHOOK_TOKEN", TOKEN)
    return path


def _client(stub):
    webhook.app.state.client_factory = lambda: stub
    return TestClient(webhook.app)


def _event(event_id="evt_1", event_type="call.completed", call_id="call_fictional0reminder0001", **data):
    return {"id": event_id, "type": event_type, "data": {"id": call_id, **data}}


def _post(tc, event, token=TOKEN, header_id=None):
    return tc.post(f"/calle/webhook/{token}", content=json.dumps(event),
                   headers={"CALL-E-Event-Id": event["id"] if header_id is None else header_id})


def _decisions(path):
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT call_id, kind, subject_id, outcome, next_action FROM call_decisions").fetchall()


def test_wrong_token_is_404_and_nothing_is_fetched(db, reminder_call):
    stub = StubClient([reminder_call])
    assert _post(_client(stub), _event(), token="guess").status_code == 404
    assert stub.fetched == []


def test_unset_token_disables_the_endpoint(db, monkeypatch, reminder_call):
    monkeypatch.delenv("NOSHOWZERO_WEBHOOK_TOKEN")
    assert _post(_client(StubClient([reminder_call])), _event(), token="anything").status_code == 404


def test_event_id_header_must_match_body(db, reminder_call):
    stub = StubClient([reminder_call])
    assert _post(_client(stub), _event(), header_id="evt_other").status_code == 400
    assert stub.fetched == []


def test_non_terminal_events_are_acknowledged_and_ignored(db, reminder_call):
    r = _post(_client(StubClient([reminder_call])), _event(event_type="call.in_progress"))
    assert r.status_code == 200 and r.json()["ignored"] == "call.in_progress"


def test_reminder_result_is_decided_on_the_refetched_snapshot(db, reminder_call):
    stub = StubClient([reminder_call])
    # The body claims the patient confirmed; the re-fetched snapshot says they want to reschedule.
    forged = _event(status="completed", structured_result={"reached_patient": "yes", "outcome": "confirmed"})
    r = _post(_client(stub), forged)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "kind": "reminder", "outcome": "wants_reschedule",
                        "next_action": "offer_slot_to_waitlist"}
    assert stub.fetched == ["call_fictional0reminder0001"]
    assert _decisions(db) == [("call_fictional0reminder0001", "reminder", "appt-1042", "wants_reschedule",
                               "offer_slot_to_waitlist")]


def test_offer_result_asks_for_booking(db, offer_call):
    r = _post(_client(StubClient([offer_call])), _event(call_id="call_fictional0offer0000002"))
    assert r.json()["next_action"] == "book_slot_for_waitlist_patient"


def test_duplicate_delivery_is_not_reprocessed(db, reminder_call):
    stub = StubClient([reminder_call])
    tc = _client(stub)
    assert _post(tc, _event()).status_code == 200
    r = _post(tc, _event())
    assert r.status_code == 200 and r.json() == {"ok": True, "duplicate": True}
    assert len(stub.fetched) == 1


def test_failed_refetch_releases_the_claim_so_the_retry_works(db, reminder_call):
    stub = StubClient([CalleAPIError(503, "unavailable", ""), reminder_call])
    tc = _client(stub)
    assert _post(tc, _event()).status_code == 502
    assert _post(tc, _event()).status_code == 200
    assert len(_decisions(db)) == 1


def test_early_delivery_is_retried_later(db, reminder_call):
    stub = StubClient([reminder_call | {"status": "in_progress"}, reminder_call])
    tc = _client(stub)
    assert _post(tc, _event()).status_code == 409
    assert _post(tc, _event()).status_code == 200


def test_foreign_calls_are_acknowledged_without_a_decision(db, reminder_call):
    other = copy.deepcopy(reminder_call) | {"metadata": {"app": "someone-else"}}
    r = _post(_client(StubClient([other])), _event())
    assert r.status_code == 200 and "ignored" in r.json()
    assert _decisions(db) == []


def test_no_transcript_or_phone_number_is_stored(db, reminder_call):
    _post(_client(StubClient([reminder_call])), _event())
    with sqlite3.connect(db) as conn:
        stored = json.dumps(conn.execute("SELECT * FROM call_decisions").fetchall())
    assert "5550116" not in stored and "Yeah, speaking" not in stored
