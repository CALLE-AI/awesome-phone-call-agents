import pytest
from fastapi.testclient import TestClient
from bytelytic_clinic.server import app


@pytest.fixture
def client():
    return TestClient(app)


def test_health_check_endpoint(client):
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"
    assert res.json()["service"] == "bytelytic-clinic-os"


def test_confirmation_call_requires_auth(client):
    res = client.post("/calls/confirmation", json={"phone_number": "+15550192834"})
    assert res.status_code == 401


def test_confirmation_call_with_api_key(client):
    res = client.post(
        "/calls/confirmation",
        json={"phone_number": "+15550192834"},
        headers={"X-API-Key": "bytelytic_demo_key_2026"},
    )
    assert res.status_code == 200
    assert res.json()["success"] is True
    assert res.json()["recipient"] == "+1555***2834"


def test_confirmation_call_with_bearer_token(client):
    res = client.post(
        "/calls/confirmation",
        json={"phone_number": "+15550192834"},
        headers={"Authorization": "Bearer bytelytic_demo_key_2026"},
    )
    assert res.status_code == 200
    assert res.json()["success"] is True


def test_noshow_call_endpoint(client):
    res = client.post(
        "/calls/no-show",
        json={"phone_number": "+15550192834"},
        headers={"X-API-Key": "bytelytic_demo_key_2026"},
    )
    assert res.status_code == 200
    assert res.json()["call_result"]["structured_result"]["wants_rebook"] == "yes"


def test_prior_auth_call_endpoint(client):
    res = client.post(
        "/calls/prior-auth",
        json={"cpt_code": "99213"},
        headers={"X-API-Key": "bytelytic_demo_key_2026"},
    )
    assert res.status_code == 200
    assert res.json()["call_result"]["structured_result"]["auth_status"] == "approved"


def test_webhook_requires_auth(client):
    res = client.post("/calle/webhook", json={"event": "call.completed"})
    assert res.status_code == 401


def test_webhook_staged_for_operator_review(client):
    res = client.post(
        "/calle/webhook",
        json={
            "structured_result": {"will_attend": "yes"},
            "operator_reviewed": False,
            "appointment_id": "apt-101",
        },
        headers={"X-API-Key": "bytelytic_demo_key_2026"},
    )
    assert res.status_code == 200
    assert res.json()["operator_review_required"] is True
    assert res.json()["ehr_mutation_gated"] is True


def test_webhook_applies_operator_reviewed_mutation(client):
    res = client.post(
        "/calle/webhook",
        json={
            "structured_result": {"will_attend": "yes"},
            "operator_reviewed": True,
            "appointment_id": "apt-101",
        },
        headers={"X-API-Key": "bytelytic_demo_key_2026"},
    )
    assert res.status_code == 200
    assert res.json()["operator_review_required"] is False
    assert res.json()["appointment_status"] == "confirmed"


def test_server_rejects_malformed_phone_input(client):
    res = client.post(
        "/calls/confirmation",
        json={"phone_number": "123_invalid"},
        headers={"X-API-Key": "bytelytic_demo_key_2026"},
    )
    assert res.status_code == 400
