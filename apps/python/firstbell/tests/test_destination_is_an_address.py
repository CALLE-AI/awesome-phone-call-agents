r"""What may be dialled, at the three places that decide it.

Three separate checks answered "is this a telephone number" and none of them answered
"is this an address a network will carry".

`sources._split_phones` asks whether a cell contains seven ASCII digits *somewhere*. That
is right for a parser, because a district writes `+1, 800, 555, 0199` and means one
number. It is wrong for a dialler, and the cell went to the platform verbatim, sentence
and all.

`dial.py` matched `^\+[1-9]\d{7,14}$`. `\d` on a str pattern is Unicode-wide, and `$`
matches immediately before a trailing newline, so a number in Eastern Arabic numerals and
a pasted number with the newline still attached both passed.

`consent.covers_number` compared the two sides on `str.isdigit()`, which is true for
superscripts. A record holding a footnote marker and a row holding the same marker
stripped to one identical character and compared equal, so a permission that named no
telephone at all covered a row nobody had checked.

The refusals below are all the same refusal: no repair, no guess. Every repair is a guess
about which number the office meant, and a wrong guess is a stranger's phone ringing about
somebody else's child.
"""

from __future__ import annotations

import pytest

from dispatch.consent import ConsentRecord
from dispatch.e164 import canonical, is_canonical
from dispatch.sources import CsvSource, SourceError
from tests.fixtures import IN_A

# Spellings a real export writes for one number, and the address each denotes.
GROUPED = [
    ("+915550000001", "+915550000001"),
    ("+1, 555, 010, 0199", "+15550100199"),
    ("+1 555 010 0301", "+15550100301"),
    ("+44 (555) 010 0958", "+445550100958"),
    ("  +915550000001  ", "+915550000001"),
    ("+915550000001\n", "+915550000001"),
]

# Text that reached a dialler and should not have.
NOT_AN_ADDRESS = [
    "٥٥٥٠١٠٠٣٠١",  # Eastern Arabic
    "५५५०१००३०१",  # Devanagari
    "unknown²",                    # a superscript is a digit to str.isdigit()
    "see note⁵",
    "ring mum on 5550100301 after three",
    "+91​5550000001",              # a zero-width space between the digits
    "+9155500–0001",               # an en dash where a hyphen was typed
    "ext. 4",
    "+0123456789",                      # a country code may not start with zero
    "+1234567",                         # too short
    "+9155500000122222",                # too long
    "1,800,555,0199",                   # national format, no country code
    "(04) 1234-5678",
    "",
]


@pytest.mark.parametrize("written,address", GROUPED)
def test_the_spellings_a_district_writes_all_resolve_to_one_address(written, address):
    assert canonical(written) == address
    assert is_canonical(address), "the resolved form is the form that gets dialled"


@pytest.mark.parametrize("text", NOT_AN_ADDRESS)
def test_text_that_is_not_an_address_is_refused_rather_than_repaired(text):
    assert canonical(text) is None, (
        f"{text!r} resolved to {canonical(text)!r} and would have been dialled")


def test_a_cell_with_digits_in_it_is_not_a_number_the_run_will_guess_at(tmp_path):
    """The parser accepts it, so the boundary has to be the one that refuses it.

    `ring mum on 5550100301 after three` carries more than seven ASCII digits, so
    `_split_phones` keeps it and used to hand the whole sentence to the platform as the
    destination. The refusal names the row and stops the file: dropping the entry quietly
    would shorten a fallback chain without saying so, and a chain one number shorter than
    the office believes is how a family goes uncontacted while the receipt reports that
    every number was tried.
    """
    path = tmp_path / "work.csv"
    path.write_text(
        "id,phones,consent,student_name\n"
        'S-1,"ring mum on 5550100301 after three",yes,Ada\n',
        encoding="utf-8", newline="")

    with pytest.raises(SourceError) as raised:
        list(CsvSource(path).items())
    assert "not an E.164 number" in str(raised.value)
    assert "5550100301" not in str(raised.value), (
        "the refusal quotes the cell, so the digits in it are masked like any other")


def test_a_grouped_number_survives_ingest_as_the_address_it_denotes(tmp_path):
    """The thing that must not break: a real export with separators in the cell."""
    path = tmp_path / "work.csv"
    path.write_text(
        "id,phones,consent,student_name\n"
        'S-1,"+1 555 010 0301",yes,Ada\n',
        encoding="utf-8", newline="")
    item = list(CsvSource(path).items())[0]
    assert item.phones == ("+15550100301",), (
        f"the row carries {item.phones!r}, which is the district's spelling rather than "
        "the address the platform is given")


def test_a_permission_naming_a_footnote_marker_covers_nothing():
    """The Unicode equality that made a permission for nothing cover a real row."""
    record = ConsentRecord(
        id="CR-1", student_id="S-1", channel="voice", purpose="attendance",
        given_at=None, expires_at=None, withdrawn_at=None,
        phones=("see note⁵",))
    assert record.covers_number("other⁵") is False, (
        "two superscripts stripped to the same character and compared equal")
    assert record.covers_number(IN_A) is False


def test_a_permission_still_covers_the_same_telephone_written_two_ways():
    """The behaviour the register side is documented to have, and keeps."""
    record = ConsentRecord(
        id="CR-1", student_id="S-1", channel="voice", purpose="attendance",
        given_at=None, expires_at=None, withdrawn_at=None,
        phones=("+1 555 010 0301",))
    assert record.covers_number("+15550100301") is True
    assert record.covers_number("+15550100302") is False


def test_the_dial_command_prints_no_destination_it_refuses(capsys):
    """A refusal is printed to a terminal that is often recorded or piped to a file.

    Three lines carried the number in full: the invalid-number message echoed the operator's
    own argument, the refusal named the destination, and the copy-pasteable command under it
    named it again. The record written to the temporary directory still carries the real
    number, because the run has to check it; the terminal copy does not.
    """
    from firstbell.dial import main

    assert main(["+915550000001"]) == 2
    printed = capsys.readouterr().out
    assert "+915550000001" not in printed, (
        "the refusal printed the destination in full")
    assert "+91********01" in printed, "the masked form is what a reader should get"


def test_the_dial_command_refuses_a_number_no_network_carries(capsys):
    r"""`\d` accepted these and `$` accepted the newline. Both went to the platform."""
    from firstbell.dial import main

    assert main(["٥٥٥٠١٠٠٣٠١", "--i-consent"]) == 2
    assert "not an E.164 number" in capsys.readouterr().out

    assert main(["+915550000001\n"]) == 2, (
        "a trailing newline is stripped rather than dialled with the number")
    assert "+91********01" in capsys.readouterr().out
