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
    retry = RetryPolicy(max_attempts, tuple(timedelta(days=n) for n in range(1, max_attempts)), frozenset({"no_answer", "call_back_later"}), timedelta(minutes=15), frozenset({"interested"}))
    return SelectionPolicy(InitialFollowUpTiming(timedelta(0), timedelta(0), timedelta(0)), retry)


def test_selection_rejects_expired_and_contact_opt_out_or_bad_phone():
    now = datetime(2026, 8, 10, tzinfo=timezone.utc)
    expired = evaluate_quote(quote(expiration_date=date(2026, 8, 9)), now, policy())
    assert expired.reason is SelectionReason.QUOTE_EXPIRED
    ready = SelectionResult(SelectionDecision.READY, SelectionReason.READY, quote())
    assert validate_callable_contact(ready, [ContactTarget("003000000000001", "A", "+1 415 555 0101", False)]).contact.phone == "+14155550101"
    assert validate_callable_contact(ready, [ContactTarget("003000000000001", "A", "+14155550101", True)]).reason is SelectionReason.DO_NOT_CALL
    assert validate_callable_contact(ready, [ContactTarget("003000000000001", "A", "123", False)]).reason is SelectionReason.INVALID_PHONE


def test_phone_normalization_and_masking_are_conservative():
    assert normalize_phone("0014155550121") == "+14155550101"
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
