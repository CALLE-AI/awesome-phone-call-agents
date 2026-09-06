"""The queue on the page has to agree with the queue the program builds.

The page now shows the screen a school office would work from. It is the one place the
software is shown doing its job to somebody rather than to a reviewer, and it is therefore
the one place where a rendering bug would be read as a fact about the product.

The first version of it had exactly that bug. Escalation was asked only of rows whose
resolution was `resolved`, on the assumption that an undetermined call has nothing left to
escalate about. In the committed run this page draws, every escalating case is undetermined,
so four safeguarding rows rendered as ordinary callbacks. Nothing failed. The page built, the
gates passed, and the queue looked calmer than the calls had been.

That is the only direction a defect here is not allowed to point. These tests hold the view
to the program: same rule, same order, same count.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "tools"))

RECEIPT = "06-locale-matched-pairs.json"


def _run() -> dict:
    for base in (Path("D:/calle-workshop/receipts"), APP / "evidence" / "receipts"):
        path = base / RECEIPT
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    pytest.skip("the receipts are held outside this repository and are not on this machine")


def _expected(run: dict) -> list[tuple[bool, str]]:
    """What the shipped rule says the queue is, computed here from the receipt."""
    from dispatch.models import Escalation
    from firstbell.domain import safeguarding_escalation

    rows = []
    for item in run["items"]:
        resolution = item.get("resolution") or ""
        structured = item.get("structured_result") or {}
        escalated = bool(structured) and safeguarding_escalation(structured) is not Escalation.NONE
        if resolution == "resolved" and not escalated:
            continue
        rows.append((escalated, item["id"]))
    rows.sort(key=lambda r: 0 if r[0] else 1)
    return rows


def test_the_queue_holds_every_row_the_program_would_put_in_it():
    from judge_page import queue_markup

    run = _run()
    expected = _expected(run)
    markup = queue_markup(run)

    assert markup, "the queue rendered nothing for a run that has rows needing a person"
    for _escalated, student in expected:
        assert student in markup, (
            f"{student} needs a person and is not in the queue the page draws"
        )
    assert markup.count("<li class=\"queue-row") == len(expected), (
        f"the page draws a different number of rows than the {len(expected)} the program "
        "would queue"
    )


def test_every_escalated_row_is_marked_as_one():
    """The bug that shipped: escalated rows drawn as ordinary ones.

    Asserting the count rather than the presence of a class, because a single marked row
    among four would satisfy a weaker check and still be three families the office would
    reach last.
    """
    from judge_page import queue_markup

    run = _run()
    expected = _expected(run)
    escalated = [s for flagged, s in expected if flagged]
    if not escalated:
        pytest.skip("no row in this run escalates, so there is nothing to mark")

    markup = queue_markup(run)
    assert markup.count("q-safeguarding") == len(escalated), (
        f"{len(escalated)} row(s) escalate under the shipped rule and the page marks "
        f"{markup.count('q-safeguarding')}. A safeguarding case drawn as an ordinary "
        "callback is the one defect this view must not have."
    )


def test_the_escalated_rows_come_first():
    """Order is part of the output, the same way it is in RunReport.human_queue."""
    from judge_page import queue_markup

    run = _run()
    expected = _expected(run)
    if not any(flagged for flagged, _ in expected) or all(f for f, _ in expected):
        pytest.skip("this run does not mix escalated and ordinary rows, so order proves nothing")

    markup = queue_markup(run)
    positions = [markup.index(student) for _f, student in expected]
    assert positions == sorted(positions), (
        "a clerk works this list from the top. The page has put an escalation below an "
        "ordinary callback."
    )


def test_no_parents_own_words_are_published_in_the_queue():
    """`free_text_note` is the one unconstrained string CALL-E returns, and it stays off.

    The escalation never reads it, so it earns nothing here, and it is a parent talking about
    their child. Putting it on a public page to make an interface look richer would be the
    wrong trade twice.
    """
    from judge_page import queue_markup

    run = _run()
    markup = queue_markup(run)
    for item in run["items"]:
        note = (item.get("structured_result") or {}).get("free_text_note") or ""
        if len(note) < 25:
            continue
        assert note[:25] not in markup, (
            f"the queue publishes the free text note for {item['id']}"
        )
