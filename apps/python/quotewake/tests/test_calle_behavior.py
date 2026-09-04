from datetime import datetime, timezone
import logging
from unittest.mock import Mock

import pytest

from calle.errors import CalleAPIError, CalleAuthenticationError, CalleConnectionError, CalleRateLimitError, CalleTimeoutError

from quotewake_salesforce.calle.client import (
    CallEClient,
    CallEError,
    failure_details,
    idempotency_key,
    operation_binding_digest,
    request_metadata,
    result_schema,
    validate_idempotency_suffix,
)
from quotewake_salesforce.domain.models import CallOutcomeKind, CallRequest


REQUEST = CallRequest("0Q0000000000001", "006000000000001", "003000000000001", "+14155550101", "Conduct a call in es-ES for region ES.", "es-ES", "ES")


def sdk(result, status="completed", task_completed=True):
    calls = Mock()
    calls.create.return_value = {"id": "call-1"}
    request_metadata_value = request_metadata(REQUEST)
    digest = operation_binding_digest(REQUEST, next_attempt=1)
    calls.wait_for_result.return_value = {
        "id": "call-1",
        "status": status,
        "task_completed": task_completed,
        "structured_result": result,
        "task": REQUEST.goal,
        "recipient": {"phones": [REQUEST.phone], "locale": REQUEST.locale, "region": REQUEST.region},
        "result_schema": result_schema(),
        "metadata": {**request_metadata_value, "quotewake_binding_digest": digest},
        "idempotency_key": idempotency_key(REQUEST.quote_id, 1, binding_digest=digest),
    }
    return Mock(calls=calls)


def bound_payload(payload):
    evidence = sdk(None).calls.wait_for_result.return_value
    evidence.update(payload)
    for recipient in evidence.get("recipients", []):
        recipient.setdefault("phones", [REQUEST.phone])
        recipient.setdefault("locale", REQUEST.locale)
        recipient.setdefault("region", REQUEST.region)
    if isinstance(evidence.get("recipient"), dict):
        evidence["recipient"].setdefault("phones", [REQUEST.phone])
        evidence["recipient"].setdefault("locale", REQUEST.locale)
        evidence["recipient"].setdefault("region", REQUEST.region)
    return evidence


def valid_result():
    return {"outcome": "interested", "interest_level": "high", "preferred_date": "2026-08-20", "summary": "Wants a human follow-up.", "next_action": "Salesperson calls."}


def bound_key(request=REQUEST, *, attempt=1, marker=None, suffix=None):
    digest = operation_binding_digest(request, next_attempt=attempt, retry_marker=marker, suffix=suffix)
    return idempotency_key(request.quote_id, attempt, marker, suffix, digest)


def test_result_schema_exposes_only_supported_business_outcomes():
    assert result_schema()["properties"]["outcome"]["enum"] == [
        "interested",
        "call_back_later",
        "not_interested",
        "stop_quote_follow_up",
        "unknown",
        "no_answer",
        "busy",
    ]
    assert "call_not_established" not in result_schema()["properties"]["outcome"]["enum"]


