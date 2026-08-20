"""T2: the words, the schema, and the check that does not trust the agent.

These tests build their transcripts inline and read no fixture directory, so they
exercise the script and the scanner without needing a recorded call.
"""

from __future__ import annotations

import json

import pytest

from holdfor import redflags
from holdfor.checkin import (
    CLOSING,
    DISCLOSURE,
    NEVER_ASK_PROMISE,
    RESULT_SCHEMA_PATH,
    SAFETY_LINE,
    build_task_text,
    recover_carried_words,
    result_schema,
    settle_stop_condition,
    weekday_of,
)
from holdfor.extract import NOT_VERBATIM
from holdfor.models import (
    CallResult,
    CallState,
    CheckinScope,
    Extraction,
    Feeling,
    MedicationOk,
    Turn,
    WantsSeen,
)
from holdfor.scan import (
    CLINICAL_QUESTION,
    RED_FLAG_PHRASE,
    THIRD_PARTY,
    UNMAPPABLE,
    extract_carried_words,
    scan,
)

MARGARET = CheckinScope(first_name="Margaret", phone_e164="+447700900123")

ALL_SET = {
    "feeling": Feeling.SAME,
    "medication_ok": MedicationOk.NOT_ASKED,
    "wants_seen": WantsSeen.NO,
}


def turns(*pairs: tuple[str, str]) -> list[Turn]:
    return [
        Turn(index=index, speaker=speaker, text=text)
        for index, (speaker, text) in enumerate(pairs)
    ]


def four_questions(worry: str, feeling: str = "About the same.") -> list[Turn]:
    """A complete, well-behaved call. The agent stops for nothing."""
    return turns(
        ("agent", "Hello, is that Margaret?"),
        ("other", "Yes, speaking."),
        ("agent", "Since Wednesday, are you feeling better, about the same, or worse?"),
        ("other", feeling),
        ("agent", "Is there anything worrying you?"),
        ("other", worry),
        ("agent", "Would you like the surgery to see you again?"),
        ("other", "No, I'll see how it goes."),
    )


# --- the script ------------------------------------------------------------------


def test_the_opening_says_what_it_is_and_proves_itself_with_the_appointment_day():
    text = build_task_text(MARGARET, medication_changed=False, weekday="Wednesday")

    assert "I'm a computer, not a person" in text
    assert "You saw someone here on Wednesday" in text
    assert "Is now a good time?" in text


def test_the_never_ask_promise_is_spoken_not_merely_honoured():
    text = build_task_text(MARGARET, medication_changed=False, weekday="Wednesday")

    assert "I won't ask you for your date of birth" in text
    assert "nobody from the practice will ever ask you for them over the phone" in text
    assert "NEVER ask her to confirm her surname" in text


def test_the_closing_tells_her_she_will_not_have_to_wait_on_hold():
    """Her notice that a Rebooking Call may be placed in her name."""
    text = build_task_text(MARGARET, medication_changed=False, weekday="Wednesday")

    assert "you won't have to ring in and wait on hold" in text


def test_the_safety_line_routes_to_111_and_is_read_verbatim():
    text = build_task_text(MARGARET, medication_changed=False, weekday="Wednesday")

    assert "Please ring 111" in text
    assert "If it feels like an emergency, ring 999" in text
    assert "Read it exactly" in text


def test_all_four_questions_are_in_the_script():
    text = build_task_text(MARGARET, medication_changed=True, weekday="Wednesday")

    assert "are you feeling better, about the same, or worse?" in text
    assert "Are you getting on alright with what they gave you?" in text
    assert "Is there anything worrying you?" in text
    assert "Would you like the surgery to see you again?" in text


def test_question_two_is_not_asked_when_the_medication_did_not_change():
    asked = build_task_text(MARGARET, medication_changed=True, weekday="Wednesday")
    not_asked = build_task_text(MARGARET, medication_changed=False, weekday="Wednesday")

    assert "Are you getting on alright with what they gave you?" in asked
    assert "Are you getting on alright with what they gave you?" not in not_asked
    assert '"not_asked"' in not_asked


def test_nothing_spoken_carries_punctuation_a_speech_engine_may_read_aloud():
    unspeakable = set("—–()[]{}/\\*_#|<>")
    for line in (DISCLOSURE, NEVER_ASK_PROMISE, CLOSING, SAFETY_LINE):
        assert not unspeakable & set(line), line


def test_the_weekday_comes_from_the_appointment_date():
    assert weekday_of("2026-08-19") == "Wednesday"
    assert weekday_of("2026-08-17") == "Monday"


# --- the schema ------------------------------------------------------------------


