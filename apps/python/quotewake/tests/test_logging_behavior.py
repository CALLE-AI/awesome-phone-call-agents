import io
import logging
import sys
from unittest.mock import Mock

import httpx
import pytest

from calle.errors import CalleAPIError, CalleTimeoutError

from quotewake_salesforce.calle.client import CallEClient, idempotency_key, operation_binding_digest, request_metadata, result_schema
from quotewake_salesforce.domain.models import CallRequest
from quotewake_salesforce.salesforce.client import SalesforceClient, SalesforceQueryError, _safe_route
from quotewake_salesforce.structured_logging import (
    _ReadableFormatter,
    _mask_identifier,
    _redact_log_value,
    configure_logging,
    log_event,
)


REQUEST = CallRequest(
    "0Q0000000000001",
    "006000000000001",
    "003000000000001",
    "+14155550101",
    "Call task contains customer details.",
    "es-ES",
    "ES",
)


def _records_at(caplog, level=logging.DEBUG):
    return [record for record in caplog.records if record.levelno == level]


def _capture_app_logs(caplog, level):
    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    logger.setLevel(level)
    logger.propagate = False
    return logger


def bound_payload(payload):
    digest = operation_binding_digest(REQUEST, next_attempt=1)
    evidence = {
        "id": "call-1",
        "task": REQUEST.goal,
        "recipient": {"phones": [REQUEST.phone], "locale": REQUEST.locale, "region": REQUEST.region},
        "result_schema": result_schema(),
        "metadata": {**request_metadata(REQUEST), "quotewake_binding_digest": digest},
        "idempotency_key": idempotency_key(REQUEST.quote_id, 1, binding_digest=digest),
    }
    evidence.update(payload)
    return evidence


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        (
            "/services/data/v61.0/sobjects/Quote/0Q0000000000001",
            "/services/data/v{version}/sobjects/Quote/{id}",
        ),
        (
            "/services/data/v61.0/sobjects/Quote/0Q0000000000000123",
            "/services/data/v{version}/sobjects/Quote/{id}",
        ),
        (
            "/services/data/v61.0/sobjects/Custom__c/a01234567890123",
            "/services/data/v{version}/sobjects/Custom__c/{id}",
        ),
        (
            "/services/data/v61.0/sobjects/Custom__c/a01234567890123456",
            "/services/data/v{version}/sobjects/Custom__c/{id}",
        ),
        (
            "/services/data/v61.0/sobjects/CustomObjectName/describe",
            "/services/data/v{version}/sobjects/CustomObjectName/describe",
        ),
        (
            "/services/data/v61.0/sobjects/CustomObjectName/abcdefghijkl",
            "/services/data/v{version}/sobjects/CustomObjectName/abcdefghijkl",
        ),
    ],
)
def test_salesforce_route_masks_generic_record_ids_without_hiding_routes(path, expected):
    assert _safe_route(path) == expected


def test_structured_events_redact_phone_and_secret_values(caplog):
    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    try:
        log_event("safe_event", phone="+14155550101", api_key="super-secret")
    finally:
        logger.removeHandler(caplog.handler)
    rendered = repr([getattr(record, "quotewake_fields", {}) for record in caplog.records])
    assert "+14155550101" not in rendered
    assert "super-secret" not in rendered


def test_readable_logs_mask_quote_provider_and_idempotency_identifiers():
    assert _mask_identifier("0Q0bm0000033oTBCAY", key="quote_id") == "0Q0…BCAY"
    assert _mask_identifier("call_1iQ2hYGDnwvbiNCBui32Pw", key="call_id") == "cal…32Pw"
    assert _mask_identifier(
        "quotewake-0Q0bm0000033oTBCAY-1-d9de810d21eb-bc1a8d298e093326e443956a8eb1a4bbf",
        key="idempotency_key",
    ) == "quotewake-0Q0…BCAY-1-[digest-redacted]"


