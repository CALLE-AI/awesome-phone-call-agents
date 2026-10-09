#!/usr/bin/env python3
"""Tests for the call-leading-question-guard skill.

Run:
    python3 -m pytest skills/call-leading-question-guard/scripts/test_leading_question_guard.py -v
    python3 skills/call-leading-question-guard/scripts/test_leading_question_guard.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_TAINTED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_NEUTRAL = SKILL_DIR / "references" / "example-transcript-neutral.json"
EXAMPLE_UNTAINTED = SKILL_DIR / "references" / "example-transcript-leading-untainted.json"
EXAMPLE_GOAL = SKILL_DIR / "references" / "example-goal.txt"

sys.path.insert(0, str(SCRIPTS))
from leading_question_guard import (  # noqa: E402
    analyze_turns,
    classify_question,
    craft_goal,
    extract_values,
    load_call_result,
    main,
    mask_pii,
)


def _write_result(tmp: Path, payload: dict) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


def _card(*pairs: tuple[str, str]) -> dict:
    return analyze_turns(_turns(*pairs))


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


def test_load_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": None})
        assert load_call_result(p)["turns"] == []


def test_load_number_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": 3})
        assert load_call_result(p)["turns"] == []


def test_load_mixed_list_skips_non_dicts():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "C", "transcript": [{"speaker": "agent", "text": "Hi"}, {"nope": 1}, "junk"]},
        )
        turns = load_call_result(p)["turns"]
        assert len(turns) == 2
        assert turns[0]["text"] == "Hi"
        assert turns[1] == {"speaker": "unknown", "text": ""}


def test_load_missing_text_defaults_empty():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": [{"speaker": "agent"}]})
        assert load_call_result(p)["turns"] == [{"speaker": "agent", "text": ""}]


def test_load_result_wrapped_shape():
    # Real get_call_run shape: status top-level, transcript under result.
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "result": {"transcript": _turns(("agent", "You can come Friday, right?"), ("callee", "Yes, Friday works."))}})
        data = load_call_result(p)
    assert data["status"] == "COMPLETED"
    assert data["turns"][0]["speaker"] == "agent"
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "LEADING_TAINTED"


# ---------------------------------------------------------------- classification


def test_tag_comma_right_positive():
    assert classify_question("You can pick up your prescription on Friday, right?") == "TAG"


def test_tag_aux_you_positive():
    assert classify_question("You will confirm it, won't you?") == "TAG"


def test_negative_interrogative_positive():
    assert classify_question("Don't you want to keep the auto-refill going?") == "NEGATIVE_INTERROGATIVE"


def test_presupposition_positive():
    assert classify_question("Are you still planning to come in?") == "PRESUPPOSITION"


def test_coercive_positive():
    assert classify_question("This plan is obviously the best fit for you?") == "COERCIVE"


def test_did_you_not_is_negative_interrogative():
    # Form policy: even a legitimate verification check in negative
    # interrogative form is flagged; this is documented behavior.
    assert classify_question("Did you not receive our letter?") == "NEGATIVE_INTERROGATIVE"


def test_standalone_wh_question_open():
    assert classify_question("What is your address?") == "OPEN"


def test_plain_closed_question_neutral():
    assert classify_question("Do you prefer morning or evening?") == "CLOSED"


def test_bounded_closed_should_i_is_closed():
    # The craft goal's bounded confirmation form must stay CLOSED.
    assert classify_question("Should I set it for Friday at 10 a.m.?") == "CLOSED"


def test_am_pm_question_not_split_by_abbreviation_period():
    # A question ending in "a.m. + capitalized word" must stay one sentence.
    card = _card(("agent", "Won't you come in at 10 a.m. Friday?"))
    assert card["questions_total"] == 1
    assert card["questions"][0]["kind"] == "NEGATIVE_INTERROGATIVE"
    assert card["questions"][0]["leading"] is True


def test_am_pm_presupposition_question_not_split():
    card = _card(("agent", "Can you still make the 9 a.m. May 3rd appointment?"))
    assert card["questions_total"] == 1
    assert card["questions"][0]["kind"] == "PRESUPPOSITION"
    assert card["questions"][0]["leading"] is True


def test_declarative_with_presupposition_word_not_question():
    card = _card(("agent", "You are still on the list."), ("callee", "Okay."))
    assert card["questions"] == []
    assert card["verdict"] == "NO_QUESTIONS_ASKED"


def test_callee_right_never_classified():
    card = _card(("agent", "Hello there."), ("callee", "Right?"))
    assert card["questions"] == []
    assert card["verdict"] == "NO_QUESTIONS_ASKED"


# ---------------------------------------------------------------- taint


def test_taint_affirmation_plus_value_same_turn():
    card = _card(
        ("agent", "You can pick up on Friday, right?"),
        ("callee", "Yes, Friday works."),
    )
    assert card["verdict"] == "LEADING_TAINTED"
    assert card["tainted_elicitation"][0]["value"] == "friday"
    assert card["tainted_elicitation"][0]["question_kind"] == "TAG"


def test_taint_all_values_in_affirming_turn():
    card = _card(
        ("agent", "You are coming Friday, right?"),
        ("callee", "Yes, Friday at 9 a.m."),
    )
    values = {t["value"] for t in card["tainted_elicitation"]}
    assert values == {"friday", "0900"}
    assert all(t["turn_index"] == 1 for t in card["tainted_elicitation"])


def test_no_taint_affirmation_only():
    card = _card(
        ("agent", "You can pick up on Friday, right?"),
        ("callee", "Yes, that works."),
    )
    assert card["verdict"] == "LEADING_QUESTIONS_DETECTED"
    assert card["tainted_elicitation"] == []


def test_no_taint_value_only():
    card = _card(
        ("agent", "You can pick up on Friday, right?"),
        ("callee", "Friday works for me."),
    )
    assert card["verdict"] == "LEADING_QUESTIONS_DETECTED"
    assert card["tainted_elicitation"] == []


def test_no_taint_value_and_affirmation_in_different_turns():
    card = _card(
        ("agent", "You can pick up on Friday, right?"),
        ("callee", "Yes."),
        ("callee", "Friday works."),
    )
    assert card["verdict"] == "LEADING_QUESTIONS_DETECTED"
    assert card["tainted_elicitation"] == []


def test_no_taint_after_open_question():
    card = _card(
        ("agent", "What day works best for you?"),
        ("callee", "Yes, Friday is fine."),
    )
    assert card["verdict"] == "NEUTRAL_ELICITATION"
    assert card["tainted_elicitation"] == []


def test_taint_via_i_plus_2_window_with_agent_turn_between():
    card = _card(
        ("agent", "You can pick up on Friday, right?"),
        ("agent", "Let me note that down."),
        ("callee", "Yes, Friday works."),
    )
    assert card["verdict"] == "LEADING_TAINTED"
    assert card["tainted_elicitation"][0]["value"] == "friday"
    assert card["tainted_elicitation"][0]["turn_index"] == 2


def test_two_questions_in_one_agent_turn_both_classified():
    card = _card(("agent", "You are coming, right? What time should I book?"))
    assert card["questions_total"] == 2
    assert card["questions"][0]["kind"] == "TAG"
    assert card["questions"][1]["kind"] == "OPEN"
    assert card["questions"][0]["leading"] is True
    assert card["questions"][1]["leading"] is False


# ---------------------------------------------------------------- verdicts


def test_verdict_leading_tainted_fixture():
    data = load_call_result(EXAMPLE_TAINTED)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "LEADING_TAINTED"
    assert card["elicitation_assessment"] == "assessed"
    assert card["questions_total"] == 3
    assert {q["kind"] for q in card["questions"]} == {"TAG", "NEGATIVE_INTERROGATIVE", "OPEN"}
    assert len(card["tainted_elicitation"]) == 1
    assert card["tainted_elicitation"][0]["value"] == "friday"
    assert card["recommended_action"]["action"] == "reask_neutrally_before_booking"


def test_verdict_leading_detected_untainted_fixture():
    data = load_call_result(EXAMPLE_UNTAINTED)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "LEADING_QUESTIONS_DETECTED"
    assert card["tainted_elicitation"] == []
    assert card["recommended_action"]["action"] == "review_question_forms"


def test_verdict_neutral_fixture():
    data = load_call_result(EXAMPLE_NEUTRAL)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "NEUTRAL_ELICITATION"
    assert all(not q["leading"] for q in card["questions"])
    assert card["recommended_action"] == {"action": "continue", "guidance": None}


def test_verdict_no_questions_asked():
    card = _card(("agent", "Thank you for your time. Goodbye."), ("callee", "Bye."))
    assert card["verdict"] == "NO_QUESTIONS_ASKED"
    assert card["questions_total"] == 0
    assert card["recommended_action"]["action"] == "review_question_strategy"


def test_empty_transcript_unclear():
    card = analyze_turns([])
    assert card["elicitation_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"
    assert card["verdict"] is None


def test_no_agent_turns_unclear():
    card = analyze_turns(_turns(("callee", "Hello?")))
    assert card["elicitation_assessment"] == "unclear"
    assert card["reason"] == "insufficient_agent_signal"
    assert card["verdict"] is None


# ---------------------------------------------------------------- masking / values


def test_mask_pii_masks_phone_keep_last_two():
    assert "555" not in mask_pii("number 415-555-0141")
    assert mask_pii("415-555-0141").endswith("41")


def test_masked_sentence_in_findings():
    card = _card(
        ("agent", "Call 415-555-0141 about the pickup, right?"),
        ("callee", "Yes."),
    )
    assert "555" not in card["questions"][0]["sentence"]


def test_extract_values_time_and_weekday():
    values = extract_values("Yes, Friday works and 10 a.m. is fine.")
    kinds = set(values)
    assert ("date", "friday") in kinds
    assert ("time", "1000") in kinds


# ---------------------------------------------------------------- craft


def test_craft_goal_wording():
    plan = craft_goal("neutral-elicitation")
    assert plan["mode"] == "craft"
    assert plan["scenario"] == "neutral-elicitation"
    assert "What day works best for you?" in plan["goal"]
    assert "never re-ask a declined question in leading form" in plan["goal"]
    assert plan["language"] == "en"
    assert len(plan["notes"]) == 2
    assert plan["notes"][0].startswith("Heuristic skill:")


def test_craft_goal_language_passthrough():
    assert craft_goal("neutral-elicitation", language="en-IE")["language"] == "en-IE"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("wrong")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "wrong" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_analyze_tainted_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze", "--transcript", str(EXAMPLE_TAINTED)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "LEADING_TAINTED"
    assert card["skill"] == "call-leading-question-guard"


def test_cli_analyze_neutral_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze", "--transcript", str(EXAMPLE_NEUTRAL)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["verdict"] == "NEUTRAL_ELICITATION"


def test_cli_analyze_untainted_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze", "--transcript", str(EXAMPLE_UNTAINTED)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "LEADING_QUESTIONS_DETECTED"
    assert card["tainted_elicitation"] == []


def test_cli_analyze_missing_transcript_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze", "--transcript", "nope.json"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_analyze_surfaces_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "run-lead1", "status": "C", "transcript": _turns(("agent", "hi"), ("callee", "hello"))},
        )
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-lead1"


def test_cli_analyze_out_writes_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "card.json"
        proc = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "leading_question_guard.py"),
                "analyze",
                "--transcript",
                str(EXAMPLE_TAINTED),
                "--out",
                str(out),
            ],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0, proc.stderr
        assert json.loads(out.read_text(encoding="utf-8"))["verdict"] == "LEADING_TAINTED"


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "craft", "--scenario", "neutral-elicitation"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "goal" in json.loads(proc.stdout)


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "craft", "--scenario", "bogus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_main_returns_int():
    assert main(["craft", "--scenario", "neutral-elicitation"]) == 0


def test_disclaimer_present():
    card = _card(("agent", "What day works?"), ("callee", "Friday."))
    assert "not proof the answer was coerced" in card["disclaimer"]
    assert card["analysis_mode"] == "heuristic"


def test_goal_fixture_readable():
    assert "Example Pharmacy" in EXAMPLE_GOAL.read_text(encoding="utf-8")


def test_cli_invalid_json_exit_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "broken.json"
        p.write_text("{not valid json", encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2
    assert "ERROR" in proc.stderr


def test_cli_json_array_exit_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "array.json"
        p.write_text('[{"speaker":"agent","text":"Hi"}]', encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2
    assert "ERROR" in proc.stderr


def test_cli_missing_required_arg_exit_2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "leading_question_guard.py"), "analyze"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


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
