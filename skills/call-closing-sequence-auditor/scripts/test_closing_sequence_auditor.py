#!/usr/bin/env python3
"""Tests for the call-closing-sequence-auditor skill.

Run:
    python3 -m pytest skills/call-closing-sequence-auditor/scripts/test_closing_sequence_auditor.py -v
    python3 skills/call-closing-sequence-auditor/scripts/test_closing_sequence_auditor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_WELL_FORMED = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_DANGLING = SKILL_DIR / "references" / "example-transcript-dangling.json"
EXAMPLE_NOSUMMARY = SKILL_DIR / "references" / "example-transcript-nosummary.json"
EXAMPLE_ABRUPT = SKILL_DIR / "references" / "example-transcript-abrupt.json"
EXAMPLE_GOAL = SKILL_DIR / "references" / "example-goal.txt"

sys.path.insert(0, str(SCRIPTS))
from closing_sequence_auditor import (  # noqa: E402
    analyze_turns,
    craft_goal,
    closing_checks,
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


def _checks(*pairs: tuple[str, str]) -> dict[str, bool]:
    return analyze_turns(_turns(*pairs))["checks"]


def _cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "closing_sequence_auditor.py"), *args],
        capture_output=True,
        text=True,
    )


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
    for payload in ({"status": "C", "transcript": None}, {"status": "C", "transcript": 3}):
        with tempfile.TemporaryDirectory() as td:
            p = _write_result(Path(td), payload)
            assert load_call_result(p)["turns"] == []


def test_load_mixed_list_skips_non_dicts():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "C", "transcript": [{"speaker": "agent", "text": "Hello"}, "junk", None, {"speaker": "callee", "text": "Yes"}]},
        )
        assert len(load_call_result(p)["turns"]) == 2


def test_load_result_wrapped_shape():
    # Real get_call_run shape: status top-level, transcript under result.
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "result": {"transcript": _turns(("agent", "Just to confirm - your table is booked for Friday at 7 p.m. You will receive a text. Anything else?"), ("callee", "No, that is all. Bye."), ("agent", "Goodbye."))}})
        data = load_call_result(p)
    assert data["status"] == "COMPLETED"
    assert data["turns"][2]["speaker"] == "agent"
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "WELL_FORMED_CLOSING"


def test_whitespace_transcript_unclear_empty():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "C", "transcript": "   "})
        card = analyze_turns(load_call_result(p)["turns"])
    assert card["closing_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"


def test_mask_pii_masks_phone_keep_last_two():
    assert "555" not in mask_pii("number 415-555-0171")


# ---------------------------------------------------------------- unclear


def test_empty_transcript_unclear():
    card = analyze_turns([])
    assert card["closing_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"
    assert card["verdict"] is None
    assert card["reasons"] == []
    assert all(v is False for v in card["checks"].values())


def test_single_turn_unclear_insufficient_signal():
    card = analyze_turns(_turns(("agent", "Hello?")))
    assert card["closing_assessment"] == "unclear"
    assert card["reason"] == "insufficient_signal"
    assert card["verdict"] is None
    assert card["reasons"] == []


# ---------------------------------------------------------------- checks: summary


def test_summary_via_marker():
    checks = _checks(
        ("agent", "Just to confirm - the table is set for tonight."),
        ("callee", "Okay."),
    )
    assert checks["summary_present"] is True


def test_summary_via_confirm_verb_and_value():
    checks = _checks(
        ("agent", "Your table is booked for Friday the 15th."),
        ("callee", "Okay."),
    )
    assert checks["summary_present"] is True


def test_summary_confirm_verb_without_value_negative():
    checks = _checks(
        ("agent", "Your table is booked."),
        ("callee", "Okay."),
    )
    assert checks["summary_present"] is False


def test_summary_marker_no_false_positive_inside_word():
    # "recapitalize" contains "recap" as a substring but is not a summary
    # marker; only word-boundary matches count.
    card = analyze_turns(
        _turns(
            ("agent", "We plan to recapitalize the debt. You'll receive a confirmation text. Goodbye."),
            ("callee", "Okay, bye."),
        )
    )
    assert card["checks"]["summary_present"] is False
    assert card["verdict"] == "DEFICIENT_CLOSING"
    assert card["reasons"] == ["MISSING_SUMMARY"]


def test_summary_marker_quick_recap_positive():
    checks = _checks(
        ("agent", "Quick recap - your table is booked for Friday at 7 p.m."),
        ("callee", "Okay."),
    )
    assert checks["summary_present"] is True


def test_summary_outside_window_not_counted():
    # Seven filler turns push the summary out of the 6-turn window.
    pairs = [("agent", "Just to confirm - the table is set.")]
    pairs += [("callee", f"Filler sentence {i}.") for i in range(7)]
    checks = closing_checks(_turns(*pairs))
    assert checks["summary_present"] is False


# ---------------------------------------------------------------- checks: arrangement


def test_arrangement_well_send():
    checks = _checks(("agent", "We'll send a confirmation email."), ("callee", "Okay."))
    assert checks["arrangement_present"] is True


def test_arrangement_youll_receive():
    checks = _checks(("agent", "You'll receive a text shortly."), ("callee", "Okay."))
    assert checks["arrangement_present"] is True


def test_arrangement_no_further_action():
    checks = _checks(("agent", "There is no further action needed on your side."), ("callee", "Okay."))
    assert checks["arrangement_present"] is True


def test_arrangement_we_will_send():
    checks = _checks(("agent", "We will send the confirmation text."), ("callee", "Okay."))
    assert checks["arrangement_present"] is True


def test_arrangement_you_will_receive():
    checks = _checks(("agent", "You will receive a text shortly."), ("callee", "Okay."))
    assert checks["arrangement_present"] is True


def test_arrangement_i_will_call_you():
    checks = _checks(("agent", "I will call you tomorrow."), ("callee", "Okay."))
    assert checks["arrangement_present"] is True


def test_arrangement_negative():
    checks = _checks(("agent", "We had a lovely chat about the menu."), ("callee", "Okay."))
    assert checks["arrangement_present"] is False


# ---------------------------------------------------------------- checks: terminal exchange


def test_terminal_exchange_both_sides():
    checks = _checks(("agent", "Goodbye."), ("callee", "Okay, bye now."))
    assert checks["terminal_exchange_complete"] is True


def test_terminal_exchange_agent_only():
    checks = _checks(("agent", "Goodbye."), ("callee", "Okay."))
    assert checks["terminal_exchange_complete"] is False


def test_terminal_exchange_callee_only():
    checks = _checks(("agent", "Thanks for the details."), ("callee", "Okay, bye."))
    assert checks["terminal_exchange_complete"] is False


def test_terminal_exchange_callee_farewell_on_first_turn_not_counted():
    checks = _checks(("callee", "Bye."), ("agent", "Goodbye."))
    assert checks["terminal_exchange_complete"] is False


# ---------------------------------------------------------------- checks: dangling question


def test_dangling_callee_question_last_turn():
    checks = _checks(("agent", "Hi."), ("callee", "Will you call me back?"))
    assert checks["dangling_question"] is True


def test_dangling_answered_by_business_turn():
    checks = _checks(
        ("agent", "Hi."),
        ("callee", "Will you call me back?"),
        ("agent", "Yes, I will call you tomorrow morning."),
    )
    assert checks["dangling_question"] is False


def test_dangling_followed_only_by_farewell():
    checks = _checks(
        ("agent", "Hi."),
        ("callee", "Will you call me back?"),
        ("agent", "Goodbye."),
    )
    assert checks["dangling_question"] is True


def test_dangling_okay_acknowledgment_before_farewell_counts_as_answer():
    # Intentional boundary, pinned by this test: an agent "Okay." is treated
    # as a substantive answer-acknowledgment, not farewell-only - an "Okay"
    # can BE the yes-answer to the callee's question. No behavior change.
    checks = _checks(
        ("agent", "Hi."),
        ("callee", "Will you call me back?"),
        ("agent", "Okay. Goodbye."),
        ("callee", "Bye."),
    )
    assert checks["dangling_question"] is False


def test_dangling_no_question_false():
    checks = _checks(("agent", "Hi."), ("callee", "Thanks."))
    assert checks["dangling_question"] is False


# ---------------------------------------------------------------- checks: post-closing business


def test_post_closing_business_after_farewell():
    checks = _checks(
        ("agent", "Goodbye."),
        ("agent", "Actually, the lounge reopens on Monday."),
        ("callee", "Okay."),
    )
    assert checks["post_closing_business"] is True


def test_post_closing_business_question_after_farewell():
    checks = _checks(
        ("agent", "Goodbye."),
        ("agent", "Should I also note the parking?"),
        ("callee", "No."),
    )
    assert checks["post_closing_business"] is True


def test_post_closing_business_sandwich_between_farewells():
    # Agent value after its FIRST farewell counts as post-closing business,
    # even with farewells interleaved on both sides.
    checks = _checks(
        ("agent", "Thank you, goodbye."),
        ("callee", "Bye."),
        ("agent", "The lounge opens Monday."),
    )
    assert checks["post_closing_business"] is True


def test_post_closing_farewell_only_after_farewell():
    checks = _checks(("agent", "Goodbye."), ("agent", "Goodbye."), ("callee", "Bye."))
    assert checks["post_closing_business"] is False


# ---------------------------------------------------------------- checks: abrupt end


def test_abrupt_last_agent_question_no_farewell():
    checks = _checks(("agent", "Hi."), ("agent", "We are set for Friday, okay?"))
    assert checks["abrupt_end"] is True


def test_abrupt_callee_plain_statement_no_farewell():
    checks = _checks(("agent", "We are set for Friday."), ("callee", "Great."))
    assert checks["abrupt_end"] is True


def test_abrupt_ignores_trailing_whitespace_only_turn():
    # A whitespace-only tail turn must not count as the call's final turn;
    # abrupt_end reads the last NON-EMPTY turn.
    card = analyze_turns(
        _turns(
            ("agent", "Just to confirm - the table is booked for Friday the 15th. You'll receive a text. Goodbye."),
            ("callee", "Okay, bye."),
            ("callee", "   "),
        )
    )
    assert card["checks"]["abrupt_end"] is False
    assert card["verdict"] == "WELL_FORMED_CLOSING"


def test_abrupt_normal_close_false():
    checks = _checks(("agent", "Goodbye."), ("callee", "Bye."))
    assert checks["abrupt_end"] is False


# ---------------------------------------------------------------- verdicts


def test_well_formed_fixture():
    data = load_call_result(EXAMPLE_WELL_FORMED)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "WELL_FORMED_CLOSING"
    assert card["reasons"] == []
    assert card["recommended_action"] == {"action": "continue", "guidance": None}


def test_deficient_missing_summary_only():
    card = analyze_turns(
        _turns(
            ("agent", "You'll receive a confirmation text. Goodbye."),
            ("callee", "Okay, bye."),
        )
    )
    assert card["verdict"] == "DEFICIENT_CLOSING"
    assert card["reasons"] == ["MISSING_SUMMARY"]


def test_deficient_missing_arrangement_only():
    card = analyze_turns(
        _turns(
            ("agent", "Just to confirm - the table is booked for Friday the 15th. Goodbye."),
            ("callee", "Okay, bye."),
        )
    )
    assert card["reasons"] == ["MISSING_ARRANGEMENT"]


def test_deficient_no_terminal_exchange_only():
    card = analyze_turns(
        _turns(
            ("agent", "Just to confirm - the table is booked for Friday the 15th. You'll receive a text."),
            ("callee", "Okay, bye."),
        )
    )
    assert card["reasons"] == ["NO_TERMINAL_EXCHANGE"]


def test_deficient_dangling_question_only():
    card = analyze_turns(
        _turns(
            ("agent", "Just to confirm - the table is booked for Friday the 15th. You'll receive a text. Goodbye."),
            ("callee", "Okay, bye. Wait - can I change it to Saturday?"),
        )
    )
    assert card["reasons"] == ["DANGLING_QUESTION"]


def test_deficient_post_closing_business_only():
    card = analyze_turns(
        _turns(
            ("agent", "Just to confirm - the table is booked for Friday the 15th. You'll receive a text. Goodbye."),
            ("callee", "Okay, bye."),
            ("agent", "Also, the lounge opens on Monday."),
        )
    )
    assert card["reasons"] == ["POST_CLOSING_BUSINESS"]


def test_deficient_abrupt_end_only():
    card = analyze_turns(
        _turns(
            ("callee", "Okay."),
            ("agent", "Just to confirm - the table is booked for Friday the 15th. You'll receive a text. So we're set, okay?"),
        )
    )
    assert card["reasons"] == ["ABRUPT_END"]


def test_abrupt_suppresses_no_terminal_exchange():
    # Same call as above: the missing goodbye is already named by
    # ABRUPT_END and must not be double-counted.
    card = analyze_turns(
        _turns(
            ("callee", "Okay."),
            ("agent", "Just to confirm - the table is booked for Friday the 15th. You'll receive a text. So we're set, okay?"),
        )
    )
    assert "NO_TERMINAL_EXCHANGE" not in card["reasons"]
    assert card["checks"]["terminal_exchange_complete"] is False
    assert card["checks"]["abrupt_end"] is True


def test_fixed_reason_ordering():
    card = analyze_turns(load_call_result(EXAMPLE_DANGLING)["turns"])
    assert card["reasons"] == ["MISSING_ARRANGEMENT", "NO_TERMINAL_EXCHANGE", "DANGLING_QUESTION"]


def test_deficient_action_review_call_ending():
    card = analyze_turns(
        _turns(
            ("agent", "Goodbye."),
            ("callee", "Bye."),
        )
    )
    action = card["recommended_action"]
    assert action["action"] == "review_call_ending"
    assert action["guidance"].startswith("The closing window is incomplete: Missing summary, Missing arrangement.")
    assert action["guidance"].endswith("Decide whether the ending needs a follow-up touch.")


def test_nosummary_fixture():
    card = analyze_turns(load_call_result(EXAMPLE_NOSUMMARY)["turns"])
    assert card["verdict"] == "DEFICIENT_CLOSING"
    assert card["reasons"] == ["MISSING_SUMMARY", "MISSING_ARRANGEMENT"]
    assert card["checks"]["terminal_exchange_complete"] is True


def test_abrupt_fixture():
    card = analyze_turns(load_call_result(EXAMPLE_ABRUPT)["turns"])
    assert card["verdict"] == "DEFICIENT_CLOSING"
    assert card["reasons"] == ["ABRUPT_END"]


def test_card_shape_and_disclaimer():
    card = analyze_turns(_turns(("agent", "Goodbye."), ("callee", "Bye.")))
    assert card["skill"] == "call-closing-sequence-auditor"
    assert card["analysis_mode"] == "heuristic"
    assert card["closing_assessment"] == "assessed"
    assert card["reason"] is None
    assert set(card["checks"]) == {
        "summary_present",
        "arrangement_present",
        "terminal_exchange_complete",
        "dangling_question",
        "post_closing_business",
        "abrupt_end",
    }
    assert card["disclaimer"].startswith("Sequence-shape heuristics, not a satisfaction measure.")


# ---------------------------------------------------------------- craft


def test_craft_goal_wording():
    plan = craft_goal("clean-closing")
    assert plan["mode"] == "craft"
    assert "Never introduce new business" in plan["goal"]
    assert "WAIT for the answer" in plan["goal"]
    assert plan["language"] == "en"
    assert len(plan["notes"]) == 2


def test_craft_goal_language_passthrough():
    assert craft_goal("clean-closing", language="en-IE")["language"] == "en-IE"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("wrong")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "wrong" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_analyze_well_formed():
    proc = _cli("analyze", "--transcript", str(EXAMPLE_WELL_FORMED))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "WELL_FORMED_CLOSING"
    assert card["reasons"] == []
    assert card["call_id"] == "call-close-001"


def test_cli_analyze_dangling():
    proc = _cli("analyze", "--transcript", str(EXAMPLE_DANGLING))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "DEFICIENT_CLOSING"
    assert card["reasons"] == ["MISSING_ARRANGEMENT", "NO_TERMINAL_EXCHANGE", "DANGLING_QUESTION"]


def test_cli_analyze_nosummary():
    proc = _cli("analyze", "--transcript", str(EXAMPLE_NOSUMMARY))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["reasons"] == ["MISSING_SUMMARY", "MISSING_ARRANGEMENT"]


def test_cli_analyze_abrupt():
    proc = _cli("analyze", "--transcript", str(EXAMPLE_ABRUPT))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["reasons"] == ["ABRUPT_END"]


def test_cli_analyze_missing_file_exit2():
    proc = _cli("analyze", "--transcript", "nope.json")
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_craft_exit0():
    proc = _cli("craft", "--scenario", "clean-closing")
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["scenario"] == "clean-closing"
    assert card["goal"] == open(EXAMPLE_GOAL, encoding="utf-8").read().strip()


def test_cli_craft_unknown_scenario_exit2():
    proc = _cli("craft", "--scenario", "bogus")
    assert proc.returncode == 2


def test_cli_out_writes_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "card.json"
        proc = _cli("analyze", "--transcript", str(EXAMPLE_WELL_FORMED), "--out", str(out))
        assert proc.returncode == 0, proc.stderr
        card = json.loads(out.read_text(encoding="utf-8"))
        assert card["verdict"] == "WELL_FORMED_CLOSING"


def test_main_returns_int():
    assert main(["craft", "--scenario", "clean-closing"]) == 0


def test_cli_invalid_json_exit_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "broken.json"
        p.write_text("{not valid json", encoding="utf-8")
        proc = _cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2
    assert "ERROR" in proc.stderr


def test_cli_json_array_exit_2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "array.json"
        p.write_text('[{"speaker":"agent","text":"Hi"}]', encoding="utf-8")
        proc = _cli("analyze", "--transcript", str(p))
    assert proc.returncode == 2
    assert "ERROR" in proc.stderr


def test_cli_missing_required_arg_exit_2():
    proc = _cli("analyze")
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
