"""The freshness challenge.

The nonce is the only defence against a voicemail greeting recorded in the
subject's own voice, so these tests care about two opposite things: it must be
strict about order, and forgiving about everything a telephone line and an ASR
engine can mangle.

It has two legs. The forward echo is the freshness proof. The reverse echo is
the one that shows the instruction was understood rather than parroted, and it
does that while collecting nothing about the person at all, which is why it can
be asked on a platform that refuses security questions.
"""

from __future__ import annotations

import random
from datetime import date

import pytest

from muster.models import Nonce, Observations
from muster.nonce import WEEKDAYS, WORD_POOL, check, check_reversed, mint, normalise


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


def test_spoken_instruction_asks_for_the_reverse_as_well() -> None:
    """The reverse leg is only fair if the person was asked for it, and this
    string is the only place the asking happens."""
    minted = Nonce(words=("river", "table", "yellow"), weekday="tuesday")
    said = minted.spoken_instruction()
    assert "reverse order" in said
    assert said.index("day of the week") < said.index("reverse order")


def test_reversed_words_is_the_word_list_backwards() -> None:
    """Stated once here so the graders and the spoken script cannot disagree
    about which end the person is meant to start from."""
    minted = Nonce(words=("river", "table", "yellow"), weekday="tuesday")
    assert minted.reversed_words == ("yellow", "table", "river")
    assert tuple(reversed(minted.reversed_words)) == minted.words


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


# --------------------------------------------------------------------------
# Checking the reverse leg
# --------------------------------------------------------------------------


def reversed_observed(words: tuple[str, ...]) -> Observations:
    """Only the reverse slot is filled, so nothing here can pass by accident on
    the strength of the forward echo."""
    return Observations(nonce_words_reversed_heard=words)


def test_check_reversed_passes_when_the_words_come_back_backwards() -> None:
    assert check_reversed(NONCE, reversed_observed(("yellow", "table", "river"))) is True


def test_check_reversed_fails_on_the_forward_order() -> None:
    """The point of the leg. Repeating the same three words a second time is
    what a recording or an inattentive parrot does; it is not an answer to the
    question that was asked."""
    assert check_reversed(NONCE, reversed_observed(("river", "table", "yellow"))) is False


def test_check_reversed_fails_on_any_other_order() -> None:
    assert check_reversed(NONCE, reversed_observed(("table", "yellow", "river"))) is False
    assert check_reversed(NONCE, reversed_observed(("yellow", "river", "table"))) is False


def test_check_reversed_tolerates_filler_around_the_sequence() -> None:
    """Somebody working it out aloud says "er, yellow, table, river, I think"."""
    reply = reversed_observed(("er", "yellow", "table", "river", "I", "think"))
    assert check_reversed(NONCE, reply) is True


def test_check_reversed_does_not_tolerate_filler_inside_the_sequence() -> None:
    """Same rule as the forward leg: the sequence has to be contiguous, or
    three words scattered through a long call would count as an ordered reply."""
    assert check_reversed(NONCE, reversed_observed(("yellow", "um", "table", "river"))) is False


def test_check_reversed_tolerates_asr_spelling_and_punctuation() -> None:
    """An ASR quirk must never fail a living person on this leg either."""
    assert check_reversed(NONCE, reversed_observed(("Yéllow,", "TABLE.", "river!"))) is True


def test_check_reversed_fails_on_a_short_reply() -> None:
    assert check_reversed(NONCE, reversed_observed(("yellow", "table"))) is False


def test_check_reversed_fails_on_the_wrong_words() -> None:
    assert check_reversed(NONCE, reversed_observed(("yellow", "table", "silver"))) is False


def test_check_reversed_fails_on_empty_input() -> None:
    """Silence is not a pass, and saying nothing when asked to reverse the words
    is the commonest way this leg goes unanswered."""
    assert check_reversed(NONCE, Observations()) is False
    assert check_reversed(NONCE, reversed_observed(())) is False
    assert check_reversed(NONCE, reversed_observed(("", "", ""))) is False


def test_check_reversed_ignores_empty_transcription_slots() -> None:
    reply = reversed_observed(("", "yellow", "  ", "table", "river"))
    assert check_reversed(NONCE, reply) is True


def test_check_reversed_reads_only_the_reverse_slot() -> None:
    """The two legs are transcribed into separate fields. If the reverse check
    could be satisfied by the forward field, a person who only ever echoed once
    would pass both."""
    spoken = Observations(nonce_words_heard=NONCE.reversed_words)
    assert check_reversed(NONCE, spoken) is False


def test_the_two_legs_are_independent() -> None:
    """Each leg answers its own question, so neither can carry the other."""
    forward_only = Observations(
        nonce_words_heard=NONCE.words, weekday_heard=NONCE.weekday
    )
    assert check(NONCE, forward_only) is True
    assert check_reversed(NONCE, forward_only) is False

    reverse_only = Observations(nonce_words_reversed_heard=NONCE.reversed_words)
    assert check(NONCE, reverse_only) is False
    assert check_reversed(NONCE, reverse_only) is True


def test_check_reversed_does_not_consult_the_weekday() -> None:
    """Characterisation, not an oversight: the weekday is the freshness half of
    the challenge and `check` already requires it. Asking for it twice would
    fail a person twice for one mishearing."""
    reply = Observations(
        nonce_words_reversed_heard=NONCE.reversed_words, weekday_heard="friday"
    )
    assert check_reversed(NONCE, reply) is True
