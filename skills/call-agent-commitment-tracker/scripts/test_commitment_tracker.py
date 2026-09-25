#!/usr/bin/env python3
"""Tests for the call-agent-commitment-tracker skill.

Run:
    python3 -m pytest skills/call-agent-commitment-tracker/scripts/test_commitment_tracker.py -v
    python3 skills/call-agent-commitment-tracker/scripts/test_commitment_tracker.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_COMMITMENTS = SKILL_DIR / "references" / "example-transcript-commitments.json"
EXAMPLE_NONE = SKILL_DIR / "references" / "example-transcript-none.json"

sys.path.insert(0, str(SCRIPTS))
from commitment_tracker import (  # noqa: E402
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

def test_mask_pii_short_run_unchanged():
    assert mask_pii("call 555-01") == "call 555-01"


def test_mask_pii_7digit_masked():
    # 555-0188 → 7 digits, should be masked
    result = mask_pii("number +14155550188")
    assert result.endswith("88")
    assert "555011" not in result


def test_mask_pii_phone_555_01xx_masked():
    # PR #288: 555-01xx numbers must be maskable
    result = mask_pii("contact at +14155550123")
    assert result.endswith("23")


# ---------------------------------------------------------------- transcript loading

def test_load_flat_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))},
        )
        data = load_call_result(p)
    assert data["turns"][0]["speaker"] == "agent"
    assert data["turns"][1]["speaker"] == "callee"


def test_load_nested_result_shape():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"status": "COMPLETED", "result": {"transcript": _turns(("agent", "Hi"), ("callee", "Yes"))}},
        )
        data = load_call_result(p)
    assert len(data["turns"]) == 2


def test_load_string_transcript():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "Agent said hello."})
        data = load_call_result(p)
    assert len(data["turns"]) == 1
    assert data["turns"][0]["speaker"] == "agent"


def test_load_whitespace_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": "   "})
        assert load_call_result(p)["turns"] == []


def test_load_null_transcript_no_turns():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(Path(td), {"status": "COMPLETED", "transcript": None})
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
            {"status": "COMPLETED", "transcript": [{"speaker": "agent", "text": "Hi"}, "junk", None]},
        )
        assert len(load_call_result(p)["turns"]) == 1


def test_load_preserves_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = _write_result(
            Path(td),
            {"call_id": "run-abc-123", "status": "COMPLETED", "transcript": _turns(("agent", "hi"))},
        )
        assert load_call_result(p)["call_id"] == "run-abc-123"


# ---------------------------------------------------------------- analysis — happy paths

def test_commitments_found_fixture():
    data = load_call_result(EXAMPLE_COMMITMENTS)
    card = analyze_transcript(data["turns"])
    assert card["verdict"] == "COMMITMENTS_FOUND"
    assert len(card["commitments"]) >= 3
    # At least one WITH_DEADLINE (within 30 minutes, by end of day)
    assert card["commitment_count"]["WITH_DEADLINE"] >= 1


def test_no_commitments_fixture():
    data = load_call_result(EXAMPLE_NONE)
    card = analyze_transcript(data["turns"])
    assert card["verdict"] == "NONE_FOUND"
    assert card["commitments"] == []


def test_with_deadline_classification():
    card = analyze_transcript(
        _turns(("agent", "I will send the document within 24 hours."), ("callee", "Thank you."))
    )
    assert card["verdict"] == "COMMITMENTS_FOUND"
    assert card["commitments"][0]["classification"] == "WITH_DEADLINE"


def test_without_deadline_classification():
    card = analyze_transcript(
        _turns(("agent", "I will follow up on this matter."), ("callee", "Okay."))
    )
    assert card["verdict"] == "COMMITMENTS_FOUND"
    assert card["commitments"][0]["classification"] == "WITHOUT_DEADLINE"


def test_conditional_classification():
    card = analyze_transcript(
        _turns(
            ("agent", "I will process your request if you confirm your address."),
            ("callee", "Sure."),
        )
    )
    assert card["verdict"] == "COMMITMENTS_FOUND"
    assert card["commitments"][0]["classification"] == "CONDITIONAL"


def test_delegation_commitment_detected():
    card = analyze_transcript(
        _turns(("agent", "Someone will call you back about this."), ("callee", "Thank you."))
    )
    assert card["verdict"] == "COMMITMENTS_FOUND"


def test_we_will_commitment():
    card = analyze_transcript(
        _turns(("agent", "We will send you an email confirmation shortly."), ("callee", "Perfect."))
    )
    assert card["verdict"] == "COMMITMENTS_FOUND"
    assert card["commitments"][0]["classification"] == "WITH_DEADLINE"


def test_multiple_commitments_in_one_turn():
    card = analyze_transcript(
        _turns(
            (
                "agent",
                "I will email you the invoice. I will also have the billing team call you by end of day.",
            ),
            ("callee", "Great."),
        )
    )
    assert len(card["commitments"]) >= 2


# ---------------------------------------------------------------- analysis — edge cases

def test_empty_transcript_unclear():
    card = analyze_transcript([])
    assert card["commitment_assessment"] == "unclear"
    assert card["reason"] == "empty_transcript"


def test_no_agent_turns_unclear():
    card = analyze_transcript(_turns(("callee", "Hello, are you there?")))
    assert card["commitment_assessment"] == "unclear"
    assert card["reason"] == "no_agent_turns"


def test_callee_saying_will_not_counted():
    # Callee's own "I will" should not be detected as an agent commitment
    card = analyze_transcript(
        _turns(
            ("agent", "Do you need anything else?"),
            ("callee", "I will think about it and get back to you."),
        )
    )
    assert card["verdict"] == "NONE_FOUND"


def test_various_callee_role_names_excluded():
    for role in ("customer", "patient", "caller", "recipient", "user"):
        card = analyze_transcript(
            _turns(
                ("agent", "Thank you for calling."),
                (role, "I will check and let you know."),
            )
        )
        assert card["verdict"] == "NONE_FOUND", f"role={role} was not excluded"


def test_asap_deadline_detected():
    card = analyze_transcript(
        _turns(("agent", "I will escalate this ASAP."), ("callee", "Thank you."))
    )
    assert card["commitment_count"]["WITH_DEADLINE"] >= 1


def test_right_away_deadline():
    card = analyze_transcript(
        _turns(("agent", "I will fix that right away."), ("callee", "Good."))
    )
    assert card["commitments"][0]["classification"] == "WITH_DEADLINE"


def test_as_soon_as_possible_deadline():
    card = analyze_transcript(
        _turns(("agent", "We will process your request as soon as possible."), ("callee", "Thanks."))
    )
    assert card["commitments"][0]["classification"] == "WITH_DEADLINE"


def test_conditional_overrides_deadline():
    # Even if deadline words appear, CONDITIONAL takes priority when "if" is present
    card = analyze_transcript(
        _turns(("agent", "I will send it today if you confirm your details."), ("callee", "Okay."))
    )
    assert card["commitments"][0]["classification"] == "CONDITIONAL"


def test_evidence_masked_in_card():
    card = analyze_transcript(
        _turns(("agent", "I will call you back at +14155550171 within an hour."), ("callee", "Thank you."))
    )
    for c in card["commitments"]:
        assert "5550171" not in c["evidence"]
        assert c["evidence"].endswith("71") or "71" in c["evidence"]


def test_disclaimer_and_mode_present():
    card = analyze_transcript(_turns(("agent", "Hi"), ("callee", "Hello")))
    assert card["analysis_mode"] == "heuristic"
    assert "follow-up verification" in card["disclaimer"]


def test_recommended_action_on_commitments():
    card = analyze_transcript(
        _turns(("agent", "I will send the confirmation email within 1 hour."), ("callee", "Thanks."))
    )
    assert card["recommended_action"]["action"] == "schedule_followup_call"
    assert "craft" in card["recommended_action"]["guidance"].lower()


def test_recommended_action_on_none():
    card = analyze_transcript(
        _turns(("agent", "Thank you for confirming."), ("callee", "No problem."))
    )
    assert card["recommended_action"]["action"] == "no_followup_required"


# ---------------------------------------------------------------- craft

def test_craft_goal_structure():
    plan = craft_goal("commitment-followup")
    assert plan["mode"] == "craft"
    assert plan["skill"] == "call-agent-commitment-tracker"
    assert "fulfilled" in plan["goal"].lower() or "promised" in plan["goal"].lower() or "commitments" in plan["goal"].lower()
    assert plan["language"] == "en"


def test_craft_language_passthrough():
    assert craft_goal("commitment-followup", language="es-MX")["language"] == "es-MX"


def test_craft_unknown_scenario_raises():
    try:
        craft_goal("nonexistent-scenario")
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "nonexistent-scenario" in str(exc)


# ---------------------------------------------------------------- CLI integration

def test_cli_analyze_commitments_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "analyze", "--transcript", str(EXAMPLE_COMMITMENTS)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "COMMITMENTS_FOUND"
    assert card["call_id"] == "run-commit-001"


def test_cli_analyze_none_fixture():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "analyze", "--transcript", str(EXAMPLE_NONE)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "NONE_FOUND"


def test_cli_analyze_missing_file_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "analyze", "--transcript", "nope.json"],
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
            [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2


def test_cli_analyze_non_dict_json_exit2():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "arr.json"
        p.write_text(json.dumps(["a", "b"]), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 2


def test_cli_analyze_surfaces_call_id():
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "result.json"
        p.write_text(
            json.dumps({"call_id": "run-xyz-999", "status": "COMPLETED", "transcript": _turns(("agent", "Hi"), ("callee", "Hello"))}),
            encoding="utf-8",
        )
        proc = subprocess.run(
            [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "analyze", "--transcript", str(p)],
            capture_output=True,
            text=True,
        )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["call_id"] == "run-xyz-999"


def test_cli_craft_exit0():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "craft", "--scenario", "commitment-followup"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    out = json.loads(proc.stdout)
    assert "goal" in out
    assert out["mode"] == "craft"


def test_cli_craft_unknown_scenario_exit2():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "craft", "--scenario", "bad-scenario"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 2


def test_cli_craft_language_flag():
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "commitment_tracker.py"), "craft", "--scenario", "commitment-followup", "--language", "fr-FR"],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["language"] == "fr-FR"


def test_main_returns_int():
    assert main(["craft", "--scenario", "commitment-followup"]) == 0


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