@pytest.mark.parametrize(
    "phone",
    [
        "+1-415-555-0101",
        "415 555 0101",
        "415.555.0101",
        "+34\u00a0910\u2011000\u2011001",
    ],
)
def test_free_text_phone_formats_with_common_separators_are_redacted(phone):
    redacted = _redact_log_value(
        "summary",
        f"CALL-E response mentioned {phone} in free text.",
        preserve_phone_fields=True,
    )

    assert phone not in redacted
    assert "[phone-redacted]" in redacted


def test_explicit_phone_fields_remain_available_for_raw_support_logs():
    payload = {
        "phone": "+34\u00a0910\u2011000\u2011001",
        "phones": ["415.555.0101"],
        "summary": "Reached +34\u00a0910\u2011000\u2011001 and 415.555.0101.",
    }

    redacted = _redact_log_value(
        "raw_payload",
        payload,
        preserve_phone_fields=True,
    )

    assert redacted["phone"] == "+34\u00a0910\u2011000\u2011001"
    assert redacted["phones"] == ["415.555.0101"]
    assert redacted["summary"] == (
        "Reached [phone-redacted] and [phone-redacted]."
    )


def test_phone_redaction_leaves_ordinary_dotted_and_hyphenated_text_unchanged():
    text = "Release 1.2.3 costs 910.00 EUR; quote ABC-123 remains open."

    assert _redact_log_value("summary", text, preserve_phone_fields=True) == text


@pytest.mark.parametrize(
    ("service", "tag"),
    [("salesforce", "[Salesforce]"), ("call_e", "[Call-E]"), (None, "[QuoteWake]")],
)
def test_text_logs_include_a_service_tag(service, tag):
    record = logging.LogRecord(
        "quotewake_salesforce",
        logging.INFO,
        __file__,
        1,
        "ignored",
        (),
        None,
    )
    record.quotewake_event = "sample_event"
    record.quotewake_fields = ({"service": service} if service else {})
    rendered = _ReadableFormatter(datefmt="%Y-%m-%d %H:%M:%S").format(record)
    assert f"[INFO] {tag} [sample_event]:" in rendered


@pytest.mark.parametrize(
    ("service", "tag", "color"),
    [
        ("salesforce", "[Salesforce]", "\x1b[94m"),
        ("call_e", "[Call-E]", "\x1b[92m"),
        (None, "[QuoteWake]", "\x1b[93m"),
    ],
)
def test_console_formatter_colors_only_the_service_tag(service, tag, color):
    record = logging.LogRecord(
        "quotewake_salesforce",
        logging.INFO,
        __file__,
        1,
        "ignored",
        (),
        None,
    )
    record.quotewake_event = "sample_event"
    record.quotewake_fields = ({"service": service} if service else {})

    rendered = _ReadableFormatter(
        datefmt="%Y-%m-%d %H:%M:%S", use_color=True
    ).format(record)

    colored_tag = f"{color}{tag}\x1b[0m"
    colored_event = f"{color}[sample_event]\x1b[0m"
    assert colored_tag in rendered
    assert colored_event in rendered
    assert rendered.count("\x1b[") == 4
    assert rendered.startswith("2026-")


class _FakeConsole(io.StringIO):
    def __init__(self, *, is_tty: bool):
        super().__init__()
        self._is_tty = is_tty

    def isatty(self):
        return self._is_tty


def _close_configured_logging_handlers():
    application_logger = logging.getLogger("quotewake_salesforce")
    for handler in list(application_logger.handlers):
        if getattr(handler, "_quotewake_managed", False):
            application_logger.removeHandler(handler)
            handler.close()


