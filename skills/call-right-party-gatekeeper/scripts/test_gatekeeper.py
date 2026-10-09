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


def test_craft_known_scenario_builds_goal():
    plan = craft_goal("sensitive-outreach")
    assert plan["skill"] == "call-right-party-gatekeeper"
    assert plan["mode"] == "craft"
    assert plan["scenario"] == "sensitive-outreach"
    assert plan["language"] == "en"
    assert "May I speak" in plan["goal"]
    assert "without revealing the subject" in plan["goal"]


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("cold-call")
    except ValueError as exc:
        assert "unknown scenario" in str(exc).lower()
    else:
        raise AssertionError("expected ValueError")


def test_craft_language_passthrough():
    assert craft_goal("sensitive-outreach", language="es")["language"] == "es"


def test_craft_goal_matches_card_retry_guidance():
    from gatekeeper import VERIFICATION_FIRST_GOAL
    plan = craft_goal("sensitive-outreach")
    turns = [
        {"speaker": "agent", "text": "Hello, this is an automated assistant. May I speak to Dana Reyes?"},
        {"speaker": "callee", "text": "Who is this calling? He is busy right now."},
    ]
    card = build_gate_card(turns)
    assert card["recommended_action"]["action"] == "stop_and_retry_with_script"
    assert plan["goal"] == card["recommended_action"]["guidance"]
    assert plan["goal"] == VERIFICATION_FIRST_GOAL


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(SCRIPTS / "gatekeeper.py"), *args]
    return subprocess.run(cmd, capture_output=True, text=True)


def test_cli_analyze_verified_fixture_outputs_card():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_VERIFIED))
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["right_party_status"] == "CONFIRMED"


def test_cli_analyze_wrong_party_fixture_outputs_card():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_WRONG_PARTY))
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["right_party_status"] == "WRONG_PARTY"
    assert card["recommended_action"]["action"] == "human_review"


def test_cli_analyze_missing_file_exits_2():
    proc = _run_cli("analyze", "--transcript", "does-not-exist.json")
    assert proc.returncode == 2
    assert "not found" in proc.stderr.lower()


def test_cli_analyze_invalid_json_exits_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text("{not json", encoding="utf-8")
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2


def test_cli_analyze_non_dict_json_exits_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "list.json"
        p.write_text("[1, 2, 3]", encoding="utf-8")
        proc = _run_cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2


def test_cli_analyze_includes_call_id_when_present():
    proc = _run_cli("analyze", "--transcript", str(EXAMPLE_WRONG_PARTY))
    card = json.loads(proc.stdout)
    assert card["call_id"] == "example-wrong-party-001"


def test_cli_craft_writes_out_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "plan.json"
        proc = _run_cli("craft", "--scenario", "sensitive-outreach", "--out", str(out))
        assert proc.returncode == 0
        plan = json.loads(out.read_text(encoding="utf-8"))
    assert plan["mode"] == "craft"


def test_cli_craft_unknown_scenario_exits_2():
    proc = _run_cli("craft", "--scenario", "nope")
    assert proc.returncode == 2


def _main() -> int:
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError:
                failures += 1
                print(f"FAIL {name}")
    print(f"{failures} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(_main())


def test_load_number_transcript_yields_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": 42})
        assert load_call_result(p)["turns"] == []


def test_load_whitespace_only_string_transcript_yields_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "completed", "transcript": "   "})
        assert load_call_result(p)["turns"] == []


def test_load_mixed_list_skips_non_dict_and_defaults_missing_text():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {
            "status": "completed",
            "transcript": [{"speaker": "CALLEE", "text": "hi"}, "junk", {"speaker": "agent"}, 5],
        })
        data = load_call_result(p)
    assert data["turns"] == [
        {"speaker": "CALLEE", "text": "hi"},
        {"speaker": "agent", "text": ""},
    ]


def test_card_wrong_party_without_disclosure_stops_and_retries():
    turns = [
        {"speaker": "agent", "text": "Hello, this is an automated assistant. May I speak to Dana Reyes?"},
        {"speaker": "callee", "text": "Sorry, you have the wrong number."},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "WRONG_PARTY"
    assert card["verification_before_disclosure"] is False
    assert card["recommended_action"]["action"] == "stop_and_retry_with_script"


def test_card_confirmation_after_disclosure_requires_review():
    turns = [
        {"speaker": "agent", "text": "May I speak to Example Person?"},
        {"speaker": "agent", "text": "Your account balance is due."},
        {"speaker": "callee", "text": "Speaking."},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "CONFIRMED"
    assert card["verification_before_disclosure"] is False
    assert card["recommended_action"]["action"] == "human_review"


def test_card_confirmation_before_disclosure_is_ordered():
    turns = [
        {"speaker": "agent", "text": "May I speak to Example Person?"},
        {"speaker": "callee", "text": "Speaking."},
        {"speaker": "agent", "text": "Your account balance is due."},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "CONFIRMED"
    assert card["verification_before_disclosure"] is True
    assert card["recommended_action"]["action"] == "proceed"


def test_card_question_without_confirmation_is_not_verified():
    turns = [
        {"speaker": "agent", "text": "May I speak to Example Person?"},
        {"speaker": "callee", "text": "Maybe, who wants to know?"},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "UNVERIFIED"
    assert card["verification_before_disclosure"] is False
    assert card["recommended_action"]["action"] == "human_review"


def test_card_third_party_then_confirmation_becomes_confirmed():
    turns = [
        {"speaker": "agent", "text": "Hello, this is an automated assistant. May I speak to Dana Reyes?"},
        {"speaker": "callee", "text": "Who is this calling?"},
        {"speaker": "agent", "text": "I am an assistant from Example Clinic."},
        {"speaker": "callee", "text": "Yes, this is Dana."},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "CONFIRMED"
    assert card["verification_before_disclosure"] is True
    assert card["recommended_action"]["action"] == "proceed"


def test_card_disclosure_then_question_no_confirmation_is_unverified_review():
    turns = [
        {"speaker": "agent", "text": "Your account balance of $50 is overdue."},
        {"speaker": "agent", "text": "Am I speaking with Dana Reyes?"},
        {"speaker": "callee", "text": "Maybe, who wants to know?"},
    ]
    card = build_gate_card(turns)
    assert card["right_party_status"] == "UNVERIFIED"
    assert card["verification_before_disclosure"] is False
    assert card["recommended_action"]["action"] == "human_review"
