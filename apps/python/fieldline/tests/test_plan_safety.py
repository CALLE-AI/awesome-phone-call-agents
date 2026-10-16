"""Offline validation and masking regressions; no provider calls are made."""

from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from fieldline.demo_data import demo_trip_plan
from fieldline.schemas import TripPlanError, _validate, load_trip_plan, scrub_text, validate_live_window


@pytest.fixture
def plan():
    return replace(demo_trip_plan(), date="2026-09-30", start="08:00", end="18:00", checkins=["14:00", "18:00"])


@pytest.mark.parametrize("phone", ["+012345678", "+1234567", "+1234567890123456", "+１２３４５６７８９", "+١٢٣٤٥٦٧٨٩", "+1 5555550100", "15555550100", "+15555550100\n"])
def test_invalid_e164_rejected_without_echo(plan, phone):
    plan = replace(plan, worker=replace(plan.worker, phone=phone))
    with pytest.raises(TripPlanError, match="E.164") as error:
        _validate(plan)
    assert phone not in str(error.value)


@pytest.mark.parametrize("phone", ["+12345678", "+123456789012345"])
def test_e164_length_boundaries(plan, phone):
    _validate(replace(plan, worker=replace(plan.worker, phone=phone)))


def test_escalation_number_is_validated(plan):
    contact = replace(plan.escalation[0], phone="+012345678")
    with pytest.raises(TripPlanError, match="E.164"):
        _validate(replace(plan, escalation=[contact]))


@pytest.mark.parametrize("date", ["2026-2-03", "26-02-03", "2026-02-29", "2026-13-01", "２０２６-09-30", "2026-09-30\n", "", "2026-09-30T08:00"])
def test_date_is_real_and_canonical(plan, date):
    with pytest.raises(TripPlanError, match="YYYY-MM-DD"):
        _validate(replace(plan, date=date))


@pytest.mark.parametrize("value", ["8:00", "08:0", "24:00", "08:60", "-1:00", "08:00:00", "０８:00", "08:00\n"])
@pytest.mark.parametrize("field", ["start", "end", "checkins"])
def test_times_are_real_and_canonical(plan, value, field):
    with pytest.raises(TripPlanError, match="HH:MM"):
        _validate(replace(plan, **{field: [value] if field == "checkins" else value}))


@pytest.mark.parametrize("changes", [{"start": "18:00", "end": "08:00"}, {"start": "18:00", "end": "18:00"}, {"checkins": []}, {"checkins": ["18:00", "14:00"]}, {"checkins": ["14:00", "14:00"]}, {"checkins": ["07:59"]}, {"checkins": ["18:01"]}])
def test_window_and_order(plan, changes):
    with pytest.raises(TripPlanError):
        _validate(replace(plan, **changes))


def test_checkins_can_include_window_boundaries(plan):
    _validate(replace(plan, checkins=["08:00", "18:00"]))


@pytest.mark.parametrize("field,low,high", [("grace_minutes", 0, 1440), ("retry_after_minutes", 1, 1440), ("max_retries", 0, 10)])
def test_retry_bounds_and_strict_integer_types(plan, field, low, high):
    for value in (low, high):
        _validate(replace(plan, **{field: value}))
    for value in (low - 1, high + 1, True, False, 1.0, "1", None):
        with pytest.raises(TripPlanError, match=field):
            _validate(replace(plan, **{field: value}))


@pytest.mark.parametrize("now", [datetime(2026, 9, 29, 8), datetime(2026, 10, 1, 8), datetime(2026, 9, 30, 14, 0, 1), datetime(2026, 9, 30, 18, 1)])
def test_start_refuses_wrong_day_and_missed_first_checkin(plan, now):
    with pytest.raises(TripPlanError):
        validate_live_window(plan, now)


@pytest.mark.parametrize("now", [datetime(2026, 9, 30, 0), datetime(2026, 9, 30, 8), datetime(2026, 9, 30, 14)])
def test_start_allows_waiting_before_first_checkin(plan, now):
    validate_live_window(plan, now)


@pytest.mark.parametrize("now", [datetime(2026, 9, 30, 7, 59, 59), datetime(2026, 9, 30, 18, 0, 1), datetime(2026, 10, 1, 12)])
def test_immediate_call_refuses_outside_window(plan, now):
    with pytest.raises(TripPlanError):
        validate_live_window(plan, now, single=True)


@pytest.mark.parametrize("now", [datetime(2026, 9, 30, 8), datetime(2026, 9, 30, 18), datetime(2026, 9, 30, 17, tzinfo=timezone.utc)])
def test_immediate_call_accepts_dated_window(plan, now):
    validate_live_window(plan, now, single=True)


@pytest.mark.parametrize("text", ["Call +15555550100 now", "Call +1 (555) 555-0100 now", "Call (555) 555-0100 now", "Call 555.555.0100 now", "Call 555 555 0100 now", "Call 555-0100 now"])
def test_scrubber_covers_phone_formats(text):
    result = scrub_text(text)
    assert "•••" in result
    assert "555" not in result
    assert result.startswith("Call ") and result.endswith(" now")


def test_scrubber_preserves_dates_times_and_ordinary_text():
    text = "2026-09-30 08:00: awaiting retry 2 at Station 3"
    assert scrub_text(text) == text


@pytest.mark.parametrize("changes", [{"max_retries": "1"}, {"max_retries": True}, {"grace_minutes": 2.5}, {"retry_after_minutes": -1}, {"checkins": "14:00"}])
def test_yaml_cannot_coerce_invalid_types(tmp_path, changes):
    example = Path(__file__).resolve().parents[1] / "examples" / "trip.yaml"
    data = yaml.safe_load(example.read_text())
    data["trip"].update(changes)
    path = tmp_path / "plan.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(TripPlanError):
        load_trip_plan(path)


@pytest.mark.parametrize("content", ["not: [valid", "[]", "worker: []\ntrip: {}", "worker: {}\ntrip: {}"])
def test_malformed_yaml_is_a_plan_error(tmp_path, content):
    path = tmp_path / "plan.yaml"
    path.write_text(content)
    with pytest.raises(TripPlanError):
        load_trip_plan(path)


@pytest.mark.parametrize("number", ["+15555550100", "2025550111", "+1 (555) 555-0100", "(202) 555-0111"])
@pytest.mark.parametrize("suffix", ["x123", "X123", " ext123", "ext.123", " EXT. 123", " extension 123", "#123", ";ext=123"])
def test_scrubber_masks_phone_and_extension(number, suffix):
    text = f"Contact {number}{suffix} now"
    result = scrub_text(text)
    assert number not in result
    assert "123" not in result
    assert "•••" in result
    assert result.startswith("Contact ") and result.endswith(" now")


def test_extension_phone_is_masked_in_banner_and_live_report(plan):
    from dataclasses import replace
    from io import StringIO
    from rich.console import Console
    from fieldline.render import RichRenderer
    from fieldline.report import build_incident_brief

    phone = "+15555550100x123"
    plan = replace(plan, label=f"Contact {phone}", site=f"Site {phone}")
    stream = StringIO()
    renderer = RichRenderer(Console(file=stream, width=200, force_terminal=False))
    renderer.banner(plan, demo=False)
    brief = build_incident_brief(plan, [("14:00", f"Call {phone}", "info")], [], "review required", False)
    assert "+15555550100" not in stream.getvalue()
    assert "+15555550100" not in brief
    assert "123" not in stream.getvalue()
    assert "123" not in brief
