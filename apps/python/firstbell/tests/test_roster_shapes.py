"""The shapes a real export arrives in, and what each one is allowed to do.

Every case here was found by running the reader rather than by reading it. A probe fed the
input path twenty-four hostile files and recorded what happened: two crashed with an
exception that was not a `SourceError`, and five were accepted when accepting them ends
with the wrong thing happening to a family. The suite was green throughout, 327 tests, so
none of this was a rule that failed. It was a set of cases nobody had written down.

The reason this matters more than it did last week is `DropSource`. While a person named
the file every morning, a truncated or mis-encoded export was a thing they saw. Reading
whatever the overnight job left in a directory removes that person, so the reader has to be
the one that notices.

Two shapes are deliberately still accepted here, and the probe settled both by running the
whole dispatcher rather than by argument: a number that is not E.164 and a locale nobody
supports. Both are read by the source and both place zero calls, because refusing to dial
is the dispatcher's job and refusing to read is not. A source that validated phone numbers
would be a second place for that rule to live and disagree from.
"""
from __future__ import annotations

import pytest

from dispatch.sources import CsvSource, SourceError

HEAD = b"id,phones,locale,consent,pupil\n"
GOOD = HEAD + b"A-1,+15551230001,en-US,yes,Ada\n"


def read(tmp_path, payload: bytes, **kwargs):
    f = tmp_path / "roster.csv"
    f.write_bytes(payload)
    return list(CsvSource(f, **kwargs).items())


# --------------------------------------------------------------------------
# The shapes that have to keep working. A reader that refuses a real export is
# a reader nobody can use, and four of these are what real systems produce.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("name,payload", [
    ("plain", GOOD),
    # Excel writes this on every CSV it saves, which is most exports in this market.
    ("a utf-8 byte order mark", b"\xef\xbb\xbf" + GOOD[len(b""):]),
    ("CRLF line endings", HEAD.replace(b"\n", b"\r\n")
     + b"A-1,+15551230001,en-US,yes,Ada\r\n"),
    ("a quoted comma in a name", HEAD + b'A-1,+15551230001,en-US,yes,"Nguyen, Ada"\n'),
    ("a name outside ascii", HEAD + "A-1,+15551230001,ta-IN,yes,அடா\n".encode("utf-8")),
    ("a semicolon-separated fallback chain",
     HEAD + b"A-1,+15551230001;+15551230002,en-US,yes,Ada\n"),
])
def test_the_shapes_a_real_export_arrives_in_are_read(tmp_path, name, payload):
    items = read(tmp_path, payload)
    assert len(items) == 1, name
    assert items[0].id == "A-1", name
    assert items[0].consented is True, name


def test_a_fallback_chain_survives_the_separator_it_was_written_with(tmp_path):
    """Both separators, because an export writes whichever its vendor chose."""
    for raw in (b"+15551230001;+15551230002", b"+15551230001,+15551230002"):
        payload = HEAD + b"A-1," + (b'"' + raw + b'"') + b",en-US,yes,Ada\n"
        assert read(tmp_path, payload)[0].phones == ("+15551230001", "+15551230002")


# --------------------------------------------------------------------------
# The two that crashed. Neither raised a SourceError, so neither reached an
# operator as anything but a traceback.
# --------------------------------------------------------------------------

def test_a_file_that_is_not_the_encoding_it_was_promised_says_so(tmp_path):
    """`UnicodeDecodeError` at 08:40 tells a school secretary nothing.

    Several systems of record in this market still export cp1252. The refusal has to name
    the encoding it tried, because `encoding=` is the fix and nothing else in the output
    would have suggested it.
    """
    with pytest.raises(SourceError) as refused:
        read(tmp_path, HEAD + b"A-1,+15551230001,en-US,yes,Ad\xe9\n")
    message = str(refused.value)
    assert "utf-8" in message, "the refusal has to name the encoding it tried"
    assert "cp1252" in message or "latin-1" in message, (
        "the refusal has to name what the file probably is, or the operator has nothing to try"
    )


