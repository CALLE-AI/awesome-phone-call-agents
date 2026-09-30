"""A district's own export, and one call per household.

Two behaviours, one file, because they are the same claim from two directions: a row is
not a call. A row can be a call under a different column name, and three rows can be one
call.
"""
from __future__ import annotations

import pytest

from dispatch import HOUSEHOLD_HELD, calls_removed, group_households
from dispatch.dialects import (
    CLEVER,
    NATIVE,
    ONEROSTER,
    DialectError,
    consent_refusal,
    recognise,
)
from dispatch.models import WorkItem
from dispatch.sources import CsvSource, SourceError


def write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8", newline="\n")
    return path


# --- which format is this ----------------------------------------------------------


def test_the_repositorys_own_columns_are_recognised_as_the_native_format():
    assert recognise(["id", "phones", "consent"]).name == NATIVE.name


def test_a_oneroster_export_is_recognised_by_its_own_identifier_field():
    assert recognise(["sourcedId", "phone", "sms", "consent"]).name == ONEROSTER.name


def test_a_clever_export_is_recognised_by_its_own_identifier_field():
    assert recognise(["student_id", "guardian_phone", "consent"]).name == CLEVER.name


def test_a_header_row_matching_two_formats_is_refused_rather_than_resolved_by_order():
    """Which column is the identifier decides which family is called about which child."""
    with pytest.raises(DialectError) as bad:
        recognise(["sourcedId", "student_id", "phone", "guardian_phone", "consent"])
    assert "at the same time" in str(bad.value)
    assert "--column-map" in str(bad.value)


def test_an_unrecognised_header_row_names_every_format_and_the_flag():
    with pytest.raises(DialectError) as bad:
        recognise(["PupilRef", "Contact1"])
    message = str(bad.value)
    for dialect in (NATIVE, ONEROSTER, CLEVER):
        assert dialect.name in message, f"{dialect.name} is not offered to the reader"
    assert "--column-map" in message
    assert "PupilRef" in message, "the reader is not told what their own header row says"


def test_a_supplied_mapping_wins_outright():
    """A district that has written a mapping has answered the question."""
    dialect = recognise(["PupilRef", "Contact1"],
                        custom={"id": ("PupilRef",), "phones": ("Contact1",)})
    assert dialect.mapping["id"] == ("PupilRef",)


# --- the column no export has -------------------------------------------------------


def test_a_recognised_export_with_no_consent_column_is_refused():
    refusal = consent_refusal(["sourcedId", "phone"], ONEROSTER)
    assert refusal is not None


def test_the_refusal_says_a_rename_cannot_produce_permission():
    """The most useful sentence in the program, so it is asserted rather than assumed.

    A district reading it at 08:40 is being told that its system of record does not hold
    the thing this software needs, which is the argument `docs/the-legal-surface.md`
    makes in prose. A refusal that said "missing column: consent" would make it look like
    a spelling problem.
    """
    refusal = consent_refusal(["sourcedId", "phone"], ONEROSTER)
    assert "no rename can produce it" in refusal
    assert "docs/consent-record.md" in refusal
    assert "--consent-records" in refusal


def test_the_native_format_keeps_its_own_shorter_refusal():
    """A hand-written file with no consent column is a different conversation."""
    refusal = consent_refusal(["id", "phones"], NATIVE)
    assert "will not guess" in refusal


def test_a_consent_column_satisfies_every_format():
    for dialect in (NATIVE, ONEROSTER, CLEVER):
        assert consent_refusal(["consent"], dialect) is None


# --- reading a real file ------------------------------------------------------------


def test_a_oneroster_file_reads_and_both_of_its_numbers_become_the_fallback_chain(tmp_path):
    path = write(tmp_path, "users.csv",
                 "sourcedId,phone,sms,consent\nS-1,+15550100201,+15550100901,yes\n")
    source = CsvSource(path)
    items = list(source.items())
    assert source.dialect.name == ONEROSTER.name
    assert items[0].id == "S-1"
    assert items[0].phones == ("+15550100201", "+15550100901"), (
        "sms is the second number in the chain, not a replacement for phone"
    )


def test_a_row_with_only_an_sms_number_still_has_a_number(tmp_path):
    path = write(tmp_path, "users.csv", "sourcedId,phone,sms,consent\nS-1,,+15550100901,yes\n")
    assert list(CsvSource(path).items())[0].phones == ("+15550100901",)


def test_the_source_column_survives_into_context(tmp_path):
    """A district reads a receipt against its own export, under its own column name."""
    path = write(tmp_path, "users.csv", "sourcedId,phone,consent\nS-1,+15550100201,yes\n")
    item = list(CsvSource(path).items())[0]
    assert item.context.get("sourcedId") == "S-1"


def test_a_clever_file_dials_the_guardian_before_the_student(tmp_path):
    path = write(tmp_path, "clever.csv",
                 "student_id,guardian_phone,phone,consent\nS-1,+15550100301,+15550100999,yes\n")
    item = list(CsvSource(path).items())[0]
    assert item.phones[0] == "+15550100301", (
        "a student's own number is not the number to ring about that student's absence"
    )


def test_a_oneroster_file_with_no_consent_column_refuses_through_the_source(tmp_path):
    path = write(tmp_path, "users.csv", "sourcedId,phone\nS-1,+15550100201\n")
    with pytest.raises(SourceError) as bad:
        list(CsvSource(path).items())
    assert "no rename can produce it" in str(bad.value)


