from dataclasses import FrozenInstanceError
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from quotewake_salesforce.domain.models import (
    CallOutcomeKind,
    CallResult,
    ContactTarget,
    SelectionDecision,
    SelectionReason,
    SelectionResult,
    QuoteCandidate,
)
from quotewake_salesforce.domain.call_request import build_call_request
from quotewake_salesforce.config import CallPromptSettings
from quotewake_salesforce.domain.policy import (
    FollowUpPolicies,
    InitialFollowUpTiming,
    RetryPolicy,
    calculate_next_follow_up,
    SelectionPolicy,
)
from quotewake_salesforce.domain.selection import evaluate_quote, validate_callable_contact
from quotewake_salesforce.phone import mask_phone, normalize_phone


def quote(**changes):
    values = dict(
        quote_id="0Q0000000000001", quote_name="Demo", quote_status="Presented",
        amount=Decimal("10"), currency_code="EUR", expiration_date=date(2026, 9, 1),
        last_modified_at=datetime(2026, 8, 1, tzinfo=timezone.utc), opportunity_id="006000000000001",
        opportunity_name="Opportunity", account_name="Account", opportunity_is_closed=False,
        enabled=True, follow_up_status=None, next_follow_up_at=None, attempt_count=0,
    )
    values.update(changes)
    return QuoteCandidate(**values)


def policy(max_attempts=3):
    retry = RetryPolicy(max_attempts, tuple(timedelta(days=n) for n in range(1, max_attempts)), frozenset({"no_answer", "call_back_later", "call_not_established", "busy"}), timedelta(minutes=15), frozenset({"interested"}))
    return SelectionPolicy(InitialFollowUpTiming(timedelta(0), timedelta(0), timedelta(0)), retry)


def test_selection_rejects_expired_and_contact_opt_out_or_bad_phone():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    expired = evaluate_quote(quote(expiration_date=date(2026, 8, 9)), now, policy())
    assert expired.reason is SelectionReason.QUOTE_EXPIRED
    ready = SelectionResult(SelectionDecision.READY, SelectionReason.READY, quote())
    assert validate_callable_contact(ready, [ContactTarget("003000000000001", "A", "+1 415 555 0101", False)]).contact.phone == "+14155550101"
    assert validate_callable_contact(ready, [ContactTarget("003000000000001", "A", "+14155550101", True)]).reason is SelectionReason.DO_NOT_CALL
    assert validate_callable_contact(ready, [ContactTarget("003000000000001", "A", "123", False)]).reason is SelectionReason.INVALID_PHONE


def test_call_request_canonicalizes_salesforce_locale_for_calle():
    result = SelectionResult(
        SelectionDecision.READY,
        SelectionReason.READY,
        quote(account_billing_country_code="US"),
        ContactTarget("003000000000001", "A", "+14155550121", False, "en_US"),
    )
    request = build_call_request(
        result,
        [],
        prompt_settings=CallPromptSettings("Call {contact_name} in {locale} for {region}."),
    )
    assert request.locale == "en-US"
    assert request.region == "US"


def test_phone_normalization_and_masking_are_conservative():
    assert normalize_phone("0014155550101") == "+14155550101"
    assert normalize_phone("4155550101") is None
    assert mask_phone("+14155550101") == "+14******101"


def test_retry_policy_handles_preferred_date_and_max_attempts():
    first = quote()
    result = CallResult(first.quote_id, "c", "completed", "call_back_later", "medium", date(2026, 8, 20), "summary", "call again", datetime(2026, 8, 20, tzinfo=timezone.utc), CallOutcomeKind.BUSINESS, datetime(2026, 8, 10, tzinfo=timezone.utc))
    update = calculate_next_follow_up(first, result, FollowUpPolicies(policy().retry_policy))
    assert update.attempt_count == 1
    assert update.follow_up_status == "Retry"
    assert update.next_follow_up_at == datetime(2026, 8, 20, tzinfo=timezone.utc)
    terminal = CallResult(first.quote_id, "c", "completed", "no_answer", "unknown", None, "summary", "stop", None, CallOutcomeKind.BUSINESS, datetime(2026, 8, 10, tzinfo=timezone.utc))
    assert calculate_next_follow_up(quote(attempt_count=2), terminal, FollowUpPolicies(policy().retry_policy)).follow_up_status == "Stopped"
    not_established = CallResult(first.quote_id, "c", "failed", "call_not_established", "unknown", None, "summary", "retry", None, CallOutcomeKind.BUSINESS, datetime(2026, 8, 10, tzinfo=timezone.utc))
    not_established_update = calculate_next_follow_up(
        quote(attempt_count=2),
        not_established,
        FollowUpPolicies(policy().retry_policy),
    )
    assert not_established_update.attempt_count == 3
    assert not_established_update.follow_up_status == "Stopped"
    assert not_established_update.next_follow_up_at is None