def test_the_schema_enumerates_the_bounded_fields():
    schema = result_schema()
    properties = schema["properties"]

    assert properties["feeling"]["enum"] == ["better", "same", "worse", "unsure"]
    assert properties["medication_ok"]["enum"] == ["yes", "no", "unsure", "not_asked"]
    assert properties["wants_seen"]["enum"] == ["yes", "no", "unsure"]
    assert properties["carried_words_text"]["type"] == ["string", "null"]
    assert properties["carried_words_turn"]["type"] == ["integer", "null"]


def test_the_app_reads_the_published_schema_rather_than_restating_it():
    assert RESULT_SCHEMA_PATH.is_file()
    assert result_schema() == json.loads(
        RESULT_SCHEMA_PATH.read_text(encoding="utf-8")
    )


# --- the red-flag list -----------------------------------------------------------


def test_every_phrase_group_cites_a_published_source():
    text = redflags.path().read_text(encoding="utf-8")
    contributing = [
        section
        for section in text.split("\n## ")[1:]
        if any(line.startswith("- ") for line in section.splitlines())
        and any(line.startswith("Source:") for line in section.splitlines())
    ]

    assert contributing, "no cited phrase group found"
    for section in contributing:
        source = next(
            line for line in section.splitlines() if line.startswith("Source:")
        )
        assert "nhs.uk" in source


def test_uncited_bullet_lists_contribute_no_phrases():
    """The matching-rules bullets are prose, not clinical phrases."""
    assert "case-folded, matched on word boundaries" not in redflags.phrases()


