from dataclasses import replace
from datetime import date, datetime, timezone
from decimal import Decimal
import logging
from unittest.mock import Mock, patch

import pytest

from quotewake_salesforce.calle.client import CallEError
from quotewake_salesforce.cli import _call_error_message, _task_description, main
from quotewake_salesforce.config import EnvironmentSettings, LoggingSettings, RegionalSettings
from quotewake_salesforce.domain.models import CallOutcomeKind, CallResult, ContactTarget, QuoteCandidate
from quotewake_salesforce.domain.policy import FollowUpPolicies, InitialFollowUpTiming, RetryPolicy
from quotewake_salesforce.structured_logging import log_event


def quote(identifier):
    return QuoteCandidate(identifier, "Demo", "Presented", Decimal("10"), "EUR", date(2026, 12, 1), datetime(2026, 8, 1, tzinfo=timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0, account_billing_country_code="ES")


def setup():
    env = EnvironmentSettings("https://salesforce.invalid", "id", "secret", "61.0", "calle-key")
    regional = RegionalSettings.from_values("UTC", "en_US")
    timing = InitialFollowUpTiming(__import__("datetime").timedelta(0), __import__("datetime").timedelta(0), __import__("datetime").timedelta(0))
    retry = RetryPolicy(3, (__import__("datetime").timedelta(days=1), __import__("datetime").timedelta(days=2)), frozenset({"no_answer", "call_back_later", "call_not_established", "busy"}), __import__("datetime").timedelta(minutes=5), frozenset({"interested"}))
    policies = FollowUpPolicies(retry)
    fake_sf = Mock()
    repository = Mock()
    repository.validate_schema.return_value = ({"Status": {"picklistValues": [{"value": "Presented"}]}}, {})
    repository.load_organization_regional_settings.return_value = regional
    repository.load.return_value = ([quote("0Q0000000000001")], {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]})
    repository.load_quote_lines.return_value = {}
    return env, regional, timing, policies, fake_sf, repository


def test_task_description_is_multiline_and_keeps_result_line_breaks():
    result = CallResult(
        "0Q0000000000001", "call-1", "completed", "no_answer", "unknown", None,
        "Recipient did not answer.\nNo voicemail was left.",
        "Retry tomorrow.\nUse the same quote context.", None,
        CallOutcomeKind.BUSINESS, datetime(2026, 8, 13, tzinfo=timezone.utc),
    )

    description = _task_description(result)

    assert "Summary:\nRecipient did not answer.\nNo voicemail was left." in description
    assert "Next action:\nRetry tomorrow.\nUse the same quote context." in description
    assert "CALL-E call ID:\ncall-1" in description


def test_default_run_plans_without_call_or_write():
    env, regional, timing, policies, fake_sf, repository = setup()
    fake_calle = Mock()
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main([]) == 0
    fake_calle.preview.assert_called_once()
    fake_sf.composite_write.assert_not_called()


def test_cli_passes_configured_call_wait_timeout_to_calle():
    env, regional, timing, policies, fake_sf, repository = setup()
    fake_calle = Mock()
    prompt_settings = Mock(wait_timeout_seconds=37)
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_call_prompt", return_value=prompt_settings), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle) as calle_class:
        assert main([]) == 0
    assert calle_class.call_args.kwargs["timeout_seconds"] == 37


def test_cli_passes_idempotency_suffix_to_calle():
    env, regional, timing, policies, fake_sf, repository = setup()
    fake_calle = Mock()
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle) as calle_class:
        assert main(["--idempotency-suffix", "test-02"]) == 0
    assert calle_class.call_args.kwargs["idempotency_suffix"] == "test-02"


@pytest.mark.parametrize("value", ["", "_invalid", "a" * 33])
def test_cli_rejects_invalid_idempotency_suffix(value):
    with pytest.raises(SystemExit):
        main(["--idempotency-suffix", value])


