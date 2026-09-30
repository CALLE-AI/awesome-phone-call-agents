"""Transcript evidence binding for counterparty-stated values.

An extraction field the model returned is not yet a fact this application
asserts. For free-text values the binding rule is containment: the stated
text, after folding, must appear inside a counterparty turn of the attempt
transcript. If the model paraphrased beyond recognition, the value is
dropped — the control fails closed, and a paraphrase costs a field, never
the truth.

Enum values and references bind through their own quote fields and the
read-back exchange; see :mod:`warrantyops.identifiers` for the reference
machinery, which this module deliberately does not duplicate.
"""

from __future__ import annotations

from .identifiers import COUNTERPARTY_SPEAKER, TranscriptTurn, fold_text

#: Below this length a "grounded" match proves nothing about intent; short
#: strings such as "yes" occur in unrelated turns all call long.
MIN_GROUNDED_TEXT_CHARS = 8


def is_grounded_in_counterparty_turn(
    text: str | None, transcript: tuple[TranscriptTurn, ...] | None
) -> bool:
    """True when ``text`` appears inside a counterparty turn, after folding.

    ``transcript`` is ``None`` or empty when the provider exposed no
    transcript: nothing is grounded then, which is the safe direction.
    """

    if not text or transcript is None:
        return False
    folded = fold_text(text)
    if len(folded) < MIN_GROUNDED_TEXT_CHARS:
        return False
    return any(
        turn.speaker == COUNTERPARTY_SPEAKER and folded in fold_text(turn.text)
        for turn in transcript
    )