def test_every_retryable_outcome_stops_after_consuming_the_last_attempt():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    policies = FollowUpPolicies(policy().retry_policy)
    for outcome in ("call_not_established", "no_answer", "busy", "call_back_later"):
        result = CallResult(
            "0Q0000000000001", "call-final", "completed", outcome, "unknown",
            None, "summary", "original action", None,
            CallOutcomeKind.BUSINESS, now,
        )
        update = calculate_next_follow_up(
            quote(attempt_count=2),
            result,
            policies,
        )
        assert update.attempt_count == 3
        assert update.follow_up_status == "Stopped"
        assert update.next_follow_up_at is None
        assert result.next_action == "original action"
        try:
            result.next_action = "changed"
        except FrozenInstanceError:
            pass
        else:  # pragma: no cover - documents the immutable domain contract
            raise AssertionError("CallResult must remain immutable")


def test_technical_and_zero_delay_retries_are_always_in_the_future():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    zero = FollowUpPolicies(
        RetryPolicy(2, (timedelta(0),), frozenset({"no_answer", "call_back_later", "call_not_established", "busy"}), timedelta(0), frozenset({"interested"}))
    )
    # Policy-only sentinel: not a provider call ID and never persisted.
    technical = CallResult("0Q0000000000001", "pre-acceptance-error-fixture", "technical_failure", "create_failed", "unknown", None, "summary", "retry", None, CallOutcomeKind.TECHNICAL_FAILURE, now)
    assert calculate_next_follow_up(quote(), technical, zero).next_follow_up_at > now
    no_answer = CallResult("0Q0000000000001", "c", "completed", "no_answer", "unknown", None, "summary", "retry", None, CallOutcomeKind.BUSINESS, now)
    assert calculate_next_follow_up(quote(), no_answer, zero).next_follow_up_at > now


def test_policy_maps_every_business_intention_without_provider_aliases():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    policies = FollowUpPolicies(policy().retry_policy)
    expected = {
        "interested": "Completed",
        "not_interested": "Stopped",
        "stop_quote_follow_up": "Stopped",
        "unknown": "Stopped",
    }
    for outcome, status in expected.items():
        result = CallResult("0Q0000000000001", "c", "completed", outcome, "unknown", None, "summary", "review", None, CallOutcomeKind.BUSINESS, now)
        update = calculate_next_follow_up(quote(), result, policies)
        assert update.follow_up_status == status
        assert update.attempt_count == 1
        assert update.next_follow_up_at is None

    for outcome in ("no_answer", "busy", "call_not_established"):
        result = CallResult("0Q0000000000001", "c", "completed", outcome, "unknown", None, "summary", "retry", None, CallOutcomeKind.BUSINESS, now)
        update = calculate_next_follow_up(quote(), result, policies)
        assert update.follow_up_status == "Retry"
        assert update.attempt_count == 1
        assert update.next_follow_up_at is not None and update.next_follow_up_at > now


def test_retry_policy_rejects_configured_sets_that_would_be_ignored():
    try:
        RetryPolicy(
            2,
            (timedelta(days=1),),
            frozenset({"no_answer"}),
            timedelta(minutes=15),
            frozenset({"interested"}),
        )
    except ValueError as error:
        assert "retry_outcomes" in str(error)
    else:  # pragma: no cover - assertion documents the fixed policy contract
        raise AssertionError("non-canonical retry outcomes must be rejected")


def test_callback_uses_only_a_future_preferred_date():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    policies = FollowUpPolicies(policy().retry_policy)
    for preferred in (None, date(2026, 8, 9)):
        result = CallResult(
            "0Q0000000000001", "c", "completed", "call_back_later", "medium",
            preferred, "summary", "call again",
            datetime.combine(preferred, datetime.min.time(), timezone.utc) if preferred else None,
            CallOutcomeKind.BUSINESS, now,
        )
        update = calculate_next_follow_up(quote(), result, policies)
        assert update.follow_up_status == "Retry"
        assert update.next_follow_up_at == now + timedelta(days=1)
