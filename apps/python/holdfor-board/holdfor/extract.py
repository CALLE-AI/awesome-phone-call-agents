from __future__ import annotations

from .models import (
    CallResult,
    Extraction,
    Feeling,
    MedicationOk,
    Turn,
    WantsSeen,
    WhenEasier,
)

EXTRACTION_FAILED = "extraction_failed"
NOT_VERBATIM = "carried_words_not_verbatim"


def _refused(reason: str) -> Extraction:
    return Extraction(
        feeling=None,
        medication_ok=None,
        wants_seen=None,
        when_easier=None,
        carried_words_text=None,
        carried_words_turn=None,
        stop_condition=True,
        stop_reason=reason,
    )


def _enum(cls, value):
    try:
        return cls(value)
    except ValueError:
        return None


def is_verbatim(turns: list[Turn], text: str | None, index: int | None) -> bool:
    if not text or index is None:
        return False
    turn = next((t for t in turns if t.index == index), None)
    return turn is not None and turn.speaker == "other" and text in turn.text


def no_answers() -> Extraction:
    return Extraction(
        feeling=None,
        medication_ok=None,
        wants_seen=None,
        when_easier=None,
        carried_words_text=None,
        carried_words_turn=None,
        stop_condition=False,
        stop_reason=None,
    )


def extract(result: CallResult, medication_changed: bool) -> Extraction:
    """The agent's own account, bounded and checked, or a refusal.

    `when_easier` is the one bounded field whose absence refuses nothing. It is
    supplementary: a call that never asked it is still a readable call, and the item is
    already on its way to a person because she said yes. Refusing on it would turn
    every call placed before this question existed into `extraction_failed`, and every
    call where the agent skipped one question into a call nobody can read.
    """
    structured = result.structured
    if not structured:
        return _refused(EXTRACTION_FAILED)

    feeling = _enum(Feeling, structured.get("feeling"))
    wants_seen = _enum(WantsSeen, structured.get("wants_seen"))
    if feeling is None or wants_seen is None:
        return _refused(EXTRACTION_FAILED)

    if medication_changed:
        medication_ok = _enum(MedicationOk, structured.get("medication_ok"))
        if medication_ok is MedicationOk.NOT_ASKED:
            medication_ok = None
    else:
        medication_ok = MedicationOk.NOT_ASKED

    # Asked only when she said yes, so anything else is a question nobody put to her,
    # whatever the agent reported. Enforced here rather than trusted, the same way
    # `medication_ok` is: the call is not the record of what the call was allowed to do.
    if wants_seen is WantsSeen.YES:
        when_easier = _enum(WhenEasier, structured.get("when_easier"))
        if when_easier is WhenEasier.NOT_ASKED:
            when_easier = None
    else:
        when_easier = WhenEasier.NOT_ASKED

    text = structured.get("carried_words_text")
    index = structured.get("carried_words_turn")
    if text is not None and not is_verbatim(result.transcript, text, index):
        return _refused(NOT_VERBATIM)

    return Extraction(
        feeling=feeling,
        medication_ok=medication_ok,
        wants_seen=wants_seen,
        when_easier=when_easier,
        carried_words_text=text,
        carried_words_turn=index,
        stop_condition=bool(structured.get("stop_condition")),
        stop_reason=structured.get("stop_reason"),
    )