def test_run_finished_is_last_event_after_calle_close(caplog):
    env, regional, timing, policies, fake_sf, repository = setup()

    class FakeCallE:
        def preview(self, request, *, next_attempt, retry_marker=None):
            return {"idempotency_key": "quotewake-test-1"}

        def close(self):
            log_event("call_e_client_closed", level=logging.INFO, service="call_e")

    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    try:
        with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=FakeCallE()):
            assert main([]) == 0
    finally:
        logger.removeHandler(caplog.handler)

    events = [record for record in caplog.records if hasattr(record, "quotewake_event")]
    assert events[-1].quotewake_event == "run_finished"
    assert events[-2].quotewake_event == "call_e_client_closed"
    fields = events[-1].quotewake_fields
    assert fields["mode"] == "dry_run"
    assert fields["exit_code"] == 0
    assert fields["evaluated"] == 1
    assert fields["failures"] == 0
    assert isinstance(fields["elapsed_ms"], (int, float))


def test_max_calls_limits_dry_run_in_salesforce_order():
    env, regional, timing, policies, fake_sf, repository = setup()
    repository.load_organization_regional_settings.return_value = regional
    repository.load.return_value = ([quote(f"0Q000000000000{i}") for i in range(1, 4)], {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]})
    fake_calle = Mock()
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--max-calls", "1"]) == 0
    assert fake_calle.preview.call_count == 1
    repository.load_quote_lines.assert_called_once_with(["0Q0000000000001"])


@pytest.mark.parametrize("value", ["0", "-1"])
def test_max_calls_requires_positive_integer(value):
    with pytest.raises(SystemExit):
        main(["--max-calls", value])


def test_regional_call_overrides_are_removed_from_cli():
    with pytest.raises(SystemExit):
        main(["--call-locale", "en-US"])
    with pytest.raises(SystemExit):
        main(["--call-region", "ES"])


def test_max_calls_limits_execute_without_processing_deferred_quotes(capsys):
    env, regional, timing, policies, fake_sf, repository = setup()
    repository.load_organization_regional_settings.return_value = regional
    repository.load.return_value = ([quote("0Q0000000000001"), quote("0Q0000000000002")], {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]})
    result = CallResult("0Q0000000000001", "call-1", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc))
    fake_calle = Mock()
    fake_calle.execute.return_value = result
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute", "--max-calls", "1"]) == 0
    fake_calle.execute.assert_called_once()
    fake_sf.composite_write.assert_called_once()
    output = capsys.readouterr().out
    assert "Call results:" in output
    assert (
            "Quote 0Q0…0001: Demo | €10.00 | CALLED (interested)"
        in output
    )
    assert "0Q0000000000002: Demo | €10.00 | CALLED" not in output


def test_max_calls_prefers_oldest_actionable_follow_up():
    env, regional, timing, policies, fake_sf, repository = setup()
    old_initial = replace(
        quote("0Q0000000000001"),
        last_modified_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    newer_initial = replace(
        quote("0Q0000000000002"),
        last_modified_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
    )
    old_retry = replace(
        quote("0Q0000000000003"),
        follow_up_status="Retry",
        next_follow_up_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        last_modified_at=datetime(2026, 8, 2, tzinfo=timezone.utc),
    )
    repository.load.return_value = (
        [newer_initial, old_initial, old_retry],
        {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]},
    )
    fake_calle = Mock()
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--max-calls", "1"]) == 0
    fake_calle.preview.assert_called_once()
    assert fake_calle.preview.call_args.args[0].quote_id == old_retry.quote_id


def test_accepted_unknown_result_is_persisted_and_consumes_attempt(capsys):
    env, regional, timing, policies, fake_sf, repository = setup()
    result = CallResult(
        "0Q0000000000001",
        "call-unknown",
        "failed",
        "unknown",
        "unknown",
        None,
        "CALL-E result unavailable (timeout/provider_error).",
        "Have a salesperson review the call evidence before taking action.",
        None,
        CallOutcomeKind.BUSINESS,
        datetime.now(timezone.utc),
    )
    fake_calle = Mock()
    fake_calle.execute.return_value = result

    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute"]) == 0

    update = fake_sf.composite_write.call_args.args[2]
    assert update.attempt_count == 1
    assert update.follow_up_status == "Stopped"
    assert fake_sf.composite_write.call_args.args[3].call_id == "call-unknown"
    assert "ATTEMPTED (unknown)" in capsys.readouterr().out