def test_live_sdk_call_uses_locale_wait_and_idempotency():
    fake = sdk(valid_result())
    result = CallEClient(api_key="secret", execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.outcome == "interested"
    assert result.outcome_kind is CallOutcomeKind.BUSINESS
    assert result.next_follow_up_at == datetime(2026, 8, 20, tzinfo=timezone.utc)
    kwargs = fake.calls.create.call_args.kwargs
    assert kwargs["recipient"] == {"phones": [REQUEST.phone], "locale": "es-ES", "region": "ES"}
    assert kwargs["idempotency_key"] == bound_key()
    assert kwargs["metadata"] == {
        **request_metadata(REQUEST),
        "quotewake_binding_digest": operation_binding_digest(REQUEST, next_attempt=1),
    }
    fake.calls.wait_for_result.assert_called_once()


@pytest.mark.parametrize(
    ("stored_locale", "provider_locale"),
    [("en_US", "en-US"), ("es_ES", "es-ES"), ("es-ES", "es-ES"), ("ES-es", "es-ES")],
)
def test_salesforce_locale_spellings_are_canonicalized_for_calle(stored_locale, provider_locale):
    request = CallRequest(
        REQUEST.quote_id,
        REQUEST.opportunity_id,
        REQUEST.contact_id,
        REQUEST.phone,
        REQUEST.goal,
        stored_locale,
        REQUEST.region,
    )
    fake = sdk(valid_result())
    CallEClient(execute=True, client=fake).execute(request, next_attempt=1)
    assert fake.calls.create.call_args.kwargs["recipient"]["locale"] == provider_locale


@pytest.mark.parametrize("locale", ["en_US_POSIX", "spanish-ES", "en--US", ""])
def test_invalid_salesforce_locale_is_rejected_before_provider_call(locale):
    request = CallRequest(
        REQUEST.quote_id,
        REQUEST.opportunity_id,
        REQUEST.contact_id,
        REQUEST.phone,
        REQUEST.goal,
        locale,
        REQUEST.region,
    )
    fake = sdk(valid_result())
    with pytest.raises(ValueError, match="locale"):
        CallEClient(execute=True, client=fake).execute(request, next_attempt=1)
    fake.calls.create.assert_not_called()


@pytest.mark.parametrize("field", ["outcome", "interest_level", "summary", "next_action"])
def test_missing_required_structured_field_becomes_unknown_after_acceptance(field):
    result = valid_result()
    result[field] = ""
    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)
    assert parsed.call_id == "call-1"
    assert parsed.outcome == "unknown"
    assert parsed.outcome_kind is CallOutcomeKind.BUSINESS


def test_invalid_date_is_unknown_but_terminal_failure_is_not_established():
    invalid = valid_result()
    invalid["preferred_date"] = "not-a-date"
    parsed = CallEClient(execute=True, client=sdk(invalid)).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "unknown"
    assert parsed.outcome_kind is CallOutcomeKind.BUSINESS
    failed = CallEClient(execute=True, client=sdk({}, status="canceled")).execute(REQUEST, next_attempt=1)
    assert failed.outcome == "call_not_established"
    assert failed.outcome_kind is CallOutcomeKind.BUSINESS


def test_wait_transport_failure_becomes_unknown_after_accepted_call(caplog):
    fake = sdk(valid_result())
    fake.calls.wait_for_result.side_effect = TimeoutError("provider timeout")
    caplog.set_level(logging.INFO, logger="quotewake_salesforce")
    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    try:
        result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    finally:
        logger.removeHandler(caplog.handler)
    assert result.call_id == "call-1"
    assert result.outcome == "unknown"
    assert result.outcome_kind is CallOutcomeKind.BUSINESS
    assert "timeout" in result.summary
    assert "provider timeout" not in result.summary
    records = [record for record in caplog.records if record.name == "quotewake_salesforce"]
    failure = next(record for record in records if record.quotewake_event == "call_e_wait_failed")
    assert failure.quotewake_fields["call_id"] == "call-1"
    assert failure.quotewake_fields["phase"] == "wait"
    assert failure.quotewake_fields["reason"] == "timeout"
    assert failure.quotewake_fields["creation_unknown"] is False
    assert failure.quotewake_fields["result_unknown"] is True
    assert failure.quotewake_fields["provider_call_id"] == "call-1"
    assert "provider timeout" not in repr(failure.quotewake_fields)


def test_unknown_outcome_becomes_business_unknown_and_parse_log_is_bounded(caplog):
    invalid = valid_result()
    invalid["outcome"] = "unexpected-provider-value"
    fake = sdk(invalid)
    caplog.set_level(logging.INFO, logger="quotewake_salesforce")
    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    try:
        result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    finally:
        logger.removeHandler(caplog.handler)
    assert result.call_id == "call-1"
    assert result.outcome == "unknown"
    assert result.outcome_kind is CallOutcomeKind.BUSINESS
    records = [record for record in caplog.records if record.name == "quotewake_salesforce"]
    failure = next(record for record in records if record.quotewake_event == "call_e_parse_failed")
    assert failure.quotewake_fields["call_id"] == "call-1"
    assert failure.quotewake_fields["phase"] == "parse"
    assert failure.quotewake_fields["reason"] == "invalid_outcome"
    assert failure.quotewake_fields["result_unknown"] is True
    assert "unexpected-provider-value" not in repr(failure.quotewake_fields)


