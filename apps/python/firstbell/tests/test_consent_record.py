"""The dated consent record, and the seven ways a row fails to have one.

`docs/the-legal-surface.md` has always said that the largest open question in this software
is what a district's consent artifact actually is, and that a defensible answer replaces
the boolean column with a reference to a dated record. It called that a schema change and
a district conversation, then did the conversation half. A blind reviewer reading the entry
as a district operations director put it precisely: a district cannot take anything home
from this except the argument.

This is the schema half, and this file is what keeps it honest. Every check fails closed:
a record that cannot be read, does not cover this student, covers text messages, covers
general contact, has been withdrawn, has expired, or is dated tomorrow, all end the same
way, which is that nobody's phone rings. The cost of being wrong in the other direction is
a call to a family that asked not to be called, and no run summary makes that up to them.
"""
from __future__ import annotations

from datetime import date

import pytest

from dispatch.consent import (CHANNELS, PURPOSES, RECORD_SCHEMA, REQUIRED, RegisterError,
                              load_register, record_from, refusal)

TODAY = date(2026, 9, 7)


def _raw(**over) -> dict:
    base = {
        "id": "CR-1",
        "student_id": "S-1",
        "channel": "voice",
        "purpose": "attendance",
        "given_at": "2026-08-14",
    }
    base.update(over)
    return base


def _record(**over):
    return record_from(_raw(**over), "a record")


# ---- the seven refusals, one test each

def test_a_reference_to_a_record_nobody_can_produce_is_not_a_record():
    assert "not in the register" in refusal(None, "S-1", "CR-9", TODAY)


def test_one_familys_permission_is_not_anothers():
    """The check that stops a register being a blanket permission for the roster.

    A register with one good record in it and a work file that points every row at that
    record would otherwise dial the whole school on one family's signature.
    """
    said = refusal(_record(student_id="S-2"), "S-1", "CR-1", TODAY)
    assert said and "is for S-2, not S-1" in said


def test_a_withdrawn_record_refuses_and_says_when():
    said = refusal(_record(withdrawn_at="2026-09-01"), "S-1", "CR-1", TODAY)
    assert said and "withdrawn on 2026-09-01" in said


def test_any_withdrawal_value_at_all_means_withdrawn():
    """Not a boolean, and not a comparison against today.

    A withdrawal dated in the future is somebody recording that a parent is withdrawing,
    and reading that as "still consented until then" is a reading nobody would defend to
    the parent.
    """
    said = refusal(_record(withdrawn_at="2027-01-01"), "S-1", "CR-1", TODAY)
    assert said and "withdrawn" in said


def test_an_expired_record_refuses_on_the_day_after_it_expires():
    assert refusal(_record(expires_at="2026-09-07"), "S-1", "CR-1", TODAY) is None, (
        "a record that expires today still covers today")
    said = refusal(_record(expires_at="2026-09-06"), "S-1", "CR-1", TODAY)
    assert said and "expired on 2026-09-06" in said


def test_a_permission_dated_tomorrow_has_not_been_given_yet():
    said = refusal(_record(given_at="2026-09-08"), "S-1", "CR-1", TODAY)
    assert said and "in the future" in said


def test_consent_to_be_texted_is_not_consent_to_be_telephoned():
    said = refusal(_record(channel="sms"), "S-1", "CR-1", TODAY)
    assert said and "covers sms, not voice" in said


def test_general_contact_is_not_permission_to_call_about_an_absence():
    """The reason the purpose enum exists.

    A district that ticks one box at enrolment has not agreed to a telephone call about
    a child who did not arrive, and a schema that cannot express the difference invites
    the reading that it has.
    """
    said = refusal(_record(purpose="general"), "S-1", "CR-1", TODAY)
    assert said and "not permission to telephone about an absence" in said


def test_a_record_that_covers_the_call_is_not_refused():
    assert refusal(_record(), "S-1", "CR-1", TODAY) is None


# ---- the record itself

def test_every_required_field_is_required():
    for field in REQUIRED:
        raw = _raw()
        del raw[field]
        with pytest.raises(RegisterError) as caught:
            record_from(raw, "a record")
        assert field in str(caught.value)


