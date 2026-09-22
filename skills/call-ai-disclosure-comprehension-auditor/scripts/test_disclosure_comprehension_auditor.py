#!/usr/bin/env python3
"""Tests for the call-ai-disclosure-comprehension-auditor skill.

Run:
    python3 -m pytest skills/call-ai-disclosure-comprehension-auditor/scripts/test_disclosure_comprehension_auditor.py -v
    python3 skills/call-ai-disclosure-comprehension-auditor/scripts/test_disclosure_comprehension_auditor.py
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
EXAMPLE_FULL = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_UNDISCLOSED = SKILL_DIR / "references" / "example-transcript-undisclosed.json"

sys.path.insert(0, str(SCRIPTS))
from disclosure_comprehension_auditor import (  # noqa: E402
    analyze_turns,
    craft_goal,
    find_acknowledgment,
    find_comprehension_check,
    find_disclosure,
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


# ---------------------------------------------------------------- loading


def test_load_list_of_turns_nested_result():
    data = load_call_result(EXAMPLE_FULL)
    assert data["status"] == "COMPLETED"
    assert len(data["turns"]) == 5
    assert data["turns"][1]["speaker"] == "callee"


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hello"), ("callee", "Hi"))})
        data = load_call_result(p)
    assert data["turns"][1]["text"] == "Hi"


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
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": 7})
        data = load_call_result(p)
    assert data["turns"] == []


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps([1]), encoding="utf-8")
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
                    None,
                    {"speaker": "callee", "text": "Yes"},
                ],
            },
        )
        data = load_call_result(p)
    assert len(data["turns"]) == 2
    assert data["turns"][1]["text"] == "Yes"


# ---------------------------------------------------------------- masking


def test_mask_pii_masks_phone_keep_last_two():
    masked = mask_pii("the number is 415-555-0126")
    assert "555" not in masked


def test_mask_pii_leaves_short_runs_untouched():
    assert mask_pii("Tuesday at 10 a.m.") == "Tuesday at 10 a.m."


# ---------------------------------------------------------------- detectors


def test_find_disclosure_first_agent_turn():
    turns = _turns(
        ("agent", "Hello, this is an automated assistant calling."),
        ("callee", "Okay."),
        ("agent", "Your delivery is Thursday."),
    )
    d = find_disclosure(turns)
    assert d["disclosure_index"] == 0
    assert d["is_early"] is True


def test_find_disclosure_ai_program_phrasing():
    turns = _turns(("agent", "I am an AI program calling from Example Service."), ("callee", "Okay."))
    assert find_disclosure(turns)["disclosure_index"] == 0


def test_find_disclosure_none():
    turns = _turns(("agent", "Hello, calling from Example Clinic about Tuesday."), ("callee", "Yes."))
    assert find_disclosure(turns)["disclosure_index"] is None


def test_disclosure_from_callee_does_not_count():
    turns = _turns(
        ("agent", "Hello, this is Example Service calling."),
        ("callee", "Are you a robot?"),
        ("agent", "Your delivery is Thursday."),
    )
    assert find_disclosure(turns)["disclosure_index"] is None


def test_late_disclosure_detected():
    turns = _turns(
        ("agent", "Hello, calling from Example Service about your order."),
        ("callee", "Go ahead."),
        ("agent", "By the way, I am an automated system."),
        ("callee", "Fine."),
    )
    d = find_disclosure(turns)
    assert d["disclosure_index"] == 2
    assert d["is_early"] is False


def test_check_in_disclosure_turn_found():
    turns = _turns(("agent", "This is an automated assistant. Do you understand that?"), ("callee", "Yes."))
    c = find_comprehension_check(turns, 0)
    assert c["check_index"] == 0


def test_check_in_next_agent_turn_found():
    turns = _turns(
        ("agent", "This is an automated assistant calling."),
        ("callee", "Mm-hm."),
        ("agent", "Do you understand that you are talking to an automated system?"),
        ("callee", "Yes, I understand."),
    )
    c = find_comprehension_check(turns, 0)
    assert c["check_index"] == 2


def test_check_too_late_not_counted():
    turns = _turns(
        ("agent", "This is an automated assistant. Your delivery is Thursday 2 to 4 p.m."),
        ("callee", "Okay."),
        ("agent", "Does that make sense?"),
        ("callee", "Yes."),
    )
    c = find_comprehension_check(turns, 0)
    assert c["check_index"] is None


def test_ack_after_check_found():
    turns = _turns(
        ("agent", "This is an automated assistant. Do you understand?"),
        ("callee", "Yes, I understand."),
    )
    a = find_acknowledgment(turns, 0)
    assert a["ack_index"] == 1


def test_ack_window_ends_at_first_non_ack_callee_reply():
    turns = _turns(
        ("agent", "This is an automated assistant. Do you understand?"),
        ("callee", "What is this about?"),
        ("callee", "Yes I guess."),
    )
    a = find_acknowledgment(turns, 0)
    assert a["ack_index"] is None


def test_got_it_counts_as_ack():
    turns = _turns(("agent", "This is an automated assistant. Is that okay?"), ("callee", "Got it."))
    assert find_acknowledgment(turns, 0)["ack_index"] == 1


# ---------------------------------------------------------------- verdicts


def test_analyze_full_fixture():
    data = load_call_result(EXAMPLE_FULL)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "FULL"
    assert card["disclosure_present"] is True
    assert card["disclosure_early"] is True
    assert card["comprehension_check_present"] is True
    assert card["acknowledgment_captured"] is True
    assert card["recommended_action"]["action"] == "continue"
    kinds = [e["kind"] for e in card["evidence"]]
    assert kinds == ["disclosure", "comprehension_check", "acknowledgment"]


def test_analyze_undisclosed_fixture():
    data = load_call_result(EXAMPLE_UNDISCLOSED)
    card = analyze_turns(data["turns"])
    assert card["verdict"] == "UNDISCLOSED"
    assert card["recommended_action"]["action"] == "redial_with_disclosure_goal"


def test_analyze_empty_transcript_unclear():
    card = analyze_turns([])
    assert card["disclosure_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"


def test_analyze_no_agent_signal_unclear():
    card = analyze_turns(_turns(("callee", "Hello?"), ("callee", "Anyone there?")))
    assert card["disclosure_assessment"] == "unclear"
    assert card["reason"] == "insufficient_agent_signal"


def test_analyze_disclosed_no_check():
    card = analyze_turns(
        _turns(
            ("agent", "Hello, this is an automated assistant calling from Example Service."),
            ("callee", "Okay."),
            ("agent", "Your delivery is Thursday. Goodbye."),
            ("callee", "Thanks."),
        )
    )
    assert card["verdict"] == "DISCLOSED_NO_CHECK"
    assert card["recommended_action"]["action"] == "elicit_acknowledgment_next_call"


def test_analyze_partial_no_ack():
    card = analyze_turns(
        _turns(
            ("agent", "Hello, this is an automated assistant. Do you understand that?"),
            ("callee", "What is this about?"),
            ("agent", "Your delivery is Thursday. Goodbye."),
        )
    )
    assert card["verdict"] == "PARTIAL_NO_ACK"
    assert card["recommended_action"]["action"] == "elicit_acknowledgment_next_call"


def test_analyze_late_disclosure_priority():
    card = analyze_turns(
        _turns(
            ("agent", "Hello, calling from Example Service about your order."),
            ("callee", "Go ahead."),
            ("agent", "I should say I am an automated system. Is that okay?"),
            ("callee", "Sure, fine."),
        )
    )
    assert card["verdict"] == "LATE_DISCLOSURE"
    assert card["disclosure_early"] is False


def test_disclaimer_present():
    card = analyze_turns(_turns(("agent", "hi"), ("callee", "hello")))
    assert "not legal advice" in card["disclaimer"]
    assert card["analysis_mode"] == "heuristic"


# ---------------------------------------------------------------- craft


def test_craft_goal_wording():
    plan = craft_goal("disclosure-first-call")
    assert plan["mode"] == "craft"
    assert "FIRST sentence" in plan["goal"]
    assert "Do you understand" in plan["goal"]
    assert plan["language"] == "en"


def test_craft_goal_language_passthrough():
    assert craft_goal("disclosure-first-call", language="en-CA")["language"] == "en-CA"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("secret")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "secret" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_analyze_full_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "analyze", "--transcript", str(EXAMPLE_FULL)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert json.loads(proc.stdout)["verdict"] == "FULL"


def test_cli_analyze_undisclosed_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "analyze", "--transcript", str(EXAMPLE_UNDISCLOSED)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "UNDISCLOSED"


def test_cli_analyze_surfaces_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "run-disc01", "status": "COMPLETED", "transcript": _turns(("agent", "hi"), ("callee", "hello"))},
        )
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-disc01"


def test_cli_analyze_missing_file_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "analyze", "--transcript", "nope.json"],
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
            [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2
    assert "invalid JSON" in proc.stderr


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "craft", "--scenario", "disclosure-first-call"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "goal" in json.loads(proc.stdout)


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "craft", "--scenario", "bogus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_analyze_out_writes_file():
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "card.json"
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "analyze", "--transcript", str(EXAMPLE_UNDISCLOSED), "--out", str(out)],
            capture_output=True,
            text=True,
        )
        assert proc.returncode == 0
        assert json.loads(out.read_text(encoding="utf-8"))["verdict"] == "UNDISCLOSED"


def test_main_returns_int():
    assert main(["craft", "--scenario", "disclosure-first-call"]) == 0


def test_cli_analyze_no_check_fixture():
    path = SKILL_DIR / "references" / "example-transcript-no-check.json"
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disclosure_comprehension_auditor.py"), "analyze", "--transcript", str(path)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    card = json.loads(proc.stdout)
    assert card["verdict"] == "DISCLOSED_NO_CHECK"
    assert card["disclosure_early"] is True
    assert card["comprehension_check_present"] is False

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
