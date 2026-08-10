"""Tests for configurable retry, cooldown, and calling-hours policies."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import tempfile
import unittest
from zoneinfo import ZoneInfo

from quotewake_salesforce.calle.simulator import simulate_call
from quotewake_salesforce.config import (
    RegionalSettings,
    load_follow_up_policies,
)
from quotewake_salesforce.domain.models import CallPlanRequest, QuoteCandidate
from quotewake_salesforce.domain.policy import (
    CallingHoursPolicy,
    CooldownPolicy,
    FollowUpPolicies,
    RetryPolicy,
    calculate_next_follow_up,
)


def _quote(**overrides: object) -> QuoteCandidate:
    values: dict[str, object] = {
        "quote_id": "0Q0TEST00000001",
        "quote_name": "Demo quote",
        "quote_status": "Presented",
        "amount": Decimal("100"),
        "currency_code": "EUR",
        "expiration_date": date(2026, 8, 31),
        "last_modified_at": datetime(2026, 8, 1, tzinfo=timezone.utc),
        "opportunity_id": "006TEST00000001",
        "opportunity_name": "Demo opportunity",
        "account_name": "Demo account",
        "opportunity_is_closed": False,
        "enabled": True,
        "follow_up_status": "Retry",
        "next_follow_up_at": datetime(2026, 8, 9, 12, tzinfo=timezone.utc),
        "attempt_count": 1,
        "last_follow_up_at": datetime(2026, 8, 8, 12, tzinfo=timezone.utc),
        "last_follow_up_result": "No Answer",
    }
    values.update(overrides)
    return QuoteCandidate(**values)  # type: ignore[arg-type]


def _policies(
    *,
    cooldown_hours: int = 24,
    hours: CallingHoursPolicy | None = None,
) -> FollowUpPolicies:
    return FollowUpPolicies(
        retry=RetryPolicy(
            max_attempts=3,
            retry_delays=(timedelta(days=2), timedelta(days=4)),
            retry_outcomes=frozenset({"no_answer", "busy", "call_back_later"}),
            technical_failure_retry_delay=timedelta(minutes=30),
            completed_outcomes=frozenset({"interested"}),
        ),
        cooldown=CooldownPolicy(True, timedelta(hours=cooldown_hours)),
        calling_hours=hours
        or CallingHoursPolicy(False, frozenset(range(7)), time(9), time(18), timezone.utc),
    )


def _request() -> CallPlanRequest:
    return CallPlanRequest(
        quote_id="0Q0TEST00000001",
        opportunity_id="006TEST00000001",
        contact_id="003TEST00000001",
        phone="+14155550101",
        goal="Follow up",
        user_input="Quote context",
        language="Spanish",
        region="ES",
    )


class TestPolicyCalculation(unittest.TestCase):
    def test_no_answer_uses_configured_delay_and_consumes_business_attempt(self) -> None:
        occurred = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        result = simulate_call(_request(), "no_answer", now=occurred)
        update = calculate_next_follow_up(
            _quote(attempt_count=0), result, _policies(), occurred_at=occurred
        )

        self.assertEqual(update.attempt_count, 1)
        self.assertEqual(update.follow_up_status, "Retry")
        self.assertEqual(update.next_follow_up_at, datetime(2026, 8, 11, 12, tzinfo=timezone.utc))

    def test_technical_failure_does_not_consume_business_attempt(self) -> None:
        occurred = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        result = simulate_call(_request(), "error", now=occurred)
        update = calculate_next_follow_up(_quote(), result, _policies(), occurred_at=occurred)

        self.assertEqual(update.attempt_count, 1)
        self.assertEqual(update.follow_up_status, "Retry")
        self.assertEqual(update.next_follow_up_at, datetime(2026, 8, 10, 12, tzinfo=timezone.utc))

    def test_cooldown_is_anchored_to_the_call_that_just_completed(self) -> None:
        occurred = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        result = simulate_call(_request(), "error", now=occurred)
        update = calculate_next_follow_up(
            _quote(last_follow_up_at=datetime(2026, 8, 1, tzinfo=timezone.utc)),
            result,
            _policies(cooldown_hours=48),
            occurred_at=occurred,
        )

        self.assertEqual(update.next_follow_up_at, datetime(2026, 8, 11, 12, tzinfo=timezone.utc))

    def test_exhausted_business_retry_stops_and_clears_next_time(self) -> None:
        occurred = datetime(2026, 8, 9, 12, tzinfo=timezone.utc)
        result = simulate_call(_request(), "no_answer", now=occurred)
        update = calculate_next_follow_up(
            _quote(attempt_count=2), result, _policies(), occurred_at=occurred
        )

        self.assertEqual(update.attempt_count, 3)
        self.assertEqual(update.follow_up_status, "Stopped")
        self.assertIsNone(update.next_follow_up_at)

    def test_calling_hours_move_scheduled_retry_to_next_window(self) -> None:
        hours = CallingHoursPolicy(
            True,
            frozenset({0, 1, 2, 3, 4}),
            time(9),
            time(18),
            ZoneInfo("Europe/Madrid"),
        )
        occurred = datetime(2026, 8, 7, 17, 30, tzinfo=timezone.utc)
        result = simulate_call(_request(), "error", now=occurred)
        update = calculate_next_follow_up(
            _quote(), result, _policies(hours=hours), occurred_at=occurred
        )

        self.assertEqual(update.next_follow_up_at, datetime(2026, 8, 10, 7, tzinfo=timezone.utc))

    def test_calling_hours_handle_nonexistent_spring_forward_start(self) -> None:
        hours = CallingHoursPolicy(
            True,
            frozenset({6}),
            time(2, 30),
            time(4),
            ZoneInfo("Europe/Madrid"),
        )
        next_at = hours.next_allowed_at(datetime(2026, 3, 29, 0, tzinfo=timezone.utc))

        # Europe/Madrid skips 02:30 on this date.  ZoneInfo's first valid
        # instant after the configured wall-clock start is 03:30 CEST.
        self.assertEqual(next_at, datetime(2026, 3, 29, 1, 30, tzinfo=timezone.utc))
        self.assertTrue(hours.is_allowed_now(next_at))

    def test_calling_hours_use_earliest_fold_for_ambiguous_fall_back_start(self) -> None:
        hours = CallingHoursPolicy(
            True,
            frozenset({6}),
            time(2, 30),
            time(4),
            ZoneInfo("Europe/Madrid"),
        )
        next_at = hours.next_allowed_at(datetime(2026, 10, 25, 0, tzinfo=timezone.utc))

        # 02:30 occurs twice; fold 0 is the first occurrence (00:30 UTC).
        self.assertEqual(next_at, datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc))
        self.assertTrue(hours.is_allowed_now(next_at))


class TestFollowUpConfiguration(unittest.TestCase):
    def test_loads_all_policy_tables_and_regional_timezone(self) -> None:
        path = Path(tempfile.mkdtemp()) / "quotewake.toml"
        path.write_text(
            """
