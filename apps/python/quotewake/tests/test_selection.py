"""Unit tests for pure QuoteWake Salesforce selection rules."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import unittest

from quotewake_salesforce.domain.models import (
    ContactTarget,
    QuoteCandidate,
    SelectionDecision,
    SelectionReason,
)
from quotewake_salesforce.domain.policy import InitialFollowUpTiming, SelectionPolicy
from quotewake_salesforce.domain.selection import evaluate_quote, validate_callable_contact


NOW = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)
POLICY = SelectionPolicy(
    initial_follow_up_timing=InitialFollowUpTiming(
        minimum_delay=timedelta(hours=4),
        standard_delay=timedelta(hours=48),
        due_soon_window=timedelta(days=3),
    ),
    allowed_quote_statuses=frozenset({"Presented"}),
)


def quote(**overrides: object) -> QuoteCandidate:
    values: dict[str, object] = {
        "quote_id": "0Q0TEST00000001",
        "quote_name": "Demo quote",
        "quote_status": "Presented",
        "amount": Decimal("4250"),
        "currency_code": "EUR",
        "expiration_date": date(2026, 8, 31),
        "last_modified_at": NOW - timedelta(hours=48),
        "opportunity_id": "006TEST00000001",
        "opportunity_name": "Demo opportunity",
        "account_name": "Demo electrical company",
        "opportunity_is_closed": False,
        "enabled": True,
        "follow_up_status": None,
        "next_follow_up_at": None,
        "attempt_count": 0,
        "last_follow_up_at": None,
        "last_follow_up_result": None,
    }
    values.update(overrides)
    return QuoteCandidate(**values)  # type: ignore[arg-type]


def contact(**overrides: object) -> ContactTarget:
    values: dict[str, object] = {
        "contact_id": "003TEST00000001",
        "name": "Laura Martín",
        "phone": "+1 415 555 0101",
        "do_not_call": False,
    }
    values.update(overrides)
    return ContactTarget(**values)  # type: ignore[arg-type]


class TestQuoteSelection(unittest.TestCase):
    def test_disabled_quote(self) -> None:
        result = evaluate_quote(quote(enabled=False), NOW, POLICY)
        self.assertEqual(result.reason, SelectionReason.DISABLED)

    def test_initial_quote_is_ready(self) -> None:
        result = evaluate_quote(quote(), NOW, POLICY)
        self.assertEqual(result.decision, SelectionDecision.READY)

    def test_initial_quote_waits_for_standard_delay(self) -> None:
        result = evaluate_quote(
            quote(last_modified_at=NOW - timedelta(hours=24)), NOW, POLICY
        )
        self.assertEqual(result.reason, SelectionReason.NOT_DUE)

    def test_due_soon_quote_is_ready_after_minimum_delay(self) -> None:
        result = evaluate_quote(
            quote(
                last_modified_at=NOW - timedelta(hours=4),
                expiration_date=NOW.date() + timedelta(days=3),
            ),
            NOW,
            POLICY,
        )
        self.assertEqual(result.decision, SelectionDecision.READY)

    def test_due_soon_quote_still_respects_minimum_delay(self) -> None:
        result = evaluate_quote(
            quote(
                last_modified_at=NOW - timedelta(hours=3, minutes=59),
                expiration_date=NOW.date() + timedelta(days=1),
            ),
            NOW,
            POLICY,
        )
        self.assertEqual(result.reason, SelectionReason.NOT_DUE)

    def test_initial_quote_without_expiration_uses_standard_delay(self) -> None:
        waiting = evaluate_quote(
            quote(
                last_modified_at=NOW - timedelta(hours=24),
                expiration_date=None,
            ),
            NOW,
            POLICY,
        )
        ready = evaluate_quote(
            quote(last_modified_at=NOW - timedelta(hours=48), expiration_date=None),
            NOW,
            POLICY,
        )
        self.assertEqual(waiting.reason, SelectionReason.NOT_DUE)
        self.assertEqual(ready.decision, SelectionDecision.READY)

    def test_initial_quote_ignores_next_follow_up_date(self) -> None:
        result = evaluate_quote(
            quote(next_follow_up_at=NOW + timedelta(days=1)), NOW, POLICY
        )
        self.assertEqual(result.decision, SelectionDecision.READY)

    def test_retry_quote_due_now(self) -> None:
        result = evaluate_quote(
            quote(
                follow_up_status="Retry",
                next_follow_up_at=NOW,
                last_modified_at=NOW,
                attempt_count=1,
            ),
            NOW,
            POLICY,
        )
        self.assertEqual(result.decision, SelectionDecision.READY)

    def test_retry_without_next_follow_up_date_is_not_due(self) -> None:
        result = evaluate_quote(quote(follow_up_status="Retry"), NOW, POLICY)
        self.assertEqual(result.reason, SelectionReason.NOT_DUE)

    def test_non_actionable_follow_up_statuses_are_skipped(self) -> None:
        for status in ("In Progress", "Completed", "Stopped"):
            with self.subTest(status=status):
                result = evaluate_quote(quote(follow_up_status=status), NOW, POLICY)
                self.assertEqual(
                    result.reason, SelectionReason.NON_ACTIONABLE_FOLLOW_UP_STATUS
                )

    def test_removed_follow_up_statuses_are_not_accepted(self) -> None:
        for status in ("Pending", "Scheduled", ""):
            with self.subTest(status=status):
                result = evaluate_quote(quote(follow_up_status=status), NOW, POLICY)
                self.assertEqual(result.reason, SelectionReason.INVALID_FOLLOW_UP_STATUS)

    def test_quote_not_due(self) -> None:
        result = evaluate_quote(
            quote(follow_up_status="Retry", next_follow_up_at=NOW + timedelta(minutes=1)),
            NOW,
            POLICY,
        )
        self.assertEqual(result.reason, SelectionReason.NOT_DUE)

    def test_attempt_count_at_limit(self) -> None:
        result = evaluate_quote(quote(attempt_count=3), NOW, POLICY)
        self.assertEqual(result.reason, SelectionReason.MAX_ATTEMPTS)

    def test_expired_quote(self) -> None:
        result = evaluate_quote(quote(expiration_date=date(2026, 8, 8)), NOW, POLICY)
        self.assertEqual(result.reason, SelectionReason.QUOTE_EXPIRED)

    def test_open_opportunity(self) -> None:
        result = evaluate_quote(quote(), NOW, POLICY)
        self.assertEqual(result.decision, SelectionDecision.READY)

    def test_closed_opportunity(self) -> None:
        result = evaluate_quote(quote(opportunity_is_closed=True), NOW, POLICY)
        self.assertEqual(result.reason, SelectionReason.OPPORTUNITY_CLOSED)

    def test_invalid_commercial_quote_status(self) -> None:
        result = evaluate_quote(quote(quote_status="Draft"), NOW, POLICY)
        self.assertEqual(result.reason, SelectionReason.INVALID_QUOTE_STATUS)

    def test_no_primary_contact(self) -> None:
        quote_result = evaluate_quote(quote(), NOW, POLICY)
        result = validate_callable_contact(quote_result, [])
        self.assertEqual(result.reason, SelectionReason.NO_PRIMARY_CONTACT)

    def test_contact_do_not_call(self) -> None:
        quote_result = evaluate_quote(quote(), NOW, POLICY)
        result = validate_callable_contact(quote_result, [contact(do_not_call=True)])
        self.assertEqual(result.reason, SelectionReason.DO_NOT_CALL)

    def test_contact_without_phone(self) -> None:
        quote_result = evaluate_quote(quote(), NOW, POLICY)
        result = validate_callable_contact(quote_result, [contact(phone=None)])
        self.assertEqual(result.reason, SelectionReason.NO_PHONE)

    def test_valid_quote_and_contact_are_ready(self) -> None:
        quote_result = evaluate_quote(quote(), NOW, POLICY)
        result = validate_callable_contact(quote_result, [contact()])
        self.assertEqual(result.decision, SelectionDecision.READY)
        self.assertEqual(result.reason, SelectionReason.READY)
        self.assertEqual(result.contact.phone, "+14155550101")

    def test_invalid_phone(self) -> None:
        quote_result = evaluate_quote(quote(), NOW, POLICY)
        result = validate_callable_contact(quote_result, [contact(phone="600 000 101")])
        self.assertEqual(result.reason, SelectionReason.INVALID_PHONE)


if __name__ == "__main__":
    unittest.main()
