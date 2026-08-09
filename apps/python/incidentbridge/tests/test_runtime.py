from pathlib import Path

from incidentbridge.ledger import ReservationLedger
from incidentbridge.models import parse_request
from incidentbridge.policy import simulated_result
from incidentbridge.runtime import execute, validate_base_url
from tests.test_policy import RAW


class FakeCalls:
    def __init__(self, response=None, create=None):
        self.created = None
        self.response = response
        self.create_response = create or {"id": "call_001"}

    def create(self, **kwargs):
        self.created = kwargs
        return self.create_response

    def wait_for_result(self, call_id, *, timeout_seconds, interval_seconds):
        assert call_id == "call_001"
        assert timeout_seconds == 5
        assert interval_seconds == 2
        return self.response


def completed_response():
    return {
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.95},
        "structured_result": simulated_result(
            parse_request(RAW), "acknowledged"
        )["structured_result"],
    }


def test_execute_calls_provider_and_returns_decision():
    calls = FakeCalls(completed_response())
    accepted = []
    result = execute(parse_request(RAW), calls, 5, accepted.append)
    assert accepted == ["call_001"]
    assert calls.created["idempotency_key"].startswith("incidentbridge-")
    assert calls.created["result_schema"]["additionalProperties"] is False
    assert result["decision"]["route"] == "vendor_acknowledged"


def test_execute_rejects_bad_provider_shapes():
    for response, create in [
        (completed_response(), {}),
        ({**completed_response(), "structured_result": []}, {"id": "call_001"}),
    ]:
        calls = FakeCalls(response, create={"missing": "id"} if create == {} else create)
        try:
            execute(parse_request(RAW), calls, 5)
        except RuntimeError:
            pass
        else:
            raise AssertionError("expected bad provider shape to fail")


def test_base_url_allowlist():
    assert validate_base_url("https://api.heycall-e.com/") == "https://api.heycall-e.com"
    assert validate_base_url("http://127.0.0.1:8123") == "http://127.0.0.1:8123"
    for value in ["http://api.heycall-e.com", "https://example.com", "http://localhost"]:
        try:
            validate_base_url(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected {value} to fail")


def test_reservation_ledger_is_durable_and_duplicate_safe(tmp_path: Path):
    ledger = ReservationLedger(tmp_path / "ledger.sqlite3")
    assert ledger.claim("key-1") is True
    assert ledger.claim("key-1") is False
    assert ledger.get("key-1")[0] == "reserved"
    ledger.mark_accepted("key-1", "call-1")
    assert ledger.get("key-1")[:2] == ("accepted", "call-1")
    ledger.mark_unknown("key-1", "call-1", "TimeoutError")
    assert ledger.get("key-1") == ("outcome_unknown", "call-1", "TimeoutError")
    ledger.mark_completed("key-1", "call-1")
    assert ledger.get("key-1")[0] == "completed"