def test_configured_console_handler_colors_tty_and_keeps_file_plain(monkeypatch, tmp_path):
    console = _FakeConsole(is_tty=True)
    monkeypatch.setattr(sys, "stderr", console)
    monkeypatch.delenv("NO_COLOR", raising=False)

    configure_logging(log_directory=tmp_path)
    try:
        log_event("sample_event", service="salesforce")
        console_output = console.getvalue()
        file_output = (tmp_path / "quotewake.log").read_text(encoding="utf-8")
    finally:
        _close_configured_logging_handlers()

    assert "\x1b[94m[Salesforce]\x1b[0m \x1b[94m[sample_event]\x1b[0m" in console_output
    assert "\x1b[" not in file_output


@pytest.mark.parametrize(
    ("is_tty", "no_color"),
    [(False, False), (True, True)],
)
def test_configured_console_handler_stays_plain_when_not_color_capable(
    monkeypatch, tmp_path, is_tty, no_color
):
    console = _FakeConsole(is_tty=is_tty)
    monkeypatch.setattr(sys, "stderr", console)
    if no_color:
        monkeypatch.setenv("NO_COLOR", "1")
    else:
        monkeypatch.delenv("NO_COLOR", raising=False)

    configure_logging(log_directory=tmp_path)
    try:
        log_event("sample_event", service="call_e")
        console_output = console.getvalue()
    finally:
        _close_configured_logging_handlers()

    assert "\x1b[" not in console_output