def test_technical_retry_marker_changes_key_but_same_marker_is_idempotent():
    marker = datetime(2026, 8, 11, 12, tzinfo=timezone.utc)
    assert idempotency_key(REQUEST.quote_id, 1, marker) == idempotency_key(REQUEST.quote_id, 1, marker)
    assert idempotency_key(REQUEST.quote_id, 1, marker) != idempotency_key(REQUEST.quote_id, 1)


def test_idempotency_suffix_is_stable_distinct_and_appended_after_retry_marker():
    marker = datetime(2026, 8, 11, 12, tzinfo=timezone.utc)
    key = idempotency_key(REQUEST.quote_id, 2, marker, "test-02")
    assert key == idempotency_key(REQUEST.quote_id, 2, marker, "test-02")
    assert key.endswith("-test-02")
    assert key != idempotency_key(REQUEST.quote_id, 2, marker, "test-03")
    assert key.startswith(idempotency_key(REQUEST.quote_id, 2, marker) + "-")


@pytest.mark.parametrize("value", ["", "_starts-with-symbol", "-starts-with-symbol", "é", "a" * 33])
def test_idempotency_suffix_is_bounded_and_ascii(value):
    with pytest.raises(ValueError, match="idempotency suffix"):
        validate_idempotency_suffix(value)


def test_idempotency_suffix_is_optional_without_changing_default_key():
    assert validate_idempotency_suffix(None) is None
    assert idempotency_key(REQUEST.quote_id, 1, suffix=None) == idempotency_key(REQUEST.quote_id, 1)


def test_preview_uses_idempotency_suffix():
    client = CallEClient(idempotency_suffix="preview-1")
    preview = client.preview(REQUEST, next_attempt=1)
    assert preview["idempotency_key"] == bound_key(suffix="preview-1")


def test_execute_uses_idempotency_suffix():
    fake = sdk(valid_result())
    CallEClient(execute=True, client=fake, idempotency_suffix="execute-1").execute(REQUEST, next_attempt=1)
    assert fake.calls.create.call_args.kwargs["idempotency_key"] == bound_key(suffix="execute-1")


def test_binding_digest_changes_when_provider_bound_operation_changes():
    variants = [
        CallRequest(REQUEST.quote_id, REQUEST.opportunity_id, REQUEST.contact_id, "+14155550102", REQUEST.goal, REQUEST.locale, REQUEST.region),
        CallRequest(REQUEST.quote_id, REQUEST.opportunity_id, REQUEST.contact_id, REQUEST.phone, "A different task.", REQUEST.locale, REQUEST.region),
        CallRequest(REQUEST.quote_id, REQUEST.opportunity_id, REQUEST.contact_id, REQUEST.phone, REQUEST.goal, "en-US", "US"),
        CallRequest("0Q0000000000002", REQUEST.opportunity_id, REQUEST.contact_id, REQUEST.phone, REQUEST.goal, REQUEST.locale, REQUEST.region),
    ]
    original = operation_binding_digest(REQUEST, next_attempt=1)
    assert all(operation_binding_digest(variant, next_attempt=1) != original for variant in variants)


def test_binding_digest_includes_metadata_contract():
    original = operation_binding_digest(REQUEST, next_attempt=1)
    changed_metadata = {**request_metadata(REQUEST), "quotewake_contract": "different"}
    assert operation_binding_digest(REQUEST, next_attempt=1, metadata=changed_metadata) != original
    changed_schema = {"type": "object", "required": ["different_contract"]}
    assert operation_binding_digest(REQUEST, next_attempt=1, schema=changed_schema) != original


