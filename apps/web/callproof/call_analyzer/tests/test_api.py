from __future__ import annotations

import hashlib
import hmac
import json
from pathlib import Path
from uuid import uuid4

import httpx
import jsonschema
from fastapi.testclient import TestClient

from call_analyzer.main import create_app
from call_analyzer.settings import Settings


CONTRACTS = next(
    parent / "contracts"
    for parent in Path(__file__).parents
    if (parent / "contracts").is_dir()
)


def validate_contract(name: str, document: dict) -> None:
    schema = json.loads((CONTRACTS / name).read_text())
    jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()).validate(document)


def request_payload(*, request_id: str | None = None, surcharge_cents: int = 32000) -> dict:
    return {
        "schema_version": "1.0",
        "request_id": request_id or str(uuid4()),
        "call_id": "call-123",
        "agentkit_run_id": "run-123",
        "submitted_at": "2026-08-01T22:30:00Z",
        "call_contract": {
            "objective": "Move delivery to Friday",
            "success_conditions": ["delivery_changed"],
            "allowed_commitments": {"maximum_surcharge_cents": 25000},
            "forbidden_commitments": [],
            "required_disclosures": [],
            "escalation_conditions": ["surcharge_above_limit"],
        },
        "transcript": {
            "language": "en",
            "turns": [
                {"id": 1, "speaker": "agent", "text": "Can we move the delivery?"},
                {"id": 2, "speaker": "recipient", "text": "Yes, with a $320.00 surcharge."},
                {"id": 3, "speaker": "agent", "text": "I accept the $320.00 surcharge."},
            ],
        },
        "provider_result": {"surcharge_cents": surcharge_cents},
        "callback": {"url": "https://rails.test/webhooks/call_analyzer"},
        "metadata": {},
    }


def test_processes_request_and_signs_completed_webhook(tmp_path):
    app = create_app(Settings(str(tmp_path / "test.db"), "test-secret", True))
    deliveries = []

    def capture(url, payload, secret):
        deliveries.append((url, payload, secret))
        return httpx.Response(200)

    app.state.processor.webhook_delivery = capture
    client = TestClient(app)
    payload = request_payload()
    validate_contract("call-analysis-request.schema.json", payload)
    response = client.post("/api/v1/analyses", json=payload)

    assert response.status_code == 202
    status_response = client.get(response.json()["status_url"])
    result = status_response.json()["result"]
    validate_contract("call-analysis-result.schema.json", result)
    assert status_response.json()["status"] == "completed"
    assert result["verdict"]["needs_human_review"] is True
    assert result["verdict"]["evidence"][0]["turn_ids"] == [2, 3]
    assert deliveries[0][0] == "https://rails.test/webhooks/call_analyzer"
    assert deliveries[0][2] == "test-secret"


def test_request_id_is_idempotent(tmp_path):
    app = create_app(Settings(str(tmp_path / "test.db"), "test-secret", False))
    client = TestClient(app)
    payload = request_payload()

    first = client.post("/api/v1/analyses", json=payload)
    second = client.post("/api/v1/analyses", json=payload)

    assert first.json()["analysis_id"] == second.json()["analysis_id"]
    assert second.json()["status"] == "completed"


def test_signed_headers_cover_timestamp_and_raw_body():
    from call_analyzer.webhooks import signed_headers

    body = json.dumps({"status": "completed"}, separators=(",", ":")).encode()
    headers = signed_headers(body, "secret", timestamp=12345)
    expected = hmac.new(b"secret", b"12345." + body, hashlib.sha256).hexdigest()

    assert headers["X-CallProof-Signature"] == f"v1={expected}"
    assert headers["X-CallProof-Timestamp"] == "12345"
