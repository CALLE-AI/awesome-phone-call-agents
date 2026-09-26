#!/usr/bin/env python3
"""Tests for the call-goal-drift-auditor skill.

Run:
    python3 -m pytest skills/call-goal-drift-auditor/scripts/test_goal_drift_auditor.py -v
    python3 skills/call-goal-drift-auditor/scripts/test_goal_drift_auditor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_DRIFT = SKILL_DIR / "references" / "example-transcript-drift.json"
EXAMPLE_ON_TRACK = SKILL_DIR / "references" / "example-transcript-on-track.json"
EXAMPLE_GOAL = SKILL_DIR / "references" / "example-goal.txt"

sys.path.insert(0, str(SCRIPTS))
from goal_drift_auditor import (  # noqa: E402
    OFF_TOPIC_SPAN_LENGTH,
    ON_TRACK_THRESHOLD,
    analyze_transcript,
    craft_goal,
    extract_goal_keywords,
    load_call_result,
    load_goal_file,
    main,
    mask_pii,
)

GOAL_TEXT = "Confirm the dental appointment scheduled for Thursday at 3 p.m. with Dr. Patel. Verify insurance information."


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _write_goal(tmp: Path, text: str) -> Path:
    p = tmp / "goal.txt"
    p.write_text(text, encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


# ---------------------------------------------------------------- PII masking

def test_mask_pii_short_unchanged():
    assert mask_pii("555-01") == "555-01"


def test_mask_pii_phone_masked():
    result = mask_pii("+14155550177")
    assert result.endswith("77")
    assert "415555" not in result


def test_mask_pii_keeps_last_two():
    result = mask_pii("87654321")
    assert result.endswith("21")


# ---------------------------------------------------------------- keyword extraction

def test_extract_keywords_basic():
    kws = extract_goal_keywords("Confirm appointment with Dr. Patel on Thursday.")
    assert "confirm" in kws
    assert "appointment" in kws
    assert "patel" in kws
    assert "thursday" in kws


def test_extract_keywords_excludes_stop_words():
    kws = extract_goal_keywords("Call the patient about their account.")
    assert "the" not in kws
    assert "about" not in kws
    assert "their" not in kws


def test_extract_keywords_min_length():
    kws = extract_goal_keywords("Set up a new plan.")
    # "set" is 3 chars, below minimum 4; "plan" is 4 chars — included
    assert "plan" in kws


def test_extract_keywords_empty_goal():
    assert extract_goal_keywords("") == set()


def test_extract_keywords_all_stop_words():
    assert extract_goal_keywords("Call the for from is are") == set()


# ---------------------------------------------------------------- transcript and goal loading

def test_load_call_result_flat():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert len(data["turns"]) == 2


def test_load_call_result_nested():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "result": {"transcript": _turns(("agent", "Hi"), ("callee", "Yes"))}})
        data = load_call_result(p)
    assert len(data["turns"]) == 2


def test_load_call_result_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


def test_load_call_result_null_transcript():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": None})
        assert load_call_result(p)["turns"] == []


def test_load_call_result_preserves_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"call_id": "run-drift-test", "status": "COMPLETED", "transcript": _turns(("agent", "hi"))})
        assert load_call_result(p)["call_id"] == "run-drift-test"


def test_load_goal_file_plain():
    goal = load_goal_file(EXAMPLE_GOAL)
    assert "appointment" in goal.lower()
    assert "patel" in goal.lower()


def test_load_goal_file_json_goal_key():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "plan.json"
        p.write_text(json.dumps({"goal": "Confirm the meeting with the client."}), encoding="utf-8")
        text = load_goal_file(p)
    assert "meeting" in text


def test_load_goal_file_json_task_key():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "plan.json"
        p.write_text(json.dumps({"task": "Schedule the callback appointment."}), encoding="utf-8")
        text = load_goal_file(p)
    assert "callback" in text


def test_load_goal_file_bad_json_array_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text(json.dumps([1, 2]), encoding="utf-8")
        try:
            load_goal_file(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "goal" in str(exc).lower()


# ---------------------------------------------------------------- analysis — happy paths

def test_on_track_fixture():
    data = load_call_result(EXAMPLE_ON_TRACK)
    goal = load_goal_file(EXAMPLE_GOAL)
    card = analyze_transcript(data["turns"], goal)
    assert card["verdict"] in ("ON_TRACK", "MILD_DRIFT")
    assert card["goal_achieved"] is True


def test_drift_fixture():
    data = load_call_result(EXAMPLE_DRIFT)
    goal = load_goal_file(EXAMPLE_GOAL)
    card = analyze_transcript(data["turns"], goal)
    assert card["verdict"] in ("MILD_DRIFT", "SIGNIFICANT_DRIFT")
    assert len(card["off_topic_spans"]) >= 1


def test_off_topic_span_detected():
    turns = _turns(
        ("agent", "Hello, I am calling to confirm your appointment Thursday with Dr. Patel."),
        ("callee", "Yes."),
        ("agent", "We also have great whitening packages available this season."),
        ("agent", "Our Invisalign promotion runs until end of month, very popular."),
        ("agent", "Back to your appointment Thursday — is that confirmed?"),
        ("callee", "Yes."),
    )
    card = analyze_transcript(turns, GOAL_TEXT)
    assert len(card["off_topic_spans"]) >= 1
    assert card["off_topic_spans"][0]["length_in_agent_turns"] >= OFF_TOPIC_SPAN_LENGTH


def test_on_track_ratio():
    turns = _turns(
        ("agent", "I am calling to confirm your dental appointment Thursday."),
        ("callee", "Yes."),
        ("agent", "Please verify your insurance is on file."),
        ("callee", "Yes, BlueCross."),
        ("agent", "Your appointment is confirmed Thursday with Dr. Patel. All set."),
        ("callee", "Thanks."),
    )
    card = analyze_transcript(turns, GOAL_TEXT)
    assert card["on_topic_ratio"] >= ON_TRACK_THRESHOLD


def test_goal_achieved_closing_confirmation():
    turns = _turns(
        ("agent", "Confirming your appointment Thursday."),
        ("callee", "Yes."),
        ("agent", "Your appointment is confirmed Thursday with Dr. Patel. Thank you."),
    )
    card = analyze_transcript(turns, GOAL_TEXT)
    assert card["goal_achieved"] is True


def test_goal_not_achieved_when_no_confirmation():
    turns = _turns(
        ("agent", "Hello, calling about our whitening promotion."),
        ("agent", "We have great offers this month."),
        ("callee", "Not interested."),
    )
    card = analyze_transcript(turns, GOAL_TEXT)
    # No goal keywords in closing + likely low on-topic ratio
    assert card["goal_achieved"] is False


def test_significant_drift_two_spans():
    off_topic = "We have great promotions running this month for whitening."
    turns = _turns(
        ("agent", "Calling to confirm your dental appointment Thursday."),
        ("callee", "Yes."),
        ("agent", off_topic),
        ("agent", off_topic),
        ("agent", "Back to your appointment Thursday."),
        ("callee", "Yes."),
        ("agent", off_topic),
        ("agent", off_topic),
        ("agent", "Thank you."),
    )
    card = analyze_transcript(turns, GOAL_TEXT)
    assert card["verdict"] in ("SIGNIFICANT_DRIFT", "GOAL_NOT_ACHIEVED")


# ---------------------------------------------------------------- analysis — edge cases

def test_empty_transcript_unclear():
    card = analyze_transcript([], GOAL_TEXT)
    assert card["drift_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"


def test_no_agent_turns_unclear():
    card = analyze_transcript(_turns(("callee", "Hello?")), GOAL_TEXT)
    assert card["drift_assessment"] == "unclear"
    assert card["reason"] == "no_agent_turns"


def test_empty_goal_keywords_unclear():
    card = analyze_transcript(_turns(("agent", "Hi"), ("callee", "Hello")), "Call the for is are")
    assert card["drift_assessment"] == "unclear"
    assert card["reason"] == "no_goal_keywords_extracted"


def test_callee_role_variants_excluded_from_agent_analysis():
    for role in ("customer", "patient", "caller", "recipient", "user"):
        card = analyze_transcript(
            _turns(
                ("agent", "Confirming your appointment Thursday with Dr. Patel."),
                (role, "Yes, confirmed."),
            ),
            GOAL_TEXT,
        )
        # Only 1 agent turn; it should be counted
        assert card["agent_turn_count"] == 1, f"role={role}"


def test_single_agent_turn_span_below_threshold():
    # A single off-topic turn should not trigger a span (need >= OFF_TOPIC_SPAN_LENGTH consecutive)
    turns = _turns(
        ("agent", "Confirming your appointment Thursday with Dr. Patel."),
        ("callee", "Yes."),
        ("agent", "We also have promotions."),  # single off-topic
        ("agent", "Your appointment Thursday is confirmed."),
    )
    card = analyze_transcript(turns, GOAL_TEXT)
    assert len(card["off_topic_spans"]) == 0


def test_evidence_masked_in_off_topic_span():
    off_topic = "Call +14155550188 for our whitening promotion today."
    turns = _turns(
        ("agent", "Confirming your dental appointment Thursday."),
        ("callee", "Yes."),
        ("agent", off_topic),
        ("agent", off_topic),
    )
    card = analyze_transcript(turns, GOAL_TEXT)
    if card["off_topic_spans"]:
        assert "5550188" not in card["off_topic_spans"][0]["first_off_topic_evidence"]


def test_goal_keywords_in_card():
    card = analyze_transcript(_turns(("agent", "hi"), ("callee", "hello")), GOAL_TEXT)
    assert isinstance(card["goal_keywords"], list)
    assert len(card["goal_keywords"]) > 0
    assert "appointment" in card["goal_keywords"]


def test_disclaimer_and_mode_present():
    card = analyze_transcript(_turns(("agent", "hi"), ("callee", "hello")), GOAL_TEXT)
    assert card["analysis_mode"] == "heuristic"
    assert "advisory" in card["disclaimer"]


def test_on_topic_ratio_bounds():
    card = analyze_transcript(
        _turns(("agent", "Confirming your appointment Thursday."), ("callee", "Okay.")),
        GOAL_TEXT,
    )
    assert 0.0 <= card["on_topic_ratio"] <= 1.0


def test_thresholds_are_reasonable():
    assert 0 < ON_TRACK_THRESHOLD < 1
    assert 1 <= OFF_TOPIC_SPAN_LENGTH <= 5


# ---------------------------------------------------------------- craft

def test_craft_goal_structure():
    plan = craft_goal("goal-refocus")
    assert plan["mode"] == "craft"
    assert plan["skill"] == "call-goal-drift-auditor"
    assert "goal" in plan["goal"].lower() or "focus" in plan["goal"].lower()
    assert plan["language"] == "en"


def test_craft_with_goal_text_embeds_original():
    plan = craft_goal("goal-refocus", goal_text="Confirm the Thursday appointment.")
    assert "Thursday" in plan["goal"] or "appointment" in plan["goal"]


def test_craft_language_passthrough():
    assert craft_goal("goal-refocus", language="ja")["language"] == "ja"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("bad-scenario")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "bad-scenario" in str(exc)


# ---------------------------------------------------------------- CLI integration

def test_cli_analyze_on_track():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "goal_drift_auditor.py"),
            "analyze",
            "--transcript", str(EXAMPLE_ON_TRACK),
            "--goal-file", str(EXAMPLE_GOAL),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "run-drift-002"
    assert card["verdict"] in ("ON_TRACK", "MILD_DRIFT")


def test_cli_analyze_drift():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "goal_drift_auditor.py"),
            "analyze",
            "--transcript", str(EXAMPLE_DRIFT),
            "--goal-file", str(EXAMPLE_GOAL),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["verdict"] in ("MILD_DRIFT", "SIGNIFICANT_DRIFT", "GOAL_NOT_ACHIEVED")


def test_cli_analyze_missing_transcript_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "goal_drift_auditor.py"), "analyze", "--transcript", "nope.json", "--goal-file", str(EXAMPLE_GOAL)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_analyze_missing_goal_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "goal_drift_auditor.py"), "analyze", "--transcript", str(EXAMPLE_ON_TRACK), "--goal-file", "nope.txt"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_analyze_invalid_json_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text("not json", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "goal_drift_auditor.py"), "analyze", "--transcript", str(p), "--goal-file", str(EXAMPLE_GOAL)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2


def test_cli_analyze_surfaces_call_id():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "goal_drift_auditor.py"),
            "analyze",
            "--transcript", str(EXAMPLE_ON_TRACK),
            "--goal-file", str(EXAMPLE_GOAL),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-drift-002"


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "goal_drift_auditor.py"), "craft", "--scenario", "goal-refocus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    out = json.loads(proc.stdout)
    assert "goal" in out


def test_cli_craft_with_goal_file():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "goal_drift_auditor.py"), "craft", "--scenario", "goal-refocus", "--goal-file", str(EXAMPLE_GOAL)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    out = json.loads(proc.stdout)
    # The original goal keywords should appear in the crafted goal
    assert "appointment" in out["goal"].lower() or "patel" in out["goal"].lower()


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "goal_drift_auditor.py"), "craft", "--scenario", "bad"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_craft_language_flag():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "goal_drift_auditor.py"), "craft", "--scenario", "goal-refocus", "--language", "ko"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["language"] == "ko"


def test_main_returns_int():
    assert main(["craft", "--scenario", "goal-refocus"]) == 0


# ---------------------------------------------------------------- standalone runner

def _run_all() -> int:
    failures = 0
    tests = [(k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
