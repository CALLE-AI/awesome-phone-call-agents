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
        reasons.append(f"the call did not complete (status: {call.get('status')})")
    if not call.get("task_completed"):
        reasons.append("CALL-E did not judge the task complete")
    if not call.get("structured_result"):
        reasons.append("no schema-valid result could be extracted from the call")

    if result.get("answered_by") != "human":
        reasons.append(f"a person did not answer (endpoint: {result.get('answered_by') or 'unknown'})")
    if result.get("resolved") != "yes":
        reasons.append(f"the question was not settled (resolved: {result.get('resolved') or 'unknown'})")

    answer = (result.get(answer_field) or "").strip()
    if not answer:
        reasons.append("the call returned no answer")

    quote = (result.get("evidence_quote") or "").strip()
    if not quote:
        reasons.append("the call returned no verbatim quote to stand behind the answer")

    # An answer that is not one of the options we offered is not an answer to
    # the question we asked. This catches an extraction that invented a value.
    if answer and expected_options:
        if not _matches_an_option(answer, expected_options):
            reasons.append(
                f"the answer '{answer}' is not one of the options that were offered"
            )

    if reasons:
        return Verdict(passed=False, reasons=reasons)

    # Both fields are provider text and both are masked on the way out. The
    # answer needs it as much as the quote: a vague_commitment has no menu to
    # check against, so `committed_date` is free text that CALL-E extracted,
    # and it goes straight into a draft. Masking only rewrites phone-shaped
    # runs, so a real date passes through untouched.
    return Verdict(passed=True, answer=mask_text(answer), quote=mask_text(quote))


def _matches_an_option(answer: str, options: list[str]) -> bool:
    low = answer.lower()
    return any(option.lower() in low or low in option.lower() for option in options)
