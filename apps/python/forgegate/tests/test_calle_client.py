import pytest
import calle_client


def test_dry_run_is_the_default():
    assert calle_client.DRY_RUN is True


def test_idempotency_key_is_deterministic_per_incident():
    key_a = calle_client.idempotency_key("inc_001")
    key_b = calle_client.idempotency_key("inc_001")
    key_c = calle_client.idempotency_key("inc_002")
    assert key_a == key_b
    assert key_a != key_c


def test_place_call_in_dry_run_needs_no_credentials_and_returns_mocked_hold():
    result = calle_client.place_call("call the lead", "inc_001")
    assert result.call_id.startswith("dryrun_")
    assert result.task_completed is True
    assert result.disposition == "HOLD"
    assert result.dry_run is True


def test_place_call_respects_mock_disposition_override():
    result = calle_client.place_call("call the lead", "inc_001", mock_disposition="APPROVE")
    assert result.disposition == "APPROVE"


def test_resolve_action_state_is_fail_closed():
    assert calle_client.resolve_action_state("APPROVE") == "EXECUTED"
    for disposition in ("HOLD", "ESCALATE", "NO_ANSWER", "UNCLEAR", "DENY", "DISPATCH_FAILED"):
        assert calle_client.resolve_action_state(disposition) == "HELD"


def test_disposition_from_result_treats_any_non_completed_status_as_no_answer():
    for status in ("FAILED", "DECLINED", "BUSY", "VOICEMAIL", "CANCELED", "EXPIRED"):
        assert calle_client._disposition_from_result(status, True, {"disposition": "APPROVE"}) == "NO_ANSWER"


def test_disposition_from_result_reads_structured_result_when_reached():
    assert calle_client._disposition_from_result("COMPLETED", True, {"disposition": "hold"}) == "HOLD"


def test_disposition_from_result_falls_back_to_unclear():
    assert calle_client._disposition_from_result("COMPLETED", True, {}) == "UNCLEAR"
    assert calle_client._disposition_from_result("COMPLETED", False, {"disposition": "APPROVE"}) == "UNCLEAR"
    assert calle_client._disposition_from_result("COMPLETED", True, {"disposition": "MAYBE"}) == "UNCLEAR"


def test_validate_origin_approved_https():
    # Approved HTTPS origin passes
    assert calle_client.validate_origin("https://api.heycall-e.com") == "https://api.heycall-e.com"
    assert calle_client.validate_origin("https://api.heycall-e.com/v1") == "https://api.heycall-e.com/v1"

    # Plain HTTP must be refused
    with pytest.raises(calle_client.CalleDispatchError, match="Refusing to send credentials"):
        calle_client.validate_origin("http://api.heycall-e.com")

    # Unapproved host must be refused
    with pytest.raises(calle_client.CalleDispatchError, match="unapproved origin"):
        calle_client.validate_origin("https://attacker.example.com")


def test_place_call_dry_run_validates_ascii_phone():
    # Valid ASCII E.164 passes in dry-run
    res = calle_client.place_call("task", "inc_01", recipient_phone="+12025550123")
    assert res.task_completed is True

    # Non-ASCII or invalid format fails even in dry-run
    with pytest.raises(calle_client.CalleDispatchError):
        calle_client.place_call("task", "inc_01", recipient_phone="not_a_phone")


def test_poll_timeout_resolves_to_unclear_and_preserves_intent(monkeypatch):
    monkeypatch.setattr(calle_client, "POLL_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(calle_client, "POLL_INTERVAL_SECONDS", 0.01)

    class DummyResponse:
        is_redirect = False
        status_code = 200

        def raise_for_status(self):
            pass

        def json(self):
            return {"status": "in-progress", "task_completed": False}

    monkeypatch.setattr(calle_client.requests, "get", lambda *args, **kwargs: DummyResponse())

    res = calle_client._poll_rest("call_timeout_test")
    # Must NOT claim timeout proves NO_ANSWER
    assert res.disposition == "UNCLEAR"
    assert res.task_completed is False
    assert "timeout" in res.reason.lower()
    assert calle_client.resolve_action_state(res.disposition) == "HELD"


def test_place_call_via_sdk_passes_idempotency_key_when_supported(monkeypatch):
    class MockCalls:
        def __init__(self):
            self.calls = []

        def create_and_wait(self, task, result_schema, idempotency_key=None):
            self.calls.append({"task": task, "idempotency_key": idempotency_key})
            return {
                "call_id": "call_mock_1",
                "task_completed": True,
                "status": "completed",
                "structured_result": {"disposition": "APPROVE", "reason": "verified"},
                "evidence": ["all ok"],
            }

    mock_client = type("MockClient", (), {"calls": MockCalls()})()
    monkeypatch.setattr(calle_client, "_sdk_client", lambda: mock_client)

    result = calle_client._place_call_via_sdk("verify unit", "test_key_123")
    assert result.disposition == "APPROVE"
    assert len(mock_client.calls.calls) == 1
    assert mock_client.calls.calls[0]["idempotency_key"] == "test_key_123"


def test_place_call_via_sdk_fails_closed_if_signature_does_not_accept_key(monkeypatch):
    class MockCallsNoKey:
        def __init__(self):
            self.calls = []

        def create_and_wait(self, task, result_schema):  # No idempotency_key parameter
            self.calls.append({"task": task})
            return {}

    mock_client = type("MockClient", (), {"calls": MockCallsNoKey()})()
    monkeypatch.setattr(calle_client, "_sdk_client", lambda: mock_client)

    with pytest.raises(calle_client.CalleDispatchError, match="does not accept 'idempotency_key'"):
        calle_client._place_call_via_sdk("verify unit", "test_key_123")

    # Method must NOT have been called
    assert len(mock_client.calls.calls) == 0


def test_place_call_via_sdk_fails_closed_on_type_error_without_redial(monkeypatch):
    call_count = 0

    class MockCallsFailing:
        def create_and_wait(self, task, result_schema, idempotency_key=None):
            nonlocal call_count
            call_count += 1
            # Simulates an unexpected TypeError occurring during execution
            raise TypeError("unexpected type error during execution")

    mock_client = type("MockClient", (), {"calls": MockCallsFailing()})()
    monkeypatch.setattr(calle_client, "_sdk_client", lambda: mock_client)

    with pytest.raises(calle_client.CalleDispatchError, match="CALL-E SDK call failed"):
        calle_client._place_call_via_sdk("verify unit", "test_key_123")

    # Must fail closed immediately and NEVER redial
    assert call_count == 1

