from __future__ import annotations

import pytest

from ringdown.calls import parse_turns, run_from


def a_transcript(speaker: str) -> list[dict]:
    return [
        {"speaker": "bot", "text": "Am I speaking with Alice Okafor?"},
        {"speaker": speaker, "text": "yes, this is alice"},
    ]


@pytest.mark.parametrize("speaker", ["user", "USER", "  User  ", "bot", "BOT"])
def test_the_two_labels_the_provider_uses_are_read_whatever_their_case(speaker):
    turns = parse_turns([{"speaker": speaker, "text": "hello"}])

    assert turns[0].speaker == speaker.strip().lower()


@pytest.mark.parametrize("speaker", ["human", "recipient", "customer", "", None, 7])
def test_a_speaker_nobody_can_place_makes_the_transcript_unreadable(speaker):
    with pytest.raises(ValueError, match="as its speaker"):
        parse_turns(a_transcript(speaker))


def test_a_transcript_that_is_not_a_list_is_still_no_turns_at_all():
    assert parse_turns(None) == ()
    assert parse_turns("[00:09] USER: yes, this is alice") == ()


def test_a_run_whose_speaker_cannot_be_placed_is_unreadable_too():
    with pytest.raises(ValueError, match="as its speaker"):
        run_from({"call_id": "call_1", "transcript_turns": a_transcript("agent")})