def test_the_same_file_read_as_what_it_really_is_works(tmp_path):
    """The refusal above is only useful if the advice in it is true."""
    items = read(tmp_path, HEAD + b"A-1,+15551230001,en-US,yes,Ad\xe9\n", encoding="cp1252")
    assert items[0].context["pupil"] == "Adé"


def test_a_cell_past_the_csv_field_limit_is_a_refusal_not_a_csv_error(tmp_path):
    """`_csv.Error: field larger than field limit (131072)` names no file and no cause."""
    with pytest.raises(SourceError) as refused:
        read(tmp_path, HEAD + b"A-1,+15551230001,en-US,yes," + b"x" * 200_000 + b"\n")
    assert "roster.csv" in str(refused.value), "a refusal that names no file is a puzzle"


def test_a_nul_byte_means_the_file_is_not_finished(tmp_path):
    """A NUL in a CSV is a half-written file, which is what a failed export leaves.

    It used to be read, and `as_data` collapsed it to a space downstream, so a child's name
    was spoken with a gap in it. Refusing is right: the file is not text.
    """
    with pytest.raises(SourceError) as refused:
        read(tmp_path, HEAD + b"A-1,+15551230001,en-US,yes,A\x00da\n")
    assert "NUL" in str(refused.value)


# --------------------------------------------------------------------------
# The three that were accepted and should not have been. Each one ends with a
# family being treated wrongly, and none of them showed up in any output.
# --------------------------------------------------------------------------

def test_a_row_with_fewer_cells_than_the_header_is_refused(tmp_path):
    """The worst of the five, because the failure was silent and it was about consent.

    `csv.DictReader` fills the missing columns with None. `consent` became None, the old
    `_truthy` read that as a no, and the family was dropped from the run and reported as
    unconsented. A truncated line is exactly what a killed overnight export leaves behind,
    so this said "these parents refused" about a broken file.
    """
    with pytest.raises(SourceError) as refused:
        read(tmp_path, HEAD + b"A-1,+15551230001\n")
    message = str(refused.value)
    assert "line 2" in message, "the refusal has to say which line"
    assert "consent" in message, (
        "the refusal has to name the absent columns, because which ones are missing is what "
        "tells the operator how far the file got"
    )


def test_a_row_with_more_cells_than_the_header_is_refused(tmp_path):
    """The surplus used to travel into the spoken instruction under the key None.

    `context` came out as `{'pupil': 'Ada', None: ['extra', 'more']}`, and context is what
    the task text is built from.
    """
    with pytest.raises(SourceError) as refused:
        read(tmp_path, HEAD + b"A-1,+15551230001,en-US,yes,Ada,extra,more\n")
    assert "extra" in str(refused.value), (
        "the refusal has to show the surplus, or the operator cannot tell which column "
        "their export added"
    )


def test_a_column_that_appears_twice_is_refused(tmp_path):
    """One of the two values is discarded and nothing says which.

    Benign for a name. For `phones` or `consent` the discarded value is the one that decides
    whether a family is telephoned.
    """
    with pytest.raises(SourceError) as refused:
        read(tmp_path, b"id,phones,phones,consent,pupil\n"
                       b"A-1,+15551230001,+15559990000,yes,Ada\n")
    assert "phones" in str(refused.value)


# --------------------------------------------------------------------------
# Consent, which now behaves the way `voice` always has.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("cell,expected", [
    (b"yes", True), (b"YES", True), (b" yes ", True), (b"y", True),
    (b"1", True), (b"true", True), (b"granted", True),
    (b"no", False), (b"NO", False), (b"n", False), (b"0", False),
    (b"false", False), (b"denied", False),
])
def test_the_consent_values_this_understands(tmp_path, cell, expected):
    payload = HEAD + b"A-1,+15551230001,en-US," + cell + b",Ada\n"
    assert read(tmp_path, payload)[0].consented is expected


def test_a_blank_consent_cell_is_a_no_and_does_not_raise(tmp_path):
    """The one case where absence carries meaning.

    A row where the office recorded nothing recorded no permission. That is not a guess, so
    it is the one unrecognised-looking value that is allowed through.
    """
    payload = HEAD + b"A-1,+15551230001,en-US,,Ada\n"
    assert read(tmp_path, payload)[0].consented is False


