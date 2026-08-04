from __future__ import annotations

import json

import pytest

import client


@pytest.fixture(params=list(client.SCENARIOS))
def case_data(request):
    return {
        "scenario": request.param,
        "phone_number": "+14155550100",
        "authorized_recipient": True,
        "region": "US",
        "locale": "en-US",
        "context": {"company_name": "Example Company"},
    }


def test_preview_and_simulation_are_no_call_paths(case_data):
    preview = client.build_preview(case_data)
    simulated = client.run_simulation(case_data)
    assert preview["phone_number_masked"] == "+14***0100"
    assert "No phone call was placed" in preview["side_effect"]
    assert simulated["success"] is True
    assert simulated["result"]
    assert simulated["follow_up_action"]["type"] != "manual_review"


def test_request_requires_e164_and_authorization():
    with pytest.raises(ValueError, match="E.164"):
        client.validate_request({
            "scenario": "appointment_booking",
            "phone_number": "415-555-0100",
            "authorized_recipient": True,
        })
    with pytest.raises(ValueError, match="authorized_recipient"):
        client.validate_request({
            "scenario": "appointment_booking",
            "phone_number": "+14155550100",
        })


def test_result_schemas_stay_within_calle_supported_subset():
    supported_keywords = {"type", "properties", "required", "enum", "items", "description", "additionalProperties"}
    supported_types = {"object", "array", "string", "integer", "number", "boolean"}

    def validate(schema):
        assert set(schema) <= supported_keywords
        assert isinstance(schema.get("type"), str)
        assert schema["type"] in supported_types
        assert schema.get("additionalProperties") is not True
        for child in (schema.get("properties") or {}).values():
            validate(child)
        if isinstance(schema.get("items"), dict):
            validate(schema["items"])

    for scenario in client.SCENARIOS.values():
        validate(scenario["result_schema"])


def test_appointment_task_accepts_ui_customer_name():
    request = {
        "scenario": "appointment_booking",
        "phone_number": "+14155550100",
        "authorized_recipient": True,
        "context": {"customer_name": "Taylor", "business_name": "Example Dental"},
    }
    assert "on behalf of Taylor" in client.build_task(request)


def test_live_path_calls_published_sdk_surface(monkeypatch, case_data):
    captured = {}

    class Calls:
        def create_and_wait(self, **kwargs):
            captured.update(kwargs)
            return {
                "id": "call_test_123",
                "status": "completed",
                "recipients": [{"structured_result": client.simulated_result(case_data["scenario"])}],
            }

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client"] = kwargs
            self.calls = Calls()

        def close(self):
            captured["closed"] = True

    monkeypatch.setenv("CALLE_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("CALLE_API_KEY", "test-secret-not-real")
    result = client.run_live(
        case_data,
        confirmed_authorized_recipient=True,
        client_factory=FakeClient,
    )
    assert result["success"] is True
    assert result["provider"] == "call-e"
    assert captured["recipient"]["phone"] == "+14155550100"
    assert captured["recipient_result_schema"] == client.SCENARIOS[case_data["scenario"]]["result_schema"]
    assert captured["idempotency_key"].startswith("genesis:")
    assert captured["closed"] is True


def test_cli_default_is_preview(tmp_path, capsys):
    path = tmp_path / "request.json"
    path.write_text(json.dumps({
        "scenario": "appointment_booking",
        "phone_number": "+14155550100",
        "authorized_recipient": True,
        "context": {},
    }), encoding="utf-8")
    assert client.main(["--request", str(path)]) == 0
    output = json.loads(capsys.readouterr().out)
    assert output["mode"] == "preview"
