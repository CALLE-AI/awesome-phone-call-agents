"""Unit tests for the Callback Coordinator engine.

These tests run with no CALL-E credentials and no network. The execute path is
exercised through a fake client-like object whose terminal results drive the
fail-closed disposition classifier.
"""

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("coordinator_mod", APP_ROOT / "coordinator.py")
assert SPEC and SPEC.loader
coordinator = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = coordinator
SPEC.loader.exec_module(coordinator)

NY = "America/New_York"
UTC = timezone.utc


def intake(**overrides):
    base = {
        "workflow_id": "demo-triage-001",
        "phone": "+12025550123",
        "source": "web_form",
        "business_display_name": "Example Service Desk",
        "request_reason_hint": "",
        "timezone": NY,
        "locale": "en-US",
        "consent": True,
    }
    base.update(overrides)
    return coordinator.parse_intake(base)


# --------------------------------------------------------------------------- #
# Parsing and validation
# --------------------------------------------------------------------------- #

def test_parse_intake_rejects_non_e164():
    try:
        intake(phone="not-a-phone")
    except ValueError as exc:
        assert "E.164" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_parse_intake_rejects_plus_zero():
    try:
        intake(phone="+0123456789")
    except ValueError as exc:
        assert "E.164" in str(exc)
    else:
        raise AssertionError("expected ValueError for +0")


def test_parse_intake_rejects_bad_source():
    try:
        intake(source="carrier_pigeon")
    except ValueError as exc:
        assert "source" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_parse_intake_rejects_do_not_call_non_bool():
    try:
        intake(do_not_call="yes")
    except ValueError as exc:
        assert "do_not_call" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_parse_intake_requires_consent():
    try:
        base = {
            "workflow_id": "demo-triage-001",
            "phone": "+12025550123",
            "source": "web_form",
            "business_display_name": "Example Service Desk",
            "request_reason_hint": "",
            "timezone": NY,
            "locale": "en-US",
            # consent missing
        }
        coordinator.parse_intake(base)
    except ValueError as exc:
        assert "consent" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError for missing consent")


def test_parse_intake_rejects_false_consent():
    try:
        intake(consent=False)
    except ValueError as exc:
        assert "consent" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError for consent=false")


def test_parse_intake_defaults():
    value = coordinator.parse_intake(
        {
            "workflow_id": "x-123",
            "phone": "+12025550123",
            "source": "missed_call",
            "business_display_name": "ACME",
            "timezone": "Europe/London",
            "consent": True,
        }
    )
    assert value.locale == "en-US"
    assert value.quiet_hours == ("20:00", "08:00")
    assert value.do_not_call is False


def test_parse_intake_accepts_iana_timezone():
    value = intake(timezone="Asia/Kolkata")
    assert value.timezone == "Asia/Kolkata"


def test_mask_phone():
    assert coordinator.mask_phone("+12025550123") == "+12******123"


def test_validate_trusted_base_url_accepts_official():
    ok = coordinator.validate_trusted_base_url("https://api.heycall-e.com")
    assert "api.heycall-e.com" in ok
    ok2 = coordinator.validate_trusted_base_url("https://api.heycall-e.com/")
    assert "api.heycall-e.com" in ok2


def test_validate_trusted_base_url_rejects_evil():
    try:
        coordinator.validate_trusted_base_url("https://evil.example.com")
    except ValueError as exc:
        assert "api.heycall-e.com" in str(exc)
    else:
        raise AssertionError("expected rejection of untrusted host")

    try:
        coordinator.validate_trusted_base_url("http://api.heycall-e.com")
    except ValueError as exc:
        assert "https" in str(exc).lower()
    else:
        raise AssertionError("expected rejection of http")


# --------------------------------------------------------------------------- #
# Gates
# --------------------------------------------------------------------------- #

def _ny(hour, minute):
    local = datetime(2026, 8, 10, hour, minute, tzinfo=timezone(timedelta(hours=-4)))
    return local


def test_attempt_gate_allows_during_day():
    value = intake()
    attempt, reason = coordinator.attempt_gate(value, _ny(14, 0))
    assert attempt is True
    assert reason is None


def test_attempt_gate_blocks_quiet_hours():
    value = intake()
    attempt, reason = coordinator.attempt_gate(value, _ny(22, 0))
    assert attempt is False
    assert reason == "quiet_hours"


