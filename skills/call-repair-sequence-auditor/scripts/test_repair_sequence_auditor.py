#!/usr/bin/env python3
"""Tests for the call-repair-sequence-auditor skill.

Run:
    python3 -m pytest skills/call-repair-sequence-auditor/scripts/test_repair_sequence_auditor.py -v
    python3 skills/call-repair-sequence-auditor/scripts/test_repair_sequence_auditor.py
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
EXAMPLE_HIGH = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_LOW = SKILL_DIR / "references" / "example-transcript-low.json"

sys.path.insert(0, str(SCRIPTS))
from repair_sequence_auditor import (  # noqa: E402
    _find_partial_repeat,
    _verdict_for,
    analyze_turns,
    classify_repair,
    classify_resolution,
    craft_goal,
    load_call_result,
    main,
    mask_pii,
    profile_trouble_source,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


# ---------------------------------------------------------------- loading


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_HIGH)
    assert data["status"] == "COMPLETED"
    speakers = [t["speaker"] for t in data["turns"]]
    assert speakers.count("callee") == 4


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "What?"))})
        data = load_call_result(p)
    assert data["turns"][1]["text"] == "What?"


def test_load_string_transcript_single_agent_turn():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "one long line"})
        data = load_call_result(p)
    assert data["turns"] == [{"speaker": "agent", "text": "one long line"}]


def test_load_whitespace_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "   "})
        data = load_call_result(p)
    assert data["turns"] == []


def test_load_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": None})
        data = load_call_result(p)
    assert data["turns"] == []


def test_load_number_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": 987})
        data = load_call_result(p)
    assert data["turns"] == []


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


def test_load_mixed_list_skips_non_dicts_and_defaults():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {
                "status": "COMPLETED",
                "transcript": [
                    {"speaker": "agent", "text": "Hello"},
                    "junk",
                    42,
                    None,
                    {"speaker": "callee", "text": "What?"},
                ],
            },
        )
        data = load_call_result(p)
    assert len(data["turns"]) == 2
    assert data["turns"][1] == {"speaker": "callee", "text": "What?"}


# ---------------------------------------------------------------- masking


def test_mask_pii_masks_phone_keep_last_two():
    masked = mask_pii("call me back at 415-555-0188 please")
    assert "555" not in masked
    assert masked.endswith("88 please")


def test_mask_pii_leaves_short_runs_untouched():
    assert mask_pii("the 12th not the 21st") == "the 12th not the 21st"


# ---------------------------------------------------------------- classifiers


def test_open_class_huh():
    assert classify_repair("Huh?", "Your pickup is Thursday.") == "open_class"


def test_open_class_what_question_mark_only():
    assert classify_repair("What?", "Pickup on Thursday.") == "open_class"


def test_what_as_discourse_marker_not_repair():
    assert classify_repair("I see what you mean about Thursday.", "Pickup on Thursday.") is None


def test_sorry_with_question_mark_is_open_class():
    assert classify_repair("Sorry?", "Pickup on Thursday.") == "open_class"


def test_sorry_as_apology_not_repair():
    assert classify_repair("Sorry, I am late answering.", "Pickup on Thursday.") is None


def test_repetition_request_phrase():
    assert classify_repair("Can you repeat that?", "Thursday November 12th.") == "repetition_request"


def test_say_that_again():
    assert classify_repair("Say that again please.", "Thursday November 12th.") == "repetition_request"


def test_specification_which_one():
    assert classify_repair("Which one do you mean?", "The branch or the depot.") == "specification_request"


def test_specification_slow_down():
    assert classify_repair("Can you speak slower?", "Thursday November 12th between 2 and 4.") == "specification_request"


def test_candidate_understanding_did_you_say():
    assert classify_repair("Did you say the 12th or the 21st?", "Thursday the 12th.") == "candidate_understanding"


def test_candidate_understanding_you_mean():
    assert classify_repair("You mean the downtown branch?", "Pickup at downtown.") == "candidate_understanding"


def test_partial_repeat_short_question_quoting_agent():
    assert _find_partial_repeat("The 12th or 21st?", "Your pickup is on the 12th at the depot.") is True


def test_partial_repeat_long_turn_not_partial():
    assert _find_partial_repeat(
        "So you are saying my pickup moved and I need to confirm which depot and also the time window again?",
        "Your pickup is on the 12th at the depot.",
    ) is False


def test_partial_repeat_requires_question():
    assert _find_partial_repeat("the depot the depot", "Your pickup is on the 12th at the depot.") is False


def test_no_repair_in_plain_answer():
    assert classify_repair("Yes, Friday works for me.", "Is Friday okay?") is None


# ---------------------------------------------------------------- profiling


def test_profile_digit_dense():
    assert "digit_dense" in profile_trouble_source("Pickup is November 12th between 2 and 4 p.m.")


def test_profile_long_words():
    assert "long_words" in profile_trouble_source(
        "The authentication requirement necessitates verification of your identification documentation."
    )


def test_profile_long_sentence():
    long_sentence = "word " * 26
    assert "long_sentence" in profile_trouble_source(long_sentence + " Short one.")


def test_profile_unremarkable():
    assert profile_trouble_source("Is Friday okay?") == ["unremarkable"]


# ---------------------------------------------------------------- resolution


def test_resolution_addressed_by_marker():
    assert classify_resolution("Let me repeat that for you.", "open_class", "Thursday the 12th.") == "ADDRESSED"


def test_resolution_redelivery_by_overlap():
    source = "Your pickup is on Thursday November 12th from 2 to 4 p.m."
    assert classify_resolution("Your pickup is on Thursday November 12th from 2 to 4.", "open_class", source) == "ADDRESSED"


def test_resolution_candidate_understanding_needs_commitment():
    source = "Your pickup is on Thursday November 12th from 2 to 4 p.m."
    assert classify_resolution("It is the 12th, one two.", "candidate_understanding", source) == "ADDRESSED"
    assert classify_resolution("Moving on to the next topic now.", "candidate_understanding", source) == "IGNORED"


def test_resolution_repetition_with_digits_addressed():
    assert classify_resolution("It is on the 12th.", "repetition_request", "Your pickup is Thursday the 12th.") == "ADDRESSED"


def test_resolution_ignored_when_agent_pivots():
    assert classify_resolution("Anyway, the branch closes at 6 p.m.", "repetition_request", "Your pickup is Thursday November 12th.") == "IGNORED"


def test_resolution_end_of_call():
    assert classify_resolution("", "open_class", "Thursday.") == "END_OF_CALL"


def test_resolution_partial_repeat_confirmation():
    assert classify_resolution("Yes, exactly, the 12th.", "partial_repeat", "Is it the 12th?") == "ADDRESSED"


# ---------------------------------------------------------------- verdicts


def test_verdict_thresholds():
    assert _verdict_for(0, 0) == "LOW"
    assert _verdict_for(1, 0) == "LOW"
    assert _verdict_for(2, 0) == "MODERATE"
    assert _verdict_for(1, 1) == "MODERATE"
    assert _verdict_for(4, 0) == "HIGH"
    assert _verdict_for(0, 2) == "HIGH"


def test_analyze_high_fixture():
    data = load_call_result(EXAMPLE_HIGH)
    card = analyze_turns(data["turns"])
    types = [e["repair_type"] for e in card["repair_events"]]
    assert types.count("open_class") >= 1
    assert "candidate_understanding" in types
    assert "repetition_request" in types
    assert "specification_request" in types
    assert card["comprehension_trouble"] == "HIGH"
    assert card["recommended_action"]["action"] == "redial_with_simplified_goal"
    assert card["repairs_initiated"] >= 4
    assert card["unresolved_repairs"] >= 1
    assert card["dominant_trouble_type"] == "digit_dense"


def test_analyze_low_fixture():
    data = load_call_result(EXAMPLE_LOW)
    card = analyze_turns(data["turns"])
    assert card["repair_events"] == []
    assert card["comprehension_trouble"] == "LOW"
    assert card["recommended_action"]["action"] == "continue"
    assert card["repairs_initiated"] == 0


def test_analyze_empty_transcript_unclear():
    card = analyze_turns([])
    assert card["repair_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"


def test_analyze_no_callee_signal_unclear():
    card = analyze_turns(_turns(("agent", "Hello there."), ("agent", "Anyone home?")))
    assert card["repair_assessment"] == "unclear"
    assert card["reason"] == "insufficient_callee_signal"


def test_analyze_repair_in_agent_turn_not_counted():
    # Only the contacted party initiates other-initiated repair here.
    card = analyze_turns(
        _turns(
            ("agent", "Sorry, what was that? Let me repeat the date."),
            ("callee", "Yes go ahead."),
            ("agent", "The 12th. Thank you."),
        )
    )
    assert card["repairs_initiated"] == 0
    assert card["comprehension_trouble"] == "LOW"


def test_analyze_callee_first_turn_no_trouble_source():
    card = analyze_turns(_turns(("callee", "What?"), ("agent", "Hello, this is Example Clinic.")))
    assert card["repairs_initiated"] == 0


def test_analyze_masks_phone_in_repair_span():
    card = analyze_turns(
        _turns(
            ("agent", "Is your number still 415-555-0166?"),
            ("callee", "Can you repeat that?"),
            ("agent", "I said is your number still 415-555-0166."),
            ("callee", "Yes."),
        )
    )
    event = card["repair_events"][0]
    assert "555" not in event["span"]


def test_analyze_baseline_note_present():
    card = analyze_turns(_turns(("agent", "Hello."), ("callee", "Hi.")))
    assert "1.4 minutes" in card["repair_baseline_note"]


def test_analyze_moderate_single_ignored():
    card = analyze_turns(
        _turns(
            ("agent", "Your pickup is Thursday November 12th between 2 and 4."),
            ("callee", "Sorry, what?"),
            ("agent", "Anyway the branch closes at six."),
            ("callee", "Okay."),
            ("agent", "Goodbye."),
        )
    )
    assert card["comprehension_trouble"] == "MODERATE"
    assert card["recommended_action"]["action"] == "verify_understanding_prompt"


def test_disclaimer_present():
    card = analyze_turns(_turns(("agent", "hi"), ("callee", "hello")))
    assert "under-report" in card["disclaimer"]
    assert card["analysis_mode"] == "heuristic"


# ---------------------------------------------------------------- craft


def test_craft_goal_wording():
    plan = craft_goal("high-trouble-redial")
    assert plan["mode"] == "craft"
    assert "repeat it slowly" in plan["goal"] or "I will repeat it slowly" in plan["goal"]
    assert "one digit at a time" in plan["goal"]
    assert plan["language"] == "en"


def test_craft_goal_language_passthrough():
    assert craft_goal("high-trouble-redial", language="en-GB")["language"] == "en-GB"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("no-op")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "no-op" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_analyze_fixture_exit0_and_valid_card():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "analyze", "--transcript", str(EXAMPLE_HIGH)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["comprehension_trouble"] == "HIGH"


def test_cli_analyze_low_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "analyze", "--transcript", str(EXAMPLE_LOW)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["comprehension_trouble"] == "LOW"


def test_cli_analyze_surfaces_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "run-zz9", "status": "COMPLETED", "transcript": _turns(("agent", "hi"), ("callee", "hello"))},
        )
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-zz9"


def test_cli_analyze_missing_file_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "analyze", "--transcript", "nope.json"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_analyze_invalid_json_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "bad.json"
        p.write_text("{oops", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2
    assert "invalid JSON" in proc.stderr


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "craft", "--scenario", "high-trouble-redial"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "goal" in json.loads(proc.stdout)


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "craft", "--scenario", "bogus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_analyze_out_writes_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "card.json"
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "repair_sequence_auditor.py"), "analyze", "--transcript", str(EXAMPLE_LOW), "--out", str(out)],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0
        assert json.loads(out.read_text(encoding="utf-8"))["comprehension_trouble"] == "LOW"


def test_main_returns_int():
    assert main(["craft", "--scenario", "high-trouble-redial"]) == 0


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
