"""The dated consent record, and the eight ways a row fails to have one.

`docs/the-legal-surface.md` has always said that the largest open question in this software
is what a district's consent artifact actually is, and that a defensible answer replaces
the boolean column with a reference to a dated record. It called that a schema change and
a district conversation, then did the conversation half. Somebody coming to the entry as a
district operations director put it precisely: a district cannot take anything home
from this except the argument.

This is the schema half, and this file is what keeps it honest. Every check fails closed:
a record that cannot be read, does not cover this student, covers text messages, covers
general contact, has been withdrawn, has expired, is dated tomorrow, or names numbers and
not the one on the row, all end the same way, which is that nobody's phone rings. The cost of being wrong in the other direction is
a call to a family that asked not to be called, and no run summary makes that up to them.
"""
from __future__ import annotations

from datetime import date

import pytest

from dispatch.consent import (CHANNELS, PURPOSES, RECORD_SCHEMA, REQUIRED, ConsentRecord,
                              RegisterError, load_register, record_from, refusal)

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

    Seven records: one plain, one open-ended, one withdrawn, one expired, one for
    text messages, one for general contact, one naming a number. Anything less would
    document the happy path.
    """
    import json
    from pathlib import Path
    app = Path(__file__).resolve().parent.parent
    register = load_register(
        json.loads((app / "examples" / "consent-register.json").read_text(encoding="utf-8")))
    verdicts = {rid: refusal(rec, rec.student_id, rid, TODAY)
                for rid, rec in register.items()}
    said = [v for v in verdicts.values() if v]
    assert len(register) == 7
    # Three pass on the record alone. The seventh is refused only once a row's numbers are
    # handed to the check, which is the next test.
    assert sum(1 for v in verdicts.values() if v is None) == 3
    for phrase in ("withdrawn on", "expired on", "covers sms", "covers general"):
        assert any(phrase in v for v in said), f"no record in the example demonstrates {phrase!r}"


def test_a_record_that_names_numbers_refuses_a_row_carrying_another_one():
    """The check the district's data protection officer asked for.

    Under the TCPA the permission attaches to the number dialled and not to the pupil the
    number belongs to. This software works down a fallback chain, so a record covering the
    first of two numbers and nothing else would have authorised a call to the second.
    """
    record = _record(phones=["+15550100301"])
    assert refusal(record, "S-1", "CR-1", TODAY, ("+15550100301",)) is None
    said = refusal(record, "S-1", "CR-1", TODAY, ("+15550100301", "+15550100999"))
    assert said is not None
    assert "1 the record does not name" in said
    assert "attaches to the number called" in said


def test_the_number_check_compares_digits_and_not_punctuation():
    """A register typed by a person and an export written by a system are one telephone.

    Refusing `+1 555 010 0301` against `+15550100301` would refuse every register anybody
    maintains by hand, which is a check that reads as strict and only stops real families
    being called about a real absence.
    """
    record = _record(phones=["+1 (555) 010-0301"])
    assert refusal(record, "S-1", "CR-1", TODAY, ("+15550100301",)) is None
    assert record.covers_number("+15550100301")
    assert not record.covers_number("+15550100302")


def test_a_word_in_a_phone_column_matches_nothing_on_either_side():
    """`unknown` is not a telephone, and two of them are not the same telephone.

    The check compares digits, which is what makes a register typed by a person and an
    export written by a system agree. Strip the digits out of `unknown` and nothing is
    left, and nothing equals nothing, so a record holding `unknown` covered a row carrying
    `unknown` and the row was dialled on a permission that names no number at all.

    Both loaders refuse that entry now. This asserts the decision itself, because a guard
    that relies on its callers having validated first is a guard the fourth caller
    removes.
    """
    # The dataclass directly, because `record_from` refuses this entry now. This is the
    # state the decision has to answer for even when no loader will hand it over.
    record = ConsentRecord(
        id="CR-1", student_id="S-1", channel="voice", purpose="attendance",
        given_at=date(2026, 8, 14), phones=("unknown",))
    assert not record.covers_number("unknown")
    assert not record.covers_number("n/a")
    assert not record.covers_number("")
    assert refusal(record, "S-1", "CR-1", TODAY, ("unknown",)) is not None


def test_the_register_refuses_a_phone_with_no_digits_in_it():
    """A district export writes `unknown` into a phone column, and this catches it there.

    The message says what is wrong with the entry rather than that the register is
    invalid, because the person reading it has a spreadsheet open and the cell looks
    filled in.
    """
    with pytest.raises(RegisterError) as caught:
        record_from(_raw(phones=["unknown"]), "CR-1")
    assert "no digits" in str(caught.value)
    assert "unknown" in str(caught.value)


def test_a_row_whose_only_number_is_a_word_is_refused_by_name(tmp_path):
    """And the same shape on the other side, in the work file.

    It used to become an attempt: the dialler tried `unknown`, the platform refused it,
    and the row spent a place in its fallback chain on a word.
    """
    from dispatch.sources import CsvSource, SourceError

    path = tmp_path / "absences.csv"
    path.write_text("id,phones,consent\nS-1,unknown,yes\n", encoding="utf-8")
    with pytest.raises(SourceError) as caught:
        list(CsvSource(path).items())
    # The quoted cell, because an empty column and a column holding a word are different
    # things to whoever has to fix the export.
    assert "'unknown'" in str(caught.value)
    assert "no digits" in str(caught.value)


def test_a_row_keeps_the_numbers_that_are_numbers(tmp_path):
    """One word beside one telephone leaves one telephone, and the row runs.

    The count of numbers on the row is the count of numbers somebody could answer, which
    is what the fallback chain and every attempt figure are built on.
    """
    from dispatch.sources import CsvSource

    path = tmp_path / "absences.csv"
    path.write_text('id,phones,consent\nS-1,"unknown,+15550100301",yes\n',
                    encoding="utf-8")
    items = list(CsvSource(path).items())
    assert len(items) == 1
    assert items[0].phones == ("+15550100301",)


def test_a_record_naming_no_number_still_dials_and_is_counted_instead():
    """The exposure this leaves, stated rather than closed.

    Every register written before the field existed names no numbers. Refusing those rows
    would stop every deployment that has one, so they dial, and `ImpactSummary` prints how
    many did. A count in the run is the honest version of not refusing them; silence would
    be the software agreeing with itself.
    """
    assert refusal(_record(), "S-1", "CR-1", TODAY, ("+15550100301",)) is None


def test_a_row_with_no_numbers_cannot_be_refused_for_its_numbers():
    """`numbers=()` is the default, so every existing caller keeps its behaviour.

    The check needs both halves: a record that names numbers and a row that carries some.
    Missing either one is not evidence of anything.
    """
    assert refusal(_record(phones=["+15550100301"]), "S-1", "CR-1", TODAY) is None


def test_phones_has_to_be_a_list_even_for_one_number():
    """A comma-joined string read as one number produces a record covering nobody.

    `"+15550100301,+15550100302"` is a register somebody exported wrong. Read as a single
    telephone it covers neither number on the row, which refuses a family whose permission
    is on file, and the reason printed would be about a number nobody has.
    """
    with pytest.raises(RegisterError) as caught:
        record_from(_raw(phones="+15550100301,+15550100302"), "record 1")
    said = str(caught.value)
    assert "even for one number" in said, (
        "the generic 'not a list' refusal already stops a string, so the only thing this "
        "branch adds is the reason, and a test asserting the generic phrase would pass "
        "with the reason deleted")
    assert "comma-joined" in said


def test_phones_refuses_an_entry_that_is_not_a_telephone_number():
    for bad in ([""], ["   "], [None], [42], [["+15550100301"]]):
        with pytest.raises(RegisterError):
            record_from(_raw(phones=bad), "record 1")


def test_phones_is_in_the_schema_the_docs_are_generated_from():
    """The field has to be in `RECORD_SCHEMA` or the documented shape omits it.

    `docs/consent-record.md` has a field table, and a schema that does not carry the field
    is a document that tells a district the record cannot hold a number.
    """
    assert "phones" in RECORD_SCHEMA["properties"]
    assert RECORD_SCHEMA["properties"]["phones"]["type"] == "array"
    assert "phones" not in REQUIRED


def test_the_shipped_example_refuses_the_row_whose_number_is_not_named():
    """The register and the work file beside it have to still agree after this change.

    The register's own comment claims it covers every way a row is refused. There are
    eight ways now, and a claim like that is worth exactly as much as the test under it.
    """
    import csv
    import json
    from pathlib import Path
    app = Path(__file__).resolve().parent.parent
    register = load_register(json.loads(
        (app / "examples" / "consent-register.json").read_text(encoding="utf-8")))
    rows = list(csv.DictReader(
        (app / "examples" / "absences-with-consent.csv").read_text(
            encoding="utf-8").splitlines()))

    verdicts = {}
    for row in rows:
        reference = (row["consent_record"] or "").strip()
        if not reference:
            continue
        numbers = tuple(n.strip() for n in row["phones"].split(",") if n.strip())
        verdicts[row["id"]] = refusal(
            register.get(reference), row["id"], reference, TODAY, numbers)

    assert verdicts["S-1041"] is None, (
        "CR-2026-0401 names both numbers on its row, so it dials")
    assert verdicts["S-1042"] is None, (
        "CR-2026-0402 names none, which is the case the run counts rather than refuses")
    assert "the record does not name" in (verdicts["S-1048"] or ""), (
        "CR-2026-0407 names one of the two numbers S-1048 carries")
    assert sum(1 for v in verdicts.values() if v) == 5, (
        "five of the eight example rows are refused, and docs/consent-record.md says so")


def test_the_run_counts_the_rows_that_rested_on_a_record_naming_no_number():
    """The count is the whole reason those rows are allowed to dial at all."""
    from dispatch.models import ItemResult, Resolution, WorkItem
    from firstbell.domain import summarise

    def result(item_id, record, no_number, skipped=False):
        return ItemResult(
            item=WorkItem(id=item_id, phones=("+15550100301",), consent_record=record,
                          consent_names_no_number=no_number),
            resolution=Resolution.SKIPPED if skipped else Resolution.RESOLVED,
            reason="x", attempts_made=0 if skipped else 1, placed_by_this_run=not skipped)

    s = summarise([result("S-1", "CR-1", True), result("S-2", "CR-2", False),
                   result("S-3", "CR-3", True, skipped=True)], live=False)
    assert s.dialled_on_a_record == 2
    assert s.dialled_on_a_record_naming_no_number == 1, (
        "a skipped row is not exposure, because nobody was telephoned on it")
    text = "\n".join(s.lines())
    assert "no number named" in text
    assert "attaches to the number" in text, (
        "the count needs the reason beside it, or it reads as a statistic")


def test_every_authorised_call_says_whether_the_record_named_the_number(capsys):
    """A parent rings the school and asks why they were called. This is that answer.

    The refusals were itemised from the beginning: each one names its record and gives a
    sentence an attendance officer can read out. The approvals were two integers. Somebody
    reading the entry as a district operations director said it plainly: the refusal log is
    the half nobody builds and the authorisation log is the half everybody is asked for.

    The log exists now, and this holds the field that answers the question underneath the
    question. Consent attaches to the number called, so "which record authorised this" is
    only half an answer, and "did that record name the telephone that rang" is the rest.

    Three states, and the shipped example carries one of each, which is why this runs the
    documented command rather than building a wave here.
    """
    import json

    from firstbell.cli import main

    assert main(["--work-file", "examples/absences-with-consent.csv",
                 "--consent-records", "examples/consent-register.json", "--json"]) == 0
    out = capsys.readouterr().out
    payload = json.loads(out[out.index("{"):])
    rows = payload["consent"]["authorised"]
    assert rows, "the authorisation log is empty on a run that placed calls"

    named = {r["id"]: r["number_named_by_the_record"] for r in rows}
    states = sorted(str(v) for v in named.values())
    assert states == ["False", "None", "True"], (
        f"the shipped example is meant to carry one row of each state and carries {named}"
    )

    # The row whose record names no number is the row the aggregate counts, so the log and
    # the count cannot drift apart into two different claims about the same run.
    no_number = [i for i, v in named.items() if v is False]
    assert len(no_number) == payload["consent"]["dialled_on_a_record_naming_no_number"], (
        "the per-call log and the count above it disagree about the same run"
    )

    # And a row with no record has nothing to answer, rather than answering no.
    for row in rows:
        if row["record"] is None:
            assert row["number_named_by_the_record"] is None, (
                "a row that dialled on a boolean column is reported as a record that "
                "failed to name the number, which is a different and worse claim"
            )
            assert row["basis"] == "a boolean column"


def test_the_no_number_count_is_printed_under_consent_and_not_beside_the_totals():
    """It belongs under the paperwork, next to the boolean count it is a cousin of.

    Printed among the totals it would read as an outcome of the calling, which it is not.
    It is a fact about the district's records.
    """
    from dispatch.models import ItemResult, Resolution, WorkItem
    from firstbell.domain import summarise

    s = summarise([ItemResult(
        item=WorkItem(id="S-1", phones=("+15550100301",), consent_record="CR-1",
                      consent_names_no_number=True),
        resolution=Resolution.RESOLVED, reason="x", attempts_made=1,
        placed_by_this_run=True)], live=False)
    lines = s.lines()
    consent_at = next(i for i, line in enumerate(lines) if line.strip() == "consent")
    count_at = next(i for i, line in enumerate(lines) if "no number named" in line)
    assert count_at > consent_at


def test_a_refused_row_is_not_recorded_as_a_record_that_named_no_number(tmp_path):
    """The flag is about rows that are going to be dialled, and only those.

    `summarise` already drops skipped rows from the count, so setting the flag on a refused
    row would print the same number today and be wrong the first time somebody counts a
    different way. The source is the layer holding the record, so it is the layer that has
    to know the difference between exposure and a refusal.
    """
    import json
    from dispatch.sources import CsvSource

    (tmp_path / "register.json").write_text(json.dumps({"records": [
        {"id": "CR-NONE", "student_id": "S-1", "channel": "voice",
         "purpose": "attendance", "given_at": "2026-08-01"},
        {"id": "CR-WITHDRAWN", "student_id": "S-2", "channel": "voice",
         "purpose": "attendance", "given_at": "2026-08-01",
         "withdrawn_at": "2026-09-01"},
        {"id": "CR-COVERED", "student_id": "S-3", "channel": "voice",
         "purpose": "attendance", "given_at": "2026-08-01",
         "phones": ["+15550100303"]},
    ]}), encoding="utf-8")
    (tmp_path / "work.csv").write_text(
        "id,phones,consent,consent_record\n"
        "S-1,+15550100301,yes,CR-NONE\n"
        "S-2,+15550100302,yes,CR-WITHDRAWN\n"
        "S-3,+15550100303,yes,CR-COVERED\n",
        encoding="utf-8", newline="\n")

    register = load_register(json.loads(
        (tmp_path / "register.json").read_text(encoding="utf-8")))
    flags = {item.id: item.consent_names_no_number
             for item in CsvSource(tmp_path / "work.csv",
                                   consent_register=register, today=TODAY).items()}
    assert flags == {"S-1": True, "S-2": False, "S-3": False}, (
        "S-2 is refused, so nobody is telephoned on it and it is not exposure")