@pytest.mark.parametrize(
    "outcome",
    ["call_not_established", "no_answer", "busy", "call_back_later"],
)
def test_last_retryable_attempt_persists_salesperson_action_without_mutating_result(
    outcome,
):
    env, regional, timing, policies, fake_sf, repository = setup()
    repository.load.return_value = (
        [replace(quote("0Q0000000000001"), attempt_count=2)],
        {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]},
    )
    original_action = f"Provider action for {outcome}."
    result = CallResult(
        "0Q0000000000001",
        "call-final",
        "completed",
        outcome,
        "unknown",
        None,
        "summary",
        original_action,
        None,
        CallOutcomeKind.BUSINESS,
        datetime.now(timezone.utc),
    )
    fake_calle = Mock()
    fake_calle.execute.return_value = result

    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute"]) == 0

    persisted = fake_sf.composite_write.call_args
    assert persisted.args[2].follow_up_status == "Stopped"
    assert persisted.args[3] is result
    assert result.next_action == original_action
    assert (
        "Next action:\nQuoteWake will make no further attempts. "
        "A salesperson should call the customer directly."
        in persisted.kwargs["task_description"]
    )


@pytest.mark.parametrize(
    "outcome",
    ["call_not_established", "no_answer", "busy", "call_back_later"],
)
def test_retryable_outcome_before_limit_keeps_original_task_action(outcome):
    env, regional, timing, policies, fake_sf, repository = setup()
    original_action = f"Retry action for {outcome}."
    result = CallResult(
        "0Q0000000000001", "call-retry", "completed", outcome, "unknown",
        None, "summary", original_action, None, CallOutcomeKind.BUSINESS,
        datetime.now(timezone.utc),
    )
    fake_calle = Mock()
    fake_calle.execute.return_value = result

    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute"]) == 0

    persisted = fake_sf.composite_write.call_args
    assert persisted.args[2].follow_up_status == "Retry"
    assert f"Next action:\n{original_action}" in persisted.kwargs["task_description"]
    assert persisted.args[3] is result


def test_no_answer_summary_is_labeled_as_attempted_not_answered(capsys):
    env, regional, timing, policies, fake_sf, repository = setup()
    result = CallResult(
        "0Q0000000000001", "call-no-answer", "completed", "no_answer", "unknown",
        None, "No answer.", "Retry later.", None, CallOutcomeKind.BUSINESS,
        datetime.now(timezone.utc),
    )
    fake_calle = Mock()
    fake_calle.execute.return_value = result
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute"]) == 0
    output = capsys.readouterr().out
    assert "ATTEMPTED (no_answer)" in output
    assert "CALLED (no_answer)" not in output


def test_non_retryable_outcome_keeps_original_task_action_when_stopped():
    env, regional, timing, policies, fake_sf, repository = setup()
    result = CallResult(
        "0Q0000000000001", "call-stop", "completed", "not_interested", "low",
        None, "summary", "Do not contact again.", None,
        CallOutcomeKind.BUSINESS, datetime.now(timezone.utc),
    )
    fake_calle = Mock()
    fake_calle.execute.return_value = result

    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute"]) == 0

    persisted = fake_sf.composite_write.call_args
    assert persisted.args[2].follow_up_status == "Stopped"
    assert "Next action:\nDo not contact again." in persisted.kwargs["task_description"]
    assert persisted.args[3] is result


def test_create_failure_without_call_id_is_not_persisted():
    env, regional, timing, policies, fake_sf, repository = setup()
    fake_calle = Mock()
    fake_calle.execute.side_effect = CallEError(
        "provider details are intentionally not exposed",
        code="missing_call_id",
        reason="create_outcome_unknown",
        creation_unknown=True,
        idempotency_key="quotewake-0Q0000000000001-1",
        phase="create",
    )

    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute"]) == 1

    fake_sf.composite_write.assert_not_called()


def test_show_prompt_respects_limit_without_constructing_calle(capsys):
    env, regional, timing, policies, fake_sf, repository = setup()
    repository.load_organization_regional_settings.return_value = regional
    repository.load.return_value = ([quote("0Q0000000000001"), quote("0Q0000000000002")], {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]})
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient") as calle_class:
        assert main(["--show-prompt", "--max-calls", "1"]) == 0
    rendered = capsys.readouterr().out
    assert "Quote 0Q0…0001 prompt:" in rendered
    assert "Quote 0Q0…0002 prompt:" not in rendered
    assert "deferred by limit: 1" in rendered
    repository.load_quote_lines.assert_called_once_with(["0Q0000000000001"])
    calle_class.assert_not_called()
    fake_sf.composite_write.assert_not_called()


