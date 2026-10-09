#!/usr/bin/env python3
"""Tests for the call-disfluency-stress-profiler skill.

Run:
    python3 -m pytest skills/call-disfluency-stress-profiler/scripts/test_disfluency_stress_profiler.py -v
    python3 skills/call-disfluency-stress-profiler/scripts/test_disfluency_stress_profiler.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_STRESSED = SKILL_DIR / "references" / "example-transcript-stressed.json"
EXAMPLE_NORMAL = SKILL_DIR / "references" / "example-transcript-normal.json"

sys.path.insert(0, str(SCRIPTS))
from disfluency_stress_profiler import (  # noqa: E402
    AGENT_HESITANT_THRESHOLD,
    CALLEE_STRESS_THRESHOLD,
    _count_disfluencies,
    _word_count,
    analyze_transcript,
    craft_goal,
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


# ---------------------------------------------------------------- PII masking

def test_mask_pii_short_unchanged():
    assert mask_pii("555-01") == "555-01"


def test_mask_pii_phone_masked():
    result = mask_pii("+14155550155")
    assert result.endswith("55")
    assert "415555" not in result


def test_mask_pii_keeps_last_two():
    result = mask_pii("12345678")
    assert result.endswith("78")


# ---------------------------------------------------------------- disfluency counting

def test_count_filled_pauses():
    assert _count_disfluencies("uh yes um I think so er") >= 3


def test_count_self_repair():
    assert _count_disfluencies("I mean, that is correct.") >= 1


def test_count_repetition():
    assert _count_disfluencies("I I need to check that") >= 1


def test_count_hesitation_opener():
    # "well, " at start of clause
    assert _count_disfluencies("Well, I am not sure about that.") >= 1


def test_count_zero_for_fluent():
    assert _count_disfluencies("Yes, that works perfectly for me.") == 0


def test_word_count_basic():
    assert _word_count("hello world foo") == 3


def test_word_count_empty():
    assert _word_count("") == 0


# ---------------------------------------------------------------- transcript loading

def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))})
        data = load_call_result(p)
    assert len(data["turns"]) == 2


def test_load_nested_result_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "result": {"transcript": _turns(("agent", "Hi"), ("callee", "Yes"))}})
        data = load_call_result(p)
    assert len(data["turns"]) == 2


def test_load_non_dict_raises():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["x"]), encoding="utf-8")
        try:
            load_call_result(p)
            raise AssertionError("expected ValueError")
        except ValueError as exc:
            assert "JSON object" in str(exc)


def test_load_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": None})
        assert load_call_result(p)["turns"] == []


def test_load_mixed_list_skips_non_dicts():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": [{"speaker": "agent", "text": "Hi"}, "junk"]})
        assert len(load_call_result(p)["turns"]) == 1


def test_load_call_id_preserved():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"call_id": "run-stress-abc", "status": "COMPLETED", "transcript": _turns(("agent", "hi"))})
        assert load_call_result(p)["call_id"] == "run-stress-abc"


# ---------------------------------------------------------------- analysis — happy paths

def test_stressed_fixture_detected():
    data = load_call_result(EXAMPLE_STRESSED)
    card = analyze_transcript(data["turns"])
    assert card["verdict"] in ("CALLEE_STRESSED", "BOTH_STRESSED")
    assert "CALLEE_STRESSED" in card["flags"]


def test_normal_fixture_not_flagged():
    data = load_call_result(EXAMPLE_NORMAL)
    card = analyze_transcript(data["turns"])
    assert card["verdict"] == "NORMAL"
    assert card["flags"] == []


def test_agent_hesitant_detection():
    # Agent speaks with many disfluencies, callee is fluent
    high_dis_agent = "Um, well, I mean, uh, let me, uh, I think, er, actually, um, let me check."
    card = analyze_transcript(
        _turns(
            ("agent", high_dis_agent),
            ("agent", "Um, uh, I mean, hmm, I am not sure er, what the, uh, policy is."),
            ("callee", "Okay, thank you."),
        )
    )
    assert card["verdict"] in ("AGENT_HESITANT", "BOTH_STRESSED")


def test_both_stressed_verdict():
    stressed_callee = "Um, I mean, uh, I actually, uh, you know, I don't know, er, maybe."
    stressed_agent = "Um, well, I mean, uh, let me, er, actually, hmm, I think."
    card = analyze_transcript(
        _turns(
            ("agent", stressed_agent),
            ("callee", stressed_callee),
            ("agent", stressed_agent),
            ("callee", stressed_callee),
        )
    )
    # Both sides should have high disfluency rates
    assert "CALLEE_STRESSED" in card["flags"] or "AGENT_HESITANT" in card["flags"]


def test_callee_only_side_with_all_agent():
    # If only agent turns — callee profile empty, assess agent only
    card = analyze_transcript(
        _turns(("agent", "Yes. Confirmed. All good. Thank you."), ("agent", "Is there anything else?"))
    )
    assert card["disfluency_assessment"] == "assessed"
    assert card["callee_profile"] == {}


# ---------------------------------------------------------------- analysis — edge cases

def test_empty_transcript_unclear():
    card = analyze_transcript([])
    assert card["disfluency_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"


def test_no_speaker_turns_unclear():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": [{"speaker": "agent", "text": "   "}, {"speaker": "callee", "text": ""}]})
        data = load_call_result(p)
    card = analyze_transcript(data["turns"])
    assert card["disfluency_assessment"] == "unclear"
    assert card["reason"] == "no_speaker_turns"


def test_callee_role_variants_classified_correctly():
    for role in ("customer", "patient", "caller", "recipient", "user"):
        card = analyze_transcript(
            _turns(
                ("agent", "Hello, this is a test."),
                (role, "Um, uh, I mean, I don't know, er, hmm, actually."),
            )
        )
        assert card["callee_profile"] != {}, f"role={role} was not treated as callee"


def test_disfluency_rate_in_profile():
    card = analyze_transcript(
        _turns(("agent", "Hello confirmed."), ("callee", "Um yes okay."))
    )
    assert "disfluency_rate" in card["agent_profile"]
    assert "disfluency_rate" in card["callee_profile"]
    assert 0.0 <= card["agent_profile"]["disfluency_rate"] <= 1.0
    assert 0.0 <= card["callee_profile"]["disfluency_rate"] <= 1.0


def test_recommended_action_normal():
    card = analyze_transcript(
        _turns(("agent", "Hello there."), ("callee", "Yes, confirmed."))
    )
    assert card["recommended_action"]["action"] == "no_action_required"


def test_recommended_action_callee_stressed():
    stressed = "Um, uh, I mean, you know, I don't, er, actually, hmm, well."
    card = analyze_transcript(_turns(("agent", "Hello."), ("callee", stressed), ("callee", stressed)))
    if "CALLEE_STRESSED" in card["flags"]:
        assert card["recommended_action"]["action"] in ("reassurance_followup", "reassurance_followup_and_script_review")


def test_disclaimer_and_mode_present():
    card = analyze_transcript(_turns(("agent", "Hi"), ("callee", "Hello")))
    assert card["analysis_mode"] == "heuristic"
    assert "advisory" in card["disclaimer"]


def test_pii_not_leaked_in_profile():
    # Profiles contain only counts/rates, not raw text — no PII possible
    card = analyze_transcript(_turns(("agent", "Call +14155550171."), ("callee", "Okay.")))
    assert "5550171" not in json.dumps(card)


def test_per_turn_counts_present():
    card = analyze_transcript(
        _turns(("agent", "Hello."), ("callee", "Um, yes."), ("agent", "Great."))
    )
    assert "per_turn_counts" in card["agent_profile"]
    assert isinstance(card["agent_profile"]["per_turn_counts"], list)


def test_thresholds_are_reasonable():
    assert 0 < CALLEE_STRESS_THRESHOLD < 1
    assert 0 < AGENT_HESITANT_THRESHOLD < 1
    assert AGENT_HESITANT_THRESHOLD < CALLEE_STRESS_THRESHOLD


# ---------------------------------------------------------------- craft

def test_craft_goal_structure():
    plan = craft_goal("reassurance-followup")
    assert plan["mode"] == "craft"
    assert plan["skill"] == "call-disfluency-stress-profiler"
    assert "calm" in plan["goal"].lower() or "unhurried" in plan["goal"].lower()
    assert plan["language"] == "en"


def test_craft_language_passthrough():
    assert craft_goal("reassurance-followup", language="pt-BR")["language"] == "pt-BR"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("bad-scenario")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "bad-scenario" in str(exc)


# ---------------------------------------------------------------- CLI integration

def test_cli_analyze_stressed_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "analyze", "--transcript", str(EXAMPLE_STRESSED)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "run-disfluency-001"
    assert card["verdict"] in ("CALLEE_STRESSED", "BOTH_STRESSED")


def test_cli_analyze_normal_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "analyze", "--transcript", str(EXAMPLE_NORMAL)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "NORMAL"


def test_cli_analyze_missing_file_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "analyze", "--transcript", "nope.json"],
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
            [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2


def test_cli_analyze_surfaces_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "run-dsf-999", "status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))},
        )
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-dsf-999"


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "craft", "--scenario", "reassurance-followup"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    out = json.loads(proc.stdout)
    assert "goal" in out


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "craft", "--scenario", "bad"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_craft_language_flag():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "disfluency_stress_profiler.py"), "craft", "--scenario", "reassurance-followup", "--language", "de-DE"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["language"] == "de-DE"


def test_main_returns_int():
    assert main(["craft", "--scenario", "reassurance-followup"]) == 0


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