@pytest.mark.parametrize("field", ["id", "task", "metadata", "result_schema", "idempotency_key"])
def test_mismatched_provider_evidence_is_not_verified(field):
    fake = sdk(valid_result())
    payload = fake.calls.wait_for_result.return_value
    payload[field] = {"id": "different"} if field in {"metadata", "result_schema"} else "different"
    result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.binding_verified is False
    assert result.outcome == "unknown"


def test_mismatched_provider_phone_is_not_verified():
    fake = sdk(valid_result())
    fake.calls.wait_for_result.return_value["recipient"]["phones"] = ["+14155550102"]
    result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.binding_verified is False
    assert result.outcome == "unknown"


def test_result_without_optional_request_echoes_uses_call_id_binding():
    fake = sdk(valid_result())
    fake.calls.wait_for_result.return_value = {
        "id": "call-1",
        "status": "completed",
        "task_completed": True,
        "structured_result": valid_result(),
    }
    result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.binding_verified is True
    assert result.outcome == "interested"


def test_schema_has_optional_preferred_date_without_a_union_and_enum_interest():
    schema = result_schema()
    assert "preferred_date" not in schema["required"]
    assert schema["properties"]["preferred_date"]["type"] == "string"
    assert "format" not in schema["properties"]["preferred_date"]
    assert "YYYY-MM-DD" in schema["properties"]["preferred_date"]["description"]
    assert all(
        isinstance(value.get("description"), str) and value["description"]
        for value in schema["properties"].values()
    )
    assert schema["properties"]["interest_level"]["enum"] == ["high", "medium", "low", "unknown"]


def test_optional_preferred_date_is_accepted_but_null_is_rejected():
    result = valid_result()
    del result["preferred_date"]
    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)
    assert parsed.preferred_date is None

    result["preferred_date"] = None
    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "unknown"


@pytest.mark.parametrize("value", ["2026-08-20", "2020-01-01"])
def test_preferred_date_accepts_future_or_past_iso_dates_for_policy_to_evaluate(value):
    result = valid_result()
    result["preferred_date"] = value
    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)
    assert parsed.preferred_date.isoformat() == value


@pytest.mark.parametrize("value", ["2026-W33-1", "20260820", "2026-08-20T00:00:00Z", "２０２６-０８-２０"])
def test_preferred_date_requires_exact_ascii_calendar_date(value):
    result = valid_result()
    result["preferred_date"] = value
    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "unknown"


@pytest.mark.parametrize("outcome", [
    "interested",
    "call_back_later",
    "not_interested",
    "stop_quote_follow_up",
    "unknown",
    "no_answer",
    "busy",
])
def test_all_explicit_business_outcomes_round_trip(outcome):
    result = valid_result()
    result["outcome"] = outcome
    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == outcome


@pytest.mark.parametrize("task_completed", [False, None])
def test_task_not_completed_never_accepts_structured_interest(task_completed):
    fake = sdk(valid_result())
    fake.calls.wait_for_result.return_value["task_completed"] = task_completed
    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "unknown"
    assert parsed.outcome_kind is CallOutcomeKind.BUSINESS


def test_aggregate_root_no_answer_is_used_when_recipient_result_is_null():
    """An aggregate CALL-E result is authoritative over a null recipient copy."""

    fake = sdk({}, task_completed=False)
    fake.calls.wait_for_result.return_value = bound_payload({
        "status": "completed",
        "task_completed": False,
        "structured_result": {
            "outcome": "no_answer",
            "interest_level": "unknown",
            "summary": "The recipient did not answer.",
            "next_action": "Retry the call later.",
        },
        "recipients": [{
            "status": "completed",
            "structured_result": None,
        }],
    })

    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)

    assert parsed.outcome == "no_answer"
    assert parsed.provider_status == "completed"
    assert parsed.outcome_kind is CallOutcomeKind.BUSINESS


