#!/usr/bin/env python3
"""Tests for the call-right-party-gatekeeper skill.

Run:
    python3 -m pytest skills/call-right-party-gatekeeper/scripts/test_gatekeeper.py -v
    python3 skills/call-right-party-gatekeeper/scripts/test_gatekeeper.py
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
EXAMPLE_VERIFIED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_WRONG_PARTY = SKILL_DIR / "references" / "example-transcript-wrong-party.json"

sys.path.insert(0, str(SCRIPTS))
from gatekeeper import (  # noqa: E402
    build_gate_card,
    craft_goal,
    detect_signals,
    load_call_result,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_VERIFIED)
    assert data["status"] == "COMPLETED"
    assert data["turns"][0]["speaker"] == "agent"
    assert data["turns"][1]["speaker"] == "callee"
    assert "May I speak to Dana Reyes" in data["turns"][0]["text"]


def test_load_plain_string_transcript_wraps_as_single_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "agent: hello there"})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_accepts_flat_top_level_transcript():
    data = load_call_result(EXAMPLE_WRONG_PARTY)
    assert data["status"] == "completed"
    assert len(data["turns"]) == 3


def test_load_empty_transcript_returns_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": []})
        data = load_call_result(p)
    assert data["turns"] == []


def test_mask_ten_digit_phone_keeps_last_two():
    # run "1 415 555 0142" is 14 chars (11 digits) -> 12 hashes + last 2 chars.
    # Note: expected value corrected from "00" (task-spec typo) to "42", the
    # actual last 2 chars of the run.
    assert mask_pii("call +1 415 555 0142 now") == "call +############42 now"


def test_mask_exactly_seven_digits_is_masked():
    assert mask_pii("ref 555-0142 closed") == "ref ######42 closed"


def test_short_digit_runs_untouched():
    text = "Thursday 10:00, 3rd attempt, order 12345"
    assert mask_pii(text) == text


def test_mask_separators_count_toward_one_run():
    assert mask_pii("id 415.555.0142 x9") == "id ##########42 x9"


def test_mask_trailing_separator_not_part_of_run():
    assert mask_pii("num 5550142, please") == "num #####42, please"


def test_signal_verification_question_detected():
    signals = detect_signals("agent", "May I speak to Dana Reyes?")
    assert "verification_question" in signals


def test_signal_verification_question_am_i_speaking():
    signals = detect_signals("agent", "Am I speaking with the account holder?")
    assert "verification_question" in signals


def test_signal_identity_confirmation_variants():
    assert "identity_confirmation" in detect_signals("callee", "Yes, this is Dana.")
    assert "identity_confirmation" in detect_signals("callee", "Speaking.")
    assert "identity_confirmation" in detect_signals("callee", "This is he.")


def test_signal_wrong_party_variants():
    assert "wrong_party_signal" in detect_signals("callee", "Sorry, you have the wrong number.")
    assert "wrong_party_signal" in detect_signals("callee", "Can I take a message?")
    assert "wrong_party_signal" in detect_signals("callee", "She is not here right now.")


def test_signal_third_party_variants():
    assert "third_party_signal" in detect_signals("callee", "Who is this calling?")
    assert "third_party_signal" in detect_signals("callee", "I'm his wife, I can ask him for you.")
    assert "third_party_signal" in detect_signals("callee", "He is busy right now.")


def test_signal_sensitive_disclosure_variants():
    assert "sensitive_disclosure" in detect_signals("agent", "Your account balance of $84.20 is settled.")
    assert "sensitive_disclosure" in detect_signals("agent", "We are calling about your invoice.")
    assert "sensitive_disclosure" in detect_signals("agent", "Can you confirm your date of birth?")


def test_signal_no_false_positive_on_plain_turns():
    assert detect_signals("agent", "Hello, this is an automated assistant from Example Clinic.") == []
    assert detect_signals("callee", "Great, thank you for letting me know.") == []


def test_signal_roles_route_patterns_to_sides():
    # verification questions only count from the agent side
    assert detect_signals("callee", "May I speak to Dana?") == []
    # identity confirmation only counts from the callee side
    assert detect_signals("agent", "Yes, this is Dana.") == []


def test_signal_speaking_of_not_identity_confirmation():
    assert detect_signals("callee", "Speaking of the weather, it's raining.") == []


def test_signal_yes_i_am_requires_complete_reply():
    assert "identity_confirmation" in detect_signals("callee", "Yes, I am.")
    assert detect_signals("callee", "Yes, I am interested in the plan.") == []


def test_signal_is_this_the_verified_as_question():
    assert "verification_question" in detect_signals("agent", "Is this the account holder?")


def _analyze_fixture(path: Path) -> dict:
    data = load_call_result(path)
    return build_gate_card(data["turns"])


def test_card_verified_fixture_confirmed_and_proceeds():
    card = _analyze_fixture(EXAMPLE_VERIFIED)
    assert card["skill"] == "call-right-party-gatekeeper"
    assert card["analysis_mode"] == "heuristic"
    assert card["right_party_status"] == "CONFIRMED"
    assert card["verification_before_disclosure"] is True
    assert card["recommended_action"]["action"] == "proceed"
    assert card["reason"] is None
    assert "disclaimer" in card and card["disclaimer"]


def test_card_verified_fixture_evidence_signals():
    card = _analyze_fixture(EXAMPLE_VERIFIED)
    kinds = [(e["turn_index"], e["signal"]) for e in card["evidence"]]
    assert (0, "verification_question") in kinds
    assert (1, "identity_confirmation") in kinds
    assert (2, "sensitive_disclosure") in kinds


def test_card_wrong_party_fixture_requires_human_review():
    card = _analyze_fixture(EXAMPLE_WRONG_PARTY)
    assert card["right_party_status"] == "WRONG_PARTY"
    assert card["verification_before_disclosure"] is False
    assert card["recommended_action"]["action"] == "human_review"


def test_card_third_party_present_asks_to_stop_and_retry():
    turns = [
        {"speaker": "agent", "text": "Hello, this is an automated assistant. May I speak to Dana Reyes?"},
        {"speaker": "callee", "text": "Who is this calling? He is busy right now."},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "THIRD_PARTY_PRESENT"
    assert card["recommended_action"]["action"] == "stop_and_retry_with_script"


def test_card_unverified_without_disclosure_is_human_review():
    turns = [
        {"speaker": "agent", "text": "Hello, this is an automated assistant from Example Clinic calling about your visit."},
        {"speaker": "callee", "text": "Okay, go ahead."},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "UNVERIFIED"
    assert card["verification_before_disclosure"] is False
    assert card["recommended_action"]["action"] == "human_review"


def test_card_disclosure_before_late_confirmation_is_human_review():
    turns = [
        {"speaker": "agent", "text": "Your account balance of $50 is overdue."},
        {"speaker": "agent", "text": "Am I speaking with Dana Reyes?"},
        {"speaker": "callee", "text": "Yes, this is Dana."},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "CONFIRMED"
    assert card["verification_before_disclosure"] is False
    assert card["recommended_action"]["action"] == "human_review"


def test_card_masks_digits_in_evidence():
    card = _analyze_fixture(EXAMPLE_VERIFIED)
    for entry in card["evidence"]:
        assert "5550142" not in json.dumps(entry)
        assert "415" not in entry["span"] or "#" in entry["span"]


def test_card_no_callee_turns_abstains():
    card = build_gate_card([{"speaker": "agent", "text": "Hello? Hello?"}])
    assert card["gate_assessment"] == "unclear"
    assert card["reason"] == "insufficient_signal"
    assert card["right_party_status"] is None


def test_card_empty_turns_abstains():
    card = build_gate_card([])
    assert card["gate_assessment"] == "unclear"
