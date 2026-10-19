#!/usr/bin/env python3
"""Tests for the call-guess-forcing-auditor skill.

Run:
    python3 -m pytest skills/call-guess-forcing-auditor/tests/test_guess_forcing_auditor.py -v
    python3 skills/call-guess-forcing-auditor/tests/test_guess_forcing_auditor.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

TESTS = Path(__file__).resolve().parent
SKILL_DIR = TESTS.parent
SCRIPTS = SKILL_DIR / "scripts"
FIXTURES = SKILL_DIR / "data" / "fixtures"

sys.path.insert(0, str(SCRIPTS))
from guess_forcing_auditor import (  # noqa: E402
    analyze_payload,
    analyze_turns,
    craft_goal,
    mask_pii,
)


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"role": r, "text": t} for r, t in pairs]


def _fixture(idx: int) -> list:
    data = json.loads((FIXTURES / f"demo-guess-{idx:03d}.json").read_text(encoding="utf-8"))
    return data["transcript"]


def _types(report: dict) -> list[str]:
    return [e["type"] for e in report["events"]]


# ---------------------------------------------------------------- loader family

def test_wrapped_shape_result_transcript():
    payload = {
        "status": "COMPLETED",
        "result": {"transcript": _fixture(1)},
    }
    report = analyze_payload(payload)
    assert report["verdict"] == "GUESS_PRESSURE_UNMITIGATED"


def test_bare_shape_transcript_key():
    report = analyze_payload({"transcript": _fixture(1)})
    assert report["verdict"] == "GUESS_PRESSURE_UNMITIGATED"


def test_flat_list_shape():
    report = analyze_turns(_fixture(1))
    assert report["verdict"] == "GUESS_PRESSURE_UNMITIGATED"


def test_speaker_alias_role():
    turns = [
        {"speaker": "bot", "text": "What time works?"},
        {"speaker": "human", "text": "I'm not sure."},
    ]
    report = analyze_payload({"transcript": turns})
    assert report["verdict"] == "UNCERTAINTY_RESPECTED"


def test_non_dict_entries_skipped():
    turns = [
        {"role": "agent", "text": "Hello?"},
        "not a dict",
        None,
        {"role": "callee", "text": "I'm not sure when we can come."},
    ]
    report = analyze_turns(turns)
    assert report["verdict"] == "UNCERTAINTY_RESPECTED"
    assert report["counts"]["uncertainty_events"] == 1


def test_u2019_regression_normalized():
    turns = _turns(("callee", "I\u2019m not sure about the time."))
    report = analyze_turns(turns)
    assert report["counts"]["uncertainty_events"] == 1


def test_call_id_from_result_call_id():
    payload = {
        "status": "COMPLETED",
        "result": {"call_id": "run-42", "transcript": _fixture(1)},
    }
    report = analyze_payload(payload)
    assert report["call_id"] == "run-42"


def test_call_id_top_level_wins():
    payload = {"call_id": "top-1", "result": {"call_id": "inner-1", "transcript": []}}
    report = analyze_payload(payload)
    assert report["call_id"] == "top-1"


def test_no_text_entries_skipped():
    turns = [
        {"role": "callee", "text": ""},
        {"role": "callee", "text": "   "},
        {"role": "callee", "text": "I don't know the arrival time."},
    ]
    report = analyze_turns(turns)
    assert report["counts"]["uncertainty_events"] == 1


# ---------------------------------------------------------------- uncertainty signal

def test_uncertainty_variants_fire():
    probes = [
        "I don't know the time.",
        "I have no idea, sorry.",
        "I can't remember what we agreed.",
        "I'm not certain about Friday.",
        "It's hard to say.",
        "I couldn't say offhand.",
    ]
    for probe in probes:
        report = analyze_turns(_turns(("callee", probe)))
        assert report["counts"]["uncertainty_events"] == 1, probe


def test_uncertainty_question_guard():
    report = analyze_turns(_turns(("callee", "Are you not sure what you booked?")))
    assert report["counts"]["uncertainty_events"] == 0


def test_uncertainty_question_guard_not_sure_question():
    report = analyze_turns(_turns(("callee", "You are not sure?")))
    assert report["counts"]["uncertainty_events"] == 0


# ---------------------------------------------------------------- pressure signal

def _uncertainty_pressure(callee: str, agent: str) -> dict:
    return analyze_turns(
        _turns(("callee", "I'm not sure what time we'll arrive."), ("agent", agent))
    )


def test_pressure_best_guess():
    report = _uncertainty_pressure("c", "Just roughly, your best guess - what time?")
    assert report["counts"]["pressure_events"] == 1


def test_pressure_approximately_when_question():
    report = _uncertainty_pressure("c", "Approximately when would that be?")
    assert report["counts"]["pressure_events"] == 1


def test_pressure_wh_re_ask():
    report = _uncertainty_pressure("c", "What time should I put down?")
    assert report["counts"]["pressure_events"] == 1


def test_declarative_offer_does_not_fire():
    report = _uncertainty_pressure("c", "We can confirm approximately later.")
    assert report["counts"]["pressure_events"] == 0


def test_pressure_window_three_turns_later_does_not_bind():
    turns = _turns(
        ("callee", "I'm not sure what time we'll arrive."),
        ("agent", "Understood."),
        ("callee", "I will check with my partner."),
        ("agent", "I will look at the calendar now."),
        ("agent", "What time should I put down?"),
    )
    report = analyze_turns(turns)
    assert report["counts"]["pressure_events"] == 0


# ---------------------------------------------------------------- yield signal

def _pressure_yield(agent: str, callee: str) -> dict:
    return analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", agent),
            ("callee", callee),
        )
    )


def test_yield_hedged():
    report = _pressure_yield("What time should I put down?", "Maybe 7.")
    assert report["counts"]["yields"] == 1
    assert report["events"][-1]["detail"] == "kind: hedged"
    assert report["events"][-1]["yield_value"] == "7"


def test_yield_pressured_answer_requires_guess_invitation():
    report = _pressure_yield("Just take a guess, okay?", "7, fine.")
    assert report["counts"]["yields"] == 1
    assert report["events"][-1]["detail"] == "kind: pressured_answer"


def test_yield_no_number_no_yield():
    report = _pressure_yield("What time should I put down?", "Honestly no idea.")
    assert report["counts"]["yields"] == 0


def test_yield_number_without_hedge_without_invitation_no_yield():
    report = _pressure_yield("What time should I put down?", "7.")
    assert report["counts"]["yields"] == 0


# ---------------------------------------------------------------- consolidation signal

def test_consolidation_as_fact():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Maybe 7."),
            ("agent", "Perfect, 7 p.m. it is - you're all set."),
        )
    )
    assert report["counts"]["consolidations_as_fact"] == 1
    assert report["verdict"] == "GUESS_PRESSURE_UNMITIGATED"


def test_consolidation_hedge_preserved():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Maybe 7."),
            ("agent", "Got it - around 7, I'll mark that as tentative."),
        )
    )
    assert report["counts"]["consolidations_hedge_preserved"] == 1
    assert report["counts"]["consolidations_as_fact"] == 0
    assert report["verdict"] == "GUESS_PRESSURE_MITIGATED"


def test_consolidation_tentative_marker_hedge_preserved():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Maybe 7."),
            ("agent", "Noted, 7 - to be confirmed."),
        )
    )
    assert report["counts"]["consolidations_hedge_preserved"] == 1


def test_consolidation_value_mismatch_time_continuation_no_bind():
    # "7" inside "7:30" is a different value; the yield value must not bind there.
    report = analyze_turns(
        _turns(
            ("agent", "Harbor Inn."),
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "Just roughly - your best guess?"),
            ("callee", "Maybe 7?"),
            ("agent", "Got it, 7:30 it is - all set."),
        )
    )
    assert report["counts"]["consolidations_as_fact"] == 0
    assert report["counts"]["consolidations_hedge_preserved"] == 0
    assert report["verdict"] == "GUESS_PRESSURE_MITIGATED"


def test_consolidation_window_outside_does_not_bind():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Maybe 7."),
            ("agent", "Thanks for your patience."),
            ("agent", "One moment while I check the calendar."),
            ("agent", "Perfect, 7 p.m. it is - you're all set."),
        )
    )
    assert report["counts"]["consolidations_as_fact"] == 0


# ---------------------------------------------------------------- shift advisory

def test_shift_advisory_never_gates():
    report = analyze_turns(
        _turns(
            ("callee", "We'll arrive at 7."),
            ("agent", "No, that's not right, the kitchen closes at 8."),
            ("callee", "Okay, then 8."),
        )
    )
    assert report["counts"]["shifts"] == 1
    assert report["verdict"] == "NO_UNCERTAINTY_EXPRESSED"


# ---------------------------------------------------------------- summary_carries_value

def test_summary_carries_value_true():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Maybe 7."),
            ("agent", "Perfect, 7 p.m. it is."),
        ),
        post_summary="Arrival at 7 p.m.",
    )
    assert report["summary_carries_value"] is True


def test_summary_carries_value_false_with_hedge():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Maybe 7."),
            ("agent", "Noted."),
        ),
        post_summary="Arrival at around 7, tentative.",
    )
    assert report["summary_carries_value"] is False


def test_summary_carries_value_false_absent():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Maybe 7."),
        ),
        post_summary="Discussed arrival plans.",
    )
    assert report["summary_carries_value"] is False


def test_summary_carries_value_null_no_post_summary():
    report = analyze_turns(_turns(("callee", "I'm not sure.")))
    assert report["summary_carries_value"] is None


# ---------------------------------------------------------------- fixture verdicts

def test_fixture_001_unmitigated():
    report = analyze_turns(_fixture(1))
    assert report["verdict"] == "GUESS_PRESSURE_UNMITIGATED"
    assert report["counts"] == {
        "uncertainty_events": 1,
        "pressure_events": 1,
        "yields": 1,
        "consolidations_as_fact": 1,
        "consolidations_hedge_preserved": 0,
        "shifts": 0,
    }
    assert report["summary_carries_value"] is None
    assert report["review_action"] == (
        "rewrite the goal template: never press for guesses; repeat uncertain "
        "values back with their qualifier and mark them tentative"
    )


def test_fixture_002_mitigated():
    report = analyze_turns(_fixture(2))
    assert report["verdict"] == "GUESS_PRESSURE_MITIGATED"
    assert report["counts"]["consolidations_hedge_preserved"] == 1
    assert report["review_action"] == "none"


def test_fixture_003_uncertainty_respected():
    report = analyze_turns(_fixture(3))
    assert report["verdict"] == "UNCERTAINTY_RESPECTED"
    assert report["counts"]["pressure_events"] == 0


def test_fixture_004_no_uncertainty():
    report = analyze_turns(_fixture(4))
    assert report["verdict"] == "NO_UNCERTAINTY_EXPRESSED"


def test_pressure_applied_no_yield_synthetic():
    report = analyze_turns(
        _turns(
            ("callee", "I'm not sure what time we'll arrive."),
            ("agent", "What time should I put down?"),
            ("callee", "Honestly no idea."),
        )
    )
    assert report["verdict"] == "PRESSURE_APPLIED_NO_YIELD"
    assert report["review_action"] == "remove guess-invitation phrasing from the goal template"


# ---------------------------------------------------------------- wrapped shape + summary

def test_wrapped_with_post_summary_true():
    payload = {
        "status": "COMPLETED",
        "result": {
            "post_summary": "Arrival at 7 p.m.",
            "transcript": _fixture(1),
        },
    }
    report = analyze_payload(payload)
    assert report["verdict"] == "GUESS_PRESSURE_UNMITIGATED"
    assert report["summary_carries_value"] is True


# ---------------------------------------------------------------- misc report

def test_empty_transcript_no_uncertainty():
    report = analyze_payload({"transcript": []})
    assert report["verdict"] == "NO_UNCERTAINTY_EXPRESSED"


def test_mask_pii_and_call_id_masking():
    assert mask_pii("backup number 415-555-0168 here") == "backup number ********68 here"
    assert mask_pii("call +14155550168 now").startswith("call +")
    turns = _turns(("callee", "I'm not sure, my reference is 4155550168."))
    report = analyze_turns(turns, call_id="+14155550168")
    dumped = json.dumps(report)
    assert "+14155550168" not in dumped
    assert "*" in report["call_id"]


# ---------------------------------------------------------------- craft

def test_craft_goal_protocol():
    goal = craft_goal("+14155550168", business_name="Harbor Inn", task="confirm the Friday arrival")["goal_template"]
    assert "Never ask for a best guess" in goal["protocol"]
    assert "open questions" in goal["protocol"]
    assert goal["to"] == "+14155550168"
    assert goal["business_name"] == "Harbor Inn"
    assert goal["task"] == "confirm the Friday arrival"
    assert goal["language"] == "en-US"


# ---------------------------------------------------------------- CLI / edges

MODULE = SCRIPTS / "guess_forcing_auditor.py"


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(MODULE), *args],
        capture_output=True,
        text=True,
    )


def test_craft_valid_number(tmp_path: Path):
    proc = _run_cli("craft", "--number", "+14155550168", "--business-name", "Harbor Inn", "--task", "confirm the Friday arrival")
    assert proc.returncode == 0
    goal = json.loads(proc.stdout)["goal_template"]
    assert goal["to"] == "+14155550168"
    assert "best guess" in goal["protocol"]


def test_craft_rejects_non_reserved():
    proc = _run_cli("craft", "--number", "+19999999999")
    assert proc.returncode == 2


def test_craft_rejects_missing_number():
    proc = _run_cli("craft")
    assert proc.returncode == 2


def test_cli_invalid_json_exit_2(tmp_path: Path):
    p = tmp_path / "broken.json"
    p.write_text("{not json", encoding="utf-8")
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 2


def test_cli_top_level_string_exit_2(tmp_path: Path):
    p = tmp_path / "str.json"
    p.write_text(json.dumps("just a string"), encoding="utf-8")
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 2


def test_cli_missing_file_exit_2(tmp_path: Path):
    proc = _run_cli("analyze", "--call-result", str(tmp_path / "nope.json"))
    assert proc.returncode == 2


def test_cli_analyze_fixture_001_exit_0():
    proc = _run_cli("analyze", "--call-result", str(FIXTURES / "demo-guess-001.json"))
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "GUESS_PRESSURE_UNMITIGATED"


# ---------------------------------------------------------------- runner


def _run_all() -> int:
    import inspect
    import tempfile

    failures = 0
    globals_map = globals()
    tests = [(k, v) for k, v in globals_map.items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            params = inspect.signature(fn).parameters
            if "tmp_path" in params:
                with tempfile.TemporaryDirectory() as tmp:
                    fn(Path(tmp))
            else:
                fn()
            print(f"PASS {name}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