def test_the_prompt_and_the_scanner_read_the_same_list(tmp_path, monkeypatch):
    """One list, two consumers. This fails the moment they diverge."""
    invented = tmp_path / "red-flags.md"
    invented.write_text(
        "# Red-flag phrases\n\n"
        "## Invented source\n\n"
        'Source: https://www.nhs.uk/conditions/example/ — "quoted wording".\n\n'
        "- the kitchen ceiling is humming\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("HOLDFOR_RED_FLAGS", str(invented))

    prompt = build_task_text(MARGARET, medication_changed=False, weekday="Wednesday")
    flagged, reason = scan(
        four_questions("The kitchen ceiling is humming."), dict(ALL_SET)
    )

    assert "the kitchen ceiling is humming" in prompt
    assert (flagged, reason) == (True, RED_FLAG_PHRASE)


def test_a_phrase_matches_whole_and_not_in_part():
    assert redflags.match("I am short of breath") is not None
    assert redflags.match("I held my breath for a moment") is None


# --- the scanner: the layer that does not trust the agent ------------------------


def test_it_flags_a_red_flag_the_agent_walked_straight_past():
    """The criterion this whole layer exists for.

    Four questions asked, four answers given, agent reported nothing wrong. On the
    agent's account this call auto-closes and a woman who mentioned chest pain is
    filed as needing nothing.
    """
    transcript = four_questions("Not really, though I've had a pain in my chest.")

    assert scan(transcript, dict(ALL_SET)) == (True, RED_FLAG_PHRASE)


def test_a_clean_complete_call_is_not_flagged():
    transcript = four_questions("No, I don't think so.", feeling="Better, thank you.")

    assert scan(transcript, dict(ALL_SET)) == (False, None)


def test_a_null_bounded_field_is_unmappable():
    unset = dict(ALL_SET) | {"wants_seen": None}

    assert scan(four_questions("No, nothing."), unset) == (True, UNMAPPABLE)


def test_somebody_else_coming_on_the_line_is_flagged():
    transcript = four_questions("Hang on, I'll put you on to my daughter.")

    assert scan(transcript, dict(ALL_SET)) == (True, THIRD_PARTY)


def test_a_clinical_question_put_to_the_agent_is_flagged():
    transcript = four_questions("Should I keep taking them, do you think?")

    assert scan(transcript, dict(ALL_SET)) == (True, CLINICAL_QUESTION)


def test_the_same_question_three_times_is_flagged():
    transcript = turns(
        ("agent", "Is there anything worrying you?"),
        ("other", "Pardon?"),
        ("agent", "Is there anything worrying you?"),
        ("other", "Who is this?"),
        ("agent", "Is there anything worrying you?"),
        ("other", "I can't hear you."),
    )

    assert scan(transcript, dict(ALL_SET))[0] is True


def test_the_red_flag_is_reported_before_a_null_field():
    """A Reviewer must see the chest pain first, not the missing answer."""
    unset = dict(ALL_SET) | {"feeling": None}
    transcript = four_questions("I've had a pain in my chest.")

    assert scan(transcript, unset) == (True, RED_FLAG_PHRASE)


# --- Carried Words: verbatim or nothing ------------------------------------------


def test_the_quote_is_a_substring_of_the_turn_it_claims_to_come_from():
    transcript = four_questions(
        "Well, the dizziness. I have to hold the worktop for a minute when I get up."
    )

    span, index = extract_carried_words(transcript)

    assert span in transcript[index].text
    assert transcript[index].speaker == "other"
    assert span == "I have to hold the worktop for a minute when I get up"


def test_no_clean_span_records_nothing_rather_than_generating_a_quote():
    assert extract_carried_words(four_questions("No, I don't think so.")) is None
    assert extract_carried_words(four_questions("Not really.")) is None
    assert extract_carried_words(four_questions("No.")) is None


def test_a_span_long_enough_but_saying_nothing_is_not_carried():
    """"Not really, no" is three words and tells a receptionist nothing."""
    assert extract_carried_words(four_questions("Not really, no.")) is None
    assert extract_carried_words(four_questions("Nothing at all, thank you.")) is None
    assert extract_carried_words(four_questions("Oh, I think it's all fine.")) is None


def test_it_returns_nothing_when_question_three_was_never_reached():
    stopped_early = turns(
        ("agent", "Since Wednesday, are you feeling better, about the same, or worse?"),
        ("other", "Worse. I've had a pain in my chest since teatime."),
        ("agent", "Thank you for telling me. Please ring 111."),
    )

    assert extract_carried_words(stopped_early) is None


def test_it_never_takes_words_from_the_agents_own_turn():
    transcript = turns(
        ("agent", "Is there anything worrying you?"),
        ("agent", "Sorry, are you still there? Anything worrying you at all?"),
        ("other", "My knee has been giving me trouble on the stairs."),
    )

    span, index = extract_carried_words(transcript)

    assert transcript[index].speaker == "other"
    assert span == "My knee has been giving me trouble on the stairs"


# --- the two layers, reconciled ---------------------------------------------------


def clean_extraction(**overrides) -> Extraction:
    fields = {
        "feeling": Feeling.SAME,
        "medication_ok": MedicationOk.NOT_ASKED,
        "wants_seen": WantsSeen.NO,
        "carried_words_text": None,
        "carried_words_turn": None,
        "stop_condition": False,
        "stop_reason": None,
    }
    return Extraction(**(fields | overrides))


def as_result(transcript: list[Turn]) -> CallResult:
    return CallResult(
        state=CallState.TERMINAL_VERIFIED, transcript=transcript, structured={}
    )


def test_the_scanner_overrules_an_agent_that_reported_nothing_wrong():
    transcript = four_questions("Not really, though I've had a pain in my chest.")

    assert settle_stop_condition(as_result(transcript), clean_extraction()) == (
        True,
        RED_FLAG_PHRASE,
    )


def test_a_more_specific_existing_reason_survives_the_scan():
    """A fabricated quote tells a Reviewer something "unmappable" would bury."""
    refused = clean_extraction(
        feeling=None,
        medication_ok=None,
        wants_seen=None,
        stop_condition=True,
        stop_reason=NOT_VERBATIM,
    )
    transcript = four_questions("No, nothing at all.")

    assert settle_stop_condition(as_result(transcript), refused) == (True, NOT_VERBATIM)


def test_a_red_flag_still_takes_the_reason_slot_from_a_specific_reason():
    refused = clean_extraction(
        feeling=None, stop_condition=True, stop_reason=NOT_VERBATIM
    )
    transcript = four_questions("I've had a pain in my chest.")

    assert settle_stop_condition(as_result(transcript), refused) == (
        True,
        RED_FLAG_PHRASE,
    )


def test_a_clean_call_stays_clean():
    transcript = four_questions("No, I don't think so.", feeling="Better, thank you.")

    assert settle_stop_condition(as_result(transcript), clean_extraction()) == (
        False,
        None,
    )


def test_a_quote_the_agent_declined_to_pick_is_recovered_from_the_transcript():
    transcript = four_questions("My knee has been giving me trouble on the stairs.")

    recovered = recover_carried_words(as_result(transcript), clean_extraction())

    assert recovered.carried_words_text == (
        "My knee has been giving me trouble on the stairs"
    )
    assert recovered.carried_words_text in transcript[recovered.carried_words_turn].text


def test_recovery_never_overrides_a_span_the_agent_already_returned():
    transcript = four_questions("My knee has been giving me trouble on the stairs.")
    already = clean_extraction(carried_words_text="the stairs", carried_words_turn=5)

    assert recover_carried_words(as_result(transcript), already) is already


def test_recovery_leaves_a_refused_extraction_alone():
    """A call refused for a fabricated quote does not get a better one grafted on."""
    transcript = four_questions("My knee has been giving me trouble on the stairs.")
    refused = clean_extraction(stop_condition=True, stop_reason=NOT_VERBATIM)

    assert recover_carried_words(as_result(transcript), refused) is refused