def test_show_prompt_and_execute_are_parser_incompatible():
    with pytest.raises(SystemExit):
        main(["--show-prompt", "--execute"])


def test_execute_continues_after_one_quote_error_and_returns_nonzero():
    env, regional, timing, policies, fake_sf, repository = setup()
    repository.load_organization_regional_settings.return_value = regional
    repository.load.return_value = ([quote("0Q0000000000001"), quote("0Q0000000000002")], {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]})
    result = CallResult("0Q0000000000002", "call-2", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc))
    fake_calle = Mock()
    fake_calle.execute.side_effect = [RuntimeError("first failure"), result]
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main(["--execute"]) == 1
    assert fake_calle.execute.call_count == 2
    fake_sf.composite_write.assert_called_once()


def test_execute_aborts_remaining_calls_when_persistence_fails(caplog):
    env, regional, timing, policies, fake_sf, repository = setup()
    repository.load.return_value = (
        [quote("0Q0000000000001"), quote("0Q0000000000002")],
        {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]},
    )
    results = [
        CallResult("0Q0000000000001", "call-1", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc)),
        CallResult("0Q0000000000002", "call-2", "completed", "interested", "high", None, "summary", "next", None, CallOutcomeKind.BUSINESS, datetime.now(timezone.utc)),
    ]
    fake_calle = Mock()
    fake_calle.execute.side_effect = results
    fake_sf.composite_write.side_effect = RuntimeError("raw persistence response")
    logger = logging.getLogger("quotewake_salesforce")
    logger.addHandler(caplog.handler)
    try:
        with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
            assert main(["--execute"]) == 1
    finally:
        logger.removeHandler(caplog.handler)
    assert fake_calle.execute.call_count == 1
    fake_sf.composite_write.assert_called_once()
    failure = next(record for record in caplog.records if record.quotewake_event == "quote_persist_failed")
    assert failure.quotewake_fields["quote_id"] == "0Q0000000000001"
    assert failure.quotewake_fields["call_id"] == "call-1"
    assert failure.quotewake_fields["phase"] == "persist"
    assert "raw persistence response" not in repr(failure.quotewake_fields)


def test_cli_error_message_is_actionable_but_does_not_echo_provider_data():
    error = CallEError(
        "provider returned token=secret phone=+14155550101",
        classification="provider",
        http_status=503,
        code="provider_unavailable",
        reason="provider_unavailable",
        creation_unknown=True,
        idempotency_key="quotewake-0Q0000000000001-1",
    )
    message = _call_error_message(error)
    assert "classification=provider" in message
    assert "http_status=503" in message
    assert "provider_unavailable" in message
    assert "same idempotency key" in message
    assert "secret" not in message
    assert "+14155550101" not in message


def test_cli_call_not_ready_message_is_actionable_without_reconciliation_warning():
    error = CallEError(
        "provider returned token=secret phone=+14155550101",
        classification="provider",
        http_status=422,
        code="call_not_ready",
        reason="call_not_ready",
        creation_unknown=False,
    )
    message = _call_error_message(error)
    assert "call_not_ready" in message
    assert "Review CALL-E task, recipient, locale, and region readiness" in message
    assert "Creation outcome is unknown" not in message
    assert "secret" not in message
    assert "+14155550101" not in message


def test_cli_wait_result_unknown_reconciles_call_without_replaying_creation():
    error = CallEError(
        "provider timeout with token=secret",
        classification="timeout",
        code="provider_error",
        reason="timeout",
        creation_unknown=False,
        result_unknown=True,
        provider_call_id="call-123",
        phase="wait",
    )
    message = _call_error_message(error)
    assert message.endswith(
        "CALL-E accepted call cal…-123, terminal result is unknown; "
        "reconcile this call before any new attempt."
    )
    assert "same idempotency key" not in message
    assert "token=secret" not in message
