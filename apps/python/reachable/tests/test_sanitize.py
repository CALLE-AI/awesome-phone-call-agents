"""Requirement 2 of docs/SAFETY.md: sanitise all free text at ingestion."""

from __future__ import annotations

from reachable.sanitize import (
    DEFAULT_MAX_LENGTH,
    TRUNCATION_MARKER,
    clean_for_csv,
    clean_quote,
    clean_text,
    clean_transcript_turns,
    strip_control_characters,
)


def test_ordinary_text_survives():
    assert clean_text("She has been unwell since Monday.") == "She has been unwell since Monday."


def test_control_characters_are_stripped():
    assert clean_text("abc\x00\x07def") == "abcdef"
    assert "\x1b" not in clean_text("before\x1b[31mafter")


def test_newlines_and_tabs_become_single_spaces():
    """Folded rather than dropped, so words do not run together."""
    assert clean_text("line one\nline two") == "line one line two"
    assert clean_text("a\t\tb") == "a b"
    assert clean_text("a\r\nb") == "a b"


def test_bidirectional_overrides_are_removed():
    """These make a stored string display as something other than what it is,
    which matters when staff read a transcript to make a safeguarding call."""
    hostile = "safe‮txt.exe"
    cleaned = clean_text(hostile)
    assert "‮" not in cleaned
    assert cleaned == "safetxt.exe"


def test_zero_width_characters_are_removed():
    assert clean_text("a​b‌c﻿") == "abc"


def test_length_is_capped_with_a_visible_marker():
    long = "x" * (DEFAULT_MAX_LENGTH + 200)
    cleaned = clean_text(long)
    assert len(cleaned) <= DEFAULT_MAX_LENGTH
    assert cleaned.endswith(TRUNCATION_MARKER)


def test_custom_length_cap():
    assert len(clean_text("y" * 100, max_length=20)) <= 20


def test_quotes_are_cleaned_but_not_reworded():
    """A tidied quote is a sentence the speaker never said."""
    spoken = "He left for school this morning,  same as always."
    assert clean_quote(spoken) == "He left for school this morning, same as always."


def test_none_and_non_strings_are_safe():
    assert clean_text(None) == ""
    assert clean_text(123) == "123"
    assert clean_text(["a"]) == "['a']"


def test_csv_formula_prefixes_are_neutralised():
    """A school office opens exports in Excel."""
    for dangerous in ["=cmd|'/c calc'!A1", "+1+1", "-1+1", "@SUM(A1)"]:
        assert clean_for_csv(dangerous).startswith("'")
    assert not clean_for_csv("Ordinary note").startswith("'")


def test_csv_cleaning_also_strips_control_characters():
    assert "\x00" not in clean_for_csv("a\x00b")


def test_strip_control_characters_keeps_accents_and_punctuation():
    assert strip_control_characters("Café — naïve") == "Café — naïve"


def test_transcript_turns_are_normalised():
    turns = clean_transcript_turns(
        [
            {"offset_seconds": 0, "speaker": "bot", "text": "Am I speaking to Martin?"},
            {"offset_seconds": 4, "speaker": "user", "text": "Speaking,\nyes."},
        ]
    )
    assert turns[0]["speaker"] == "bot"
    assert turns[1]["speaker"] == "user"
    assert turns[1]["text"] == "Speaking, yes."


def test_unrecognised_speaker_becomes_unknown_never_user():
    """The identity-binding rule depends on `user` meaning the recipient spoke."""
    turns = clean_transcript_turns(
        [
            {"offset_seconds": 1, "speaker": "assistant", "text": "hello"},
            {"offset_seconds": 2, "speaker": "customer", "text": "yes"},
            {"offset_seconds": 3, "speaker": None, "text": "maybe"},
        ]
    )
    assert [t["speaker"] for t in turns] == ["unknown", "unknown", "unknown"]


def test_malformed_transcript_input_is_safe():
    assert clean_transcript_turns(None) == []
    assert clean_transcript_turns("not a list") == []
    assert clean_transcript_turns([1, "x", None]) == []


def test_negative_or_missing_offsets_become_none():
    turns = clean_transcript_turns(
        [
            {"offset_seconds": -5, "speaker": "user", "text": "a"},
            {"speaker": "user", "text": "b"},
            {"offset_seconds": "4", "speaker": "user", "text": "c"},
        ]
    )
    assert [t["offset_seconds"] for t in turns] == [None, None, None]