[regional]
business_timezone = "Europe/Madrid"
locale = "es_ES"
[follow_up.retry]
max_attempts = 3
retry_delays_days = [2, 4]
retry_outcomes = ["no_answer", "busy"]
technical_failure_retry_delay_minutes = 30
completed_outcomes = ["interested"]
[follow_up.cooldown]
enabled = true
minimum_delay_hours = 24
[follow_up.calling_hours]
enabled = true
days = ["monday", "friday"]
start = "09:00"
end = "18:00"
""",
            encoding="utf-8",
        )
        regional = RegionalSettings.from_values("Europe/Madrid", "es_ES")
        policies = load_follow_up_policies(path, regional)

        self.assertEqual(policies.retry.max_attempts, 3)
        self.assertEqual(policies.retry.retry_delays[0], timedelta(days=2))
        self.assertEqual(policies.calling_hours.timezone.key, "Europe/Madrid")

    def test_retry_delay_length_is_validated(self) -> None:
        path = Path(tempfile.mkdtemp()) / "quotewake.toml"
        path.write_text(
            """
[regional]
business_timezone = "UTC"
locale = "en_US"
[follow_up.retry]
max_attempts = 3
retry_delays_days = [2]
retry_outcomes = ["no_answer"]
technical_failure_retry_delay_minutes = 30
completed_outcomes = ["interested"]
[follow_up.cooldown]
enabled = false
minimum_delay_hours = 0
[follow_up.calling_hours]
enabled = false
days = ["monday"]
start = "09:00"
end = "18:00"
""",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "exactly max_attempts - 1"):
            load_follow_up_policies(path, RegionalSettings.from_values("UTC", "en_US"))

    def test_completed_outcomes_is_required(self) -> None:
        path = Path(tempfile.mkdtemp()) / "quotewake.toml"
        path.write_text(
            """
