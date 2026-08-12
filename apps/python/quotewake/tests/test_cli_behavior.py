from datetime import date, datetime, timezone
from decimal import Decimal
import logging
from unittest.mock import Mock, patch

import pytest

from quotewake_salesforce.cli import main
from quotewake_salesforce.config import EnvironmentSettings, LoggingSettings, RegionalSettings
from quotewake_salesforce.domain.models import CallOutcomeKind, CallResult, ContactTarget, QuoteCandidate
from quotewake_salesforce.domain.policy import FollowUpPolicies, InitialFollowUpTiming, RetryPolicy


def quote(identifier):
    return QuoteCandidate(identifier, "Demo", "Presented", Decimal("10"), "EUR", date(2026, 12, 1), datetime(2026, 8, 1, tzinfo=timezone.utc), "006000000000001", "Opportunity", "Account", False, True, None, None, 0, account_billing_country_code="ES")


def setup():
    env = EnvironmentSettings("https://salesforce.invalid", "id", "secret", "61.0", "calle-key")
    regional = RegionalSettings.from_values("UTC", "en_US")
    timing = InitialFollowUpTiming(__import__("datetime").timedelta(0), __import__("datetime").timedelta(0), __import__("datetime").timedelta(0))
    retry = RetryPolicy(3, (__import__("datetime").timedelta(days=1), __import__("datetime").timedelta(days=2)), frozenset({"no_answer"}), __import__("datetime").timedelta(minutes=5), frozenset({"interested"}))
    policies = FollowUpPolicies(retry)
    fake_sf = Mock()
    repository = Mock()
    repository.validate_schema.return_value = ({"Status": {"picklistValues": [{"value": "Presented"}]}}, {})
    repository.load_organization_regional_settings.return_value = regional
    repository.load.return_value = ([quote("0Q0000000000001")], {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]})
    repository.load_quote_lines.return_value = {}
    return env, regional, timing, policies, fake_sf, repository


def test_default_run_plans_without_call_or_write():
    env, regional, timing, policies, fake_sf, repository = setup()
    fake_calle = Mock()
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient", return_value=fake_calle):
        assert main([]) == 0
    fake_calle.preview.assert_called_once()
    fake_sf.composite_write.assert_not_called()


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


def test_max_calls_limits_execute_without_processing_deferred_quotes():
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


def test_show_prompt_respects_limit_without_constructing_calle(capsys):
    env, regional, timing, policies, fake_sf, repository = setup()
    repository.load_organization_regional_settings.return_value = regional
    repository.load.return_value = ([quote("0Q0000000000001"), quote("0Q0000000000002")], {"006000000000001": [ContactTarget("003000000000001", "Contact", "+14155550101", False, "en-US")]})
    with patch("quotewake_salesforce.cli.load_environment", return_value=env), patch("quotewake_salesforce.cli.load_initial_follow_up_timing", return_value=timing), patch("quotewake_salesforce.cli.load_follow_up_policies", return_value=policies), patch("quotewake_salesforce.cli.SalesforceClient", return_value=fake_sf), patch("quotewake_salesforce.cli.QuoteRepository", return_value=repository), patch("quotewake_salesforce.cli.CallEClient") as calle_class:
        assert main(["--show-prompt", "--max-calls", "1"]) == 0
    rendered = capsys.readouterr().out
    assert "Quote 0Q0000000000001 prompt:" in rendered
    assert "Quote 0Q0000000000002 prompt:" not in rendered
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
