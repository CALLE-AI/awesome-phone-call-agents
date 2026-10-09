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


def test_prior_auth_response_sanitization(client):
    res = client.post(
        "/calls/prior-auth",
        json={"cpt_code": "99213", "payor_phone": "1-800-676-2583"},
        headers={"X-API-Key": "bytelytic_demo_key_2026"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["payor"] == "Blue Cross Blue Shield"
    assert data["recipient"] == "+1800***2583"
    assert "call_result" in data
    assert "status" in data["call_result"]
    assert "structured_result" in data["call_result"]


def test_sanitize_call_result_helper():
    from bytelytic_clinic.server import sanitize_call_result
    raw = {
        "status": "completed",
        "task_completed": True,
        "raw_carrier_data": "secret_debug_headers",
        "internal_call_id": "call-xyz-999",
        "recipient": "+15550192834",
        "evidence": ["Dialed +15550192834 successfully and confirmed approval."],
        "structured_result": {
            "auth_status": "approved",
            "notes": "Patient requested callback at +15550192835 tomorrow",
            "nested_contact": {"alt_phone": "555-019-2834"},
        },
    }
    cleaned = sanitize_call_result(raw)
    assert "raw_carrier_data" not in cleaned
    assert "internal_call_id" not in cleaned
    assert cleaned["recipient_masked"] == "+1555***2834"
    assert cleaned["evidence"][0] == "Dialed +1555***2834 successfully and confirmed approval."
    assert cleaned["structured_result"]["auth_status"] == "approved"
    assert "+1555***2835" in cleaned["structured_result"]["notes"]
    assert "***2834" in cleaned["structured_result"]["nested_contact"]["alt_phone"]


def test_sanitize_non_dictionary_provider_result():
    from bytelytic_clinic.server import sanitize_call_result

    class MockProviderResult:
        def __init__(self):
            self.status = "completed"
            self.raw_leak = "Secret call destination +15550192834"

        def __str__(self):
            return f"RawProviderObj(phone=+15550192834, leak={self.raw_leak})"

    non_dict = MockProviderResult()
    cleaned = sanitize_call_result(non_dict)
    assert cleaned == {"status": "completed"}
    assert "phone" not in str(cleaned)
    assert "+15550192834" not in str(cleaned)
