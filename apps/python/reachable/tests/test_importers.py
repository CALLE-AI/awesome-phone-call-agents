"""CSV import: structural failures are fatal, bad rows are rejected with reasons."""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from reachable.importers import ImportReport, language_supported, load_dataset
from reachable.models import Contact
from reachable.sessions import find_triggers

SAMPLE = Path(__file__).resolve().parent.parent / "sample_data"


@pytest.fixture(scope="module")
def imported():
    dataset, report = load_dataset(SAMPLE)
    return dataset, report


def test_sample_data_imports_cleanly(imported):
    dataset, report = imported
    assert report.ok, report.fatal
    assert dataset.school is not None
    assert dataset.school.school_name == "Fernhollow Primary School"
    assert dataset.school.timezone == "Europe/London"
    assert dataset.school.has_first_day_process


def test_sample_has_the_documented_scale(imported):
    dataset, report = imported
    assert report.accepted["pupils"] == 12
    # 22 contact rows, one of which has an invalid number and is rejected.
    assert report.accepted["contacts"] == 21
    assert report.accepted["register_sessions"] > 300


def test_the_invalid_number_is_rejected_with_a_reason_and_never_imported(imported):
    dataset, report = imported
    bad = [p for p in report.rejected if p.file == "contacts.csv"]
    assert len(bad) == 1
    assert "invalid phone number" in bad[0].reason
    assert "country code" in bad[0].reason
    # Reported masked: this report is displayed and exported.
    assert "07700900182" not in bad[0].detail
    assert bad[0].detail.endswith("…182")
    assert all(c.contact_id != "C-2131" for c in dataset.contacts)


def test_row_numbers_match_what_the_office_sees_in_a_spreadsheet(imported):
    _, report = imported
    bad = [p for p in report.rejected if p.file == "contacts.csv"][0]
    # C-2131 is the 13th data row, so line 14 including the header.
    assert bad.row_number == 14


def test_every_imported_number_is_in_the_drama_range(imported):
    """No fixture number may be able to ring a real subscriber."""
    from reachable.phone import is_drama_number

    dataset, _ = imported
    for contact in dataset.contacts:
        assert is_drama_number(contact.phone_e164), contact.contact_id


def test_cascade_order_is_the_schools_own(imported):
    dataset, _ = imported
    order = [c.contact_id for c in dataset.contacts_for("P-1041")]
    assert order == ["C-2089", "C-2090", "C-2088"]


def test_non_emergency_and_do_not_call_contacts_are_excluded(imported):
    dataset, _ = imported
    assert [c.contact_id for c in dataset.contacts_for("P-1118")] == ["C-2170"]
    assert [c.contact_id for c in dataset.contacts_for("P-1165")] == ["C-2190"]


def test_designed_trigger_cases(imported):
    dataset, _ = imported

    ivy = find_triggers(dataset, "P-1041", threshold=2)
    assert len(ivy) == 1 and ivy[0].trigger_date == date(2026, 9, 11)

    # Across the half-term holiday.
    sam = find_triggers(dataset, "P-1177", threshold=2)
    assert len(sam) == 1 and sam[0].trigger_date == date(2026, 9, 16)

    # Vulnerable pupil still triggers; the refusal happens at screening.
    assert len(find_triggers(dataset, "P-1203", threshold=2)) == 1

    # A reason recorded on the second session breaks the chain.
    assert find_triggers(dataset, "P-1015", threshold=2) == []
    # One session is below threshold.
    assert find_triggers(dataset, "P-1058", threshold=2) == []
    # Authorised illness is not unexplained.
    assert find_triggers(dataset, "P-1064", threshold=2) == []


def test_language_gate_identifies_the_swedish_contact(imported):
    dataset, _ = imported
    swedish = next(c for c in dataset.contacts if c.contact_id == "C-2120")
    assert not language_supported(swedish)
    english = next(c for c in dataset.contacts if c.contact_id == "C-2088")
    assert language_supported(english)


@pytest.mark.parametrize("value", ["", "English", "english", "en", "en-GB", "eng"])
def test_english_variants_are_supported(value):
    assert language_supported(_contact(language=value))


@pytest.mark.parametrize("value", ["Swedish", "Polish", "Urdu", "fr-FR", "Romanian"])
def test_other_languages_are_not(value):
    assert not language_supported(_contact(language=value))


def _contact(**kwargs) -> Contact:
    return Contact(
        contact_id="C-1",
        pupil_id="P-1",
        contact_order=1,
        contact_name="Test Person",
        phone_e164="+447700900123",
        **kwargs,
    )


# ------------------------------------------------------------- failure modes


def write(tmp_path: Path, name: str, text: str) -> None:
    (tmp_path / name).write_text(text.strip() + "\n", encoding="utf-8")


def minimal(tmp_path: Path) -> None:
    write(
        tmp_path,
        "school.csv",
        "school_name,timezone,call_window_start,call_window_end,first_day_process_description\n"
        "Test School,Europe/London,09:00,16:00,Office calls on day one",
    )
    write(
        tmp_path,
        "pupils.csv",
        "pupil_id,first_name,last_name,vulnerable_flag\nP-1,Ivy,Brennan,N",
    )
    write(
        tmp_path,
        "contacts.csv",
        "contact_id,pupil_id,contact_order,contact_name,phone_e164,is_emergency_contact\n"
        "C-1,P-1,1,Janet Okoro,+447700900142,Y",
    )
    write(tmp_path, "school_calendar.csv", "date,day_type\n2026-09-07,SCHOOL_DAY")
    write(tmp_path, "register.csv", "pupil_id,date,session,code\nP-1,2026-09-07,AM,N")


