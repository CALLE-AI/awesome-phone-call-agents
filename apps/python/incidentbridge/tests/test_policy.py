from incidentbridge.models import mask_phone, parse_request
from incidentbridge.policy import (
    build_task,
    idempotency_key,
    preview,
    redact,
    route_result,
    simulated_result,
    valid_result,
)

RAW = {
    "workflow_id": "wf-incident-001",
    "incident_id": "INC-2026-0810",
    "support_phone": "+15555550100",
    "authorized_support_contact": True,
    "caller_business_name": "Acme Data Operations",
    "provider_name": "ExampleCloud",
    "affected_service": "managed ingestion endpoint",
    "incident_summary": "Requests return elevated 503 responses across the ingestion endpoint.",
    "severity": "outage",
    "observed_at_utc": "2026-08-10T01:20:00Z",
    "region": "US",
    "locale": "en-US",
}


def acknowledged_result():
    return simulated_result(parse_request(RAW), "acknowledged")["structured_result"]


def test_parse_and_preview_mask_phone():
    request = parse_request(RAW)
    result = preview(request)
    assert result["creates_phone_call"] is False
    assert result["input"]["support_phone"] == mask_phone(RAW["support_phone"])
    assert RAW["support_phone"] not in str(result)
    assert result["idempotency_key"].startswith("incidentbridge-")


def test_rejects_invalid_or_unauthorized_inputs():
    for field, value in [
        ("support_phone", "5550100"),
        ("authorized_support_contact", False),
        ("severity", "critical"),
        ("region", "usa"),
        ("observed_at_utc", "2026-08-10T01:20:00+08:00"),
    ]:
        raw = {**RAW, field: value}
        try:
            parse_request(raw)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected {field} to fail")


def test_rejects_secret_like_summary():
    raw = {**RAW, "incident_summary": "The API key=abc is failing on every request."}
    try:
        parse_request(raw)
    except ValueError as exc:
        assert "credentials or secrets" in str(exc)
    else:
        raise AssertionError("expected secret-like summary to fail")


def test_task_has_disclosure_and_authority_boundary():
    task = build_task(parse_request(RAW))
    assert "AI calling assistant" in task
    assert "consent to continue" in task
    assert "Do not" in task
    assert "close the incident" in task


def test_acknowledged_result_never_closes_incident():
    decision = route_result(acknowledged_result())
    assert decision["route"] == "vendor_acknowledged"
    assert decision["incident_closed"] == "false"


def test_fail_closed_routes():
    complete = acknowledged_result()
    cases = [
        ({**complete, "right_support_desk": "no"}, {}),
        ({**complete, "human_escalation_required": "yes"}, {}),
        ({**complete, "ticket_id": "unknown"}, {}),
        ({key: value for key, value in complete.items() if key != "ticket_id"}, {}),
        (complete, {"completion_confidence": {"score": 0.4}}),
        (complete, {"provider_status": "timeout"}),
        (complete, {"task_completed": False}),
    ]
    for structured, kwargs in cases:
        assert route_result(structured, **kwargs)["route"] == "needs_human"


def test_schema_validation_and_simulation():
    request = parse_request(RAW)
    assert valid_result(acknowledged_result()) is True
    invalid = {**acknowledged_result(), "eta_minutes": True}
    assert valid_result(invalid) is False
    assert simulated_result(request, "wrong-desk")["decision"]["route"] == "needs_human"
    assert simulated_result(request, "eta-unknown")["decision"]["route"] == "vendor_acknowledged"


def test_idempotency_and_recursive_redaction():
    request = parse_request(RAW)
    assert idempotency_key(request) == idempotency_key(request)
    payload = {"nested": ["Call +15555550100 or a@b.com", {"x": "Bearer abc123"}]}
    rendered = str(redact(payload))
    assert "5555550100" not in rendered
    assert "a@b.com" not in rendered
    assert "abc123" not in rendered