def test_a_blank_required_field_is_missing_rather_than_present():
    with pytest.raises(RegisterError):
        record_from(_raw(student_id="   "), "a record")


def test_an_unrecognised_key_is_refused_rather_than_ignored():
    """The misspelling that would matter most.

    `witdrawn_at` on a record nobody proofread is a withdrawal this code cannot see, and
    a schema that ignores unknown keys reads that record as one nobody withdrew. That is
    the single misreading in this file that ends with a call to a family that asked not to
    be called, so an unknown key stops the register instead.
    """
    with pytest.raises(RegisterError) as caught:
        record_from(_raw(witdrawn_at="2026-09-01"), "a record")
    assert "witdrawn_at" in str(caught.value)


def test_a_date_that_does_not_parse_stops_the_register():
    with pytest.raises(RegisterError) as caught:
        record_from(_raw(given_at="14 August 2026"), "a record")
    assert "ISO 8601" in str(caught.value)


def test_a_channel_or_purpose_outside_the_enum_is_refused():
    for over in ({"channel": "carrier pigeon"}, {"purpose": "marketing"}):
        with pytest.raises(RegisterError):
            record_from(_raw(**over), "a record")


def test_the_published_schema_describes_the_code_that_enforces_it():
    """A schema document that drifts from the checker is worse than none.

    A district validating its register with its own tooling has to get the same answer
    this does, so the enums and the required list are read from one place.
    """
    assert RECORD_SCHEMA["required"] == list(REQUIRED)
    assert RECORD_SCHEMA["properties"]["channel"]["enum"] == list(CHANNELS)
    assert RECORD_SCHEMA["properties"]["purpose"]["enum"] == list(PURPOSES)


# ---- the register

def test_a_register_may_be_a_list_or_an_object_with_records():
    both = (load_register([_raw()]), load_register({"records": [_raw()]}))
    assert both[0].keys() == both[1].keys() == {"CR-1"}


def test_an_object_register_with_no_records_key_is_refused():
    with pytest.raises(RegisterError) as caught:
        load_register({"consents": [_raw()]})
    assert "records" in str(caught.value)


def test_an_empty_register_is_refused_rather_than_refusing_every_family():
    """Third outcome, and the one that would look like a finding.

    A run pointed at an empty register refuses every row and prints a wave of consent
    refusals, which reads as a statement about families when it is a statement about a
    file path.
    """
    with pytest.raises(RegisterError) as caught:
        load_register([])
    assert "empty" in str(caught.value)


def test_two_records_sharing_an_id_are_refused():
    with pytest.raises(RegisterError) as caught:
        load_register([_raw(), _raw(student_id="S-2")])
    assert "share the id" in str(caught.value)


def test_one_bad_record_stops_the_whole_register():
    """Not per-row. A register with one malformed record is a document somebody has to
    look at, and dialling the rows it happened to parse is calling families on the
    strength of a file nobody trusts."""
    with pytest.raises(RegisterError):
        load_register([_raw(), _raw(id="CR-2", given_at="soon")])


# ---- the work file, the run, and the two kinds of permission

def _source(tmp_path, rows: str, register=None):
    from dispatch.sources import CsvSource
    path = tmp_path / "work.csv"
    path.write_text(rows, encoding="utf-8", newline="\n")
    return list(CsvSource(path, consent_register=register, today=TODAY).items())


def test_a_row_naming_a_record_carries_the_registers_verdict(tmp_path):
    register = load_register([_raw(student_id="S-1", withdrawn_at="2026-09-01")])
    items = _source(tmp_path,
                    "id,phones,consent,consent_record\n"
                    "S-1,+915550000001,yes,CR-1\n", register)
    assert items[0].consent_record == "CR-1"
    assert "withdrawn" in items[0].consent_refusal


def test_a_row_with_no_reference_still_dials_on_the_boolean(tmp_path):
    """The column is optional on purpose. A boolean is what an SIS export gives a school
    today, and refusing every existing work file would be a schema change dressed as a
    safety improvement."""
    items = _source(tmp_path, "id,phones,consent\nS-1,+915550000001,yes\n")
    assert items[0].consented is True
    assert items[0].consent_record is None
    assert items[0].consent_refusal is None


