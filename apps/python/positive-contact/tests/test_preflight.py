"""Preflight refuses; it never repairs."""

from __future__ import annotations

import pytest

from positive_contact.preflight import (
    PreflightError,
    load_roster_rows,
    render_preview,
    run_preflight,
)
from positive_contact.redact import find_raw_e164
from tests.conftest import ROSTER_PATH


def row(**overrides):
    base = {
        "contact_id": "pc-900",
        "first_name": "Sam",
        "phone_e164": "+14155550190",
        "alt_phone_e164": "",
        "locale": "en-US",
        "tz": "America/Los_Angeles",
        "service_address_short": "9 block of Test St",
    }
    base.update(overrides)
    return base


def codes(issues):
    return {issue.code for issue in issues}


def test_the_demo_roster_passes(demo_preflight):
    assert demo_preflight.ok
    assert demo_preflight.roster_size == 12
    assert len(demo_preflight.callable_contacts) == 11
    assert len(demo_preflight.routed) == 1


@pytest.mark.parametrize(
    "bad",
    [
        "4155550190",       # no plus, no country code
        "+1 415 555 0190",  # spaces
        "+1-415-555-0190",  # hyphens
        "(415) 555-0190",   # national format
        "+0155550190",      # leading zero after the plus
        "+1415555019012345678",  # too long for E.164
        "",
    ],
)
def test_a_malformed_number_is_rejected_not_repaired(event, policy, now, bad):
    result = run_preflight(event, policy, [row(phone_e164=bad)], now=now)
    assert not result.ok
    assert "invalid_e164" in codes(result.blocking)
    assert result.callable_contacts == []
    assert result.exit_code == 1


def test_a_malformed_alternate_number_is_also_rejected(event, policy, now):
    result = run_preflight(event, policy, [row(alt_phone_e164="415-555-0191")], now=now)
    assert "invalid_e164" in codes(result.blocking)


def test_an_unsupported_locale_is_routed_and_never_dialled(event, policy, now):
    result = run_preflight(event, policy, [row(locale="vi-VN")], now=now)
    assert result.ok  # not a blocking issue: it is a different path, not a defect
    assert result.callable_contacts == []
    assert len(result.routed) == 1
    routed = result.routed[0]
    assert routed.action == "needs_human_bilingual_callback"
    assert routed.locale == "vi-VN"
    assert routed.contact is not None


def test_an_unknown_timezone_is_blocking(event, policy, now):
    result = run_preflight(event, policy, [row(tz="Mars/Olympus")], now=now)
    assert "unknown_timezone" in codes(result.blocking)


def test_a_blank_timezone_falls_back_to_the_event_default(event, policy, now):
    result = run_preflight(event, policy, [row(tz="")], now=now)
    assert result.ok
    assert result.callable_contacts[0].tz == event.default_tz


def test_a_duplicate_contact_id_is_blocking(event, policy, now):
    result = run_preflight(event, policy, [row(), row()], now=now)
    assert "duplicate_contact_id" in codes(result.blocking)


def test_a_missing_contact_id_is_blocking(event, policy, now):
    result = run_preflight(event, policy, [row(contact_id="")], now=now)
    assert "missing_contact_id" in codes(result.blocking)


def test_a_roster_missing_a_required_column_is_refused(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("contact_id,first_name\npc-1,Sam\n", encoding="utf-8")
    with pytest.raises(PreflightError, match="missing required column"):
        load_roster_rows(path)


def test_a_cutoff_after_the_window_start_is_blocking(event, policy, now):
    broken = event.model_copy(update={"field_visit_cutoff": event.window_start})
    result = run_preflight(broken, policy, [row()], now=now)
    assert "cutoff_after_window_start" in codes(result.blocking)


def test_a_contact_too_late_for_the_ladder_is_warned_about(event, policy):
    # Ten minutes before the cutoff: the step allowance cannot fit.
    from datetime import timedelta

    late = event.field_visit_cutoff - timedelta(minutes=10)
    result = run_preflight(event, policy, [row()], now=late)
    assert result.ok
    assert "cannot_finish_before_cutoff" in codes(result.warnings)


def test_the_preview_contains_no_raw_number(demo_preflight, now):
    rendered = render_preview(demo_preflight, now=now)
    assert find_raw_e164(rendered) == []
    for contact in demo_preflight.callable_contacts:
        assert contact.phone_e164 not in rendered
        if contact.alt_phone_e164:
            assert contact.alt_phone_e164 not in rendered


def test_the_preview_shows_masked_numbers_and_the_exact_script(demo_preflight, now):
    rendered = render_preview(demo_preflight, now=now)
    assert "+1415•••0101" in rendered
    assert "This call may be recorded" in rendered
    assert "Medical Baseline" in rendered
    assert "We will never ask for payment or account information" in rendered
    assert "needs_human_bilingual_callback" in rendered


def test_the_preview_states_the_ladder_and_the_gates(demo_preflight, now):
    rendered = render_preview(demo_preflight, now=now)
    assert "field-visit cutoff" in rendered
    assert "quiet hours" in rendered
    assert "confidence gate" in rendered


def test_the_demo_roster_uses_only_fictional_numbers():
    rows = load_roster_rows(ROSTER_PATH)
    for entry in rows:
        for column in ("phone_e164", "alt_phone_e164"):
            value = entry.get(column) or ""
            if value:
                assert value.startswith("+1") and "5550" in value, value
