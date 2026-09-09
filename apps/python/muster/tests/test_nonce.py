"""The freshness challenge.

The nonce is the only defence against a voicemail greeting recorded in the
subject's own voice, so these tests care about two opposite things: it must be
strict about order, and forgiving about everything a telephone line and an ASR
engine can mangle.
"""

from __future__ import annotations

import random
from datetime import date

import pytest

from muster.models import Nonce, Observations
from muster.nonce import WEEKDAYS, WORD_POOL, check, mint, normalise


# --------------------------------------------------------------------------
# Minting
# --------------------------------------------------------------------------


def test_mint_is_deterministic_under_a_seeded_generator() -> None:
    """Determinism is what makes a failing call reproducible in a post-mortem."""
    first = mint(date(2026, 9, 8), random.Random(1234))
    second = mint(date(2026, 9, 8), random.Random(1234))
    assert first == second
    assert first.words == second.words


def test_mint_draws_three_distinct_words_from_the_pool() -> None:
    """A repeated word would let a recording pass a third of the challenge."""
    for seed in range(50):
        minted = mint(date(2026, 9, 8), random.Random(seed))
        assert len(minted.words) == 3
        assert len(set(minted.words)) == 3
        assert set(minted.words) <= set(WORD_POOL)


def test_mint_varies_between_seeds() -> None:
    """A per-call nonce that never changed would be a shared secret, not a nonce."""
    drawn = {mint(date(2026, 9, 8), random.Random(seed)).words for seed in range(30)}
    assert len(drawn) > 1


@pytest.mark.parametrize(
    ("when", "expected_weekday"),
    [
        (date(2026, 9, 7), "monday"),
        (date(2026, 9, 8), "tuesday"),
        (date(2026, 9, 12), "saturday"),
        (date(2026, 9, 6), "sunday"),
    ],
)
def test_mint_takes_the_weekday_from_the_call_date(when: date, expected_weekday: str) -> None:
    assert mint(when, random.Random(0)).weekday == expected_weekday


def test_weekday_table_is_indexed_the_way_date_weekday_counts() -> None:
    """`date.weekday()` is Monday-zero; the table must agree or every nonce lies."""
    assert WEEKDAYS[0] == "monday"
    assert len(WEEKDAYS) == 7


def test_spoken_instruction_names_every_word_in_order() -> None:
    minted = Nonce(words=("river", "table", "yellow"), weekday="tuesday")
    said = minted.spoken_instruction()
    assert "river, table, yellow" in said
    assert said.index("river") < said.index("table") < said.index("yellow")


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "folded"),
    [
        ("River", "river"),
        ("  YELLOW  ", "yellow"),
        ("yellow.", "yellow"),
        ("Yellow!?", "yellow"),
        ("café", "cafe"),
        ("Mardí", "mardi"),
        ("Rivér,", "river"),
        ("HARBOUR-", "harbour"),
        ("", ""),
        ("...", ""),
        ("river table", "rivertable"),
    ],
)
def test_normalise_folds_case_accents_and_punctuation(raw: str, folded: str) -> None:
    assert normalise(raw) == folded


def test_normalise_is_idempotent() -> None:
    """Folding twice must not change the answer, or matching would depend on when."""
    for raw in ("Café!", "  Tuesday. ", "Rivér"):
        assert normalise(normalise(raw)) == normalise(raw)


# --------------------------------------------------------------------------
# Checking
# --------------------------------------------------------------------------


NONCE = Nonce(words=("river", "table", "yellow"), weekday="tuesday")


def observed(words: tuple[str, ...], weekday: str) -> Observations:
    return Observations(nonce_words_heard=words, weekday_heard=weekday)


def test_check_passes_on_an_exact_reply() -> None:
    assert check(NONCE, observed(("river", "table", "yellow"), "tuesday")) is True


def test_check_tolerates_asr_spelling_and_punctuation() -> None:
    """An ASR quirk must never fail a living person."""
    reply = observed(("River,", "TABLE.", "yéllow"), "Tuesday.")
    assert check(NONCE, reply) is True


def test_check_fails_when_the_right_words_arrive_in_the_wrong_order() -> None:
    """Order is what separates a live reply from an echo of the question."""
    assert check(NONCE, observed(("table", "river", "yellow"), "tuesday")) is False
    assert check(NONCE, observed(("yellow", "table", "river"), "tuesday")) is False


def test_check_tolerates_filler_around_the_sequence() -> None:
    """People say "um, river, table, yellow, I think"."""
    reply = observed(("um", "river", "table", "yellow", "I", "think"), "tuesday")
    assert check(NONCE, reply) is True


def test_check_tolerates_leading_and_trailing_filler_separately() -> None:
    assert check(NONCE, observed(("right", "river", "table", "yellow"), "tuesday")) is True
    assert check(NONCE, observed(("river", "table", "yellow", "yes"), "tuesday")) is True


def test_check_does_not_tolerate_filler_inside_the_sequence() -> None:
    """Deliberate: the sequence must be contiguous, or "river ... table" months
    apart in the call would count as an ordered reply."""
    reply = observed(("river", "um", "table", "yellow"), "tuesday")
    assert check(NONCE, reply) is False


def test_check_fails_on_a_short_reply() -> None:
    assert check(NONCE, observed(("river", "table"), "tuesday")) is False


def test_check_fails_on_the_wrong_words() -> None:
    assert check(NONCE, observed(("river", "table", "silver"), "tuesday")) is False


def test_check_fails_on_the_wrong_weekday() -> None:
    """The weekday is the half of the challenge a stale recording cannot know."""
    assert check(NONCE, observed(("river", "table", "yellow"), "wednesday")) is False


def test_check_fails_when_no_weekday_was_given() -> None:
    assert check(NONCE, observed(("river", "table", "yellow"), "")) is False


def test_check_fails_on_empty_input() -> None:
    """Silence is not a pass."""
    assert check(NONCE, Observations()) is False
    assert check(NONCE, observed((), "")) is False
    assert check(NONCE, observed(("", "", ""), "tuesday")) is False


def test_check_ignores_empty_transcription_slots() -> None:
    """An ASR engine emits stray blank elements; they are not evidence either way."""
    reply = observed(("", "river", "  ", "table", "yellow"), "tuesday")
    assert check(NONCE, reply) is True