def test_naming_a_record_with_no_register_supplied_refuses_the_row(tmp_path):
    """The one case where dialling would be worse than before the column existed.

    A row that points at a record looks better documented than a boolean row. If nothing
    checks it, it is documented less.
    """
    items = _source(tmp_path,
                    "id,phones,consent,consent_record\n"
                    "S-1,+915550000001,yes,CR-1\n", None)
    assert items[0].consent_refusal and "no register" in items[0].consent_refusal


def test_a_work_file_with_records_and_no_consent_column_is_still_refused(tmp_path):
    """The rule this change was not allowed to weaken.

    `CsvSource` refuses a file with no `consent` column, because a missing column is
    ambiguous and the safe reading of an ambiguous consent record is not "go ahead".
    Adding an optional column next to it must not turn that into a way around it.
    """
    from dispatch.sources import SourceError
    with pytest.raises(SourceError) as caught:
        _source(tmp_path,
                "id,phones,consent_record\nS-1,+915550000001,CR-1\n",
                load_register([_raw()]))
    assert "consent" in str(caught.value)


def test_the_dispatcher_skips_a_refused_row_and_keeps_the_reason():
    from dispatch import NO_CONSENT, Resolution, WorkItem
    from firstbell.domain import summarise
    from dispatch.models import ItemResult
    refused = ItemResult(
        item=WorkItem(id="S-1", phones=("+915550000001",), consent_record="CR-1",
                      consent_refusal="consent record 'CR-1' was withdrawn on 2026-09-01."),
        resolution=Resolution.SKIPPED,
        reason=f"{NO_CONSENT}: consent record 'CR-1' was withdrawn on 2026-09-01.")
    s = summarise([refused], live=False)
    assert s.skipped_no_consent == 1, (
        "the reason carries the register's sentence after it, so an equality test counted "
        "this row in no bucket at all and it fell into the one for a cancelled run")
    assert s.skipped_not_dialled == 0


def test_the_run_says_which_rows_rested_on_a_record_and_which_on_a_column():
    from dispatch import Resolution, WorkItem
    from dispatch.models import ItemResult
    from firstbell.domain import summarise
    on_record = ItemResult(item=WorkItem(id="S-1", phones=("+915550000001",),
                                         consent_record="CR-1"),
                           resolution=Resolution.RESOLVED, attempts_made=1,
                           placed_by_this_run=True)
    on_boolean = ItemResult(item=WorkItem(id="S-2", phones=("+915550000002",)),
                            resolution=Resolution.RESOLVED, attempts_made=1,
                            placed_by_this_run=True)
    s = summarise([on_record, on_boolean], live=False)
    assert s.dialled_on_a_record == 1
    assert s.dialled_on_a_boolean == 1
    text = "\n".join(s.lines())
    assert "on a record" in text and "on a boolean" in text
    assert "which is not a record" in text, (
        "the boolean count is the district's open exposure and the line beside it has to "
        "say so, or it reads as a second way of being compliant")


def test_the_shipped_example_register_covers_every_refusal():
    """The example is the artifact a district takes home, so it has to teach all of it.

    Six records: one plain, one open-ended, one withdrawn, one expired, one for text
    messages, one for general contact. Anything less would document the happy path.
    """
    import json
    from pathlib import Path
    app = Path(__file__).resolve().parent.parent
    register = load_register(
        json.loads((app / "examples" / "consent-register.json").read_text(encoding="utf-8")))
    verdicts = {rid: refusal(rec, rec.student_id, rid, TODAY)
                for rid, rec in register.items()}
    said = [v for v in verdicts.values() if v]
    assert len(register) == 6
    assert sum(1 for v in verdicts.values() if v is None) == 2
    for phrase in ("withdrawn on", "expired on", "covers sms", "covers general"):
        assert any(phrase in v for v in said), f"no record in the example demonstrates {phrase!r}"
