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
import os
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "tools"))

RECEIPT = "06-locale-matched-pairs.json"


def _run() -> dict:
    # The receipts are held outside this repository. Point FIRSTBELL_RECEIPTS at them;
    # with no variable set this falls back to whatever the repository itself carries.
    external = os.environ.get("FIRSTBELL_RECEIPTS")
    for base in ([Path(external)] if external else []) + [APP / "evidence" / "receipts"]:
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


# The two facts a district administrator found missing from this screen: which language the
# callback has to be made in, and when the thirty-minute window closes. Both come off the
# receipt or are left out. A queue that invented either would be telling an attendance
# office something about a real family that nobody measured.

def _markup(items: list[dict]) -> str:
    import judge_page
    return judge_page.queue_markup({"items": items})


def _item(sid: str, **extra) -> dict:
    base = {"id": sid, "resolution": "undetermined", "numbers_tried": ["+91 555 ***"],
            "structured_result": {"reason_category": "unknown",
                                  "expected_return": "unknown"}}
    base.update(extra)
    return base


def test_the_language_comes_from_the_roster_field_when_the_receipt_carries_one():
    out = _markup([_item("S-1", locale="ta-IN"), _item("S-2", locale="en-IN")])
    assert "Tamil" in out and "English" in out
    assert "read from the script" not in out, (
        "the receipt said what the language was, so nothing was inferred and the page "
        "should not claim it was")


def test_an_unknown_locale_tag_prints_itself_rather_than_being_guessed_at():
    """A wrong language on this row sends the wrong person to the phone."""
    out = _markup([_item("S-1", locale="pt-BR")])
    assert "pt-BR" in out


def test_the_language_is_measured_from_the_transcript_when_the_receipt_predates_the_field():
    """The committed run has no `locale`, and the script of what was said is a measurement.

    Two of its four queued cases were conducted in Tamil. That is a staffing fact: half
    that queue cannot be worked by whoever is free.
    """
    tamil = _item("S-1", transcript=[{"speaker": "agent",
                                      "text": "வணக்கம், பள்ளியிலிருந்து அழைக்கிறேன்"}])
    english = _item("S-2", transcript=[{"speaker": "agent", "text": "Hello, the school"}])
    out = _markup([tamil, english])
    assert "Tamil" in out and "English" in out
    assert "read from the script of the call's own transcript" in out
    assert "1 of the 2 were conducted in Tamil" in out, (
        "the count in that sentence has to be derived; a typed one is true of one receipt")


def test_a_row_with_neither_a_locale_nor_a_transcript_shows_no_language():
    out = _markup([_item("S-1", transcript=[])])
    assert "Tamil" not in out and "English" not in out
    assert "read from the script" not in out


def test_an_escalated_row_shows_the_deadline_its_own_end_time_implies():
    from firstbell.domain import SAFEGUARDING_CALLBACK_MINUTES
    assert SAFEGUARDING_CALLBACK_MINUTES == 30
    out = _markup([_item("S-1", completed_at="2026-09-04T09:12:00+00:00")])
    assert "answered 09:12, call back by" in out
    assert "<b>09:42</b>" in out, "the deadline is the end time plus the promised window"
    assert "records no per-call end time" not in out


def test_a_row_that_is_not_escalated_carries_no_callback_clock():
    """The window is a promise about safeguarding cases and not about every callback."""
    plain = _item("S-1", structured_result={}, resolution="failed",
                  completed_at="2026-09-04T09:12:00+00:00")
    out = _markup([plain])
    assert "call back by" not in out


def test_an_unreadable_end_time_shows_no_clock_rather_than_a_wrong_one():
    out = _markup([_item("S-1", completed_at="the fourth of September")])
    assert "call back by" not in out
    assert "records no per-call end time" in out, (
        "a timestamp this page could not read is a deadline it does not know, and the "
        "page says so rather than going quiet")


def test_the_note_is_one_paragraph_rather_than_one_per_row():
    """Reading fatigue was the loudest complaint about this page.

    Four rows each admitting the same missing field is twenty-four lines of identical
    prose, which is the defect the shared-reason band was written to remove.
    """
    out = _markup([_item(f"S-{n}") for n in range(1, 5)])
    assert out.count("class=queue-clockless") == 1
