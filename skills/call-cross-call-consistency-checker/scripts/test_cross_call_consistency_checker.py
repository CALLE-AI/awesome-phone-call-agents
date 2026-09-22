#!/usr/bin/env python3
"""Tests for the call-cross-call-consistency-checker skill.

Run:
    python3 -m pytest skills/call-cross-call-consistency-checker/scripts/test_cross_call_consistency_checker.py -v
    python3 skills/call-cross-call-consistency-checker/scripts/test_cross_call_consistency_checker.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_A = SKILL_DIR / "references" / "example-transcript-a.json"
EXAMPLE_B = SKILL_DIR / "references" / "example-transcript-b.json"
EXAMPLE_B_CONSISTENT = SKILL_DIR / "references" / "example-transcript-b-consistent.json"

sys.path.insert(0, str(SCRIPTS))
from cross_call_consistency_checker import (  # noqa: E402
    analyze_pair,
    craft_goal,
    extract_agent_facts,
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


def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert data["turns"][1]["speaker"] == "callee"


def test_load_whitespace_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "   "})
        assert load_call_result(p)["turns"] == []


def test_load_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": None})
        assert load_call_result(p)["turns"] == []


def test_load_number_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": 11})
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
            {"status": "COMPLETED", "transcript": [{"speaker": "agent", "text": "Hello"}, "junk", None, {"speaker": "callee", "text": "Yes"}]},
        )
        data = load_call_result(p)
    assert len(data["turns"]) == 2


# ---------------------------------------------------------------- masking


def test_mask_pii_masks_phone_keep_last_two():
    masked = mask_pii("number 415-555-0152")
    assert "555" not in masked


def test_mask_pii_leaves_amounts_untouched():
    assert mask_pii("the fee is $45") == "the fee is $45"


# ---------------------------------------------------------------- facts


def test_extract_facts_weekday_ordinal_amount_time():
    facts = extract_agent_facts(
        _turns(("agent", "The fee is $45, drop-off on Tuesday the 15th at 2 p.m."), ("callee", "Okay."))
    )
    assert facts["amount"] == ["45"]
    assert facts["date_weekday"] == ["tuesday"]
    assert facts["date_day"] == ["15"]
    assert facts["time"] == ["1400"]


def test_extract_facts_24h_clock():
    facts = extract_agent_facts(_turns(("agent", "The window opens at 14:00 sharp."), ("callee", "Okay.")))
    assert facts["time"] == ["1400"]


def test_extract_facts_45_dollars_form():
    facts = extract_agent_facts(_turns(("agent", "The total is 45 dollars."), ("callee", "Okay.")))
    assert facts["amount"] == ["45"]


def test_extract_facts_ignores_callee_values():
    facts = extract_agent_facts(
        _turns(
            ("agent", "Your fee is $45."),
            ("callee", "But I paid 99 dollars last time."),
        )
    )
    assert facts["amount"] == ["45"]


def test_extract_facts_midday_midnight_normalization():
    facts = extract_agent_facts(_turns(("agent", "Pickup at 12 p.m. and again at 12 a.m."), ("callee", "Okay.")))
    assert facts["time"] == ["1200", "0000"]


def test_extract_facts_empty():
    assert extract_agent_facts(_turns(("agent", "Hello, just checking in."), ("callee", "Hi."))) == {"amount": [], "date_weekday": [], "date_day": [], "time": []}


# ---------------------------------------------------------------- analysis


def test_analyze_contradiction_fixture():
    a = load_call_result(EXAMPLE_A)["turns"]
    b = load_call_result(EXAMPLE_B)["turns"]
    card = analyze_pair(a, b)
    by_kind = {c["kind"]: c for c in card["comparisons"]}
    assert by_kind["amount"]["status"] == "CONSISTENT"
    assert by_kind["time"]["status"] == "CONSISTENT"
    assert by_kind["date_weekday"]["status"] == "CONTRADICTED"
    assert by_kind["date_day"]["status"] == "CONTRADICTED"
    assert card["verdict"] == "CONTRADICTIONS_FOUND"
    assert card["contradiction_count"] == 2
    assert card["recommended_action"]["action"] == "verify_before_next_call"
    assert card["analysis_mode"] == "heuristic"


def test_analyze_consistent_fixture():
    a = load_call_result(EXAMPLE_A)["turns"]
    b = load_call_result(EXAMPLE_B_CONSISTENT)["turns"]
    card = analyze_pair(a, b)
    assert all(c["status"] == "CONSISTENT" for c in card["comparisons"])
    assert card["verdict"] == "CONSISTENT"
    assert card["recommended_action"]["action"] == "continue"


def test_analyze_identical_transcripts_consistent():
    a = load_call_result(EXAMPLE_A)["turns"]
    card = analyze_pair(a, list(a))
    assert card["verdict"] == "CONSISTENT"


def test_analyze_reschedule_not_contradiction():
    # Call A mentions the move from 12th to 15th; call B says 15th -> shared.
    a = _turns(
        ("agent", "We moved your delivery from the 12th to the 15th, fee $45."),
        ("callee", "Okay."),
    )
    b = _turns(("agent", "Your delivery is on the 15th."), ("callee", "Fine."))
    card = analyze_pair(a, b)
    by_kind = {c["kind"]: c for c in card["comparisons"]}
    assert "date_weekday" not in by_kind
    assert by_kind["date_day"]["status"] == "CONSISTENT"


def test_analyze_weekday_change_same_day_number_contradicts():
    # Same day-of-month, different weekday: the weekday sub-kind catches
    # what a single merged date bucket would have hidden.
    a = _turns(("agent", "Your pickup is Tuesday the 15th."), ("callee", "Okay."))
    b = _turns(("agent", "Your pickup is Wednesday the 15th."), ("callee", "Fine."))
    card = analyze_pair(a, b)
    by_kind = {c["kind"]: c for c in card["comparisons"]}
    assert by_kind["date_weekday"]["status"] == "CONTRADICTED"
    assert by_kind["date_day"]["status"] == "CONSISTENT"
    assert card["verdict"] == "CONTRADICTIONS_FOUND"


def test_analyze_only_stated():
    a = _turns(("agent", "Your fee is $45."), ("callee", "Okay."))
    b = _turns(("agent", "Calling to confirm you are still happy."), ("callee", "Yes."))
    card = analyze_pair(a, b)
    by_kind = {c["kind"]: c for c in card["comparisons"]}
    assert by_kind["amount"]["status"] == "ONLY_STATED"
    assert card["verdict"] == "NOTHING_TO_COMPARE"


def test_analyze_nothing_comparable():
    a = _turns(("agent", "Hello, just a courtesy check."), ("callee", "Thanks."))
    b = _turns(("agent", "Hello again, all good?"), ("callee", "Yes."))
    card = analyze_pair(a, b)
    assert card["comparisons"] == []
    assert card["verdict"] == "NOTHING_TO_COMPARE"


def test_analyze_empty_a_unclear():
    card = analyze_pair([], _turns(("agent", "Hello."), ("callee", "Hi.")))
    assert card["consistency_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript_a"


def test_analyze_empty_b_unclear():
    card = analyze_pair(_turns(("agent", "Hello."), ("callee", "Hi.")), [])
    assert card["consistency_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript_b"


def test_analyze_no_agent_turns_unclear():
    card = analyze_pair(_turns(("callee", "Hello?")), _turns(("agent", "Hi"), ("callee", "Hello")))
    assert card["consistency_assessment"] == "unclear"
    assert card["reason"] == "no_agent_turns"


def test_values_masked_in_comparisons():
    a = _turns(("agent", "Call me back at 415-555-0152, fee $45."), ("callee", "Okay."))
    b = _turns(("agent", "The fee is $50."), ("callee", "Fine."))
    card = analyze_pair(a, b)
    all_values = [v for c in card["comparisons"] for v in c["values_a"] + c["values_b"]]
    assert not any("555" in v for v in all_values)


def test_disclaimer_present():
    card = analyze_pair(_turns(("agent", "Hi"), ("callee", "Hello")), _turns(("agent", "Hi"), ("callee", "Hello")))
    assert "legitimately changed record" in card["disclaimer"]


# ---------------------------------------------------------------- craft


def test_craft_goal_wording():
    plan = craft_goal("consistency-guarded-callback")
    assert plan["mode"] == "craft"
    assert "our record shows" in plan["goal"]
    assert "two unreconciled values" in plan["goal"]
    assert plan["language"] == "en"


def test_craft_goal_language_passthrough():
    assert craft_goal("consistency-guarded-callback", language="en-GB")["language"] == "en-GB"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("nope")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "nope" in str(exc)


# ---------------------------------------------------------------- CLI


def test_cli_analyze_contradiction_pair():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "cross_call_consistency_checker.py"),
            "analyze",
            "--transcript-a",
            str(EXAMPLE_A),
            "--transcript-b",
            str(EXAMPLE_B),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "CONTRADICTIONS_FOUND"
    assert card["call_a"] is None or isinstance(card["call_a"], str)


def test_cli_analyze_consistent_pair():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "cross_call_consistency_checker.py"),
            "analyze",
            "--transcript-a",
            str(EXAMPLE_A),
            "--transcript-b",
            str(EXAMPLE_B_CONSISTENT),
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "CONSISTENT"


def test_cli_analyze_missing_file_b_exit2():
    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "cross_call_consistency_checker.py"),
            "analyze",
            "--transcript-a",
            str(EXAMPLE_A),
            "--transcript-b",
            "nope.json",
        ],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_missing_transcript_b_arg_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "cross_call_consistency_checker.py"), "analyze", "--transcript-a", str(EXAMPLE_A)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "cross_call_consistency_checker.py"), "craft", "--scenario", "consistency-guarded-callback"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "goal" in json.loads(proc.stdout)


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "cross_call_consistency_checker.py"), "craft", "--scenario", "bogus"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_main_returns_int():
    assert main(["craft", "--scenario", "consistency-guarded-callback"]) == 0


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
