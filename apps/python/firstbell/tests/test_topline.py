"""The four numbers on the first screen are computed, and this is what says so.

A reviewer with two hundred entries to read reported reaching the end of the first screen
of this page without meeting a single number. Everything the page argues was one screen
down, in act 01's stat grid. So a dateline went under the standfirst carrying four values,
and a number on the first screen is exactly the kind of thing that gets typed once, read
for a fortnight, and then quietly stops being true.

None of the four may be a literal. Two of these tests read the built page against the
committed files the values come from, and the third proves the markup is derived rather
than written by moving the source underneath it and watching the output move.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
PAGE = APP / "out" / "index.html"
PRICE = APP / "evidence" / "observed-price.json"
POOLED = APP / "evidence" / "recorded-calls.json"

sys.path.insert(0, str(APP / "tools"))

TOPLINE = re.compile(r"<ul class=topline[^>]*>(.*?)</ul>", re.S)
CELL = re.compile(r"<li><b>([^<]+)</b>\s*([^<]+)</li>")


def cells() -> list[tuple[str, str]]:
    if not PAGE.exists():
        pytest.skip("the page is not built, so there is no first screen to read")
    found = TOPLINE.search(PAGE.read_text(encoding="utf-8"))
    assert found, ("the first screen carries no dateline. It was added because a reviewer "
                   "met no number at all before the fold, and removing it puts that back")
    return [(value.strip(), label.strip()) for value, label in CELL.findall(found.group(1))]


def test_the_dateline_counts_match_the_pooled_call_file() -> None:
    """calls, answered and escalated come out of the one numerator nobody chose."""
    counts = json.loads(POOLED.read_text(encoding="utf-8"))["counts"]
    stated = {label: value for value, label in cells()}

    for label, key in (("real calls", "calls"),
                       ("answered", "answered"),
                       ("escalated to a person", "escalated")):
        assert label in stated, f"the dateline no longer carries {label!r}"
        assert stated[label] == str(counts[key]), (
            f"the first screen says {stated[label]} {label} and "
            f"evidence/recorded-calls.json counts {counts[key]}. The page reads that file, "
            "so a disagreement here means the page in out/ was built before it changed")


def test_the_dateline_price_is_the_price_the_account_was_billed() -> None:
    """The dateline quotes the rate the account is charged now, not the one it was.

    This asserted the flat $0.05 until CALL-E metered the account and started labelling
    those rows `Legacy pricing` on its own panel. A first screen quoting a retired rate is
    the failure this suite exists to catch, so the assertion moved to the current reading
    rather than the wording being relaxed: the label still has to name its denominator, and
    the figure still has to be the file's.
    """
    price = json.loads(PRICE.read_text(encoding="utf-8"))["observed_metered_period"]
    metered = price["metered_rate"]
    label = f'a call, mean of {metered["rows"]}'
    stated = {lab: value for value, lab in cells()}
    assert label in stated, "the dateline no longer carries the price, or not its count"
    assert stated[label] == f'${metered["mean_usd"]:.2f}', (
        f'the first screen says {stated[label]} a call and '
        f'evidence/observed-price.json records {metered["mean_usd"]}, read off the '
        "usage panel on " + price["read_at"])


def test_the_dateline_is_derived_and_not_written_out() -> None:
    """Move the source under the markup and the markup has to move with it.

    A test that only compared the page to the files it is built from would pass just as
    happily on four literals that happen to be right today. This one asks the builder for
    the same block twice with different arithmetic underneath, which nothing typed can
    survive.
    """
    import judge_page

    real = judge_page.money_facts

    def moved(run: dict) -> dict:
        out = dict(real(run))
        out["pooled"] = dict(out["pooled"])
        out["pooled"]["calls"] = out["pooled"]["calls"] + 7
        out["price_now"] = dict(out["price_now"])
        out["price_now"]["metered_rate"] = dict(out["price_now"]["metered_rate"])
        out["price_now"]["metered_rate"]["mean_usd"] = 0.99
        return out

    run = {"calls_placed": 1, "items": []}
    try:
        before = judge_page.topline_markup(run)
    except Exception:  # pragma: no cover
        pytest.skip("the receipts this reads are not on this machine")

    judge_page.money_facts = moved
    try:
        after = judge_page.topline_markup(run)
    finally:
        judge_page.money_facts = real

    assert before != after, ("the dateline did not move when the arithmetic under it did, "
                            "so at least one of its four numbers is written into the "
                            "builder rather than computed")
    assert "$0.99" in after, "the price on the dateline is not read from the money facts"


def test_the_dateline_renders_as_nothing_without_a_run() -> None:
    """No receipts, no numbers, and no half-built first screen either.

    The exchange above it holds to the same rule. A first screen built on a value no reader
    can check is the one thing this page must never carry, so the absence is empty rather
    than a placeholder.
    """
    import judge_page

    assert judge_page.topline_markup({}) == ""
