"""Detector tests. No network, no API key, no calls.

The negative cases matter more than the positive ones: a false positive here
proposes a real phone call to a real person.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.detect import detect, extract_options, names_an_option  # noqa: E402
from app.thread import thread_from_payload  # noqa: E402


def build(*messages) -> object:
    return thread_from_payload({
        "thread_id": "t1",
        "subject": "Test",
        "messages": [
            {"sender": "Me" if from_me else "Alex", "from_me": from_me, "body": body}
            for from_me, body in messages
        ],
    })


# --- A: unclear choice -------------------------------------------------------

def test_weekday_choice_answered_vaguely_is_detected():
    thread = build(
        (True, "Does Monday or Tuesday work for the kickoff? Stephen can only join Tuesday."),
        (False, "Yeah, I'll be there."),
    )
    [finding] = detect(thread)
    assert finding.kind == "unclear_choice"
    assert finding.options == ["Monday", "Tuesday"]
    assert finding.confidence == "high"
    assert "Monday or Tuesday" in finding.call_question


def test_naming_the_option_is_not_a_finding():
    thread = build(
        (True, "Does Monday or Tuesday work?"),
        (False, "Tuesday works for me."),
    )
    assert detect(thread) == []


def test_weekday_abbreviation_counts_as_naming_it():
    thread = build(
        (True, "Monday or Tuesday for the review?"),
        (False, "Tues is better, thanks."),
    )
    assert detect(thread) == []


def test_reply_without_agreement_is_not_a_finding():
    thread = build(
        (True, "Does Monday or Tuesday work?"),
        (False, "I'm checking with the team and will revert."),
    )
    assert detect(thread) == []


def test_reply_that_asks_a_question_back_is_left_alone():
    thread = build(
        (True, "Monday or Tuesday?"),
        (False, "Sure — is Stephen joining either way?"),
    )
    assert detect(thread) == []


def test_time_options_are_detected():
    thread = build(
        (True, "Shall we say 3pm or 5pm?"),
        (False, "Yep, works for me."),
    )
    [finding] = detect(thread)
    assert finding.kind == "unclear_choice"
    assert len(finding.options) == 2


def test_generic_either_or_options():
    thread = build(
        (True, "Should I send the short deck or the full deck?"),
        (False, "Yes please, that's great."),
    )
    [finding] = detect(thread)
    assert finding.kind == "unclear_choice"
    assert len(finding.options) == 2


def test_quoted_history_is_not_read_as_a_new_reply():
    thread = build(
        (True, "Monday or Tuesday?"),
        (False, "Let me check.\n\nOn Tue, Alex wrote:\n> Yeah sure, sounds good"),
    )
    assert detect(thread) == []


# --- B: vague commitment -----------------------------------------------------

def test_commitment_without_a_date_is_detected():
    thread = build(
        (True, "Can you send the signed copy over before the board meeting?"),
        (False, "Will do."),
    )
    [finding] = detect(thread)
    assert finding.kind == "vague_commitment"
    assert finding.options == []


def test_soon_raises_confidence():
    thread = build(
        (True, "Could you share the revised quote?"),
        (False, "Sure, I'll send it soon."),
    )
    [finding] = detect(thread)
    assert finding.kind == "vague_commitment"
    assert finding.confidence == "high"


def test_commitment_with_a_weekday_is_not_a_finding():
    thread = build(
        (True, "Can you send the revised quote?"),
        (False, "Will do — sending Thursday."),
    )
    assert detect(thread) == []


def test_commitment_with_a_date_is_not_a_finding():
    thread = build(
        (True, "Could you confirm the numbers?"),
        (False, "Yes, by the 14th."),
    )
    assert detect(thread) == []


def test_commitment_with_a_relative_day_is_not_a_finding():
    thread = build(
        (True, "Can you review the contract?"),
        (False, "On it, will have it back to you tonight."),
    )
    assert detect(thread) == []


def test_no_request_means_no_commitment_finding():
    thread = build(
        (True, "Just FYI, the deck is attached."),
        (False, "Great, thanks."),
    )
    assert detect(thread) == []


# --- structure ---------------------------------------------------------------

def test_at_most_one_finding_per_reply():
    thread = build(
        (True, "Can you confirm Monday or Tuesday?"),
        (False, "Yes, will do."),
    )
    assert len(detect(thread)) == 1


def test_latest_ambiguity_comes_first():
    thread = build(
        (True, "Monday or Tuesday?"),
        (False, "Sure thing."),
        (True, "And can you send the deck?"),
        (False, "Will do."),
    )
    findings = detect(thread)
    assert len(findings) == 2
    assert findings[0].replied_index > findings[1].replied_index


def test_thread_with_no_reply_yields_nothing():
    thread = build((True, "Monday or Tuesday?"))
    assert detect(thread) == []


def test_fingerprint_is_stable_and_content_sensitive():
    a = build((True, "Monday or Tuesday?"), (False, "Yeah."))
    b = build((True, "Monday or Tuesday?"), (False, "Yeah."))
    c = build((True, "Monday or Tuesday?"), (False, "Yeah, Monday."))
    assert a.fingerprint() == b.fingerprint()
    assert a.fingerprint() != c.fingerprint()


# --- helpers -----------------------------------------------------------------

def test_extract_options_needs_two():
    assert extract_options("Does Monday work?") == []
    assert extract_options("Monday or Tuesday?") == ["Monday", "Tuesday"]


def test_names_an_option_is_word_bounded():
    assert names_an_option("Monday suits", ["Monday", "Tuesday"]) == "Monday"
    assert names_an_option("I'll be there", ["Monday", "Tuesday"]) == ""


def test_an_undelimited_phone_number_does_not_count_as_a_specific():
    """Digits in a signature are not a date.

    Found by accident: every fixture used a "--" delimited signature, which is
    stripped before analysis, so a bare number under a reply was never exercised.
    """
    thread = build(
        (True, "Can you send the signed copy before the board meeting?"),
        (False, "Will do.\n+1 555 010 0142"),
    )
    [finding] = detect(thread)
    assert finding.kind == "vague_commitment"


def test_a_real_quantity_still_counts_as_a_specific():
    thread = build(
        (True, "Can you send the signed copies?"),
        (False, "Will do, all 3 of them."),
    )
    assert detect(thread) == []


def test_options_stated_before_the_question_mark_are_found():
    """"We can start Monday or Tuesday. Which works for you?" is how people
    actually write; the options and the question mark are in different sentences."""
    thread = build(
        (True, "We can start the kickoff on Monday or Tuesday next week. "
               "Stephen can only join on Tuesday. Which works for you?"),
        (False, "Yeah, count me in."),
    )
    [finding] = detect(thread)
    assert finding.kind == "unclear_choice"
    assert finding.options == ["Monday", "Tuesday"]


def test_two_days_mentioned_without_asking_is_not_a_finding():
    """The guard on the rule above: a statement is not a question."""
    thread = build(
        (True, "We were closed Monday and Tuesday, so the numbers look odd."),
        (False, "Yeah, makes sense."),
    )
    assert detect(thread) == []


def test_a_generic_option_starts_at_its_own_noun_phrase():
    thread = build(
        (True, "Should I send the board the two-page summary or the full appendix version?"),
        (False, "Yes please, that works."),
    )
    [finding] = detect(thread)
    assert finding.options == ["two-page summary", "full appendix version"]
