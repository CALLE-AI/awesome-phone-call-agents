"""Quiet hours, the cutoff, and the ladder's own arithmetic."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from positive_contact.models import ContactType, LadderTarget
from positive_contact.policy import (
    DEFAULT_POLICY,
    PolicyError,
    compute_field_visit_cutoff,
    in_quiet_hours,
    load_policy,
    next_callable_time,
    resolve_zone,
    schedule_step,
    select_next_step,
    step_can_finish_before_cutoff,
)

LA = ZoneInfo("America/Los_Angeles")


@pytest.fixture
def default_policy():
    return load_policy(DEFAULT_POLICY)


def local(year, month, day, hour, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=LA)


def test_quiet_hours_wrap_midnight(default_policy):
    assert in_quiet_hours(local(2026, 9, 11, 22, 30), "America/Los_Angeles", default_policy)
    assert in_quiet_hours(local(2026, 9, 11, 3, 0), "America/Los_Angeles", default_policy)
    assert not in_quiet_hours(local(2026, 9, 11, 9, 0), "America/Los_Angeles", default_policy)


def test_quiet_hours_boundaries_are_half_open(default_policy):
    # 21:00 is inside quiet hours; 08:00 is the first callable minute.
    assert in_quiet_hours(local(2026, 9, 11, 21, 0), "America/Los_Angeles", default_policy)
    assert not in_quiet_hours(local(2026, 9, 11, 8, 0), "America/Los_Angeles", default_policy)


def test_a_call_inside_quiet_hours_is_deferred_to_the_morning(default_policy):
    at_night = local(2026, 9, 11, 22, 15)
    moved = next_callable_time(at_night, "America/Los_Angeles", default_policy)
    assert moved.astimezone(LA).hour == 8
    assert moved.astimezone(LA).date() == (at_night + timedelta(days=1)).date()
    assert not in_quiet_hours(moved, "America/Los_Angeles", default_policy)


def test_an_early_morning_call_is_deferred_to_the_same_morning(default_policy):
    before_dawn = local(2026, 9, 11, 3, 30)
    moved = next_callable_time(before_dawn, "America/Los_Angeles", default_policy)
    assert moved.astimezone(LA).hour == 8
    assert moved.astimezone(LA).date() == before_dawn.date()


def test_a_callable_time_is_left_alone(default_policy):
    daytime = local(2026, 9, 11, 10, 0)
    assert next_callable_time(daytime, "America/Los_Angeles", default_policy) == daytime


def test_quiet_hours_are_applied_in_the_contacts_own_timezone(default_policy):
    # 23:00 in New York is 20:00 in Los Angeles: quiet for one contact, not the other.
    moment = datetime(2026, 9, 11, 23, 0, tzinfo=ZoneInfo("America/New_York"))
    assert in_quiet_hours(moment, "America/New_York", default_policy)
    assert not in_quiet_hours(moment, "America/Los_Angeles", default_policy)


def test_an_emergency_override_disables_quiet_hours():
    policy = load_policy({**DEFAULT_POLICY, "quiet_hours_emergency_override": True})
    assert not in_quiet_hours(local(2026, 9, 11, 2, 0), "America/Los_Angeles", policy)


def test_an_unknown_timezone_raises_instead_of_falling_back():
    with pytest.raises(PolicyError, match="will not guess"):
        resolve_zone("Pacific/Nowhere")


def test_the_cutoff_is_computed_from_the_window_start(default_policy):
    window_start = local(2026, 9, 11, 18, 0)
    cutoff = compute_field_visit_cutoff(window_start, default_policy)
    assert cutoff == window_start - timedelta(hours=6)


def test_a_step_that_cannot_finish_before_the_cutoff_is_refused(default_policy):
    cutoff = local(2026, 9, 11, 12, 0)
    # Ten minutes before the cutoff is not enough for the 15 minute step allowance.
    assert not step_can_finish_before_cutoff(cutoff - timedelta(minutes=10), cutoff, default_policy)
    assert step_can_finish_before_cutoff(cutoff - timedelta(minutes=20), cutoff, default_policy)


def test_a_step_landing_exactly_on_the_allowance_is_allowed(default_policy):
    cutoff = local(2026, 9, 11, 12, 0)
    exactly = cutoff - timedelta(minutes=default_policy.step_allowance_minutes)
    assert step_can_finish_before_cutoff(exactly, cutoff, default_policy)


def test_the_ladder_skips_a_step_whose_only_if_does_not_match(default_policy):
    # A live person who did not acknowledge is not a no-answer, so step 2 is skipped and
    # the alternate contact is tried instead.
    step = select_next_step(
        default_policy,
        current_step=1,
        last_contact_type=ContactType.LIVE_PERSON,
        has_alternate=True,
    )
    assert step is not None
    assert step.step == 3
    assert step.target is LadderTarget.ALTERNATE


def test_the_ladder_retries_the_primary_after_a_voicemail(default_policy):
    step = select_next_step(
        default_policy,
        current_step=1,
        last_contact_type=ContactType.VOICEMAIL,
        has_alternate=False,
    )
    assert step is not None and step.step == 2 and step.target is LadderTarget.PRIMARY


def test_the_alternate_step_is_skipped_when_there_is_no_alternate(default_policy):
    step = select_next_step(
        default_policy,
        current_step=2,
        last_contact_type=ContactType.VOICEMAIL,
        has_alternate=False,
    )
    assert step is not None and step.step == 4


def test_the_ladder_runs_out(default_policy):
    assert (
        select_next_step(
            default_policy,
            current_step=4,
            last_contact_type=ContactType.VOICEMAIL,
            has_alternate=True,
        )
        is None
    )


def test_max_calls_per_contact_comes_from_the_policy(default_policy):
    assert default_policy.max_calls_per_contact == 4
    assert len(default_policy.ladder) == 4


def test_a_scheduled_step_adds_its_delay_then_respects_quiet_hours(default_policy):
    step = default_policy.step(4)
    assert step is not None and step.delay_minutes == 180
    # 20:00 plus three hours is 23:00, inside quiet hours, so it lands at 08:00 next day.
    planned = schedule_step(
        step, after=local(2026, 9, 11, 20, 0), tz_name="America/Los_Angeles", policy=default_policy
    )
    assert planned.astimezone(LA).hour == 8
    assert planned.astimezone(LA).day == 12


def test_a_policy_with_an_unknown_only_if_value_is_refused():
    broken = {
        **DEFAULT_POLICY,
        "ladder": [{"step": 1, "target": "primary", "only_if": ["answered_maybe"]}],
    }
    with pytest.raises(PolicyError, match="only_if"):
        load_policy(broken)


def test_a_policy_with_an_unknown_target_is_refused():
    broken = {**DEFAULT_POLICY, "ladder": [{"step": 1, "target": "carrier_pigeon"}]}
    with pytest.raises(PolicyError, match="target"):
        load_policy(broken)


def test_a_confidence_threshold_outside_zero_to_one_is_refused():
    with pytest.raises(PolicyError, match="confidence_threshold"):
        load_policy({**DEFAULT_POLICY, "confidence_threshold": 1.5})


def test_the_default_policy_matches_the_architecture_document(default_policy):
    assert default_policy.confidence_threshold == 0.80
    assert default_policy.supported_locales == frozenset({"en-US"})
    assert default_policy.unsupported_locale_action == "needs_human_bilingual_callback"
    assert default_policy.field_visit_cutoff_hours_before_window_start == 6
    assert default_policy.quiet_hours_emergency_override is False


def test_utc_moments_are_evaluated_against_local_quiet_hours(default_policy):
    # 05:00 UTC is 22:00 the previous day in Los Angeles: quiet.
    moment = datetime(2026, 9, 12, 5, 0, tzinfo=timezone.utc)
    assert in_quiet_hours(moment, "America/Los_Angeles", default_policy)