[regional]
business_timezone = "UTC"
locale = "en_US"
[follow_up.retry]
max_attempts = 1
retry_delays_days = []
retry_outcomes = ["no_answer"]
technical_failure_retry_delay_minutes = 30
[follow_up.cooldown]
enabled = false
minimum_delay_hours = 0
[follow_up.calling_hours]
enabled = false
days = ["monday"]
start = "09:00"
end = "18:00"
""",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "completed_outcomes"):
            load_follow_up_policies(path, RegionalSettings.from_values("UTC", "en_US"))

    def test_outcomes_reject_normalized_duplicates_and_overlap(self) -> None:
        common = """
[regional]
business_timezone = "UTC"
locale = "en_US"
[follow_up.retry]
max_attempts = 2
retry_delays_days = [2]
technical_failure_retry_delay_minutes = 30
[follow_up.cooldown]
enabled = false
minimum_delay_hours = 0
[follow_up.calling_hours]
enabled = false
days = ["monday"]
start = "09:00"
end = "18:00"
"""
        invalid_documents = (
            common
            + 'retry_outcomes = ["No Answer", "no_answer"]\n'
            + 'completed_outcomes = ["interested"]\n',
            common
            + 'retry_outcomes = ["no_answer"]\n'
            + 'completed_outcomes = ["Interested", "interested"]\n',
            common
            + 'retry_outcomes = ["No Answer"]\n'
            + 'completed_outcomes = ["no_answer"]\n',
        )
        for document in invalid_documents:
            with self.subTest(document=document):
                path = Path(tempfile.mkdtemp()) / "quotewake.toml"
                path.write_text(document, encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_follow_up_policies(
                        path, RegionalSettings.from_values("UTC", "en_US")
                    )

    def test_calling_hours_values_are_required_even_when_disabled(self) -> None:
        documents = (
            """
[follow_up.calling_hours]
enabled = false
start = "09:00"
end = "18:00"
""",
            """
[follow_up.calling_hours]
enabled = false
days = ["monday"]
end = "18:00"
""",
            """
[follow_up.calling_hours]
enabled = false
days = ["monday"]
start = "9:00"
end = "18:00"
""",
        )
        common = """
[regional]
business_timezone = "UTC"
locale = "en_US"
[follow_up.retry]
max_attempts = 1
retry_delays_days = []
retry_outcomes = ["no_answer"]
technical_failure_retry_delay_minutes = 30
completed_outcomes = ["interested"]
[follow_up.cooldown]
enabled = false
minimum_delay_hours = 0
"""
        for calling_hours in documents:
            with self.subTest(calling_hours=calling_hours):
                path = Path(tempfile.mkdtemp()) / "quotewake.toml"
                path.write_text(common + calling_hours, encoding="utf-8")
                with self.assertRaises(ValueError):
                    load_follow_up_policies(
                        path, RegionalSettings.from_values("UTC", "en_US")
                    )


if __name__ == "__main__":
    unittest.main()
