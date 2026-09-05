"""The webhook trust boundary.

CALL-E does not sign webhooks, so these tests pin what stands in for a
signature: the secret path, the event-id check, and the independent re-fetch of
the call from the Calls API before anything is stored.
"""
import os

import pytest
from fastapi.testclient import TestClient

from conftest import full_result, make_call

import refcheck.webhook as wh

TOKEN = "test-token"
EVENT_ID = "evt_123"


class FakeCalle:
    def __init__(self, call=None, raises=None):
        self.calls = self
        self._call = call
        self._raises = raises
        self.fetched = []

    def get(self, call_id):
        self.fetched.append(call_id)
        if self._raises:
            raise self._raises
        return self._call


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "refcheck.db"
    monkeypatch.setattr(wh, "DB_PATH", path)
    return path


@pytest.fixture
def calle(monkeypatch):
    holder = {}

    def install(call=None, raises=None):
        client = FakeCalle(call=call, raises=raises)
        holder["client"] = client
        monkeypatch.setattr(wh, "get_client", lambda: client)
        return client

    install(make_call(structured_result=full_result()))
    return type(
        "C",
        (),
        {"install": staticmethod(install), "get": staticmethod(lambda: holder["client"])},
    )()


@pytest.fixture
def client(db_path, calle, monkeypatch):
    monkeypatch.setenv("REFCHECK_WEBHOOK_TOKEN", TOKEN)
    return TestClient(wh.app)


def event(event_id=EVENT_ID, type_="call.completed", call_id="call_abc123"):
    return {
        "id": event_id,
        "type": type_,
        "created_at": "2026-06-08T18:30:00Z",
        "data": {"id": call_id, "status": "completed"},
    }


def post(client, body, *, token=TOKEN, event_id=EVENT_ID):
    headers = {"CALL-E-Event-Id": event_id} if event_id is not None else {}
    return client.post(f"/calle/webhook/{token}", json=body, headers=headers)


def rows(db_path):
    conn = wh.connect()
    try:
        return conn.execute(
            "select reference_id, call_status, call_outcome, score, transcript,"
            " duration_seconds, provider_call_id from reference_results"
        ).fetchall()
    finally:
        conn.close()


class TestTrustBoundary:
    def test_wrong_path_token_is_not_found(self, client):
        assert post(client, event(), token="guessed").status_code == 404

    def test_missing_event_id_header_is_rejected(self, client):
        assert post(client, event(), event_id=None).status_code == 400

    def test_event_id_header_must_match_the_body(self, client):
        assert post(client, event(event_id="evt_other")).status_code == 400

    def test_malformed_json_is_rejected(self, client):
        r = client.post(
            f"/calle/webhook/{TOKEN}",
            content=b"{not json",
            headers={"CALL-E-Event-Id": EVENT_ID, "Content-Type": "application/json"},
        )
        assert r.status_code == 400

    def test_body_is_never_trusted_the_call_is_refetched(self, client, calle):
        post(client, event())
        assert calle.get().fetched == ["call_abc123"]

    def test_forged_body_cannot_inject_a_result(self, client, calle, db_path):
        forged = event()
        forged["data"]["structured_result"] = full_result(call_outcome="declined")
        post(client, forged)
        # Stored state comes from the API snapshot, not the posted body.
        assert rows(db_path)[0][2] == "completed"


class TestDelivery:
    def test_happy_path_stores_the_result(self, client, db_path):
        assert post(client, event()).status_code == 200
        (ref_id, status, outcome, score, transcript, duration, provider) = rows(db_path)[0]
        assert ref_id == "ref-1"
        assert status == "completed" and outcome == "completed"
        assert score > 9
        assert "Agent: Is this Jordan?" in transcript
        assert duration == 480
        assert provider == "provider_001"

    def test_duplicate_delivery_is_ignored(self, client, db_path):
        assert post(client, event()).status_code == 200
        second = post(client, event())
        assert second.status_code == 200 and second.json()["duplicate"] is True
        assert len(rows(db_path)) == 1

    def test_non_terminal_event_is_acked(self, client):
        r = post(client, event(type_="call.started"))
        assert r.status_code == 200 and r.json()["ignored"] == "call.started"

    def test_api_failure_returns_5xx_so_calle_retries(self, client, calle):
        calle.install(raises=RuntimeError("upstream down"))
        assert post(client, event()).status_code == 502

    def test_retry_after_a_failure_is_not_swallowed_as_duplicate(self, client, calle, db_path):
        calle.install(raises=RuntimeError("upstream down"))
        assert post(client, event()).status_code == 502
        calle.install(make_call(structured_result=full_result()))
        assert post(client, event()).status_code == 200
        assert len(rows(db_path)) == 1


class TestResultHandling:
    def test_failed_call_is_not_guessed_as_no_answer_or_declined(self, client, calle, db_path):
        calle.install(make_call(status="failed", structured_result=None))
        post(client, event(type_="call.failed"))
        assert rows(db_path)[0][1] == "failed"

    def test_null_structured_result_does_not_crash(self, client, calle, db_path):
        calle.install(make_call(structured_result=None))
        assert post(client, event()).status_code == 200
        assert rows(db_path)[0][3] is None

    def test_policy_limited_reference_still_counts_as_completed(self, client, calle, db_path):
        calle.install(
            make_call(structured_result=full_result(call_outcome="only_confirmed_employment"))
        )
        post(client, event())
        assert rows(db_path)[0][1] == "completed"
        assert rows(db_path)[0][2] == "only_confirmed_employment"

    def test_declined_reference_maps_to_declined(self, client, calle, db_path):
        calle.install(make_call(structured_result=full_result(call_outcome="declined")))
        post(client, event())
        assert rows(db_path)[0][1] == "declined"
