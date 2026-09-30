"""The live transport's wire behaviour, driven by a stub. No socket is opened.

Every other test exercises the fixture or replay transport, which means the code that
actually talks to CALL-E was unverified: dropping the `Idempotency-Key` header, the one
thing standing between a retry and a second call to a real person, kept the suite green.
"""

from __future__ import annotations

import json
import ssl

import httpx
import pytest
import truststore

from positive_contact.config import OFFICIAL_CALLE_BASE_URL
from positive_contact.transports.base import TransportError
from positive_contact.transports.calle import CalleTransport

ACCEPTED = {
    "id": "call_abc123",
    "object": "call_task",
    "status": "queued",
    "task": "...",
    "recipients": [],
    "structured_result": None,
    "summary": None,
    "task_completed": None,
    "completion_confidence": None,
    "evidence": [],
    "metadata": {},
    "failure_code": None,
    "failure_message": None,
    "created_at": "2026-09-11T15:00:00Z",
    "completed_at": None,
}


def build(handler, **kwargs) -> CalleTransport:
    transport = CalleTransport("calle_test_key", sleep=lambda _seconds: None, **kwargs)
    transport._client = httpx.Client(
        base_url=OFFICIAL_CALLE_BASE_URL,
        transport=httpx.MockTransport(handler),
        headers={
            "Authorization": "Bearer calle_test_key",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    return transport


def submit(transport, **overrides):
    payload = {
        "task_text": "This is an automated safety notification...",
        "phone_e164": "+14155550101",
        "locale": "en-US",
        "region": "US",
        "recipient_result_schema": {"type": "object", "additionalProperties": False},
        "idempotency_key": "pc:psps-demo:pc-001:1:primary",
        "metadata": {"pc_contact_id": "pc-001", "pc_ladder_step": "1"},
    }
    payload.update(overrides)
    return transport.submit(**payload)


def test_default_client_uses_the_operating_system_trust_store(monkeypatch):
    seen: dict = {}

    class StubClient:
        def close(self) -> None:
            pass

    def build_client(**kwargs):
        seen.update(kwargs)
        return StubClient()

    monkeypatch.setattr(httpx, "Client", build_client)
    transport = CalleTransport("calle_test_key")

    assert isinstance(seen["verify"], truststore.SSLContext)
    assert seen["verify"].check_hostname is True
    assert seen["verify"].verify_mode == ssl.CERT_REQUIRED
    transport.close()


# -- the request that goes on the wire --------------------------------------------


def test_the_idempotency_key_is_sent_as_a_header():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = request.headers
        return httpx.Response(201, json=ACCEPTED)

    result = submit(build(handler))
    assert result.kind == "accepted"
    assert seen["headers"]["Idempotency-Key"] == "pc:psps-demo:pc-001:1:primary"


def test_the_bearer_token_is_sent_and_the_key_is_not_in_the_body():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = request.headers
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json=ACCEPTED)

    submit(build(handler))
    assert seen["headers"]["Authorization"] == "Bearer calle_test_key"
    assert "idempotency_key" not in seen["body"]


def test_the_request_body_matches_the_published_contract():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        seen["url"] = str(request.url)
        return httpx.Response(201, json=ACCEPTED)

    submit(build(handler))
    body = seen["body"]
    assert seen["url"] == f"{OFFICIAL_CALLE_BASE_URL}/v1/calls"
    # CreateCallRequest is additionalProperties: false, so an invented field fails the call.
    assert set(body) <= {
        "task", "recipients", "result_schema", "recipient_result_schema",
        "metadata", "webhook_url",
    }
    assert body["task"]
    assert body["recipients"] == [
        {"phones": ["+14155550101"], "locale": "en-US", "region": "US"}
    ]
    assert body["recipient_result_schema"]["additionalProperties"] is False
    assert body["metadata"]["pc_contact_id"] == "pc-001"


def test_exactly_one_recipient_is_sent():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json=ACCEPTED)

    submit(build(handler))
    assert len(seen["body"]["recipients"]) == 1


def test_no_task_level_result_schema_is_sent():
    """With one recipient it would only duplicate the same evidence under a second
    extraction, and the disposition is read from the recipient."""
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(201, json=ACCEPTED)

    submit(build(handler))
    assert "result_schema" not in seen["body"]


def test_a_webhook_url_is_sent_only_when_configured():
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(201, json=ACCEPTED)

    submit(build(handler))
    assert "webhook_url" not in bodies[0]

    submit(build(handler, webhook_url="https://example.com/calle/webhook"))
    assert bodies[1]["webhook_url"] == "https://example.com/calle/webhook"


# -- how outcomes are classified ---------------------------------------------------