def test_failed_declined_call_uses_aggregate_no_answer_result():
    """A declined call can have status=failed but still provide no_answer evidence."""

    fake = sdk({}, status="failed", task_completed=False)
    fake.calls.wait_for_result.return_value = bound_payload({
        "id": "call-b7r1WPAheNhASNYx7rcQzA",
        "status": "failed",
        "task_completed": False,
        "structured_result": {
            "outcome": "no_answer",
            "interest_level": "unknown",
            "summary": "The call did not connect and no conversation occurred.",
            "next_action": "Retry the quote follow-up call later.",
        },
        "failure_code": "call_failed",
        "failure_message": "calling task status=DECLINED (Hangup by: user)",
        "recipients": [{
            "status": "failed",
            "structured_result": None,
            "attempts": [{
                "status": "failed",
                "failure_code": None,
            }],
        }],
    })

    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)

    assert parsed.outcome == "unknown"
    assert parsed.provider_status == "failed"
    assert parsed.outcome_kind is CallOutcomeKind.BUSINESS


def test_failure_message_declined_text_is_not_a_business_signal():
    fake = sdk({}, status="failed", task_completed=False)
    fake.calls.wait_for_result.return_value = bound_payload({
        "status": "failed",
        "failure_code": "call_failed",
        "failure_message": "calling task status=DECLINED (Hangup by: user)",
    })

    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)

    assert parsed.call_id == "call-1"
    assert parsed.outcome == "call_not_established"
    assert parsed.outcome_kind is CallOutcomeKind.BUSINESS


def test_structured_text_preserves_line_breaks():
    result = valid_result()
    result["summary"] = "First line.\r\nSecond line."
    result["next_action"] = "Call back.\nAsk for the decision maker."

    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)

    assert parsed.summary == "First line.\nSecond line."
    assert parsed.next_action == "Call back.\nAsk for the decision maker."


def test_missing_task_completed_never_accepts_structured_interest():
    fake = sdk(valid_result())
    del fake.calls.wait_for_result.return_value["task_completed"]
    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "unknown"


@pytest.mark.parametrize("task_completed", ["true", 1, [], {}])
def test_invalid_task_completed_type_becomes_unknown_after_acceptance(task_completed):
    fake = sdk(valid_result())
    fake.calls.wait_for_result.return_value["task_completed"] = task_completed
    result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.call_id == "call-1"
    assert result.outcome == "unknown"


def test_missing_or_null_structured_result_becomes_unknown():
    for value in (None,):
        fake = sdk({}, task_completed=True)
        fake.calls.wait_for_result.return_value["structured_result"] = value
        parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
        assert parsed.outcome == "unknown"


def test_nested_no_answer_and_busy_codes_are_safe_business_outcomes():
    for code in ("no_answer", "busy"):
        fake = sdk({}, task_completed=True)
        fake.calls.wait_for_result.return_value = bound_payload({
            "status": "completed",
            "task_completed": True,
            "recipients": [{
                "status": "failed",
                "attempts": [{"status": "failed", "failure_code": code}],
            }],
        })
        parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
        assert parsed.outcome == code
        assert parsed.outcome_kind is CallOutcomeKind.BUSINESS


def test_explicit_nested_no_answer_overrides_false_task_evidence():
    fake = sdk({}, task_completed=False)
    fake.calls.wait_for_result.return_value = bound_payload({
        "status": "completed",
        "task_completed": False,
        "recipients": [{"attempts": [{"status": "no_answer"}]}],
    })
    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "no_answer"


def test_malformed_structured_result_becomes_unknown_even_when_task_not_completed():
    fake = sdk("not an object", task_completed=False)
    result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.call_id == "call-1"
    assert result.outcome == "unknown"


@pytest.mark.parametrize(
    "status", ["failed", "rejected", "declined", "canceled", "cancelled"]
)
def test_terminal_unconnected_statuses_become_call_not_established(status):
    result = CallEClient(execute=True, client=sdk({}, status=status)).execute(REQUEST, next_attempt=1)
    assert result.outcome == "call_not_established"
    assert result.outcome_kind is CallOutcomeKind.BUSINESS
    assert result.provider_status == status
    assert "human review" not in result.summary.lower()
    assert "review" not in result.next_action.lower()


def test_internal_call_not_established_is_not_accepted_from_agent_output():
    result = valid_result()
    result["outcome"] = "call_not_established"

    parsed = CallEClient(execute=True, client=sdk(result)).execute(REQUEST, next_attempt=1)

    assert parsed.outcome == "unknown"


