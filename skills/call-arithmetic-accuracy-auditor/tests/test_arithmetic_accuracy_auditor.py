#!/usr/bin/env python3
"""Tests for the call-arithmetic-accuracy-auditor skill.

Run:
    python3 -m pytest skills/call-arithmetic-accuracy-auditor/tests/test_arithmetic_accuracy_auditor.py -v
    python3 skills/call-arithmetic-accuracy-auditor/tests/test_arithmetic_accuracy_auditor.py
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
from arithmetic_accuracy_auditor import (  # noqa: E402
    analyze_payload,
    analyze_turns,
    mask_pii,
)


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"role": r, "text": t} for r, t in pairs]


def _fixture(idx: int) -> dict:
    return json.loads((FIXTURES / f"demo-arith-{idx:03d}.json").read_text(encoding="utf-8"))


def _fixture_turns(idx: int) -> list:
    return _fixture(idx)["transcript"]


def _kinds(report: dict) -> list[str]:
    return [c["kind"] for c in report["computations"]]


# ---------------------------------------------------------------- loader

def test_wrapped_shape_result_transcript(tmp_path: Path):
    payload = {
        "status": "COMPLETED",
        "result": {"transcript": _fixture_turns(1), "post_summary": "Reservation confirmed."},
    }
    report = analyze_payload(payload)
    assert report["verdict"] == "ALL_COMPUTATIONS_CORRECT"


def test_bare_dict_transcript():
    payload = {"transcript": _turns(("agent", "Your total comes to 250 dollars."))}
    report = analyze_payload(payload)
    assert report["counts"]["detected"] == 1


def test_flat_turn_list():
    report = analyze_turns(_turns(("agent", "Your total comes to 250 dollars.")))
    assert report["counts"]["detected"] == 1


def test_speaker_alias_role():
    turns = [{"speaker": "agent", "text": "Your total comes to 250 dollars."}]
    report = analyze_payload({"transcript": turns})
    assert report["counts"]["detected"] == 1


def test_non_dict_turns_skipped():
    turns = [
        {"role": "agent", "text": "Your total comes to 250 dollars."},
        "not a dict",
        None,
        {"role": "callee", "text": "Okay."},
    ]
    report = analyze_turns(turns)
    assert report["counts"]["detected"] == 1
    assert report["computations"][0]["turn_index"] == 0


def test_smart_apostrophe_regression():
    ascii_turns = _turns(("agent", "I have you for 3 nights at 120 dollars a night, so that's 420 dollars total."))
    smart_turns = _turns(("agent", "I have you for 3 nights at 120 dollars a night, so that\u2019s 420 dollars total."))
    a = analyze_turns(ascii_turns)
    b = analyze_turns(smart_turns)
    assert a["verdict"] == "ARITHMETIC_ERRORS_FOUND"
    assert b["verdict"] == a["verdict"]
    assert b["computations"][0]["delta"] == a["computations"][0]["delta"] == 60.0


def test_call_id_from_result_call_id(tmp_path: Path):
    payload = {
        "status": "COMPLETED",
        "result": {"call_id": "demo-arith-001", "transcript": _fixture_turns(1)},
    }
    report = analyze_payload(payload)
    assert report["call_id"] == "demo-arith-001"


# ------------------------------------------------- inline string transcripts
# The live get_call_run endpoint also returns result.transcript as a single
# inline string ("[MM:SS] BOT: ... [MM:SS] USER: ..."), per the observed-live
# fixture in apps/python/ringdown/tests/fixtures.

_STRING_SIGNAL = (
    "[00:00] BOT: Thanks for holding. I see 3 nights at 120 dollars a night, "
    "so that comes to 360 dollars total.\n"
    "[00:05] USER: That sounds right.\n"
    "[00:07] BOT: And with the 45 dollar cleaning fee, 360 and 45 comes to 475 dollars."
)


def test_string_transcript_arithmetic_errors():
    report = analyze_payload({"transcript": _STRING_SIGNAL})
    assert report["counts"]["detected"] >= 2
    assert report["verdict"] == "ARITHMETIC_ERRORS_FOUND"


def test_string_transcript_wrapped_shape_and_call_id(tmp_path: Path):
    payload = {
        "status": "COMPLETED",
        "call_id": "call-string-001",
        "result": {"transcript": _STRING_SIGNAL, "post_summary": "Booking confirmed."},
    }
    report = analyze_payload(payload)
    assert report["verdict"] == "ARITHMETIC_ERRORS_FOUND"
    assert report["call_id"] == "call-string-001"


def test_string_transcript_wrapped_continuation_join():
    wrapped = (
        "[00:00] BOT: I see 3 nights at 120 dollars a night, so that\n"
        "comes to 360 dollars total.\n"
        "[00:05] USER: Great."
    )
    report = analyze_payload({"status": "COMPLETED", "result": {"transcript": wrapped}})
    assert report["counts"]["detected"] >= 1
    assert report["verdict"] == "ALL_COMPUTATIONS_CORRECT"
    assert report["computations"][0]["status"] == "CORRECT"


def test_string_transcript_label_coverage():
    payload = {
        "transcript": (
            "[00:00] AI: Your total comes to 250 dollars.\n"
            "[00:04] CALLEE: Okay.\n"
            "[00:06] CALLER: Fine.\n"
            "[00:08] CUSTOMER: Bye."
        )
    }
    report = analyze_payload(payload)
    assert report["counts"]["detected"] == 1


# ---------------------------------------------------------------- detector units

def test_multiply_correct():
    turns = _turns(("agent", "I see 3 nights at 120 dollars a night, so that comes to 360 dollars total."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "multiply"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 360.0


def test_multiply_incorrect_delta():
    turns = _turns(("agent", "I have you for 3 nights at 120 dollars a night, so that's 420 dollars total."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "multiply"
    assert comp["status"] == "INCORRECT"
    assert comp["delta"] == 60.0


def test_dollar_word_and_bucks_equivalence():
    probes = [
        "I see 3 nights at $120 a night, so that comes to $360 total.",
        "I see 3 nights at 120 bucks a night, so that comes to 360 bucks total.",
    ]
    for probe in probes:
        report = analyze_turns(_turns(("agent", probe)))
        comp = report["computations"][0]
        assert comp["kind"] == "multiply", probe
        assert comp["status"] == "CORRECT", probe


def test_decimal_unit_price():
    turns = _turns(("agent", "That is 2 sessions at $45.50 each, so that comes to $91 total."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "multiply"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 91.0


def test_each_per_apiece_tolerated():
    probes = [
        "3 tickets at 50 dollars each, that's 150 dollars total.",
        "3 tickets at 50 dollars per ticket, that's 150 dollars total.",
        "3 tickets at 50 dollars apiece, that's 150 dollars total.",
    ]
    for probe in probes:
        report = analyze_turns(_turns(("agent", probe)))
        assert report["computations"][0]["status"] == "CORRECT", probe


def test_non_whitelist_noun_does_not_fire_multiply():
    turns = _turns(("agent", "There are 5 parking spots at the mall and 25 total."))
    report = analyze_turns(turns)
    assert "multiply" not in _kinds(report)


def test_multiply_factors_missing_unverifiable():
    turns = _turns(("agent", "I see 3 nights there, so that comes to 360 dollars total."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "multiply"
    assert comp["status"] == "UNVERIFIABLE"
    assert comp["reason"] == "FACTORS_MISSING"


def test_add_correct_two_operands():
    turns = _turns(("agent", "So 360 and 45 comes to 405 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "add"
    assert comp["status"] == "CORRECT"


def test_add_one_operand_unverifiable():
    turns = _turns(("agent", "There is a 45 dollar cleaning fee, so the total is 405 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "add"
    assert comp["status"] == "UNVERIFIABLE"
    assert comp["reason"] == "FACTORS_MISSING"


def test_add_suppressed_when_multiply_matched():
    turns = _turns(("agent", "I have you for 3 nights at 120 dollars a night, so that's 420 dollars total."))
    report = analyze_turns(turns)
    assert _kinds(report) == ["multiply"]


def test_percent_off_correct():
    turns = _turns(("agent", "We can take 20% off the 80 dollar rate, so that's 64 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "percent_off"
    assert comp["status"] == "CORRECT"


def test_percent_off_incorrect():
    turns = _turns(("agent", "We can take 20 percent off the 80 dollar rate, so that's 65 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "percent_off"
    assert comp["status"] == "INCORRECT"
    assert comp["delta"] == 1.0


def test_percent_off_factors_missing():
    turns = _turns(("agent", "We can take 20% off, so that's 64 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "percent_off"
    assert comp["status"] == "UNVERIFIABLE"


def test_subtract_correct():
    turns = _turns(("agent", "Your total is 500 dollars, you paid a 100 dollar deposit, so the balance due is 400 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "subtract"
    assert comp["status"] == "CORRECT"


def test_duration_correct_with_meridiem():
    turns = _turns(("agent", "Your pickup window runs from 2 p.m. to 5 p.m., that's 3 hours."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "duration"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 3.0


def test_duration_ambiguous_clock_unverifiable():
    turns = _turns(("agent", "The run goes from 9 to 11, that's 2 hours, all included."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "duration"
    assert comp["status"] == "UNVERIFIABLE"
    assert comp["reason"] == "AMBIGUOUS_CLOCK"


def test_agent_turns_only():
    turns = _turns(("callee", "So that's 420 dollars total, right?"))
    report = analyze_turns(turns)
    assert report["verdict"] == "NO_SPOKEN_COMPUTATIONS"


# ---------------------------------------------------------------- fixtures

def test_fixture_001_all_correct():
    report = analyze_turns(_fixture_turns(1))
    assert report["verdict"] == "ALL_COMPUTATIONS_CORRECT"
    assert report["counts"] == {"detected": 2, "correct": 2, "incorrect": 0, "unverifiable": 0}
    assert report["review_action"] == "none"
    assert _kinds(report) == ["multiply", "add"]


def test_fixture_002_errors_found():
    report = analyze_turns(_fixture_turns(2))
    assert report["verdict"] == "ARITHMETIC_ERRORS_FOUND"
    assert report["counts"]["detected"] == 2
    assert report["counts"]["incorrect"] == 1
    assert report["counts"]["correct"] == 1
    assert report["review_action"] == "recompute spoken totals in the goal template before deployment"


def test_fixture_003_percent_error_duration_correct():
    report = analyze_turns(_fixture_turns(3))
    assert report["verdict"] == "ARITHMETIC_ERRORS_FOUND"
    assert report["counts"]["detected"] == 2
    assert report["counts"]["incorrect"] == 1
    kinds = _kinds(report)
    assert "percent_off" in kinds and "duration" in kinds


def test_fixture_004_unverifiable_only():
    report = analyze_turns(_fixture_turns(4))
    assert report["verdict"] == "UNVERIFIABLE_COMPUTATIONS_ONLY"
    assert report["counts"] == {"detected": 2, "correct": 0, "incorrect": 0, "unverifiable": 2}
    assert report["review_action"] == "state the factors aloud before the total so arithmetic can be verified"
    assert all(c["status"] == "UNVERIFIABLE" for c in report["computations"])


def test_fixture_005_no_spoken_computations():
    report = analyze_turns(_fixture_turns(5))
    assert report["verdict"] == "NO_SPOKEN_COMPUTATIONS"
    assert report["counts"]["detected"] == 0
    assert report["review_action"] == "none"


def test_wrapped_fixture_001_same_verdict():
    payload = {
        "status": "COMPLETED",
        "result": {
            "call_id": "demo-arith-001",
            "transcript": _fixture_turns(1),
            "post_summary": "Reservation confirmed.",
        },
    }
    report = analyze_payload(payload)
    assert report["verdict"] == "ALL_COMPUTATIONS_CORRECT"
    assert report["call_id"] == "demo-arith-001"


def test_empty_transcript_no_computations():
    report = analyze_payload({"transcript": []})
    assert report["verdict"] == "NO_SPOKEN_COMPUTATIONS"
    assert report["review_action"] == "none"


# ---------------------------------------------------------------- mask_pii / report

def test_masked_phone_in_report_sentence():
    turns = _turns(("agent", "Your confirmation number is +1 415 555 0135, and the total comes to 12 dollars."))
    report = analyze_turns(turns)
    assert report["computations"], "expected at least one computation"
    sentence = report["computations"][0]["sentence"]
    assert "415" not in sentence
    assert "*" in sentence


def test_report_keys_shape():
    report = analyze_turns(_fixture_turns(1))
    assert set(report.keys()) == {"skill", "mode", "call_id", "verdict", "computations", "counts", "review_action"}
    comp = report["computations"][0]
    assert set(comp.keys()) == {
        "turn_index", "kind", "sentence", "factors",
        "stated_result", "computed_result", "delta", "status", "reason",
    }
    assert report["mode"] == "analyze"


def test_verdict_priority_errors_beat_correct():
    turns = _turns(
        ("agent", "I see 3 nights at 120 dollars a night, so that comes to 360 dollars total."),
        ("agent", "But with the fee, 360 and 45 comes to 999 dollars."),
    )
    report = analyze_turns(turns)
    assert report["verdict"] == "ARITHMETIC_ERRORS_FOUND"


# ---------------------------------------------------------------- review round 1 regressions

def test_duration_minutes_included_half_hour():
    turns = _turns(("agent", "Your slot runs from 2 p.m. to 4:30 p.m., that's 2.5 hours."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "duration"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 2.5


def test_duration_whole_hours_am_still_correct():
    turns = _turns(("agent", "Your slot runs from 9 a.m. to 11 a.m., that's 2 hours."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "duration"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 2.0


def test_duration_noon_12pm():
    turns = _turns(("agent", "Your slot runs from 12 p.m. to 3 p.m., that's 3 hours."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "duration"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 3.0


def test_pii_digit_run_not_amount_operand():
    turns = _turns((
        "agent",
        "Your card ending 4111111111111 was charged 420 dollars total, that comes to 420 dollars.",
    ))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    operands = comp["factors"].get("operands", [])
    assert all(op < 10000 for op in operands), operands
    assert comp["status"] == "UNVERIFIABLE"
    sentence = comp["sentence"]
    assert "4111111111111" not in sentence
    assert "*" in sentence
    # mask_pii must be idempotent on already-masked output
    assert mask_pii(sentence) == sentence


def test_total_only_classification_bare_total():
    turns = _turns(("agent", "Your total comes to 42 dollars."))
    report = analyze_turns(turns)
    assert report["counts"]["detected"] == 1
    comp = report["computations"][0]
    assert comp["kind"] == "total_only"
    assert comp["factors"] == {}
    assert comp["status"] == "UNVERIFIABLE"
    assert comp["reason"] == "FACTORS_MISSING"
    assert report["verdict"] == "UNVERIFIABLE_COMPUTATIONS_ONLY"


def test_fixture_004_first_computation_total_only():
    report = analyze_turns(_fixture_turns(4))
    assert report["computations"][0]["kind"] == "total_only"
    assert report["computations"][0]["status"] == "UNVERIFIABLE"


def test_percent_off_of_phrasing():
    turns = _turns(("agent", "10% off of 90 is 81 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "percent_off"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 81.0


def test_percent_off_so_result_even_suffix():
    turns = _turns(("agent", "Take 50 percent off the 60 dollar plan, so 30 dollars even."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "percent_off"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 30.0


def test_balance_cue_remains():
    turns = _turns(("agent", "The deposit is 100 dollars of the 500 dollar total, so 400 dollars remains."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "subtract"
    assert comp["status"] == "CORRECT"
    assert comp["computed_result"] == 400.0


def test_two_digit_bare_operands_still_add():
    turns = _turns(("agent", "45 plus 45, totaling 90 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "add"
    assert comp["status"] == "CORRECT"
    assert comp["factors"]["operands"] == [45.0, 45.0]


def test_single_digit_bare_numbers_gated():
    turns = _turns(("agent", "Options 1 and 2 were declined, so the total comes to 45 dollars."))
    report = analyze_turns(turns)
    for comp in report["computations"]:
        assert 1.0 not in comp["factors"].get("operands", [])
        assert 2.0 not in comp["factors"].get("operands", [])


# ---------------------------------------------------------------- add_carry running-total continuation

def test_add_carry_probe_dialogue_fee_on_prior_subtotal():
    turns = _turns(
        ("agent", "You had 4 tickets at 45 dollars each, so that comes to 180 dollars even."),
        ("callee", "Okay."),
        ("agent", "With the 18 dollar service fee that totals to 220 dollars."),
    )
    report = analyze_turns(turns)
    assert report["computations"][0]["kind"] == "multiply"
    assert report["computations"][0]["status"] == "CORRECT"
    carry = report["computations"][1]
    assert carry["kind"] == "add_carry"
    assert carry["status"] == "INCORRECT"
    assert carry["computed_result"] == 198.0
    assert carry["stated_result"] == 220.0
    assert carry["delta"] == 22.0
    assert carry["factors"]["implicit_base"] == 180.0
    assert carry["factors"]["implicit_base_turn_index"] == 0
    assert carry["factors"]["operand"] == 18.0
    assert report["verdict"] == "ARITHMETIC_ERRORS_FOUND"


def test_add_carry_guard_no_fee_noun_stays_unverifiable():
    turns = _turns(
        ("agent", "I have you for 3 nights at 120 dollars a night, so that's 360 dollars total."),
        ("agent", "The 30 dollar gift card comes to 30 dollars."),
    )
    report = analyze_turns(turns)
    comp = report["computations"][1]
    assert comp["kind"] in ("add", "total_only")
    assert comp["status"] == "UNVERIFIABLE"
    assert comp["reason"] == "FACTORS_MISSING"


def test_add_carry_guard_no_prior_computation():
    turns = _turns(("agent", "With the 18 dollar service fee that totals to 220 dollars."))
    report = analyze_turns(turns)
    comp = report["computations"][0]
    assert comp["kind"] == "add"
    assert comp["status"] == "UNVERIFIABLE"
    assert comp["reason"] == "FACTORS_MISSING"


def test_add_carry_guard_prior_unverifiable_no_base():
    turns = _turns(
        ("agent", "Your total comes to 250 dollars."),
        ("agent", "With the 18 dollar service fee that totals to 268 dollars."),
    )
    report = analyze_turns(turns)
    kinds = [c["kind"] for c in report["computations"]]
    assert "add_carry" not in kinds
    assert report["computations"][1]["status"] == "UNVERIFIABLE"


# ---------------------------------------------------------------- CLI

MODULE = SCRIPTS / "arithmetic_accuracy_auditor.py"


def _run_cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(MODULE), *args],
        capture_output=True,
        text=True,
    )


def _write_file(tmp: Path, payload: object) -> Path:
    p = tmp / "call-result.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_cli_analyze_fixture_exit_0():
    proc = _run_cli("analyze", "--call-result", str(FIXTURES / "demo-arith-001.json"))
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "ALL_COMPUTATIONS_CORRECT"


def test_cli_missing_file_exit_2(tmp_path: Path):
    proc = _run_cli("analyze", "--call-result", str(tmp_path / "nope.json"))
    assert proc.returncode == 2


def test_cli_invalid_json_exit_2(tmp_path: Path):
    p = tmp_path / "broken.json"
    p.write_text("{not json", encoding="utf-8")
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 2


def test_cli_top_level_string_exit_2(tmp_path: Path):
    p = _write_file(tmp_path, "just a string")
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 2


def test_cli_missing_call_result_exit_2():
    proc = _run_cli("analyze")
    assert proc.returncode == 2


def test_cli_empty_transcript_exit_0(tmp_path: Path):
    p = _write_file(tmp_path, {"transcript": []})
    proc = _run_cli("analyze", "--call-result", str(p))
    assert proc.returncode == 0
    assert json.loads(proc.stdout)["verdict"] == "NO_SPOKEN_COMPUTATIONS"


def test_craft_valid_number(tmp_path: Path):
    proc = _run_cli("craft", "--number", "+14155550135", "--business-name", "Harbor Grill", "--task", "confirm the Friday reservation")
    assert proc.returncode == 0
    goal = json.loads(proc.stdout)["goal_template"]
    assert "factors" in goal["protocol"] or "total" in goal["protocol"]
    assert goal["to"] == "+14155550135"
    assert goal["language"] == "en-US"
    assert goal["description"].startswith("Harbor Grill:")


def test_craft_rejects_non_reserved(tmp_path: Path):
    proc = _run_cli("craft", "--number", "+19999999999")
    assert proc.returncode == 2


def test_craft_rejects_missing_number(tmp_path: Path):
    proc = _run_cli("craft")
    assert proc.returncode == 2


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
