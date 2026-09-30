"""The spoken script.

These assert the disclosures a person is owed before they answer questions that
affect their income, and the rule that the script never names the line.
"""

from __future__ import annotations

from datetime import date

from muster import nonce as nonce_mod, roster, task
from muster.runner import plan_call

SCHEME = "the Northern Counties Pension Scheme"


def _script(subject_id: str = "s-1041") -> str:
    subject = roster.get(subject_id)
    issued = nonce_mod.mint(date(2026, 9, 8))
    return task.build_task(subject, issued, subject.prompts, SCHEME)


def test_the_script_never_names_the_line() -> None:
    """A preview, a log line or the console can show the whole spoken text
    without disclosing the number. It travels in `recipients` instead."""
    for subject in roster.ROSTER:
        issued = nonce_mod.mint(date(2026, 9, 8))
        script = task.build_task(subject, issued, subject.prompts, SCHEME)
        assert subject.phone_e164 not in script
        assert subject.phone_e164[-6:] not in script


def test_the_script_discloses_who_is_calling_and_why() -> None:
    script = _script()
    assert "automated call" in script
    assert SCHEME in script


def test_the_script_says_the_call_cannot_take_anything_away() -> None:
    """Somebody who believes their pension is about to be cut will say whatever
    they think is needed. That pressure is what produces bad evidence."""
    script = _script()
    assert "cannot stop or reduce any payment" in script


def test_the_script_refuses_to_question_a_third_party() -> None:
    script = _script()
    assert "do not ask them anything" in script


def test_the_script_never_marks_the_answer() -> None:
    script = _script()
    assert "Never say whether an answer was right or wrong" in script


def test_the_script_stops_on_distress() -> None:
    script = _script()
    assert "distressed" in script


def test_the_payload_still_carries_the_number() -> None:
    """Removing it from the script must not remove it from the request."""
    from muster.runner import payload_for

    subject = roster.get("s-1041")
    plan = plan_call(subject, "2026-09", SCHEME, when=date(2026, 9, 8))
    assert payload_for(plan)["recipients"] == [{"phones": [subject.phone_e164]}]