def test_result_uses_recipient_and_last_attempt_statuses():
    fake = sdk({})
    fake.calls.wait_for_result.return_value = bound_payload({
        "status": "completed",
        "recipients": [{
            "status": "completed",
            "attempts": [{"status": "completed"}],
            "task_completed": True,
            "structured_result": valid_result(),
        }],
    })
    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "interested"


def test_result_accepts_singular_recipient_and_reports_nested_terminal_status():
    fake = sdk({})
    fake.calls.wait_for_result.return_value = bound_payload({
        "recipient": {
            "last_attempt": {
                "status": "succeeded",
                "task_completed": True,
                "structured_result": valid_result(),
            }
        }
    })
    parsed = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert parsed.outcome == "interested"
    assert parsed.provider_status == "completed"


def test_failure_classification_is_bounded_and_includes_http_status():
    cases = [
        (CalleAuthenticationError(code="unauthorized", message="secret", status_code=401), "auth", 401),
        (CalleRateLimitError(code="rate_limit_exceeded", message="slow down", status_code=429), "rate", 429),
        (CalleAPIError(code="insufficient_balance", message="low", status_code=402), "balance", 402),
        (CalleAPIError(code="invalid_recipient", message="bad", status_code=422), "recipient", 422),
        (CalleAPIError(code="policy_violation", message="blocked", status_code=403), "policy", 403),
        (CalleTimeoutError("slow"), "timeout", None),
        (CalleConnectionError("network"), "connection", None),
    ]
    for error, classification, status in cases:
        details = failure_details(error)
        assert details["classification"] == classification
        assert details["http_status"] == status
        assert details["reason"] not in str(error)


def test_local_call_error_does_not_use_arbitrary_message_as_reason():
    error = CallEError("provider returned token=secret phone=+14155550101")
    details = failure_details(error)
    assert details["reason"] == "provider_error"
    assert "secret" not in details["reason"]
    assert "+14155550101" not in details["reason"]


@pytest.mark.parametrize(
    ("code", "status", "classification"),
    [
        ("unauthorized", 401, "auth"),
        ("forbidden", 403, "auth"),
        ("policy_violation", 403, "policy"),
        ("recipient_blocked", 403, "policy"),
        ("insufficient_balance", 402, "balance"),
        ("rate_limit_exceeded", 429, "rate"),
        ("result_schema_invalid", 422, "schema"),
        ("recipient_result_schema_invalid", 422, "schema"),
        ("schema_override_not_allowed", 422, "schema"),
        ("variables_invalid", 422, "schema"),
        ("invalid_recipient", 422, "recipient"),
        ("invalid_phone", 422, "recipient"),
        ("no_recipients", 422, "recipient"),
        ("unsupported_region", 422, "recipient"),
        ("unsupported_language", 422, "recipient"),
        ("idempotency_conflict", 409, "idempotency"),
        ("provider_unavailable", 503, "provider"),
        ("internal_error", 500, "provider"),
        ("call_not_ready", 409, "provider"),
    ],
)
def test_create_api_errors_are_classified_without_retry_or_raw_diagnostics(code, status, classification, caplog):
    fake = sdk(valid_result())
    raw = f"token=secret phone={REQUEST.phone} provider detail {code}"
    fake.calls.create.side_effect = CalleAPIError(code=code, message=raw, status_code=status)
    caplog.set_level(logging.INFO, logger="quotewake_salesforce")
    with pytest.raises(CalleAPIError) as raised:
        CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    details = failure_details(raised.value)
    assert details["classification"] == classification
    assert details["http_status"] == status
    assert details["code"] == code
    assert "secret" not in details["reason"]
    assert REQUEST.phone not in details["reason"]
    assert fake.calls.create.call_count == 1
    fake.calls.wait_for_result.assert_not_called()
    records = [record for record in caplog.records if record.quotewake_event == "call_e_execution_failed"]
    assert records
    rendered = repr(records[-1].quotewake_fields)
    assert "secret" not in rendered
    assert REQUEST.phone not in rendered


