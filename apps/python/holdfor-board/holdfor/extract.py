from __future__ import annotations

from .models import (
    CallResult,
    Extraction,
    Feeling,
    MedicationOk,
    Turn,
    WantsSeen,
)

EXTRACTION_FAILED = "extraction_failed"
NOT_VERBATIM = "carried_words_not_verbatim"


def _refused(reason: str) -> Extraction:
    return Extraction(
        feeling=None,
        medication_ok=None,
        wants_seen=None,
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
        carried_words_text=None,
        carried_words_turn=None,
        stop_condition=False,
        stop_reason=None,
    )


def extract(result: CallResult, medication_changed: bool) -> Extraction:
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

    text = structured.get("carried_words_text")
    index = structured.get("carried_words_turn")
    if text is not None and not is_verbatim(result.transcript, text, index):
        return _refused(NOT_VERBATIM)

    return Extraction(
        feeling=feeling,
        medication_ok=medication_ok,
        wants_seen=wants_seen,
        carried_words_text=text,
        carried_words_turn=index,
        stop_condition=bool(structured.get("stop_condition")),
        stop_reason=structured.get("stop_reason"),
    )