def test_salesforce_debug_boundaries_are_safe_on_success(caplog):
    logger = _capture_app_logs(caplog, logging.DEBUG)
    try:
        def handler(request):
            if request.url.path.endswith("/token"):
                return httpx.Response(
                    200,
                    json={"access_token": "token-value", "instance_url": "https://instance.invalid"},
                )
            return httpx.Response(200, json={"records": [], "done": True})

        client = SalesforceClient(
            "https://login.invalid",
            "client-id",
            "client-secret",
            "61.0",
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        client.query("SELECT Phone FROM Contact WHERE Phone = '+14155550101'")
    finally:
        logger.removeHandler(caplog.handler)

    records = _records_at(caplog)
    assert [record.quotewake_event for record in records] == [
        "salesforce_request_started",
        "salesforce_response_received",
        "salesforce_request_started",
        "salesforce_response_received",
    ]
    assert {record.quotewake_fields["operation"] for record in records} == {"authenticate", "query"}
    for record in records:
        fields = record.quotewake_fields
        assert fields["service"] == "salesforce"
        assert fields["method"] in {"GET", "POST"}
        assert "?" not in fields["route"]
        assert "login.invalid" not in repr(fields)
        assert "SELECT Phone" not in repr(fields)
        assert "+14155550101" not in repr(fields)
        assert isinstance(fields["elapsed_ms"], (int, float))
    assert records[-1].quotewake_fields["http_status"] == 200


def test_salesforce_debug_response_boundary_is_bounded_on_error(caplog):
    logger = _capture_app_logs(caplog, logging.DEBUG)
    try:
        def handler(request):
            if request.url.path.endswith("/token"):
                return httpx.Response(
                    200,
                    json={"access_token": "token-value", "instance_url": "https://instance.invalid"},
                )
            return httpx.Response(
                500,
                json={
                    "errorCode": "SERVER_ERROR",
                    "message": "token=secret phone=+14155550101 raw provider details",
                },
            )

        client = SalesforceClient(
            "https://login.invalid",
            "client-id",
            "client-secret",
            "61.0",
            http_client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        with pytest.raises(SalesforceQueryError):
            client.query("SELECT Phone FROM Contact")
    finally:
        logger.removeHandler(caplog.handler)

    responses = [record for record in _records_at(caplog) if record.quotewake_event == "salesforce_response_received"]
    assert responses[-1].quotewake_fields["http_status"] == 500
    rendered = repr(responses[-1].quotewake_fields)
    assert "secret" not in rendered
    assert "+14155550101" not in rendered
    assert "raw provider details" not in rendered


def test_call_e_debug_boundaries_are_safe_on_success(caplog):
    logger = _capture_app_logs(caplog, logging.DEBUG)
    try:
        calls = Mock()
        calls.create.return_value = {"id": "call-1", "status": "accepted"}
        calls.wait_for_result.return_value = bound_payload({
            "status": "completed",
            "task_completed": True,
            "structured_result": {
                "outcome": "interested",
                "interest_level": "high",
                "summary": "Customer wants a follow-up.",
                "next_action": "Salesperson calls.",
            },
        })
        result = CallEClient(execute=True, client=Mock(calls=calls)).execute(REQUEST, next_attempt=1)
        assert result.outcome == "interested"
    finally:
        logger.removeHandler(caplog.handler)

    records = _records_at(caplog)
    assert [record.quotewake_event for record in records] == [
        "call_e_create_started",
        "call_e_create_finished",
        "call_e_wait_started",
        "call_e_wait_finished",
    ]
    assert {record.quotewake_fields["operation"] for record in records} == {
        "calls.create",
        "calls.wait_for_result",
    }
    for record in records:
        fields = record.quotewake_fields
        rendered = repr(fields)
        assert fields["service"] == "call_e"
        assert fields["phase"] in {"create", "wait"}
        assert fields["quote_id"] == REQUEST.quote_id
        digest = operation_binding_digest(REQUEST, next_attempt=1)
        assert fields["idempotency_key"] == idempotency_key(
            REQUEST.quote_id, 1, binding_digest=digest
        )
        if fields["phase"] == "wait":
            assert fields["aggregate"] is True
        assert "Call task contains customer details" not in rendered
        assert REQUEST.phone not in rendered
        assert "structured_result" not in rendered
        assert isinstance(fields["elapsed_ms"], (int, float))


def test_call_e_wait_boundary_records_configured_timeout_and_timeout_error_type(caplog):
    logger = _capture_app_logs(caplog, logging.DEBUG)
    try:
        calls = Mock()
        calls.create.return_value = {"id": "call-1", "status": "accepted"}
        calls.wait_for_result.side_effect = CalleTimeoutError("provider timeout")
        result = CallEClient(
            execute=True,
            timeout_seconds=60,
            client=Mock(calls=calls),
        ).execute(REQUEST, next_attempt=1)
        assert result.outcome == "unknown"
    finally:
        logger.removeHandler(caplog.handler)

    started = next(
        record for record in caplog.records if record.quotewake_event == "call_e_wait_started"
    )
    assert started.quotewake_fields["timeout_seconds"] == 60
    failed = next(
        record for record in caplog.records if record.quotewake_event == "call_e_wait_finished"
    )
    assert failed.quotewake_fields["timeout_seconds"] == 60
    assert failed.quotewake_fields["error_type"] == "CalleTimeoutError"
    wait_failure = next(
        record for record in caplog.records if record.quotewake_event == "call_e_wait_failed"
    )
    assert wait_failure.quotewake_fields["reason"] == "timeout"


def test_call_e_opt_in_raw_logs_are_redacted_and_keep_support_structure(caplog):
    logger = _capture_app_logs(caplog, logging.DEBUG)
    try:
        calls = Mock()
        calls.create.return_value = {
            "id": "call-1",
            "status": "accepted",
            "headers": {"Authorization": "Bearer api-secret-value"},
        }
        calls.wait_for_result.return_value = bound_payload({
            "status": "failed",
            "failure_code": "call_not_ready",
            "task_completed": False,
            "structured_result": {
                "summary": (
                    "Call +1-415-555-0101, 415 555 0101, 415.555.0101, "
                    "or +34\u00a0910\u2011000\u2011001"
                )
            },
            "api_key": "api-secret-value",
        })
        result = CallEClient(
            execute=True,
            raw_calle_api=True,
            client=Mock(calls=calls),
        ).execute(REQUEST, next_attempt=1)
        assert result.outcome == "call_not_established"
    finally:
        logger.removeHandler(caplog.handler)

    raw_records = [
        record for record in caplog.records if record.quotewake_event.startswith("call_e_raw_")
    ]
    assert [record.quotewake_event for record in raw_records] == [
        "call_e_raw_request",
        "call_e_raw_response",
        "call_e_raw_request",
        "call_e_raw_response",
    ]
    rendered = repr([record.quotewake_fields for record in raw_records])
    assert "Call task contains customer details." in rendered
    assert "result_schema" in rendered
    assert "call_not_ready" in rendered
    request_record = next(
        record
        for record in raw_records
        if record.quotewake_event == "call_e_raw_request"
        and record.quotewake_fields["operation"] == "calls.create"
    )
    response_record = next(
        record
        for record in raw_records
        if record.quotewake_event == "call_e_raw_response"
        and record.quotewake_fields["operation"] == "calls.wait_for_result"
    )
    assert "+14155550101" in repr(request_record.quotewake_fields)
    response_rendered = repr(response_record.quotewake_fields)
    assert "+1-415-555-0101" not in response_rendered
    assert "415 555 0101" not in response_rendered
    assert "415.555.0101" not in response_rendered
    response_summary = response_record.quotewake_fields["raw_payload"][
        "structured_result"
    ]["summary"]
    assert response_summary == (
        "Call [phone-redacted], [phone-redacted], [phone-redacted], "
        "or [phone-redacted]"
    )
    assert "[phone-redacted]" in response_rendered
    assert "api-secret-value" not in rendered
    assert "Authorization" not in rendered
    assert "headers" not in rendered
    assert "api_key" not in rendered


def test_call_e_raw_logs_are_disabled_by_default_and_at_info(caplog):
    for raw_enabled, level in ((False, logging.DEBUG), (True, logging.INFO)):
        logger = _capture_app_logs(caplog, level)
        try:
            calls = Mock()
            calls.create.return_value = {"id": "call-1", "status": "accepted"}
            calls.wait_for_result.return_value = bound_payload({
                "status": "failed",
                "failure_code": "call_not_ready",
            })
            CallEClient(
                execute=True,
                raw_calle_api=raw_enabled,
                client=Mock(calls=calls),
            ).execute(REQUEST, next_attempt=1)
        finally:
            logger.removeHandler(caplog.handler)
    assert not [
        record for record in caplog.records if record.quotewake_event.startswith("call_e_raw_")
    ]
    assert all(
        REQUEST.phone not in repr(getattr(record, "quotewake_fields", {}))
        for record in caplog.records
    )


def test_call_e_debug_boundary_is_bounded_on_create_error(caplog):
    logger = _capture_app_logs(caplog, logging.DEBUG)
    try:
        calls = Mock()
        calls.create.side_effect = CalleAPIError(
            code="provider_unavailable",
            message="secret=do-not-log phone=+14155550101 raw body",
            status_code=503,
        )
        with pytest.raises(CalleAPIError):
            CallEClient(execute=True, client=Mock(calls=calls)).execute(REQUEST, next_attempt=1)
    finally:
        logger.removeHandler(caplog.handler)

    records = _records_at(caplog)
    finished = [record for record in records if record.quotewake_event == "call_e_create_finished"]
    assert len(finished) == 1
    fields = finished[0].quotewake_fields
    assert fields["http_status"] == 503
    rendered = repr(fields)
    assert "do-not-log" not in rendered
    assert REQUEST.phone not in rendered
    assert "raw body" not in rendered
    assert not [record for record in records if record.quotewake_event.startswith("call_e_wait_")]


def test_info_logging_filters_call_e_debug_boundaries(caplog):
    logger = _capture_app_logs(caplog, logging.INFO)
    try:
        calls = Mock()
        calls.create.return_value = {"id": "call-1", "status": "accepted"}
        calls.wait_for_result.return_value = bound_payload({
            "status": "failed",
            "task_completed": False,
        })
        CallEClient(execute=True, client=Mock(calls=calls)).execute(REQUEST, next_attempt=1)
    finally:
        logger.removeHandler(caplog.handler)

    assert not _records_at(caplog, logging.DEBUG)
