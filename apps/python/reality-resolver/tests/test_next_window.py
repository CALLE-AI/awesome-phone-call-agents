"""Unit tests for next_window.next_legal_window()."""

from __future__ import annotations

from datetime import datetime, timezone

from compliance.models import CheckResult, PreCallDecision
from next_window import next_legal_window


def _decision(*results: CheckResult, chain: tuple[str, ...] = ()) -> PreCallDecision:
    allowed = all(r.passed for r in results)
    return PreCallDecision(allowed=allowed, jurisdiction_chain=chain, results=results)


def test_not_blocked_reports_not_blocked():
    decision = _decision(CheckResult("us_federal_calling_window", True, "in window"))
    result = next_legal_window(decision, "America/New_York", datetime(2026, 9, 8, 14, 0, tzinfo=timezone.utc))
    assert result == "call is not blocked"


def test_non_time_based_block_has_no_next_window():
    decision = _decision(CheckResult("us_federal_consent", False, "PEWC not documented"))
    result = next_legal_window(decision, "America/New_York", datetime(2026, 9, 8, 14, 0, tzinfo=timezone.utc))
    assert "non-time-based reason" in result
    assert "no next window" in result


def test_mixed_time_and_non_time_block_has_no_next_window():
    """A single non-time-based failure among several is enough to
    refuse guessing a next window - the call would still be blocked
    even once the clock is right.
    """
    decision = _decision(
        CheckResult("us_federal_calling_window", False, "outside window"),
        CheckResult("us_federal_consent", False, "PEWC not documented"),
    )
    result = next_legal_window(decision, "America/New_York", datetime(2026, 9, 8, 22, 0, tzinfo=timezone.utc))
    assert "non-time-based reason" in result


def test_missing_recipient_timezone_is_reported_plainly():
    decision = _decision(CheckResult("us_federal_calling_window", False, "outside window"))
    result = next_legal_window(decision, None, datetime(2026, 9, 8, 22, 0, tzinfo=timezone.utc))
    assert "recipient_timezone" in result


def test_us_federal_window_projects_to_tomorrow_8am_when_blocked_late_at_night():
    # 2026-09-08T22:00:00-04:00 New York local, well after the 21:00 close.
    now_utc = datetime(2026, 9, 9, 2, 0, tzinfo=timezone.utc)
    decision = _decision(CheckResult("us_federal_calling_window", False, "outside window"))
    result = next_legal_window(decision, "America/New_York", now_utc)
    assert "08:00:00" in result
    assert "next legal window opens" in result


def test_fr_window_projects_to_same_afternoon_during_the_lunch_gap():
    # Tuesday 2026-09-08, 13:30 Paris local - between the morning and
    # afternoon windows, on an allowed weekday.
    now_utc = datetime(2026, 9, 8, 11, 30, tzinfo=timezone.utc)  # Paris is UTC+2 in September (CEST)
    decision = _decision(CheckResult("fr_calling_window", False, "outside window"))
    result = next_legal_window(decision, "Europe/Paris", now_utc)
    assert "14:00:00" in result


def test_fr_window_projects_past_the_weekend_to_monday_morning():
    # Saturday 2026-09-12, 10:00 Paris local - not an allowed weekday at all.
    now_utc = datetime(2026, 9, 12, 8, 0, tzinfo=timezone.utc)
    decision = _decision(CheckResult("fr_calling_window", False, "not an allowed calling day"))
    result = next_legal_window(decision, "Europe/Paris", now_utc)
    assert "2026-09-14" in result  # the following Monday
    assert "10:00:00" in result


def test_oregon_only_failure_ignores_the_wider_federal_window():
    """When us_federal's own window already passed (it's wider) but
    us_oregon's stricter window failed, only the failing check should
    drive the projection - the passing federal result must not appear
    in `blocking` at all.
    """
    now_utc = datetime(2026, 9, 9, 3, 30, tzinfo=timezone.utc)  # 20:30 Portland local (PDT, UTC-7)
    decision = _decision(
        CheckResult("us_federal_calling_window", True, "in window"),
        CheckResult("us_oregon_calling_window", False, "outside Oregon's stricter window"),
    )
    result = next_legal_window(decision, "America/Los_Angeles", now_utc)
    assert "08:00:00" in result
