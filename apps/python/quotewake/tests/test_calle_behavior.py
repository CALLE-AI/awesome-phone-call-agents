from datetime import datetime, timezone
import logging
from unittest.mock import Mock

import pytest

from quotewake_salesforce.calle.client import CallEClient, CallEError, idempotency_key, result_schema
from quotewake_salesforce.domain.models import CallOutcomeKind, CallRequest


REQUEST = CallRequest("0Q0000000000001", "006000000000001", "003000000000001", "+14155550101", "Conduct a call in es-ES for region ES.", "es-ES", "ES")


def sdk(result, status="completed"):
    calls = Mock()
    calls.create.return_value = {"id": "call-1"}
    calls.wait_for_result.return_value = {"status": status, "structured_result": result}
    return Mock(calls=calls)


def valid_result():
    return {"outcome": "interested", "interest_level": "high", "preferred_date": "2026-08-20", "summary": "Wants a human follow-up.", "next_action": "Salesperson calls."}


def test_result_schema_exposes_only_supported_business_outcomes():
    assert result_schema()["properties"]["outcome"]["enum"] == [
        "interested",
        "call_back_later",
        "no_answer",
        "busy",
    ]


def test_live_sdk_call_uses_locale_wait_and_idempotency():
    fake = sdk(valid_result())
    result = CallEClient(api_key="secret", execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.outcome == "interested"
    assert result.outcome_kind is CallOutcomeKind.BUSINESS
    assert result.next_follow_up_at == datetime(2026, 8, 20, tzinfo=timezone.utc)
    kwargs = fake.calls.create.call_args.kwargs
    assert kwargs["recipient"] == {"phone": REQUEST.phone, "locale": "es-ES"}
    assert kwargs["idempotency_key"] == idempotency_key(REQUEST.quote_id, 1)
    fake.calls.wait_for_result.assert_called_once()


@pytest.mark.parametrize("field", ["outcome", "interest_level", "summary", "next_action"])
def test_missing_required_structured_field_is_technical(field):
    result = valid_result()
    result[field] = ""
    with pytest.raises(CallEError):
        CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)


def test_invalid_date_and_failed_provider_status_are_technical():
    invalid = valid_result()
    invalid["preferred_date"] = "not-a-date"
    with pytest.raises(CallEError):
        CallEClient(execute=True, client=sdk(invalid)).execute(REQUEST, next_attempt=1)
    failed = CallEClient(execute=True, client=sdk({}, status="canceled")).execute(REQUEST, next_attempt=1)
    assert failed.outcome_kind is CallOutcomeKind.TECHNICAL_FAILURE


def test_wait_transport_failure_propagates_after_accepted_call(caplog):
    fake = sdk(valid_result())
    fake.calls.wait_for_result.side_effect = TimeoutError("provider timeout")
    caplog.set_level(logging.INFO, logger="quotewake_salesforce")
    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    with pytest.raises(TimeoutError):
        try:
            CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
        finally:
            logger.removeHandler(caplog.handler)
    records = [record for record in caplog.records if record.name == "quotewake_salesforce"]
    failure = next(record for record in records if record.quotewake_event == "call_e_wait_failed")
    assert failure.quotewake_fields["call_id"] == "call-1"
    assert failure.quotewake_fields["phase"] == "wait"
    assert failure.quotewake_fields["reason"] == "timeout"
    assert "provider timeout" not in repr(failure.quotewake_fields)


def test_unknown_outcome_is_rejected_and_parse_log_is_bounded(caplog):
    invalid = valid_result()
    invalid["outcome"] = "unexpected-provider-value"
    fake = sdk(invalid)
    caplog.set_level(logging.INFO, logger="quotewake_salesforce")
    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    with pytest.raises(CallEError):
        try:
            CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
        finally:
            logger.removeHandler(caplog.handler)
    records = [record for record in caplog.records if record.name == "quotewake_salesforce"]
    failure = next(record for record in records if record.quotewake_event == "call_e_parse_failed")
    assert failure.quotewake_fields["call_id"] == "call-1"
    assert failure.quotewake_fields["phase"] == "parse"
    assert failure.quotewake_fields["reason"] == "invalid_outcome"
    assert "unexpected-provider-value" not in repr(failure.quotewake_fields)


def test_technical_retry_marker_changes_key_but_same_marker_is_idempotent():
    marker = datetime(2026, 8, 11, 12, tzinfo=timezone.utc)
    assert idempotency_key(REQUEST.quote_id, 1, marker) == idempotency_key(REQUEST.quote_id, 1, marker)
    assert idempotency_key(REQUEST.quote_id, 1, marker) != idempotency_key(REQUEST.quote_id, 1)
