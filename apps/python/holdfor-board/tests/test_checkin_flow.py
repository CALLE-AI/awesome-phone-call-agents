from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from holdfor.app import create_app
from holdfor.models import CallKind, ReviewStatus
from holdfor.providers import FakeProvider

CONSENTING = 1
WITHHOLDING = 6


@pytest.fixture
def client(db_path, fixtures_dir):
    provider = FakeProvider(
        fixtures_dir=fixtures_dir, route={"checkin:1": "02-wants-seen.json"}
    )
    return TestClient(create_app(db_path=db_path, provider=provider))


def test_the_default_provider_places_no_real_call():
    app = create_app(db_path=":memory:")
    assert isinstance(app.state.provider, FakeProvider)


def test_a_checkin_creates_an_attempt_then_a_review_item(client, conn):
    response = client.post(f"/checkins/{CONSENTING}")
    assert response.status_code == 201
    review_item_id = response.json()["review_item_id"]

    attempt = conn.execute(
        "SELECT * FROM call_attempt WHERE appointment_id = ?", (CONSENTING,)
    ).fetchone()
    assert attempt["kind"] == CallKind.CHECKIN
    assert attempt["idempotency_key"] == f"checkin:{CONSENTING}"
    assert attempt["provider_run_id"]

    item = conn.execute(
        "SELECT * FROM review_item WHERE id = ?", (review_item_id,)
    ).fetchone()
    assert item["call_attempt_id"] == attempt["id"]
    assert item["status"] == ReviewStatus.NEEDS_REVIEW


def test_the_review_item_carries_the_patients_own_words(client, conn):
    review_item_id = client.post(f"/checkins/{CONSENTING}").json()["review_item_id"]
    item = conn.execute(
        "SELECT * FROM review_item WHERE id = ?", (review_item_id,)
    ).fetchone()
    assert item["carried_words_text"] == (
        "I can't get up the stairs the way I could a fortnight ago, "
        "and I'm having to stop halfway."
    )
    assert item["carried_words_turn"] == 7
    assert item["feeling"] == "worse"
    assert item["wants_seen"] == "yes"


def test_calling_twice_does_not_ring_the_patient_twice(client, conn):
    first = client.post(f"/checkins/{CONSENTING}").json()["review_item_id"]
    second = client.post(f"/checkins/{CONSENTING}")
    assert second.status_code == 201
    assert second.json()["review_item_id"] == first
    attempts = conn.execute(
        "SELECT COUNT(*) AS n FROM call_attempt WHERE appointment_id = ?", (CONSENTING,)
    ).fetchone()["n"]
    assert attempts == 1


def test_a_patient_who_withheld_consent_is_never_called(client, conn):
    response = client.post(f"/checkins/{WITHHOLDING}")
    assert response.status_code == 409
    assert response.json() == {"refused": "no_consent"}
    attempts = conn.execute(
        "SELECT COUNT(*) AS n FROM call_attempt WHERE appointment_id = ?", (WITHHOLDING,)
    ).fetchone()["n"]
    assert attempts == 0


def test_an_unknown_appointment_is_a_404(client):
    assert client.post("/checkins/9999").status_code == 404


def test_the_board_lists_review_items_newest_first(client):
    for appointment_id in (1, 2, 3):
        client.post(f"/checkins/{appointment_id}")
    payload = client.get("/board").json()
    assert payload["today"] == 3
    assert payload["needs_review"] == 3
    assert payload["auto_closed"] == 0
    ids = [item["id"] for item in payload["items"]]
    assert ids == sorted(ids, reverse=True)


def test_the_queue_page_renders_the_patients_words(client):
    client.post(f"/checkins/{CONSENTING}")
    page = client.get("/")
    assert page.status_code == 200
    assert "Margaret" in page.text
    assert "get up the stairs" in page.text


def test_a_patient_who_hung_up_is_filed_as_declined_not_unreached(db_path, fixtures_dir):
    from fastapi.testclient import TestClient

    from holdfor import db
    from holdfor.app import create_app

    provider = FakeProvider(
        fixtures_dir=fixtures_dir, route={"checkin:1": "05-declined.json"}
    )
    client = TestClient(create_app(db_path=db_path, provider=provider))
    review_item_id = client.post("/checkins/1").json()["review_item_id"]

    connection = db.connect(db_path)
    item = connection.execute(
        "SELECT * FROM review_item WHERE id = ?", (review_item_id,)
    ).fetchone()
    connection.close()
    assert item["status"] == ReviewStatus.DECLINED
    assert item["status"] != ReviewStatus.NOT_REACHED
