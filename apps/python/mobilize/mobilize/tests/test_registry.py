from __future__ import annotations

from datetime import date

import pytest

from mobilize.core.registry import (
    Registry,
    RegistryError,
    load_registry_csv,
    load_registry_json,
    record_attendance,
    record_outcomes,
    save_registry_json,
)
from mobilize.core.types import CallOutcome, CallResult


def _write_csv(tmp_path, content: str):
    path = tmp_path / "registry.csv"
    path.write_text(content)
    return path


def test_load_registry_csv_minimal(tmp_path):
    path = _write_csv(tmp_path, "name,phone,timezone\nAsha Rao,+15550101001,Asia/Kolkata\n")
    registry = load_registry_csv(path)
    assert len(registry) == 1
    # Auto-generated ids are now phone-derived, not row-number-based (see
    # test_registry_validation.py for why), so look the person up by
    # content rather than assuming a specific id string.
    person = registry.all()[0]
    assert person.name == "Asha Rao"
    assert person.timezone == "Asia/Kolkata"
    # No history -> defaults, not zero and not crashing.
    assert person.accept_rate == 0.5


def test_load_registry_csv_full_columns(tmp_path):
    path = _write_csv(tmp_path, (
        "id,name,phone,timezone,last_donation,distance_km,accept_rate,showup_rate\n"
        "x1,Karan Mehta,+15550101002,Asia/Kolkata,2026-05-01,4.5,0.7,0.6\n"
    ))
    registry = load_registry_csv(path)
    person = registry.get("x1")
    assert person.last_donation == date(2026, 5, 1)
    assert person.distance_km == 4.5
    assert person.accept_rate == 0.7


def test_load_registry_csv_missing_required_column(tmp_path):
    path = _write_csv(tmp_path, "name,phone\nAsha Rao,+15550101001\n")
    with pytest.raises(RegistryError, match="timezone"):
        load_registry_csv(path)


def test_load_registry_csv_missing_value_in_row(tmp_path):
    path = _write_csv(tmp_path, "name,phone,timezone\n,+15550101001,Asia/Kolkata\n")
    with pytest.raises(RegistryError, match="Row 2"):
        load_registry_csv(path)


def test_load_registry_csv_bad_date(tmp_path):
    path = _write_csv(tmp_path, (
        "name,phone,timezone,last_donation\nAsha Rao,+15550101001,Asia/Kolkata,not-a-date\n"
    ))
    with pytest.raises(RegistryError, match="last_donation"):
        load_registry_csv(path)


def test_load_registry_csv_no_such_file(tmp_path):
    with pytest.raises(RegistryError, match="No such file"):
        load_registry_csv(tmp_path / "does_not_exist.csv")


def test_load_registry_csv_empty_rows(tmp_path):
    path = _write_csv(tmp_path, "name,phone,timezone\n")
    with pytest.raises(RegistryError, match="no rows"):
        load_registry_csv(path)


def test_person_eligibility_by_recency():
    from mobilize.core.registry import Person

    recent = Person(id="a", name="A", phone="+15550101001", timezone="UTC", last_donation=date(2026, 7, 20))
    long_ago = Person(id="b", name="B", phone="+15550101002", timezone="UTC", last_donation=date(2026, 1, 1))
    never = Person(id="c", name="C", phone="+15550101003", timezone="UTC")

    today = date(2026, 8, 6)
    assert not recent.is_eligible(56, today)   # 17 days ago, too recent
    assert long_ago.is_eligible(56, today)      # well past the window
    assert never.is_eligible(56, today)         # no record -> treated as eligible


def test_registry_to_candidates_carries_timezone_and_eligibility():
    path_content = "name,phone,timezone,last_donation\nAsha,+15550101001,Asia/Kolkata,2026-01-01\n"
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        from pathlib import Path
        p = Path(tmp) / "r.csv"
        p.write_text(path_content)
        registry = load_registry_csv(p)
    candidates = registry.candidates(min_days_between_donations=56, today=date(2026, 8, 6))
    assert len(candidates) == 1
    assert candidates[0].timezone == "Asia/Kolkata"
    assert candidates[0].eligible is True