def test_an_unrecognised_file_refuses_through_the_source(tmp_path):
    path = write(tmp_path, "mystery.csv", "PupilRef,Contact1,consent\nX,+1,yes\n")
    with pytest.raises(SourceError) as bad:
        list(CsvSource(path).items())
    assert "not a format this recognises" in str(bad.value)


def test_a_column_map_reads_a_file_no_format_recognises(tmp_path):
    path = write(tmp_path, "mystery.csv", "PupilRef,Contact1,consent\nX-1,+15550100201,yes\n")
    source = CsvSource(path, column_map={"id": ("PupilRef",), "phones": ("Contact1",)})
    item = list(source.items())[0]
    assert (item.id, item.phones) == ("X-1", ("+15550100201",))


# --- one call per household ---------------------------------------------------------


def rows(*specs):
    return [WorkItem(id=i, phones=(p,)) for i, p in specs]


def test_two_absences_on_one_number_place_one_call():
    out, held = group_households(rows(("S-1", "+15550100301"), ("S-2", "+15550100301")))
    assert calls_removed(held) == 1
    assert out[0].household_held_for is None
    assert out[1].household_held_for == "S-1"


def test_the_number_is_compared_on_its_digits():
    """`+1 555 010 0301` and `+15550100301` are one telephone, not two."""
    out, _ = group_households(rows(("S-1", "+1 555 010 0301"), ("S-2", "+15550100301")))
    assert out[1].household_held_for == "S-1"


def test_the_row_the_export_put_first_is_the_one_dialled():
    out, _ = group_households(rows(("S-9", "+15550100301"), ("S-1", "+15550100301")))
    assert out[0].id == "S-9" and out[0].household_held_for is None


def test_the_dialled_row_is_told_who_else_is_absent():
    """So the parent is asked once, about all of them, rather than once per child."""
    out, _ = group_households(rows(("S-1", "+15550100301"), ("S-2", "+15550100301"),
                                   ("S-3", "+15550100301")))
    assert out[0].context["also_absent"] == "S-2, S-3"


def test_a_held_row_is_not_closed_and_says_a_person_closes_it():
    out, _ = group_households(rows(("S-1", "+15550100301"), ("S-2", "+15550100301")))
    assert out[1].held_reason.startswith(HOUSEHOLD_HELD)
    assert "a person closes this one" in out[1].held_reason


def test_different_numbers_are_different_households():
    out, held = group_households(rows(("S-1", "+15550100301"), ("S-2", "+15550100999")))
    assert held == {} and all(r.household_held_for is None for r in out)


def test_a_row_nobody_was_going_to_dial_holds_nothing_behind_it():
    """A row with no consent is not a call, so a sibling behind it is not saved work."""
    first = WorkItem(id="S-1", phones=("+15550100301",), consented=False)
    second = WorkItem(id="S-2", phones=("+15550100301",))
    out, held = group_households([first, second])
    assert held == {}, "a sibling was held behind a call that was never going to happen"
    assert out[1].household_held_for is None


def test_a_row_the_telephone_cannot_reach_holds_nothing_behind_it():
    first = WorkItem(id="S-1", phones=("+15550100301",), reachable_by_voice=False)
    second = WorkItem(id="S-2", phones=("+15550100301",))
    _, held = group_households([first, second])
    assert held == {}


def test_a_row_refused_on_a_dated_record_holds_nothing_behind_it():
    first = WorkItem(id="S-1", phones=("+15550100301",),
                     consent_refusal="record CR-1 was withdrawn on 2026-09-01.")
    second = WorkItem(id="S-2", phones=("+15550100301",))
    _, held = group_households([first, second])
    assert held == {}


def test_an_unparseable_number_is_its_own_household():
    """Otherwise every row whose number is punctuation collapses into one family."""
    out, held = group_households(rows(("S-1", "+++"), ("S-2", "---")))
    assert held == {}, "two different unparseable numbers were read as one telephone"
    assert all(r.household_held_for is None for r in out)


def test_grouping_returns_every_row_it_was_given():
    given = rows(("S-1", "+15550100301"), ("S-2", "+15550100301"), ("S-3", "+15550100999"))
    out, _ = group_households(given)
    assert [r.id for r in out] == ["S-1", "S-2", "S-3"]


def test_a_run_with_no_shared_numbers_is_left_exactly_alone():
    given = rows(("S-1", "+15550100301"), ("S-2", "+15550100999"))
    out, held = group_households(given)
    assert out == given and held == {}


def test_the_summary_counts_held_rows_in_their_own_bucket():
    """Not under a cancelled run, which is where an unbucketed skip lands."""
    from firstbell.domain import summarise
    from dispatch import ItemResult, Resolution

    out, _ = group_households(rows(("S-1", "+15550100301"), ("S-2", "+15550100301")))
    results = [
        ItemResult(item=out[0], resolution=Resolution.RESOLVED,
                   structured_result={"parent_confirmed_aware": "yes"}),
        ItemResult(item=out[1], resolution=Resolution.SKIPPED, reason=out[1].held_reason),
    ]
    summary = summarise(results, calls_placed=1)
    assert summary.held_same_household == 1
    assert summary.skipped_not_dialled == 0, (
        "a held row was reported as a run somebody cancelled"
    )
    assert summary.skipped_no_consent == 0, (
        "a held row was reported as a family who had not consented"
    )
