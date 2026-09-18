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