def test_save_and_load_registry_json_round_trip(tmp_path):
    csv_path = _write_csv(tmp_path, (
        "id,name,phone,timezone,last_donation,distance_km,accept_rate,showup_rate\n"
        "x1,Karan Mehta,+15550101002,Asia/Kolkata,2026-05-01,4.5,0.7,0.6\n"
    ))
    registry = load_registry_csv(csv_path)
    json_path = tmp_path / "registry.json"
    save_registry_json(registry, json_path)

    reloaded = load_registry_json(json_path)
    person = reloaded.get("x1")
    assert person.name == "Karan Mehta"
    assert person.last_donation == date(2026, 5, 1)
    assert person.accept_rate == 0.7


def test_load_registry_json_missing_file_returns_empty():
    from pathlib import Path
    registry = load_registry_json(Path("/tmp/definitely_does_not_exist_mobilize.json"))
    assert len(registry) == 0


def test_record_outcomes_nudges_accept_rate_up_on_firm_yes():
    csv_content = "id,name,phone,timezone,accept_rate,showup_rate\nx1,A,+15550101001,UTC,0.5,0.5\n"
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "r.csv"
        p.write_text(csv_content)
        registry = load_registry_csv(p)

    result = CallResult(
        call_id="c1", candidate_id="x1", outcome=CallOutcome.FIRM_YES,
        commitment_score=0.9, stated_yes=True, evidence="leaving now",
    )
    updated = record_outcomes(registry, [result])
    assert "x1" in updated
    person = registry.get("x1")
    assert person.accept_rate > 0.5  # moved toward accepted
    assert person.showup_rate > 0.5  # moved toward the high commitment score
    assert person.times_called == 1


def test_record_outcomes_nudges_down_on_decline():
    csv_content = "id,name,phone,timezone,accept_rate\nx1,A,+15550101001,UTC,0.5\n"
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "r.csv"
        p.write_text(csv_content)
        registry = load_registry_csv(p)

    result = CallResult(
        call_id="c1", candidate_id="x1", outcome=CallOutcome.NO,
        commitment_score=0.0, stated_yes=False, evidence="can't make it",
    )
    record_outcomes(registry, [result])
    assert registry.get("x1").accept_rate < 0.5


def test_record_outcomes_no_answer_does_not_move_accept_rate():
    csv_content = "id,name,phone,timezone,accept_rate\nx1,A,+15550101001,UTC,0.5\n"
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "r.csv"
        p.write_text(csv_content)
        registry = load_registry_csv(p)

    result = CallResult(
        call_id="c1", candidate_id="x1", outcome=CallOutcome.NO_ANSWER,
        commitment_score=0.0, stated_yes=False, evidence="",
    )
    record_outcomes(registry, [result])
    # Not reached, so accept_rate is unmoved -- an unanswered call says
    # nothing about willingness to help.
    assert registry.get("x1").accept_rate == 0.5
    assert registry.get("x1").times_called == 1


def test_record_outcomes_unknown_candidate_id_ignored_gracefully():
    registry = Registry()
    result = CallResult(
        call_id="c1", candidate_id="nonexistent", outcome=CallOutcome.FIRM_YES,
        commitment_score=0.9, stated_yes=True, evidence="",
    )
    updated = record_outcomes(registry, [result])
    assert updated == []


def test_record_attendance_ground_truth_overrides_toward_observed():
    csv_content = "id,name,phone,timezone,showup_rate\nx1,A,+15550101001,UTC,0.9\n"
    import tempfile
    from pathlib import Path
    with tempfile.TemporaryDirectory() as tmp:
        p = Path(tmp) / "r.csv"
        p.write_text(csv_content)
        registry = load_registry_csv(p)

    record_attendance(registry, "x1", showed_up=False)
    assert registry.get("x1").showup_rate < 0.9


def test_nudge_stays_within_bounds():
    from mobilize.core.registry import _nudge

    result = _nudge(0.95, 1.0, 0.9)
    assert result <= 0.98
    result = _nudge(0.05, 0.0, 0.9)
    assert result >= 0.02
