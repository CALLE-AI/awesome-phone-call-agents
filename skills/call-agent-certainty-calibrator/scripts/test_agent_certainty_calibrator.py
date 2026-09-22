#!/usr/bin/env python3
"""Tests for the call-agent-certainty-calibrator skill.

Run:
    python3 -m pytest skills/call-agent-certainty-calibrator/scripts/test_agent_certainty_calibrator.py -v
    python3 skills/call-agent-certainty-calibrator/scripts/test_agent_certainty_calibrator.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_MIXED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_CALIBRATED = SKILL_DIR / "references" / "example-transcript-calibrated.json"
EXAMPLE_GOAL = SKILL_DIR / "references" / "example-goal.txt"

sys.path.insert(0, str(SCRIPTS))
from agent_certainty_calibrator import (  # noqa: E402
    analyze_turns,
    analyze_with_goal,
    craft_goal,
    extract_values,
    load_call_result,
    load_goal_file,
    main,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


GOAL = "The fee is $45, pickup on Tuesday the 15th at 2 p.m."


# ---------------------------------------------------------------- loading


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert data["turns"][1]["speaker"] == "callee"


def test_load_whitespace_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "  "})
        assert load_call_result(p)["turns"] == []


def test_load_null_and_number_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        a = _write_result(Path(td) / "a" .join("x"), {"status": "C", "transcript": None}) if False else None
    for payload in ({"status": "C", "transcript": None}, {"status": "C", "transcript": 3}):
        with tempfile.TemporaryDirectory() as td:
            p = _write_result(Path(td), payload)
            assert load_call_result(p)["turns"] == []


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


def test_load_mixed_list_skips_non_dicts():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "C", "transcript": [{"speaker": "agent", "text": "Hello"}, "junk", None, {"speaker": "callee", "text": "Yes"}]},
        )
        assert len(load_call_result(p)["turns"]) == 2


def test_load_goal_file_plain_and_json():
    goal = load_goal_file(EXAMPLE_GOAL)
    assert "$45" in goal
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "plan.json"
        p.write_text(json.dumps({"goal": "The total is $45."}), encoding="utf-8")
        assert "$45" in load_goal_file(p)


def test_load_goal_file_invalid_json_object_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text(json.dumps([1]), encoding="utf-8")
        try:
            load_goal_file(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "goal field" in str(exc)


# ---------------------------------------------------------------- masking / values


def test_mask_pii_masks_phone_keep_last_two():
    assert "555" not in mask_pii("number 415-555-0171")


def test_extract_values_kinds():
    values = extract_values("The fee is $45, pickup on Tuesday the 15th at 2 p.m.")
    kinds = {(k, v) for k, v in values}
    assert ("amount", "45") in kinds
    assert ("date", "tuesday") in kinds
    assert ("date", "15") in kinds
    assert ("time", "1400") in kinds


def test_extract_values_45_dollars_form():
    assert ("amount", "45") in set(extract_values("The total is 45 dollars."))


# ---------------------------------------------------------------- analysis


def test_analyze_mixed_fixture():
    data = load_call_result(EXAMPLE_MIXED)
    card = analyze_with_goal(data["turns"], load_goal_file(EXAMPLE_GOAL))
    assert card["verdict"] == "MIXED"
    assert len(card["over_assertions"]) == 1
    assert card["over_assertions"][0]["value"] == "friday"
    assert len(card["over_hedges"]) == 1
    assert card["over_hedges"][0]["kind"] == "time"
    assert card["calibrated_statements"] >= 2
    assert card["recommended_action"]["action"] == "verify_unsourced_values"


def test_analyze_calibrated_fixture():
    data = load_call_result(EXAMPLE_CALIBRATED)
    card = analyze_with_goal(data["turns"], load_goal_file(EXAMPLE_GOAL))
    assert card["over_assertions"] == []
    assert card["over_hedges"] == []
    assert card["verdict"] == "CALIBRATED"
    assert card["recommended_action"]["action"] == "continue"


def test_source_marker_overrides_hedge():
    card = analyze_with_goal(
        _turns(
            ("agent", "I think our records show the fee is $45."),
            ("callee", "Okay."),
        ),
        GOAL,
    )
    assert card["over_hedges"] == []
    assert card["calibrated_statements"] == 1


def test_plain_statement_of_goal_fact_is_calibrated():
    card = analyze_with_goal(
        _turns(("agent", "The fee is $45."), ("callee", "Okay.")),
        GOAL,
    )
    assert card["verdict"] == "CALIBRATED"
    assert card["calibrated_statements"] == 1


def test_overassertive_verdict():
    card = analyze_with_goal(
        _turns(
            ("agent", "The fee is $45 and everything is 20 percent off this Friday."),
            ("callee", "Okay."),
        ),
        GOAL,
    )
    assert card["verdict"] == "OVERASSERTIVE"
    assert card["over_assertions"]


def test_overhedged_verdict():
    card = analyze_with_goal(
        _turns(("agent", "I believe the fee might be $45."), ("callee", "Okay.")),
        GOAL,
    )
    assert card["verdict"] == "OVERHEDGED"
    assert card["over_hedges"][0]["value"] == "45"


def test_callee_sourced_value_not_over_assertion():
    card = analyze_with_goal(
        _turns(
            ("agent", "The fee is $45."),
            ("callee", "Can we do the 16th instead of the 15th?"),
            ("agent", "The 16th works."),
            ("callee", "Thanks."),
        ),
        GOAL,
    )
    assert card["over_assertions"] == []


def test_value_from_callee_but_agent_repeats_is_fine():
    card = analyze_with_goal(
        _turns(
            ("agent", "What day works for you?"),
            ("callee", "Thursday."),
            ("agent", "Thursday it is, and the fee is $45."),
            ("callee", "Great."),
        ),
        GOAL,
    )
    assert card["over_assertions"] == []
    assert card["calibrated_statements"] >= 1


def test_empty_transcript_unclear():
    card = analyze_with_goal([], GOAL)
    assert card["calibration_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"


def test_no_agent_turns_unclear():
    card = analyze_with_goal(_turns(("callee", "Hello?")), GOAL)
    assert card["calibration_assessment"] == "unclear"
    assert card["reason"] == "insufficient_agent_signal"


def test_no_goal_facts_unclear():
    card = analyze_with_goal(_turns(("agent", "Hello there."), ("callee", "Hi.")), "Just be polite.")
    assert card["calibration_assessment"] == "unclear"
    assert card["reason"] == "no_goal_facts_extracted"


def test_analyze_without_goal_unclear():
    card = analyze_turns(_turns(("agent", "hi"), ("callee", "hello")))
    assert card["calibration_assessment"] == "unclear"


def test_masked_sentence_in_findings():
    card = analyze_with_goal(
        _turns(("agent", "Call 415-555-0171 and the fee is maybe $45."), ("callee", "Okay.")),
        GOAL,
    )
    hedge = card["over_hedges"][0]
    assert "555" not in hedge["sentence"]


def test_disclaimer_present():
    card = analyze_with_goal(_turns(("agent", "hi"), ("callee", "hello")), GOAL)
    assert "missing from the goal text" in card["disclaimer"]
    assert card["analysis_mode"] == "heuristic"


# ---------------------------------------------------------------- craft


def test_craft_goal_wording():
    plan = craft_goal("calibrated-fact-stating")
    assert plan["mode"] == "craft"
    assert "I do not have that information" in plan["goal"]
    assert "Never invent" in plan["goal"]
    assert plan["language"] == "en"


def test_craft_goal_language_passthrough():
    assert craft_goal("calibrated-fact-stating", language="en-IE")["language"] == "en-IE"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("wrong")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "wrong" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_analyze_mixed():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "agent_certainty_calibrator.py"),
            "analyze",
            "--transcript",
            str(EXAMPLE_MIXED),
            "--goal-file",
            str(EXAMPLE_GOAL),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "MIXED"
    assert card["goal_facts"]["amount"] == ["45"]


def test_cli_analyze_calibrated():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "agent_certainty_calibrator.py"),
            "analyze",
            "--transcript",
            str(EXAMPLE_CALIBRATED),
            "--goal-file",
            str(EXAMPLE_GOAL),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "CALIBRATED"


def test_cli_analyze_missing_goal_file_exit2():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "agent_certainty_calibrator.py"),
            "analyze",
            "--transcript",
            str(EXAMPLE_MIXED),
            "--goal-file",
            "nope.txt",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "goal file not found" in proc.stderr


def test_cli_analyze_missing_transcript_arg_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "agent_certainty_calibrator.py"), "analyze", "--transcript", str(EXAMPLE_MIXED)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_analyze_surfaces_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "run-cal9", "status": "C", "transcript": _turns(("agent", "hi"), ("callee", "hello"))},
        )
        proc = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "agent_certainty_calibrator.py"),
                "analyze",
                "--transcript",
                str(p),
                "--goal-file",
                str(EXAMPLE_GOAL),
            ],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-cal9"


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "agent_certainty_calibrator.py"), "craft", "--scenario", "calibrated-fact-stating"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "goal" in json.loads(proc.stdout)


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "agent_certainty_calibrator.py"), "craft", "--scenario", "bogus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_main_returns_int():
    assert main(["craft", "--scenario", "calibrated-fact-stating"]) == 0


def test_calling_about_opening_not_hedge():
    # "about" is the canonical call-opening word, not a hedge; the opening
    # restating goal facts must stay CALIBRATED.
    card = analyze_with_goal(
        _turns(
            ("agent", "Hello, I am calling about your delivery on Tuesday the 15th."),
            ("callee", "Okay."),
        ),
        GOAL,
    )
    assert card["over_hedges"] == []
    assert card["verdict"] == "CALIBRATED"

def test_cli_analyze_overassertive_fixture():
    path = SKILL_DIR / "references" / "example-transcript-overassertive.json"
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "agent_certainty_calibrator.py"),
            "analyze",
            "--transcript",
            str(path),
            "--goal-file",
            str(EXAMPLE_GOAL),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["verdict"] == "OVERASSERTIVE"
    assert {a["value"] for a in card["over_assertions"]} == {"friday", "30"}
    assert card["over_hedges"] == []

# ---------------------------------------------------------------- runner


def _run_all() -> int:
    failures = 0
    globals_map = globals()
    tests = [(k, v) for k, v in globals_map.items() if k.startswith("test_") and callable(v)]
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
