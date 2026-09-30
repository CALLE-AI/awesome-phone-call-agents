"""Coaching detection.

A heuristic that may only ever downgrade. These tests pin both directions: it
must fire on the shapes it claims to catch, and stay silent on an ordinary
conversation, because a false positive sends a living pensioner to a human
queue for no reason.
"""

from __future__ import annotations

import pytest

from muster.coaching import (
    LONG_PAUSE_SECONDS,
    long_gap_before_reply,
    suspected,
    unattributed_voice_between_turns,
)
from muster.models import Observations, TranscriptTurn


def turn(offset: float, speaker: str, text: str = "...") -> TranscriptTurn:
    return TranscriptTurn(offset_seconds=offset, speaker=speaker, text=text)


def conversation(*spec: tuple[float, str]) -> tuple[TranscriptTurn, ...]:
    """Build turns from (offset, speaker) pairs; the words never matter here."""
    return tuple(turn(offset, speaker) for offset, speaker in spec)


# --------------------------------------------------------------------------
# Unattributed voice
# --------------------------------------------------------------------------


def test_unattributed_voice_fires_on_bot_unknown_user() -> None:
    """Somebody who is not the caller and not the subject spoke in between."""
    turns = conversation((0.0, "bot"), (2.0, "unknown"), (3.0, "user"))
    assert unattributed_voice_between_turns(turns) is True


def test_unattributed_voice_fires_deep_in_a_longer_call() -> None:
    turns = conversation(
        (0.0, "bot"), (1.0, "user"), (5.0, "bot"), (7.0, "unknown"), (8.0, "user")
    )
    assert unattributed_voice_between_turns(turns) is True


def test_unattributed_voice_does_not_fire_on_bot_user_bot() -> None:
    """An ordinary exchange must never look like coaching."""
    turns = conversation((0.0, "bot"), (1.0, "user"), (2.0, "bot"))
    assert unattributed_voice_between_turns(turns) is False


def test_unattributed_voice_does_not_fire_on_a_clean_call() -> None:
    turns = conversation(
        (0.0, "bot"), (1.0, "user"), (2.0, "bot"), (3.0, "user"), (4.0, "bot")
    )
    assert unattributed_voice_between_turns(turns) is False


def test_unattributed_voice_does_not_fire_when_the_unknown_speaks_after_the_user() -> None:
    """A stray voice after the answer prompted nothing."""
    turns = conversation((0.0, "bot"), (1.0, "user"), (2.0, "unknown"))
    assert unattributed_voice_between_turns(turns) is False


def test_unattributed_voice_does_not_fire_when_the_unknown_opens_the_call() -> None:
    turns = conversation((0.0, "unknown"), (1.0, "bot"), (2.0, "user"))
    assert unattributed_voice_between_turns(turns) is False


@pytest.mark.parametrize("count", [0, 1, 2])
def test_unattributed_voice_needs_three_turns_to_have_a_middle(count: int) -> None:
    turns = conversation(*[(float(i), "unknown") for i in range(count)])
    assert unattributed_voice_between_turns(turns) is False


# --------------------------------------------------------------------------
# Long gap
# --------------------------------------------------------------------------


def test_long_gap_fires_above_the_threshold() -> None:
    turns = conversation((0.0, "bot"), (LONG_PAUSE_SECONDS + 0.5, "user"))
    assert long_gap_before_reply(turns) is True


def test_long_gap_does_not_fire_below_the_threshold() -> None:
    turns = conversation((0.0, "bot"), (LONG_PAUSE_SECONDS - 0.5, "user"))
    assert long_gap_before_reply(turns) is False


def test_long_gap_does_not_fire_exactly_on_the_threshold() -> None:
    """The comparison is strict; an elderly speaker gets the benefit of the edge."""
    turns = conversation((0.0, "bot"), (LONG_PAUSE_SECONDS, "user"))
    assert long_gap_before_reply(turns) is False


def test_long_gap_ignores_a_pause_before_a_bot_turn() -> None:
    """Only the reply to a question is timed. The caller may take its time."""
    turns = conversation((0.0, "user"), (LONG_PAUSE_SECONDS + 10.0, "bot"))
    assert long_gap_before_reply(turns) is False


def test_long_gap_is_measured_across_intervening_turns() -> None:
    """A turn in between must not hide the delay. A whispered prompt is exactly
    what sits between the question and the answer in the case this signal
    exists to catch, so the gap is timed from the most recent bot turn."""
    turns = conversation(
        (0.0, "bot"), (1.0, "unknown"), (LONG_PAUSE_SECONDS + 5.0, "user")
    )
    assert long_gap_before_reply(turns) is True
    assert unattributed_voice_between_turns(turns) is True


def test_long_gap_on_empty_turns() -> None:
    assert long_gap_before_reply(()) is False


# --------------------------------------------------------------------------
# suspected()
# --------------------------------------------------------------------------


def test_suspected_returns_no_signals_for_empty_turns() -> None:
    """CALL-E may return no transcript at all; that is not suspicion."""
    assert suspected(Observations()) == (False, ())


def test_suspected_names_the_unattributed_voice_signal() -> None:
    observed = Observations(
        turns=conversation((0.0, "bot"), (1.0, "unknown"), (2.0, "user"))
    )
    fired, signals = suspected(observed)
    assert fired is True
    assert "unattributed_voice_between_question_and_answer" in signals


def test_suspected_names_the_delay_signal_with_the_threshold_in_it() -> None:
    observed = Observations(
        turns=conversation((0.0, "bot"), (LONG_PAUSE_SECONDS + 1.0, "user"))
    )
    fired, signals = suspected(observed)
    assert fired is True
    assert f"reply_delayed_more_than_{int(LONG_PAUSE_SECONDS)}s" in signals


def test_suspected_reports_both_signals_when_both_fire() -> None:
    observed = Observations(
        turns=conversation(
            (0.0, "bot"),
            (2.0, "unknown"),
            (3.0, "user"),
            (5.0, "bot"),
            (5.0 + LONG_PAUSE_SECONDS + 1.0, "user"),
        )
    )
    fired, signals = suspected(observed)
    assert fired is True
    assert set(signals) == {
        "unattributed_voice_between_question_and_answer",
        f"reply_delayed_more_than_{int(LONG_PAUSE_SECONDS)}s",
    }


def test_suspected_stays_silent_on_a_brisk_clean_call() -> None:
    observed = Observations(
        turns=conversation((0.0, "bot"), (1.5, "user"), (3.0, "bot"), (4.2, "user"))
    )
    assert suspected(observed) == (False, ())


def test_suspected_signals_are_a_tuple_of_named_strings() -> None:
    """Reasons are written into the attestation, so they must be stable names."""
    observed = Observations(
        turns=conversation((0.0, "bot"), (1.0, "unknown"), (2.0, "user"))
    )
    _, signals = suspected(observed)
    assert isinstance(signals, tuple)
    assert all(isinstance(s, str) and s and " " not in s for s in signals)