@pytest.mark.parametrize("error", [CalleTimeoutError("secret timeout"), CalleConnectionError("secret network")])
def test_ambiguous_create_errors_preserve_key_and_do_not_retry(error):
    fake = sdk(valid_result())
    fake.calls.create.side_effect = error
    client = CallEClient(execute=True, client=fake)
    with pytest.raises(type(error)) as raised:
        client.execute(REQUEST, next_attempt=2)
    expected = bound_key(attempt=2)
    assert failure_details(raised.value)["creation_unknown"] is True
    assert failure_details(raised.value)["idempotency_key"] == expected
    assert fake.calls.create.call_count == 1
    assert fake.calls.create.call_args.kwargs["idempotency_key"] == expected


def test_create_without_call_id_is_ambiguous_and_replay_key_is_stable():
    first = sdk(valid_result())
    first.calls.create.return_value = {"status": "accepted"}
    first_client = CallEClient(execute=True, client=first)
    with pytest.raises(CallEError) as raised:
        first_client.execute(REQUEST, next_attempt=2, retry_marker=datetime(2026, 8, 12, tzinfo=timezone.utc))
    marker = datetime(2026, 8, 12, tzinfo=timezone.utc)
    key = bound_key(attempt=2, marker=marker)
    assert failure_details(raised.value)["creation_unknown"] is True
    assert failure_details(raised.value)["idempotency_key"] == key

    second = sdk(valid_result())
    second.calls.create.return_value = {"status": "accepted"}
    with pytest.raises(CallEError):
        CallEClient(execute=True, client=second).execute(REQUEST, next_attempt=2, retry_marker=datetime(2026, 8, 12, tzinfo=timezone.utc))
    assert first.calls.create.call_args.kwargs["idempotency_key"] == second.calls.create.call_args.kwargs["idempotency_key"] == key


def test_call_not_ready_http_4xx_is_deterministic_and_has_no_reconciliation_guidance():
    fake = sdk(valid_result())
    fake.calls.create.side_effect = CalleAPIError(
        code="call_not_ready",
        message="provider details include token=secret and phone=" + REQUEST.phone,
        status_code=422,
    )
    with pytest.raises(CalleAPIError) as raised:
        CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    details = failure_details(raised.value)
    assert details["classification"] == "provider"
    assert details["code"] == "call_not_ready"
    assert details["reason"] == "call_not_ready"
    assert details["http_status"] == 422
    assert details["creation_unknown"] is False
    assert fake.calls.create.call_count == 1
    assert fake.calls.wait_for_result.call_count == 0


def test_provider_http_5xx_create_is_ambiguous_and_preserves_same_key():
    fake = sdk(valid_result())
    fake.calls.create.side_effect = CalleAPIError(
        code="provider_unavailable", message="temporary outage", status_code=503
    )
    with pytest.raises(CalleAPIError) as raised:
        CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    details = failure_details(raised.value)
    assert details["creation_unknown"] is True
    assert details["idempotency_key"] == bound_key()


def test_wait_http_4xx_is_deterministic_after_confirmed_creation():
    fake = sdk(valid_result())
    fake.calls.wait_for_result.side_effect = CalleAPIError(
        code="call_not_ready", message="not ready", status_code=422
    )
    result = CallEClient(execute=True, client=fake).execute(REQUEST, next_attempt=1)
    assert result.call_id == "call-1"
    assert result.outcome == "unknown"
    assert result.outcome_kind is CallOutcomeKind.BUSINESS


def test_sdk_owned_client_is_closed_but_injected_client_is_not():
    injected = sdk(valid_result())
    client = CallEClient(execute=True, client=injected)
    client.close()
    assert not injected.close.called


@pytest.mark.parametrize("base_url", [
    "http://api.heycall-e.com",
    "https://api.heycall-e.com/v1",
    "https://user:pass@api.heycall-e.com",
    "https://api.heycall-e.com?token=secret",
    "https://example.invalid",
])
def test_untrusted_base_url_is_rejected_before_sdk_creation(base_url):
    with pytest.raises(ValueError):
        CallEClient(base_url=base_url)
