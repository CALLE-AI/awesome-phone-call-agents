"""Detect a third party feeding answers to the subject.

CALL-E returns `transcript_turns` with `offset_seconds`, `speaker` and `text`.
When a reply to a freshness challenge arrives long after the question with an
unattributed turn in between, somebody in the room was prompting.

This is a heuristic. It may only ever downgrade a result to NEEDS_HUMAN. It can
never raise one, and it never concludes fraud.
"""

from __future__ import annotations

from .models import Observations, TranscriptTurn

#: A pause longer than this between question and answer is unusual for a recall
#: task this small.
LONG_PAUSE_SECONDS = 6.0


def unattributed_voice_between_turns(turns: tuple[TranscriptTurn, ...]) -> bool:
    """True when an `unknown` speaker sits between a bot turn and a user turn."""
    for i in range(1, len(turns) - 1):
        before, middle, after = turns[i - 1], turns[i], turns[i + 1]
        if middle.speaker == "unknown" and before.speaker == "bot" and after.speaker == "user":
            return True
    return False


def long_gap_before_reply(turns: tuple[TranscriptTurn, ...]) -> bool:
    """True when a user reply arrives an unusually long time after the question.

    Measured from the most recent bot turn, not merely the adjacent one. An
    intervening turn is precisely what a prompted answer looks like, so timing
    only adjacent pairs would hide the case this exists to catch.
    """
    asked_at: float | None = None
    for turn in turns:
        if turn.speaker == "bot":
            asked_at = turn.offset_seconds
        elif turn.speaker == "user" and asked_at is not None:
            if turn.offset_seconds - asked_at > LONG_PAUSE_SECONDS:
                return True
            asked_at = None
    return False


def suspected(observed: Observations) -> tuple[bool, tuple[str, ...]]:
    """Return whether coaching is suspected, and the named signals that say so."""
    signals: list[str] = []
    turns = observed.turns
    if turns:
        if unattributed_voice_between_turns(turns):
            signals.append("unattributed_voice_between_question_and_answer")
        if long_gap_before_reply(turns):
            signals.append(f"reply_delayed_more_than_{int(LONG_PAUSE_SECONDS)}s")
    return bool(signals), tuple(signals)
