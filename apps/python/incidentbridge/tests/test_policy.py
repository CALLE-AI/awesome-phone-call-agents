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


def bound_provider_result(structured=None):
    result = structured or acknowledged_result()
    return {
        "id": "call_001",
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.95, "label": "high"},
        "structured_result": result,
        "evidence": ["The recipient supplied a vendor ticket."],
        "metadata": {
            "workflow_id": RAW["workflow_id"],
            "workflow_type": "vendor_incident_support",
            "incident_id": RAW["incident_id"],
        },
        "recipients": [
            {
                "phone": RAW["support_phone"],
                "attempts": [
                    {
                        "transcript_turns": [
                            {
                                "speaker": "recipient",
                                "text": f"Ticket {result.get('ticket_id', 'unknown')}.",
                            }
                        ]
                    }
                ],
            }
        ],
    }


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


def test_rejects_secret_or_contact_data_in_every_spoken_free_text_field():
    cases = [
        ("incident_summary", "The API key=abc is failing on every request."),
        ("caller_business_name", "Bearer abc123 operations"),
        ("provider_name", "Support at ops@example.com"),
        ("affected_service", "ingestion password credential"),
    ]
    for field, value in cases:
        try:
            parse_request({**RAW, field: value})
        except ValueError as exc:
            assert field in str(exc)
            assert "credentials, secrets, or personal contact data" in str(exc)
        else:
            raise AssertionError(f"expected secret-like {field} to fail")


def test_task_has_disclosure_and_authority_boundary():
    task = build_task(parse_request(RAW))
    assert "AI calling assistant" in task
    assert "consent to continue" in task
    assert "Do not" in task
    assert "close the incident" in task


def test_acknowledged_result_never_closes_incident():
    decision = route_result(
        parse_request(RAW), bound_provider_result(), expected_call_id="call_001"
    )
    assert decision["route"] == "vendor_acknowledged"
    assert decision["incident_closed"] == "false"


def test_fail_closed_routes():
    complete = acknowledged_result()
    cases = [
        bound_provider_result({**complete, "right_support_desk": "no"}),
        bound_provider_result({**complete, "human_escalation_required": "yes"}),
        bound_provider_result({**complete, "ticket_id": "unknown"}),
        bound_provider_result(
            {key: value for key, value in complete.items() if key != "ticket_id"}
        ),
        {**bound_provider_result(), "completion_confidence": {"score": 0.4}},
        {**bound_provider_result(), "status": "timeout"},
        {**bound_provider_result(), "task_completed": False},
    ]
    request = parse_request(RAW)
    for provider_result in cases:
        assert (
            route_result(request, provider_result, expected_call_id="call_001")["route"]
            == "needs_human"
        )


def test_acknowledged_route_requires_request_binding_and_recipient_corroboration():
    request = parse_request(RAW)
    cases = []
    mismatched_metadata = bound_provider_result()
    mismatched_metadata["metadata"] = {
        **mismatched_metadata["metadata"],
        "incident_id": "INC-other",
    }
    cases.append(mismatched_metadata)
    mismatched_destination = bound_provider_result()
    mismatched_destination["recipients"][0]["phone"] = "+15555550101"
    cases.append(mismatched_destination)
    missing_recipient_evidence = bound_provider_result()
    missing_recipient_evidence["recipients"][0]["attempts"][0]["transcript_turns"] = []
    cases.append(missing_recipient_evidence)
    wrong_ticket = bound_provider_result()
    wrong_ticket["recipients"][0]["attempts"][0]["transcript_turns"][0]["text"] = "Ticket SUP-9999."
    cases.append(wrong_ticket)
    mismatched_call = bound_provider_result()
    mismatched_call["id"] = "call_other"
    cases.append(mismatched_call)
    for provider_result in cases:
        assert (
            route_result(request, provider_result, expected_call_id="call_001")["route"]
            == "needs_human"
        )


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
