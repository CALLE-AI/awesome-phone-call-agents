"""The HTTP surface, and the ledger everything writes to.

The API tests use Starlette's own test client, so they exercise the routes, the
middleware, the CSRF check and the session cookie exactly as a browser would.
"""

from __future__ import annotations

import time

import pytest
from starlette.testclient import TestClient

from callibrate.api import create_app
from callibrate.audit.chain import verify_chain
from callibrate.store import Store


@pytest.fixture
def client(settings, store):
    app = create_app(settings, store)
    with TestClient(app) as test_client:
        yield test_client


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/auth/login", json={"username": "judge", "password": "callibrate-demo-2026"}
    )
    assert response.status_code == 200
    return response.json()["csrf_token"]


def wait_for(client: TestClient, task_id: str, timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        payload = client.get(f"/api/verifications/{task_id}").json()
        if payload["state"] in {"verified", "review", "failed", "refused"}:
            return payload
        time.sleep(0.1)
    raise AssertionError("verification never finished")


# ------------------------------------------------------------------- access


def test_the_console_is_closed_to_anonymous_requests(client):
    for path in ("/api/dashboard", "/api/tasks", "/api/decisions", "/api/ledger", "/api/metrics"):
        assert client.get(path).status_code == 401


def test_a_mutation_without_the_csrf_token_is_refused(client):
    sign_in(client)
    assert client.post("/api/queue/refresh", json={}).status_code == 403


def test_bad_credentials_do_not_say_which_half_was_wrong(client):
    response = client.post("/api/auth/login", json={"username": "judge", "password": "nope"})
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "invalid username or password"


def test_the_allowlist_is_reported_as_a_count_and_never_as_numbers(settings, store):
    live = settings.model_copy(
        update={"caller_mode": "calle", "call_allowlist": "+15550101101,+15550102202"}
    )
    with TestClient(create_app(live, store)) as client:
        sign_in(client)
        payload = client.get("/api/system").json()
    assert payload["allowlisted_numbers"] == 2
    assert "5550101101" not in str(payload)


# ------------------------------------------------------------------- reading


def test_the_contract_preview_returns_the_whole_call_goal(client):
    sign_in(client)
    payload = client.get("/api/tasks/task_food/contract").json()
    assert "automated assistant" in payload["goal"]
    assert payload["contract"]["current_record"]["schedule"] == "WE 09:00-12:00"
    assert payload["caller"] == "pilot-line"


def test_the_public_directory_needs_no_account(client):
    response = client.post("/api/directory/search", json={"need": "food", "postal_code": "02038"})
    assert response.status_code == 200
    assert response.json()["results"]


def test_hsds_is_served_without_an_account(client):
    assert client.get("/hsds").status_code == 200
    assert client.get("/hsds/services").json()["total_items"] == 4


# --------------------------------------------------------------- verifying


def test_a_curator_can_run_a_verification_and_watch_the_record_change(client):
    csrf = sign_in(client)
    started = client.post(
        "/api/tasks/task_food/verify",
        json={"scenario": "hours_changed"},
        headers={"X-CSRF-Token": csrf},
    )
    assert started.status_code == 202
    finished = wait_for(client, "task_food")
    assert finished["state"] == "verified"
    assert finished["result"]["authority"] == "APPLY"
    services = client.get("/api/services").json()["services"]
    pantry = next(item for item in services if item["id"] == "svc_food")
    assert (pantry["opens_at"], pantry["closes_at"]) == ("10:00", "13:00")


def test_verify_before_i_go_is_public_and_produces_the_same_transaction(client):
    response = client.post(
        "/api/verify-now", json={"service_id": "svc_food", "fields": ["schedule"]}
    )
    assert response.status_code == 202
    job = response.json()
    finished = wait_for(client, job["task_id"])
    assert finished["state"] in {"verified", "review"}
    assert finished["result"]["call_id"]


def test_a_reported_failure_becomes_a_priority_call_in_the_same_request(client):
    response = client.post(
        "/api/directory/reports",
        json={"service_id": "svc_food", "reason": "closed", "details": "Door was locked"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["verification_task_id"]
    assert "status" in body["fields"]

    csrf = sign_in(client)
    del csrf
    tasks = client.get("/api/tasks").json()["tasks"]
    promoted = next(task for task in tasks if task["id"] == body["verification_task_id"])
    assert promoted["priority"] >= 1000
    assert promoted["trigger"] == "failed_referral"


def test_an_unknown_pilot_scenario_is_refused(client):
    csrf = sign_in(client)
    response = client.post(
        "/api/tasks/task_food/verify",
        json={"scenario": "make_it_up"},
        headers={"X-CSRF-Token": csrf},
    )
    assert response.status_code == 422


# ---------------------------------------------------------------- the ledger


def test_the_ledger_verifies_and_reports_where_it_would_break(client, store: Store):
    sign_in(client)
    payload = client.get("/api/ledger").json()
    assert payload["chain_valid"]
    assert payload["first_break"] is None
    assert payload["events"]


def test_the_ledger_refuses_to_be_edited(store: Store):
    import sqlite3

    with store.connect() as connection:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE audit_events SET actor='someone else'")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("DELETE FROM audit_events")


def test_a_tampered_row_breaks_the_chain_visibly(store: Store):
    """The trigger blocks the easy edit; this proves the hash catches the hard one."""
    with store.connect() as connection:
        rows = connection.execute("SELECT * FROM audit_events ORDER BY sequence").fetchall()
    assert verify_chain(rows)

    tampered = [dict(row) for row in rows]
    tampered[0]["payload_json"] = '{"services":400}'
    assert not verify_chain(tampered)


def test_metrics_count_rows_rather_than_asserting_anything(client):
    sign_in(client)
    metrics = client.get("/api/metrics").json()
    assert metrics["false_automatic_mutations"] == 0
    assert metrics["unsupported_claims"] == 0
    assert set(metrics) >= {"runs", "claims", "auto_applied", "calls_placed", "calls_refused"}


def test_a_corrected_automatic_change_is_counted_against_the_product(store: Store):
    """The number that would have to be non-zero for the premise to be false."""
    store.correct_applied_change("chg_family_done", "+15550102299", "usr_judge", "wrong digits")
    assert store.call_metrics()["false_automatic_mutations"] == 1
    assert store.verify_audit_chain()
