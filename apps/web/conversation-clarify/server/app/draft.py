"""Write the outcome back into the written record.

A phone agreement that stays on the phone is worth very little a month later.
The draft exists so the thread -- which is what both sides will actually reread
-- ends up holding the answer, attributed to the words that were spoken.

The draft is never sent. It is handed to the user to review, edit and send.
"""

from __future__ import annotations

from .detect import Finding
from .gate import Verdict


def build_draft(finding: Finding, verdict: Verdict, *, recipient_name: str, caller_name: str) -> str:
    if not verdict.passed:
        raise ValueError("A draft is only ever built from a call that passed the gate.")

    # The verbatim quote is deliberately NOT in the draft.
    #
    # It is evidence for the user that the answer came from a sentence someone
    # actually spoke -- the gate refuses to proceed without one. The recipient
    # does not need it: they know what they said. And the quote inherits speech
    # recognition quality, so it can arrive mangled. An observed call returned
    # "Up. 2 page summary actually." for a clear answer; mailing that back to
    # the person who said it is at best odd. The answer extracted from it was
    # correct, and the answer is what belongs in the written record.
    greeting = f"Hi {recipient_name.split()[0]}," if recipient_name else "Hi,"
    sign_off = f"\n\nThanks,\n{caller_name}" if caller_name else ""

    return (
        f"{greeting}\n\n"
        f"{_body(finding, verdict)}\n\n"
        f"Noting it here so it is written down — do correct me if I have it wrong."
        f"{sign_off}"
    )


def _body(finding: Finding, verdict: Verdict) -> str:
    if finding.kind == "unclear_choice":
        return (
            f"Thanks for taking the quick call just now. Confirming what we settled: "
            f"{verdict.answer}."
        )
    return (
        f"Thanks for taking the quick call just now. Confirming the timing we settled: "
        f"{verdict.answer}."
    )


def unresolved_note(finding: Finding, verdict: Verdict) -> dict:
    """What the user is shown when the call did not settle it.

    Deliberately not a draft. Nothing is written into the thread, because
    nothing was established.
    """
    return {
        "drafted": False,
        "headline": "The call did not settle it — nothing has been drafted.",
        "reasons": verdict.reasons,
        "suggestion": (
            "The thread is unchanged. You could reply asking the question directly, "
            "or try the call again later."
        ),
        "question_still_open": finding.call_question,
    }
