"""Every count the page spells out in a sentence is checked against the thing it counts.

Some numbers on this page cannot be derived at build time without reading better than a
template does, so they are written as words: "Four real calls placed by this software", "All
twelve comparisons". Written as words they read properly, and written as words nothing
updates them.

The sibling gate in `test_page_counts_rather_than_types.py` handles the mutation table, which
is derived. This one handles the rest: it leaves the prose alone and checks it, which is the
same bargain the whole entry makes.

It reads the built page, so it skips when the page has not been built. The page needs receipts
that are deliberately outside this repository. That skip is declared in
`GATES_THAT_CANNOT_ALWAYS_RUN`.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
PAGE = APP / "out" / "index.html"

WORD = {
    "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
}


def _page() -> str:
    if not PAGE.exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    return PAGE.read_text(encoding="utf-8")


def test_the_hero_counts_the_calls_the_register_actually_shows():
    """"Four real calls placed by this software, one row each" is a claim about a table.

    A fifth receipt arriving makes the register five rows and the sentence under it wrong,
    and nothing in the build would notice. The sentence is checked against the ids the
    register rendered rather than against a number recorded somewhere else, because the ids
    are what a reader counts when they check it.
    """
    page = _page()

    start = page.index("The attendance register")
    end = page.index("hero-foot", start)
    shown = sorted(set(re.findall(r"S-\d{4}", page[start:end])))

    claim = re.search(r"class=hero-foot>(\w+) real calls placed by this software", page)
    assert claim, (
        "the sentence under the register has been reworded, so this gate is checking "
        "nothing; point it at whatever states the count now"
    )

    spelled = claim.group(1).lower()
    assert spelled in WORD, (
        f"the register count is written as {claim.group(1)!r}, which this gate cannot turn "
        "into a number; widen the table rather than leaving the count unchecked"
    )
    assert WORD[spelled] == len(shown), (
        f"the page says {claim.group(1)} real calls and the register renders {len(shown)}: "
        f"{shown}"
    )


def test_the_locale_fold_counts_the_comparisons_it_contains():
    """"All twelve comparisons, counted before the phone rang" is the pre-registration claim.

    It is the strongest sentence in that act, because counting the family before measuring is
    the thing that stops a favourable subset being reported as the result. It is also the one
    a reviewer would check first, so it is checked here.
    """
    page = _page()

    claim = re.search(r"All (\w+) comparisons, counted before the phone rang", page)
    assert claim, (
        "the pre-registration sentence has been reworded or removed; it is the claim that "
        "makes the locale result more than a favourable subset, so it does not go quietly"
    )

    spelled = claim.group(1).lower()
    assert spelled in WORD, (
        f"the comparison count is written as {claim.group(1)!r}, which this gate cannot read"
    )

    # The fold states its own arithmetic two sentences later: scenarios, performed twice,
    # with a fixed number of enumerated fields each. The product has to be the total, or the
    # family being claimed is not the family being described.
    shape = re.search(
        r"(\w+) scenarios, each performed twice, (\w+) enumerated fields per pair", page)
    assert shape, (
        "the fold no longer says how the comparison family was built, so the total above it "
        "rests on nothing a reader can re-derive"
    )

    scenarios, fields = shape.group(1).lower(), shape.group(2).lower()
    assert scenarios in WORD and fields in WORD, (
        f"the fold's arithmetic is written as {shape.group(1)!r} and {shape.group(2)!r}, "
        "which this gate cannot read"
    )
    assert WORD[scenarios] * WORD[fields] == WORD[spelled], (
        f"the fold says {shape.group(1)} scenarios with {shape.group(2)} fields each, which "
        f"is {WORD[scenarios] * WORD[fields]} comparisons, and claims {claim.group(1)}"
    )
