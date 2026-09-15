"""What counts as a telephone number on a row, and how many of them there are.

`_split_phones`'s docstring states the invariant: it "keeps the count of numbers on the row
equal to the count of numbers somebody could answer". Three separate things broke it.

A cell holding one comma-grouped number, which `models.redact`'s own comment records as a
format real vendors write, became four numbers. The row was then reported `invalid_phone`,
which is in `NEVER_CARRIED`, so the run said the platform refused the call when the cause
was the district's formatting. Worse, `households._key` reads the digits of `phones[0]`,
which is `"1"` for every such row, so unrelated pupils were filed as one family and held
behind a call about a different child.

The word filter was `any(ch.isdigit())`, so a spreadsheet footnote marker or an extension
note took a place in the fallback chain, and `str.isdigit()` is Unicode-wide, so a cell of
Eastern Arabic numerals was accepted as diallable. And a number written twice on one row
survived twice, which rings the same house twice inside one call: the harm
`dispatch/households.py` exists to prevent, reached from inside a single row.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))

from dispatch.sources import _split_phones  # noqa: E402


@pytest.mark.parametrize("cell,expected", [
    ("+1,800,555,0199", ("+1,800,555,0199",)),
    ("+1, 800, 555, 0199", ("+1, 800, 555, 0199",)),
    ("1,800,555,0199", ("1,800,555,0199",)),
])
def test_one_comma_grouped_number_is_one_number(cell, expected):
    assert _split_phones(cell) == expected


@pytest.mark.parametrize("cell", ["unknown", "n/a", "none", "unknown²",
                                  "see note ⁵", "ext. 4", "call mobile 1st", "-",
                                  "٩٨٧٦٥٤٣٢"])
def test_a_cell_that_is_not_a_diallable_number_takes_no_place_in_the_chain(cell):
    assert _split_phones(cell) == (), (
        f"{cell!r} took a place in the fallback chain and would have been dialled")


def test_a_number_repeated_on_one_row_rings_the_house_once():
    assert _split_phones("+15550100301,+15550100301") == ("+15550100301",)
    assert _split_phones("+1 555 010 0301;+15550100301") == ("+1 555 010 0301",), (
        "the same telephone written two ways is one telephone")


def test_two_real_numbers_are_still_two_numbers():
    """The thing that must not break: a genuine fallback chain."""
    assert _split_phones("+15550100301,+15550100302") == ("+15550100301", "+15550100302")
    assert _split_phones("+15550100301; +15550100302") == ("+15550100301", "+15550100302")


def test_unrelated_pupils_are_not_filed_as_one_household(tmp_path):
    """The second harm, at the layer that acts on it."""
    from dispatch.households import group as group_households
    from dispatch.models import WorkItem

    items = [WorkItem(id=f"S-{n}", phones=_split_phones("+1,800,555,019%d" % n))
             for n in range(3)]
    assert all(len(one.phones) == 1 for one in items)
    kept, households = group_households(items)
    assert len(kept) == 3, "three unrelated children were held as one family"


def test_a_refusal_names_the_physical_line_an_operator_will_open(tmp_path):
    """A quoted cell containing a newline is one record and several lines.

    The refusals counted records from 2 and called the result a line number, so from the
    first multi-line cell onward an operator opening the file at the number printed landed
    in the middle of the previous record.
    """
    from dispatch.sources import CsvSource, SourceError

    path = tmp_path / "ml.csv"
    path.write_text(
        "id,phones,consent,student_name\n"
        'S-1,"+15550100301",yes,"Ada\nLovelace"\n'
        "S-2,,yes,Bob\n", encoding="utf-8", newline="")

    with pytest.raises(SourceError) as raised:
        list(CsvSource(path).items())
    assert "line 4" in str(raised.value), (
        f"S-2 is on physical line 4 of the file; the refusal said {raised.value}")
