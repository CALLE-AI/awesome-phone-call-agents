"""Decide whether a finished call is allowed to change anything.

A call produces testimony, not fact. Before this app writes a single word into
someone's email thread, eight independent things must agree. Any one of them
failing means the thread is left exactly as it was, and the user is told why.

Nothing here consults completion_confidence. On a call that never rang, CALL-E
returned confidence 0.85 labelled "high" alongside task_completed: false.
Confidence measures certainty in the judgement, not success of the task, so it
is not evidence and is not used as any.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .numbers import mask_text


@dataclass
class Verdict:
    passed: bool
    answer: str = ""
    quote: str = ""
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "answer": self.answer,
            "quote": self.quote,
            "reasons": self.reasons,
        }


def evaluate(call: dict, *, answer_field: str, expected_options: list[str] | None = None) -> Verdict:
    reasons: list[str] = []
    result = call.get("structured_result") or {}

    if call.get("status") != "completed":
        reasons.append(
            f"the call did not complete (status: {mask_text(str(call.get('status')))})"
        )
    if not call.get("task_completed"):
        reasons.append("CALL-E did not judge the task complete")
    if not call.get("structured_result"):
        reasons.append("no schema-valid result could be extracted from the call")

    # answered_by and resolved are declared enums, but they are provider-supplied
    # strings on the wire and nothing stops one arriving with a number in it.
    if result.get("answered_by") != "human":
        endpoint = mask_text(str(result.get("answered_by") or "unknown"))
        reasons.append(f"a person did not answer (endpoint: {endpoint})")
    if result.get("resolved") != "yes":
        settled = mask_text(str(result.get("resolved") or "unknown"))
        reasons.append(f"the question was not settled (resolved: {settled})")

    answer = (result.get(answer_field) or "").strip()
    if not answer:
        reasons.append("the call returned no answer")

    quote = (result.get("evidence_quote") or "").strip()
    if not quote:
        reasons.append("the call returned no verbatim quote to stand behind the answer")
    else:
        # "Verbatim" has to mean something. Check the quote against what the
        # recipient actually said, rather than trusting the extraction to have
        # copied rather than paraphrased.
        spoken = _spoken_by_recipient(call)
        if not spoken:
            reasons.append("the call returned no transcript to check the quote against")
        elif not _appears_in(quote, spoken):
            reasons.append("the quoted words do not appear in what the recipient said")

    # An answer that is not one of the options we offered is not an answer to
    # the question we asked. This catches an extraction that invented a value.
    if answer and expected_options:
        if not _matches_an_option(answer, expected_options):
            reasons.append(
                f"the answer {mask_text(answer)!r} is not one of the options that were offered"
            )

    if reasons:
        return Verdict(passed=False, reasons=reasons)

    # Both fields are provider text and both are masked on the way out. The
    # answer needs it as much as the quote: a vague_commitment has no menu to
    # check against, so `committed_date` is free text that CALL-E extracted,
    # and it goes straight into a draft. Masking only rewrites phone-shaped
    # runs, so a real date passes through untouched.
    return Verdict(passed=True, answer=mask_text(answer), quote=mask_text(quote))


# Words that flip the meaning of a sentence that otherwise contains an option.
# "not Monday" mentions Monday; it does not choose it.
_NEGATION = re.compile(
    r"\b(not|no|neither|nor|none|never|isn't|wasn't|won't|can't|cannot|"
    r"instead|other than|rather than|except)\b"
)


def _normalise(text: str) -> str:
    """Lower-case, strip punctuation and markdown, collapse whitespace."""
    text = (text or "").replace("*", " ").replace("_", " ")
    text = re.sub(r"[^\w\s]+", " ", text.lower())
    return " ".join(text.split())


def _spoken_by_recipient(call: dict) -> str:
    """Everything the person on the other end said, normalised.

    Read from the raw call rather than a masked copy, so a quote containing a
    number can still be matched against the turn it came from.
    """
    said = []
    for recipient in call.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            for turn in attempt.get("transcript_turns") or []:
                if (turn.get("speaker") or "") == "user":
                    said.append(turn.get("text") or "")
    return _normalise(" ".join(said))


def _appears_in(quote: str, spoken: str) -> bool:
    needle = _normalise(quote)
    return bool(needle) and needle in spoken


def _matches_an_option(answer: str, options: list[str]) -> bool:
    """Whole-word match, and nothing that negates the option it names.

    Substring matching in either direction was too loose: it accepted "Mon" for
    "Monday" and, worse, accepted "not Monday" and "neither Monday nor Tuesday"
    as though they had chosen one.
    """
    low = _normalise(answer)
    if not low or _NEGATION.search(low):
        return False
    return any(
        re.search(rf"\b{re.escape(_normalise(option))}\b", low)
        for option in options if _normalise(option)
    )
