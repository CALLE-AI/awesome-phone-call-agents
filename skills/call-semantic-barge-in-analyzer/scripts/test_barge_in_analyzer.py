#!/usr/bin/env python3
"""Tests for the call-semantic-barge-in-analyzer skill.

Run:
    python3 -m pytest skills/call-semantic-barge-in-analyzer/scripts/test_barge_in_analyzer.py -v
    python3 skills/call-semantic-barge-in-analyzer/scripts/test_barge_in_analyzer.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
REPO_ROOT = SKILL_DIR.parent.parent
EXAMPLE_ENGAGED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_FRUSTRATED = SKILL_DIR / "references" / "example-transcript-frustrated.json"

sys.path.insert(0, str(SCRIPTS))
from barge_in_analyzer import (  # noqa: E402
    build_pacing_card,
    classify_callee_turn,
    craft_goal,
    load_call_result,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_ENGAGED)
    assert data["status"] == "COMPLETED"
    assert data["turns"][0]["speaker"] == "agent"
    assert data["turns"][1]["speaker"] == "callee"
    assert "lab results" in data["turns"][0]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_FRUSTRATED)
    assert data["status"] == "completed"
    assert len(data["turns"]) == 7


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []


def test_mask_ten_digit_phone_keeps_last_two():
    # run "1 415 555 0188" is 14 chars (11 digits) -> 12 hashes + last 2 chars
    assert mask_pii("call +1 415 555 0188 now") == "call +############88 now"


def test_mask_exactly_seven_digits_is_masked():
    assert mask_pii("ref 555-0188 closed") == "ref ######88 closed"


def test_short_digit_runs_untouched():
    text = "Thursday 10:00, 3rd ring, order 12345, total $42.10"
    assert mask_pii(text) == text


def test_mask_separators_count_toward_one_run():
    assert mask_pii("id 415.555.0188 x9") == "id ##########88 x9"


def test_mask_trailing_separator_not_part_of_run():
    assert mask_pii("num 5550188, please") == "num #####88, please"


def test_classify_backchannel_variants_after_statement():
    assert classify_callee_turn("Mm-hmm.", "Your results came back normal.") == "backchannel"
    assert classify_callee_turn("Yeah.", "The doctor reviewed them yesterday.") == "backchannel"
    assert classify_callee_turn("Right, okay.", "No follow-up is needed.") == "backchannel"
    assert classify_callee_turn("Got it.", "The total is settled.") == "backchannel"
    assert classify_callee_turn("Sounds good, go on.", "Here is the first part.") == "backchannel"


def test_classify_answer_to_question_is_substantive():
    assert classify_callee_turn("Yes, please.", "Would you like the summary sent?") == "substantive"
    assert classify_callee_turn("Mm-hmm.", "Did you receive the message?") == "substantive"


def test_classify_barge_in_variants():
    assert classify_callee_turn("Wait, wait, slow down.", "") == "barge_in"
    assert classify_callee_turn("Hold on, how much is the total again?", "") == "barge_in"
    assert classify_callee_turn("Enough, just tell me when it arrives.", "") == "barge_in"
    assert classify_callee_turn("Hang on a second.", "") == "barge_in"


def test_classify_barge_in_precedence_over_backchannel():
    assert classify_callee_turn("Wait, ok, ok.", "Statement not question.") == "barge_in"


def test_classify_substantive_long_answer():
    assert classify_callee_turn("Yes, Thursday at ten works for me.", "Is Tuesday still good?") == "substantive"


def test_classify_word_count_limit():
    # vocabulary words, but after a statement -> too long for a backchannel
    assert classify_callee_turn("Yeah, the Tuesday one is fine.", "Your appointment is on Tuesday.") == "substantive"


def test_classify_look_not_a_barge_in():
    # deliberate deviation: bare "look" is excluded (false-positive vector)
    assert classify_callee_turn("I will look into that, thanks.", "") == "substantive"


def test_classify_question_mark_detection_uses_trailing_question():
    assert classify_callee_turn("Sure.", "Anything else I can help with?") == "substantive"
    assert classify_callee_turn("Sure.", "That is all I needed to say.") == "backchannel"


def test_classify_no_previous_agent_text_backchannel():
    assert classify_callee_turn("Okay.", "") == "backchannel"


def test_classify_plain_substantive():
    assert classify_callee_turn("Thank you for calling.", "It arrives Thursday.") == "substantive"


def test_classify_wait_for_and_stop_by_not_barge_ins():
    assert classify_callee_turn("I will wait for the email.", "") == "substantive"
    assert classify_callee_turn("You can stop by the pharmacy anytime.", "") == "substantive"


def test_classify_wait_comma_still_barge_in():
    assert classify_callee_turn("Wait, let me write that down.", "") == "barge_in"


def test_classify_question_detection_handles_trailing_quotes():
    assert classify_callee_turn("Yes.", "Okay, you are free tomorrow?'") == "substantive"
    assert classify_callee_turn("Yes.", "Okay, you are free tomorrow?\u201d") == "substantive"


def _analyze_fixture(path: Path) -> dict:
    data = load_call_result(path)
    return build_pacing_card(data["turns"])


def test_card_engaged_fixture_profile_and_recommendation():
    card = _analyze_fixture(EXAMPLE_ENGAGED)
    assert card["skill"] == "call-semantic-barge-in-analyzer"
    assert card["analysis_mode"] == "heuristic"
    assert card["cooperation_profile"] == "ENGAGED_COOPERATIVE"
    assert card["pacing_recommendation"]["recommendation"] == "maintain_pacing"
    assert card["reason"] is None
    assert "disclaimer" in card and card["disclaimer"]


def test_card_engaged_fixture_metrics():
    card = _analyze_fixture(EXAMPLE_ENGAGED)
    m = card["metrics"]
    assert m["callee_turns"] == 4
    assert m["backchannel_count"] == 2
    assert m["barge_in_count"] == 0
    assert m["substantive_count"] == 2
    assert m["backchannel_density"] == 0.5


def test_card_frustrated_fixture_profile_and_adaptation():
    card = _analyze_fixture(EXAMPLE_FRUSTRATED)
    assert card["cooperation_profile"] == "FRUSTRATED_INTERRUPTING"
    assert card["pacing_recommendation"]["recommendation"] == "shorten_turns"
    m = card["metrics"]
    assert m["barge_in_count"] == 3
    assert m["agent_adapted_after_barge_in"] is True


def test_card_frustrated_recommendation_guidance_is_pacing_goal():
    from barge_in_analyzer import PACING_GOAL
    card = _analyze_fixture(EXAMPLE_FRUSTRATED)
    assert card["pacing_recommendation"]["guidance"] == PACING_GOAL


def test_card_neutral_synthetic():
    turns = [
        {"speaker": "agent", "text": "Hello, may I confirm your appointment on Thursday at ten?"},
        {"speaker": "callee", "text": "Yes, Thursday at ten works for me."},
        {"speaker": "agent", "text": "Great, it is booked."},
        {"speaker": "callee", "text": "Thank you for calling."},
    ]
    card = build_pacing_card(turns)
    assert card["cooperation_profile"] == "NEUTRAL"
    assert card["pacing_recommendation"]["recommendation"] == "pause_and_confirm"


def test_card_disengaged_synthetic():
    turns = [
        {"speaker": "agent", "text": "Is Tuesday still good for the delivery?"},
        {"speaker": "callee", "text": "Yes."},
        {"speaker": "agent", "text": "The driver will call before arriving."},
        {"speaker": "callee", "text": "Fine."},
        {"speaker": "agent", "text": "Anything else I can help with?"},
        {"speaker": "callee", "text": "No."},
    ]
    card = build_pacing_card(turns)
    assert card["cooperation_profile"] == "DISENGAGED"
    assert card["pacing_recommendation"]["recommendation"] == "pause_and_confirm"


def test_card_evidence_contains_only_backchannel_and_barge_in():
    card = _analyze_fixture(EXAMPLE_ENGAGED)
    kinds = {e["classification"] for e in card["evidence"]}
    assert kinds == {"backchannel"}


def test_card_masks_digits_in_evidence():
    card = _analyze_fixture(EXAMPLE_ENGAGED)
    for entry in card["evidence"]:
        assert "5550188" not in json.dumps(entry)
        assert "415" not in entry["span"] or "#" in entry["span"]


def test_card_no_callee_turns_abstains():
    card = build_pacing_card([{"speaker": "agent", "text": "Hello? Hello?"}])
    assert card["pacing_assessment"] == "unclear"
    assert card["reason"] == "insufficient_callee_signal"
    assert card["cooperation_profile"] is None


def test_card_empty_turns_abstains():
    card = build_pacing_card([])
    assert card["pacing_assessment"] == "unclear"
