"""Whether the call may happen at all. Everything here runs before CALL-E does."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest

from callibrate.policy.call_eligibility import (
    allowlist_permits,
    consent_permits,
    evaluate,
    normalise_number,
    parse_allowlist,
    spacing_permits,
)


def consent(**overrides):
    base = {
        "id": "consent_1",
        "phone_number": "+15550101101",
        "timezone": "America/New_York",
        "status": "active",
        "calls_placed": 0,
        "max_calls": 10,
        "valid_from": "2026-01-01",
        "valid_until": "2027-12-31",
        "allowed_days_json": json.dumps(["MO", "TU", "WE", "TH", "FR"]),
        "earliest_local": "09:00",
        "latest_local": "17:00",
    }
    base.update(overrides)
    return base


# Thursday 10 September 2026, 14:00 UTC = 10:00 in New York.
WEEKDAY_MORNING = datetime(2026, 9, 10, 14, 0, tzinfo=UTC)
WEEKEND = datetime(2026, 9, 12, 14, 0, tzinfo=UTC)
MIDNIGHT_LOCAL = datetime(2026, 9, 10, 4, 0, tzinfo=UTC)


def test_numbers_compare_by_digits_not_punctuation():
    assert normalise_number("+1-555-010-1101") == normalise_number("+1 (555) 010 1101")


def test_an_empty_allowlist_permits_nothing():
    """The default deployment cannot ring anybody. That is the point."""
    assert parse_allowlist("") == []
    assert not allowlist_permits("+15550101101", [])


def test_the_allowlist_admits_only_what_it_names():
    allowlist = parse_allowlist("+1-555-010-1101, +1-555-010-9090")
    assert allowlist_permits("+15550101101", allowlist)
    assert not allowlist_permits("+15550102202", allowlist)


def test_consent_covers_a_weekday_morning():
    permitted, _ = consent_permits(consent(), WEEKDAY_MORNING)
    assert permitted


def test_consent_does_not_cover_a_day_it_does_not_name():
    permitted, reason = consent_permits(consent(), WEEKEND)
    assert not permitted
    assert "calling day" in reason


def test_the_window_is_evaluated_where_the_phone_is():
    """"Not before nine" means nine where the provider is, not on the server."""
    permitted, reason = consent_permits(consent(), MIDNIGHT_LOCAL)
    assert not permitted
    assert "00:00" in reason


def test_a_used_up_allowance_refuses():
    permitted, reason = consent_permits(consent(calls_placed=10), WEEKDAY_MORNING)
    assert not permitted
    assert "allowance" in reason


def test_a_withdrawn_consent_refuses():
    permitted, _ = consent_permits(consent(status="withdrawn"), WEEKDAY_MORNING)
    assert not permitted


def test_spacing_keeps_one_organization_from_being_phoned_twice_in_a_day():
    permitted, reason = spacing_permits(
        "2026-09-10T09:00:00+00:00", minimum_interval_days=1, at=WEEKDAY_MORNING
    )
    assert not permitted
    assert "not callable again before" in reason


# ------------------------------------------------------------------ all gates


def test_a_number_off_the_allowlist_is_refused_before_anything_is_dialled():
    verdict = evaluate(
        destination="+15550109999",
        allowlist=parse_allowlist("+15550101101"),
        live=True,
        do_not_call=False,
        consents=[consent()],
        last_call_at=None,
        minimum_interval_days=1,
        at=WEEKDAY_MORNING,
    )
    assert not verdict.allowed
    assert "allowlist" in verdict.reason


def test_a_do_not_call_organization_is_refused_first():
    verdict = evaluate(
        destination="+15550101101",
        allowlist=parse_allowlist("+15550101101"),
        live=True,
        do_not_call=True,
        consents=[consent()],
        last_call_at=None,
        minimum_interval_days=1,
        at=WEEKDAY_MORNING,
    )
    assert not verdict.allowed
    assert "never to be called again" in verdict.reason


def test_every_gate_passing_returns_the_consent_that_permitted_it():
    verdict = evaluate(
        destination="+15550101101",
        allowlist=parse_allowlist("+15550101101"),
        live=True,
        do_not_call=False,
        consents=[consent()],
        last_call_at=None,
        minimum_interval_days=1,
        at=WEEKDAY_MORNING,
    )
    assert verdict.allowed
    assert verdict.consent_id == "consent_1"


def test_no_recorded_consent_says_so_plainly():
    verdict = evaluate(
        destination="+15550101101",
        allowlist=parse_allowlist("+15550101101"),
        live=True,
        do_not_call=False,
        consents=[],
        last_call_at=None,
        minimum_interval_days=1,
        at=WEEKDAY_MORNING,
    )
    assert not verdict.allowed
    assert "no consent" in verdict.reason


@pytest.mark.parametrize("live", [True, False])
def test_the_allowlist_only_binds_a_caller_that_can_reach_a_telephone(live):
    """The pilot line dials nothing, so the allowlist has nothing to protect."""
    verdict = evaluate(
        destination="+15550101101",
        allowlist=[],
        live=live,
        do_not_call=False,
        consents=[consent()],
        last_call_at=None,
        minimum_interval_days=1,
        at=WEEKDAY_MORNING,
    )
    assert verdict.allowed is (not live)