def test_attempt_gate_blocks_after_midnight():
    value = intake(quiet_hours={"start": "20:00", "end": "08:00"})
    attempt, _ = coordinator.attempt_gate(value, _ny(2, 0))
    assert attempt is False


def test_attempt_gate_respects_do_not_call():
    value = intake(do_not_call=True)
    attempt, reason = coordinator.attempt_gate(value, _ny(14, 0))
    assert attempt is False
    assert reason == "do_not_call"


# --------------------------------------------------------------------------- #
# Disposition classification (fail-closed)
# --------------------------------------------------------------------------- #

def _completed(**overrides):
    base = {
        "status": "completed",
        "task_completed": True,
        "completion_confidence": {"score": 0.94, "label": "high"},
        "structured_result": {
            "right_person": "yes",
            "consent_after_ai_disclosure": "yes",
            "contact_reason": "billing",
            "urgent": "no",
            "voicemail_allowed": "yes",
            "evidence_summary": "Recipient requested a call about an invoice.",
        },
    }
    base.update(overrides)
    return base


def test_classify_scheduled_on_high_confidence_actionable():
    result = coordinator.classify_disposition(_completed())
    assert result["disposition"] == "scheduled"
    assert result["needs_human"] is False


def test_classify_needs_human_when_missing_result():
    result = coordinator.classify_disposition({"status": "completed", "task_completed": True, "structured_result": None})
    assert result["disposition"] == "needs_human"
    assert result["needs_human"] is True


def test_classify_needs_human_on_low_confidence():
    result = coordinator.classify_disposition(_completed(completion_confidence={"score": 0.3, "label": "low"}))
    assert result["disposition"] == "needs_human"
    assert result["reason"] == "low_confidence"


def test_classify_needs_human_on_wrong_person():
    result = coordinator.classify_disposition(
        _completed(structured_result={**_completed()["structured_result"], "right_person": "no"})
    )
    assert result["disposition"] == "needs_human"
    assert result["reason"] == "wrong_person"


def test_classify_declined_when_no_consent():
    result = coordinator.classify_disposition(
        _completed(structured_result={**_completed()["structured_result"], "consent_after_ai_disclosure": "no"})
    )
    assert result["disposition"] == "declined"
    assert result["needs_human"] is False


def test_classify_needs_human_on_unknown_reason():
    result = coordinator.classify_disposition(
        _completed(structured_result={**_completed()["structured_result"], "contact_reason": "unknown"})
    )
    assert result["disposition"] == "needs_human"
    assert result["reason"] == "reason_unknown"


def test_classify_needs_human_on_failed_status():
    result = coordinator.classify_disposition(_completed(status="failed"))
    assert result["disposition"] == "needs_human"
    assert result["reason"] == "call_failed"


def test_classify_needs_human_on_urgent():
    result = coordinator.classify_disposition(
        _completed(structured_result={**_completed()["structured_result"], "urgent": "yes"})
    )
    assert result["disposition"] == "needs_human"
    assert result["reason"] == "urgent_fast_track"


def test_classify_needs_human_when_task_not_completed():
    result = coordinator.classify_disposition(_completed(task_completed=False))
    assert result["disposition"] == "needs_human"
    assert result["reason"] == "task_not_completed"


def test_classify_needs_human_when_status_not_completed():
    result = coordinator.classify_disposition(_completed(status="in_progress"))
    assert result["disposition"] == "needs_human"
    assert "not_completed" in result["reason"]


def test_classify_needs_human_on_unbound_structured_data():
    # Invalid enum value should not be scheduled
    result = coordinator.classify_disposition(
        _completed(structured_result={**_completed()["structured_result"], "contact_reason": "evil_injection"})
    )
    assert result["disposition"] == "needs_human"
    assert "invalid" in result["reason"]


def test_build_task_does_not_offer_callback_time():
    v = intake()
    task = coordinator.build_task(v)
    # Old prompt offered "Offer to book a specific callback time"
    assert "book a specific callback time" not in task.lower()
    # Schema cannot return a time, so task must not promise booking
    assert "confirm the time by repeating" not in task.lower()


def test_redact_phone_like_formatted():
    # Contiguous E.164
    assert "[phone-redacted]" in coordinator.redact_phone_like("Call +12025550123")
    # US formatted
    assert "[phone-redacted]" in coordinator.redact_phone_like("Call (202) 555-0123")
    assert "[phone-redacted]" in coordinator.redact_phone_like("Call 202-555-0123")
    assert "[phone-redacted]" in coordinator.redact_phone_like("Call 202.555.0123")
    assert "[phone-redacted]" in coordinator.redact_phone_like("Call 202 555 0123")
    assert "[phone-redacted]" in coordinator.redact_phone_like("Call +1 (202) 555-0123")
    # International
    assert "[phone-redacted]" in coordinator.redact_phone_like("Call +44 20 7123 4567")