def test_a_consent_value_nobody_defined_is_refused_rather_than_read_as_a_no(tmp_path):
    """The inconsistency this closes.

    `voice` has always refused a value it does not recognise, on the stated grounds that
    the column decides whether a person is telephoned so it is not guessed at. Consent
    decides the same thing and used to guess. The direction it guessed in was safe and the
    silence was not: a district whose export writes `consented` had every family dropped
    and reported as having refused, and no line of output would have told them why.
    """
    for cell in (b"maybe", b"consented", b"1.0", b"opt-in", b"Y/N"):
        with pytest.raises(SourceError) as refused:
            read(tmp_path, HEAD + b"A-1,+15551230001,en-US," + cell + b",Ada\n")
        message = str(refused.value)
        assert "consent" in message and "line 2" in message
        assert "refused" in message, (
            "the refusal has to say what the old behaviour got wrong, because an operator "
            "who has been reading 'unconsented' for a week needs to know it was the column"
        )


def test_consent_and_voice_disagree_about_a_blank_and_agree_about_everything_else(tmp_path):
    """The two columns are deliberately different in exactly one place.

    Blank consent is a no, because permission not recorded is permission not given. Blank
    voice is a yes, because a family whose accessibility need nobody recorded is dialled,
    which is what happens today. Pinned here so neither drifts into the other.
    """
    blank_consent = HEAD + b"A-1,+15551230001,en-US,,Ada\n"
    assert read(tmp_path, blank_consent)[0].consented is False

    blank_voice = b"id,phones,voice,consent,pupil\nA-1,+15551230001,,yes,Ada\n"
    assert read(tmp_path, blank_voice)[0].reachable_by_voice is True


# --------------------------------------------------------------------------
# The header, which nothing checked. A bug hunt found this and rated it the
# worst defect in the project, correctly.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("header", [
    b"id,phones,consent, voice,pupil",
    b"id,phones,consent,voice ,pupil",
    b"id, phones , consent , voice , pupil",
    b" id,phones,consent,voice,pupil",
])
def test_a_padded_header_still_reads_the_column_it_names(tmp_path, header):
    """One space after a comma used to telephone a family that cannot use a telephone.

    The header was stripped to decide which columns exist and the row was then read by its
    raw key, so `consent, voice` passed every check and `row.get("voice")` returned None.
    `_voice_ok` reads a blank as yes by design, because a family whose accessibility need
    nobody recorded is dialled. So a guardian the office had recorded as unreachable by
    voice, which the models module documents as deaf, hard of hearing, or with a speech
    disability, was telephoned, and the call was filed as an answer. No error and no log
    line.

    Written as four spellings because the defect is about whitespace and one example only
    proves the one place it was tried.
    """
    payload = header + b"\nS-1,+15551230001,yes,no,Ada\n"
    item = read(tmp_path, payload)[0]
    assert item.id == "S-1", "a padded id column"
    assert item.consented is True, "a padded consent column"
    assert item.reachable_by_voice is False, (
        "the row says voice=no and this read it as yes, which is the telephone call that "
        "should not have happened"
    )


def test_the_unpadded_control_reads_the_same(tmp_path):
    """The test above is only evidence if the clean spelling agrees with it."""
    item = read(tmp_path, b"id,phones,consent,voice,pupil\nS-1,+15551230001,yes,no,Ada\n")[0]
    assert (item.id, item.consented, item.reachable_by_voice) == ("S-1", True, False)


def test_a_padded_duplicate_is_still_a_duplicate(tmp_path):
    """Stripping the names makes `voice` and ` voice` the same column, which they are.

    So this has to land on the duplicate refusal rather than quietly keeping one.
    """
    with pytest.raises(SourceError) as refused:
        read(tmp_path, b"id,phones,consent,voice, voice\nS-1,+15551230001,yes,no,yes\n")
    assert "voice" in str(refused.value)