def test_a_missing_file_is_fatal(tmp_path):
    minimal(tmp_path)
    (tmp_path / "school.csv").unlink()
    dataset, report = load_dataset(tmp_path)
    assert not report.ok
    assert "school.csv" in report.fatal
    assert dataset.pupils == {}  # nothing half-imported


def test_a_missing_column_is_fatal(tmp_path):
    minimal(tmp_path)
    write(tmp_path, "pupils.csv", "pupil_id,first_name\nP-1,Ivy")
    _, report = load_dataset(tmp_path)
    assert not report.ok
    assert "missing column" in report.fatal


def test_a_register_date_with_no_calendar_row_is_fatal(tmp_path):
    """Guessing which days are school days would be wrong every half-term."""
    minimal(tmp_path)
    write(
        tmp_path,
        "register.csv",
        "pupil_id,date,session,code\nP-1,2026-09-07,AM,N\nP-1,2026-12-25,AM,N",
    )
    _, report = load_dataset(tmp_path)
    assert not report.ok
    assert "2026-12-25" in report.fatal


def test_two_school_rows_are_fatal(tmp_path):
    minimal(tmp_path)
    write(
        tmp_path,
        "school.csv",
        "school_name,timezone,call_window_start,call_window_end,first_day_process_description\n"
        "A,Europe/London,09:00,16:00,x\nB,Europe/London,09:00,16:00,y",
    )
    _, report = load_dataset(tmp_path)
    assert not report.ok
    assert "single-school" in report.fatal


def test_a_bad_timezone_is_fatal_and_never_guessed(tmp_path):
    minimal(tmp_path)
    write(
        tmp_path,
        "school.csv",
        "school_name,timezone,call_window_start,call_window_end,first_day_process_description\n"
        "Test School,BST,09:00,16:00,x",
    )
    _, report = load_dataset(tmp_path)
    assert not report.ok
    assert "IANA" in report.fatal


def test_an_inverted_calling_window_is_fatal(tmp_path):
    minimal(tmp_path)
    write(
        tmp_path,
        "school.csv",
        "school_name,timezone,call_window_start,call_window_end,first_day_process_description\n"
        "Test School,Europe/London,16:00,09:00,x",
    )
    _, report = load_dataset(tmp_path)
    assert not report.ok


def test_an_empty_first_day_process_imports_but_disables_workflow_b(tmp_path):
    minimal(tmp_path)
    write(
        tmp_path,
        "school.csv",
        "school_name,timezone,call_window_start,call_window_end,first_day_process_description\n"
        "Test School,Europe/London,09:00,16:00,",
    )
    dataset, report = load_dataset(tmp_path)
    assert report.ok
    assert not dataset.school.has_first_day_process


def test_orphan_rows_are_rejected_not_fatal(tmp_path):
    minimal(tmp_path)
    write(
        tmp_path,
        "contacts.csv",
        "contact_id,pupil_id,contact_order,contact_name,phone_e164,is_emergency_contact\n"
        "C-1,P-1,1,Janet Okoro,+447700900142,Y\n"
        "C-9,P-NOPE,1,Ghost Person,+447700900143,Y",
    )
    dataset, report = load_dataset(tmp_path)
    assert report.ok
    assert len(dataset.contacts) == 1
    assert any("does not match any pupil" in p.reason for p in report.rejected)


def test_duplicate_ids_are_rejected(tmp_path):
    minimal(tmp_path)
    write(
        tmp_path,
        "pupils.csv",
        "pupil_id,first_name,last_name,vulnerable_flag\nP-1,Ivy,Brennan,N\nP-1,Other,Person,N",
    )
    dataset, report = load_dataset(tmp_path)
    assert len(dataset.pupils) == 1
    assert any("duplicate pupil_id" in p.reason for p in report.rejected)


def test_the_vulnerable_flag_fails_safe(tmp_path):
    """Anything not explicitly N means vulnerable. A typo must not un-flag a child."""
    minimal(tmp_path)
    write(
        tmp_path,
        "pupils.csv",
        "pupil_id,first_name,last_name,vulnerable_flag\n"
        "P-1,Ivy,Brennan,N\nP-2,Sam,Adeyemi,y\nP-3,Dylan,Okafor,maybe\nP-4,Lee,Novak,",
    )
    dataset, _ = load_dataset(tmp_path)
    assert dataset.pupils["P-1"].vulnerable is False
    assert dataset.pupils["P-2"].vulnerable is True
    assert dataset.pupils["P-3"].vulnerable is True   # unparseable -> treated as flagged
    assert dataset.pupils["P-4"].vulnerable is False  # blank is the documented "no"


def test_report_summary_is_human_readable(imported):
    _, report = imported
    text = report.summary()
    assert "Imported" in text and "pupils: 12" in text and "1 row(s) rejected" in text


def test_summary_reports_a_fatal_error():
    report = ImportReport()
    report.fatal = "missing required file(s): school.csv"
    assert report.summary().startswith("Import failed")