# --------------------------------------------------------------------------- #
# Routing
# --------------------------------------------------------------------------- #

def test_route_maps_actionable_reason():
    value = intake()
    routed = coordinator.route(value, "billing")
    assert routed["team"] == "Billing Team"


def test_route_fails_closed_for_unknown_reason():
    value = intake()
    routed = coordinator.route(value, "unknown")
    assert routed["team"] == "General Intake (human review)"
    assert "do not auto-close" in routed["action"]


def test_route_uses_custom_rules():
    value = intake(
        routing_rules=[
            {"category": "billing", "team": "Accounts Receivable", "action": "Call customer directly."},
        ]
    )
    routed = coordinator.route(value, "billing")
    assert routed["team"] == "Accounts Receivable"


# --------------------------------------------------------------------------- #
# Execute orchestration (fake client, no network)
# --------------------------------------------------------------------------- #

class FakeCalls:
    def __init__(self, terminal):
        self.terminal = terminal
        self.created = []

    def create(self, **kwargs):
        self.created.append(kwargs)
        return {"id": "call-abc-123"}

    def wait_for_result(self, call_id, **kwargs):
        return self.terminal


class FakeClient:
    def __init__(self, terminal):
        self.calls = FakeCalls(terminal)


def test_execute_scheduled_ticket_masks_evidence():
    value = intake()
    client = FakeClient(_completed())
    ticket = coordinator.execute_with_client(
        value, client, now=_ny(14, 0), timeout_seconds=60
    )
    assert ticket["mode"] == "execute"
    assert ticket["disposition"] == "scheduled"
    assert ticket["route_to"] == "Billing Team"
    assert ticket["call_id"] == "call-abc-123"
    assert ticket["idempotency_key"] == "callback-triage-demo-triage-001"
    assert len(client.calls.created) == 1


def test_execute_fail_closed_on_low_confidence():
    value = intake()
    client = FakeClient(_completed(completion_confidence={"score": 0.2, "label": "low"}))
    ticket = coordinator.execute_with_client(value, client, now=_ny(14, 0), timeout_seconds=60)
    # Low confidence still routes to a human, and stays on the reason's team so a
    # specialist reviews rather than a generic queue.
    assert ticket["needs_human"] is True
    assert ticket["disposition"] == "needs_human"
    assert ticket["route_to"] == "Billing Team"


def test_execute_skips_during_quiet_hours_without_creating_call():
    value = intake()
    client = FakeClient(_completed())
    ticket = coordinator.execute_with_client(value, client, now=_ny(22, 0), timeout_seconds=60)
    assert ticket["disposition"] == "skipped"
    assert ticket["creates_phone_call"] is False
    assert client.calls.created == []


def test_execute_fail_closed_when_create_has_no_id():
    class NoIdCalls(FakeCalls):
        def create(self, **kwargs):
            return {}

    value = intake()
    client = FakeClient(_completed())
    client.calls = NoIdCalls(_completed())
    ticket = coordinator.execute_with_client(value, client, now=_ny(14, 0), timeout_seconds=60)
    assert ticket["disposition"] == "needs_human"
    assert ticket["reason"] == "create_no_id"


def test_execute_fail_closed_when_lookup_raises():
    class BoomCalls(FakeCalls):
        def wait_for_result(self, call_id, **kwargs):
            raise RuntimeError("network down")

    value = intake()
    client = FakeClient(_completed())
    client.calls = BoomCalls(_completed())
    ticket = coordinator.execute_with_client(value, client, now=_ny(14, 0), timeout_seconds=60)
    assert ticket["disposition"] == "needs_human"
    assert ticket["reason"] == "result_lookup_error"


def test_execute_masks_formatted_phone_in_evidence():
    value = intake()
    term = _completed(
        structured_result={
            **_completed()["structured_result"],
            "evidence_summary": "Caller left number (202) 555-0123 for callback.",
        }
    )
    client = FakeClient(term)
    ticket = coordinator.execute_with_client(value, client, now=_ny(14, 0), timeout_seconds=60)
    assert "[phone-redacted]" in ticket["evidence_summary"]
    assert "(202)" not in ticket["evidence_summary"]
