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
        "schema_version": "2.0",
        "request_id": request_id or str(uuid4()),
        "call_id": "call-123",
        "agentkit_run_id": "run-123",
        "submitted_at": "2026-08-01T22:30:00Z",
        "call_contract": {
            "objective": "Move delivery to Friday",
            "protocol_language": "en",
            "success_conditions": ["delivery_date_confirmed"],
            "allowed_commitments": {"maximum_surcharge_cents": 25000},
            "forbidden_commitments": [],
            "required_disclosures": ["recording_notice"],
            "escalation_conditions": [],
            "verification_claims": [
                {
                    "kind": "success",
                    "id": "delivery_date_confirmed",
                    "result_field": "delivery_date",
                    "operator": "equals",
                    "expected": "2026-08-07",
                },
                {
                    "kind": "commitment_limit",
                    "id": "surcharge_within_limit",
                    "result_field": "surcharge_cents",
                    "operator": "less_than_or_equal",
                    "maximum": 25000,
                },
                {
                    "kind": "required_disclosure",
                    "id": "recording_notice",
                },
            ],
        },
        "transcript": {
            "language": "en",
            "turns": [
                {"id": 1, "speaker": "agent", "text": "This call is being recorded."},
                {"id": 2, "speaker": "agent", "text": "Please confirm exactly: the delivery date is 2026-08-07. Answer YES or NO."},
                {"id": 3, "speaker": "recipient", "text": "Yes."},
                {"id": 4, "speaker": "agent", "text": f"Please confirm exactly: the surcharge is ${surcharge_cents / 100:.2f}. Answer YES or NO."},
                {"id": 5, "speaker": "recipient", "text": "Yes."},
            ],
        },
        "provider_result": {"surcharge_cents": surcharge_cents, "delivery_date": "2026-08-07"},
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
    assert result["verdict"]["policy_evaluation"] == "violated"
    assert any(item["turn_ids"] == [4, 5] for item in result["verdict"]["evidence"])
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
