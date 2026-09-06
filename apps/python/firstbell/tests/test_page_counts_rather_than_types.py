"""A number on the page is read off the thing it describes, or it is not on the page.

This gate exists because a reviewer found the failure before the suite did. A take-away card
read "Eighteen deliberate changes ... eighty-eight passing tests" and sat three screens below
a counter, on the same page, reading 116. Both had been true once. One of them was counted at
build time and the other had been typed, and only the typed one aged.

The entry's whole argument is that a claim carries the thing that checks it, so a hand-typed
count on the judge-facing page is not a small error. It is the argument failing in public, on
the surface chosen to make the argument.

The check is on the builder rather than on the built page, so it runs on any checkout. The
page needs receipts that are deliberately not in this repository; the source does not.
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
BUILDER = APP / "tools" / "judge_page.py"

# The written-out numbers a person reaches for when they are describing a count in prose.
# Digits are not searched for: dates, ids, ratios and CSS all carry them legitimately, and a
# spelled number in a sentence is the specific shape that rotted here.
# `one` is deliberately absent. In this prose it is almost always the pronoun ("the one no
# test caught", "only the first one"), and a gate that fires on an English pronoun is a gate
# somebody switches off.
NUMBER_WORDS = (
    "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
    "eighty", "ninety", "hundred",
)


# A word-boundary pattern, built once and reused by both checks below.
BOUNDED = r"\b%s\b"


def _takeaway_block() -> str:
    """The `takes = [...]` assignment, sliced out of the builder by its own syntax tree.

    Sliced by AST rather than by a line range so that moving the block does not silently
    turn this gate into a check on whatever text happens to live at those lines. Reading a
    fixed range is how a check like this ends up measuring nothing.
    """
    source = BUILDER.read_text(encoding="utf-8")
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "takes" for t in node.targets
        ):
            return "".join(lines[node.lineno - 1:node.end_lineno])

    raise AssertionError(
        "the page builder no longer assigns `takes`, so this gate is reading nothing; "
        "point it at whatever holds the take-away cards now"
    )


def test_the_mutation_takeaway_is_counted_from_the_table():
    """The card has to derive its number from the rows it is describing."""
    block = _takeaway_block()

    assert "len(_muts)" in block, (
        "the mutation take-away no longer counts the rows it describes. It sits on the same "
        "page as a counter built from the same table, and a typed number beside a counted "
        "one is the defect this gate was written for"
    )


def test_no_takeaway_card_spells_out_a_count():
    """A spelled number in this block is a number nothing will ever update."""
    block = _takeaway_block()

    # Only prose inside the quoted strings is judged. An identifier or a comment containing
    # `one` is not a claim to a reader.
    prose = " ".join(re.findall(r'"([^"]*)"', block)).lower()
    # `f"{len(_muts)} deliberate changes"` is the fixed version and must not trip this.
    prose = re.sub(r"\{[^}]*\}", " ", prose)

    typed = sorted({
        word for word in NUMBER_WORDS
        if re.search(rf"\b{word}\b", prose)
    })

    assert not typed, (
        f"a take-away card spells out {typed}, which is a count no build step will ever "
        "correct. Derive it from the thing it counts, the way the mutation card does"
    )


def test_the_row_the_card_singles_out_is_really_the_uncaught_one():
    """The card names a row by number, and the number comes out of the table.

    Naming row 57 is the strongest line on that card, and it is only worth having while it
    is true. If a later mutation is recorded with no test catching it, the card has to stop
    saying one row and say how many, which the builder already handles. What it must never
    do is name a row that other rows now contradict.
    """
    import sys

    sys.path.insert(0, str(APP / "tools"))
    from judge_page import mutation_rows  # noqa: E402

    uncaught = [row for row in mutation_rows() if row[2] == "0"]

    assert len(uncaught) <= 1, (
        f"{len(uncaught)} rows report that no test caught them ({[r[0] for r in uncaught]}). "
        "That is not a formatting problem: each one is a gate that was not guarding what it "
        "claimed to, and the page still speaks about a single row"
    )


def test_nowhere_in_the_builder_spells_the_size_of_the_mutation_table():
    """One page stated the size of one table in three places, and two of them were typed.

    The first version of this gate read only the take-away block, so it passed while a
    margin note two hundred lines away still said eighteen. That note shipped to production
    and was found by reading the deployed page, not by running this suite. A gate scoped to
    the place a defect was found last time is a gate that misses it in the next place.

    So the whole builder is read, and every sentence describing a count of deliberate
    changes has to derive that count.
    """
    source = BUILDER.read_text(encoding="utf-8")

    offenders = []
    for number, line in enumerate(source.splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith("#") or "deliberate" not in stripped.lower():
            continue
        spelled = [w for w in NUMBER_WORDS if re.search(BOUNDED % w, stripped.lower())]
        if spelled:
            offenders.append("line %d: %s in %r" % (number, spelled, stripped[:70]))

    assert not offenders, (
        "the page states the size of the mutation table as a spelled number, which nothing "
        "will update when a row is added: " + "; ".join(offenders)
    )