def test_a_201_binds_the_call_id():
    result = submit(build(lambda request: httpx.Response(201, json=ACCEPTED)))
    assert result.kind == "accepted"
    assert result.call_id == "call_abc123"


def test_a_response_without_a_call_id_is_unknown_not_accepted():
    payload = {key: value for key, value in ACCEPTED.items() if key != "id"}
    result = submit(build(lambda request: httpx.Response(201, json=payload)))
    assert result.kind == "unknown"


def test_a_transport_error_is_unknown_because_the_call_may_have_landed():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection reset")

    result = submit(build(handler))
    assert result.kind == "unknown"


@pytest.mark.parametrize(
    "code,status",
    [
        ("invalid_phone", 400),
        ("unsupported_language", 400),
        ("unsupported_region", 400),
        ("recipient_blocked", 403),
        ("policy_violation", 403),
        ("recipient_result_schema_invalid", 422),
        ("insufficient_balance", 402),
    ],
)
def test_a_definite_rejection_is_rejected(code, status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"code": code, "message": "no", "details": {}}})

    result = submit(build(handler))
    assert result.kind == "rejected"
    assert result.error_code == code


@pytest.mark.parametrize(
    "code,status",
    [
        ("rate_limit_exceeded", 429),
        ("provider_unavailable", 503),
        ("internal_error", 500),
        ("idempotency_conflict", 409),
    ],
)
def test_an_ambiguous_outcome_is_unknown_never_rejected(code, status):
    """These must not be read as "no call was placed"; the ladder would advance past a
    call that may be ringing."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"error": {"code": code, "message": "x", "details": {}}})

    result = submit(build(handler))
    assert result.kind == "unknown"
    assert result.error_code == code


def test_an_unreadable_error_body_still_classifies():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, content=b"<html>gateway</html>")

    assert submit(build(handler)).kind == "unknown"


# -- reading a call back -----------------------------------------------------------


def test_read_parses_the_recipient_result():
    payload = {
        **ACCEPTED,
        "status": "completed",
        "recipients": [
            {
                "id": "rcp_1",
                "phones": ["+14155550101"],
                "locale": "en-US",
                "region": "US",
                "status": "completed",
                "structured_result": {"contact_type": "live_person", "acknowledged": "yes"},
                "summary": "ok",
                "attempts": [
                    {
                        "id": "att_1",
                        "phone": "+14155550101",
                        "status": "completed",
                        "started_at": None,
                        "completed_at": None,
                        "summary": None,
                        "transcript_turns": [
                            {"offset_seconds": 0, "speaker": "bot", "text": "hello"},
                            {"offset_seconds": 5, "speaker": "user", "text": "Yes, I heard you."},
                        ],
                        "provider_call_id": "provider_1",
                        "failure_code": None,
                        "failure_message": None,
                    }
                ],
            }
        ],
        "completion_confidence": {"score": 0.93, "label": "high"},
    }
    transport = build(lambda request: httpx.Response(200, json=payload))
    snapshot = transport.read("call_abc123")
    assert snapshot.recipient_result["acknowledged"] == "yes"
    assert snapshot.confidence_label == "high"
    assert len(snapshot.transcript_turns) == 2
    assert snapshot.is_terminal


def test_read_uses_the_call_id_in_the_path():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={**ACCEPTED, "status": "completed"})

    build(handler).read("call_abc123")
    assert seen["url"] == f"{OFFICIAL_CALLE_BASE_URL}/v1/calls/call_abc123"


def test_a_failed_read_raises_rather_than_returning_a_guess():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": {"code": "not_found", "message": "no", "details": {}}})

    with pytest.raises(TransportError):
        build(handler).read("call_missing")


# -- polling -----------------------------------------------------------------------


def test_polling_stops_at_a_terminal_status():
    statuses = iter(["queued", "in_progress", "completed"])

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={**ACCEPTED, "status": next(statuses)})

    snapshot = build(handler).wait_for_terminal("call_abc123", first_delay_seconds=0)
    assert snapshot.status == "completed"


def test_a_polling_timeout_says_the_call_may_still_be_running():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={**ACCEPTED, "status": "in_progress"})

    with pytest.raises(TransportError, match="cancel endpoint"):
        build(handler).wait_for_terminal(
            "call_abc123", first_delay_seconds=0, timeout_seconds=0
        )


# -- the origin guard --------------------------------------------------------------


def test_credentials_may_only_go_to_the_official_origin():
    with pytest.raises(TransportError, match="official API origin"):
        CalleTransport("calle_test_key", base_url="https://evil.test")


def test_an_empty_api_key_is_refused():
    with pytest.raises(TransportError, match="CALLE_API_KEY"):
        CalleTransport("")


def test_the_transport_offers_no_cancel():
    assert not hasattr(CalleTransport, "cancel")
