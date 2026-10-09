#!/usr/bin/env python3
"""Tests for call-correction-propagation-auditor (pytest + standalone runner)."""

from __future__ import annotations

import atexit
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

import correction_propagation_auditor as mod

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "correction_propagation_auditor.py"


def _turn(spk, txt):
    return {"speaker": spk, "text": txt}


# ---------------------------------------------------------------------------
# Parser / masking / CLI trio
# ---------------------------------------------------------------------------

def test_mask_keeps_short_runs():
    text = "Party of 4 on 10/14 at 7 p.m., 2026."
    assert mod.mask_pii(text) == text


def test_mask_masks_7plus_digit_runs_keep_last_2():
    assert mod.mask_pii("+14155550151") == "+#########51"
    assert mod.mask_pii("call 415-555-0151 now") == "call ##########51 now"


def test_load_nested_wrapped_shape():
    p = _write_json("wrapped.json", {
        "call_id": "w-1", "status": "COMPLETED",
        "result": {
            "post_summary": "Booked for Thursday.",
            "transcript": [{"speaker": "agent", "text": "Hi."}],
        },
    })
    rec = mod.load_call_result(p)
    assert rec["call_id"] == "w-1"
    assert rec["post_summary"] == "Booked for Thursday."
    assert rec["turns"] == [{"speaker": "agent", "text": "Hi."}]


def test_load_flat_shape():
    p = _write_json("flat.json", {
        "call_id": "f-1",
        "post_summary": "Booked.",
        "transcript": [{"speaker": "callee", "text": "Okay."}],
    })
    rec = mod.load_call_result(p)
    assert rec["call_id"] == "f-1" and rec["post_summary"] == "Booked."
    assert rec["turns"] == [{"speaker": "callee", "text": "Okay."}]


def test_load_string_transcript():
    p = _write_json("str.json", {"call_id": "s-1", "post_summary": "", "transcript": "One line."})
    rec = mod.load_call_result(p)
    assert rec["turns"] == [{"speaker": "agent", "text": "One line."}]


def test_load_mixed_list_skips_non_dicts_and_defaults_text():
    p = _write_json("mixed.json", {
        "post_summary": "x",
        "transcript": [{"speaker": "agent", "text": "Hi."}, 5, "junk", {"speaker": "agent"}],
    })
    rec = mod.load_call_result(p)
    assert rec["turns"] == [
        {"speaker": "agent", "text": "Hi."},
        {"speaker": "agent", "text": ""},
    ]


def test_cli_invalid_json_array_exits_2_with_error():
    p = _write_json("arr.json", [1, 2, 3])
    proc = _run_cli(["analyze", "--call-result", str(p)])
    assert proc.returncode == 2
    assert "error" in proc.stderr


def test_cli_missing_call_result_exits_2():
    with pytest.raises(SystemExit) as exc:
        mod.main(["analyze"])
    assert exc.value.code == 2


# ---------------------------------------------------------------------------
# Core: detection, chains, propagation, confirmation
# ---------------------------------------------------------------------------

def test_explicit_sorry_i_said_weekday_propagated():
    turns = [
        _turn("agent", "Your table is set for Tuesday. Sorry, I said Tuesday; I meant Thursday."),
        _turn("callee", "Thursday works."),
        _turn("agent", "Great, see you Thursday."),
    ]
    card = mod.analyze(turns, "Reservation confirmed for Thursday.")
    assert card["verdict"] == "PROPAGATED"
    corr = card["corrections"][0]
    assert corr["old_value"] == "tuesday" and corr["new_value"] == "thursday"
    assert corr["kind"] == "weekday" and corr["confirmed"] is True


def test_not_x_but_y_money_propagated():
    turns = [
        _turn("agent", "The deposit is not $20, but $45 total."),
        _turn("callee", "Yes, $45 is fine."),
        _turn("agent", "Perfect, $45 it is."),
    ]
    card = mod.analyze(turns, "Deposit of $45 collected.")
    assert card["verdict"] == "PROPAGATED"
    corr = card["corrections"][0]
    assert corr["marker"] == "not_x_but_y" and corr["kind"] == "money"
    assert corr["old_value"] == "$20" and corr["new_value"] == "$45"


def test_proximity_old_from_previous_agent_turn():
    turns = [
        _turn("agent", "The total comes to $54."),
        _turn("callee", "Wow, okay."),
        _turn("agent", "Actually, it's $45 with the discount."),
        _turn("callee", "Got it, $45."),
        _turn("agent", "Thanks!"),
    ]
    card = mod.analyze(turns, "Charged $45.")
    assert card["verdict"] == "PROPAGATED"
    assert card["corrections"][0]["old_value"] == "$54"


def test_chain_extends_twice_same_chain():
    turns = [
        _turn("agent", "Your pickup is Tuesday. Sorry, I meant Thursday."),
        _turn("callee", "Okay, Thursday."),
        _turn("agent", "Actually, correction: Friday at 2 p.m. works better."),
        _turn("callee", "Friday is perfect."),
        _turn("agent", "Great, Friday at 2 p.m. then."),
    ]
    card = mod.analyze(turns, "Pickup Friday at 14:00.")
    assert card["verdict"] == "PROPAGATED"
    assert any(c["final_value"] == "friday" for c in card["summary_checks"])
    assert all(c["outcome"] != "stale" for c in card["summary_checks"])


def test_stale_value_in_summary():
    turns = [
        _turn("agent", "We reserved Tuesday. Sorry, I meant Thursday."),
        _turn("callee", "Thursday, yes."),
        _turn("agent", "Thursday confirmed."),
    ]
    card = mod.analyze(turns, "Table booked for Tuesday.")
    assert card["verdict"] == "STALE_VALUE_IN_SUMMARY"
    assert card["summary_checks"][0]["outcome"] == "stale"


def test_ambiguous_outcome_both_values_in_summary():
    turns = [
        _turn("agent", "We reserved Tuesday. Sorry, I meant Thursday."),
        _turn("callee", "Thursday, yes."),
        _turn("agent", "Thursday confirmed."),
    ]
    card = mod.analyze(turns, "Booked for Tuesday, corrected to Thursday.")
    assert card["summary_checks"][0]["outcome"] == "ambiguous"


def test_unreported_chain_advisory():
    turns = [
        _turn("agent", "We reserved Tuesday. Sorry, I meant Thursday."),
        _turn("callee", "Thursday, yes."),
        _turn("agent", "Thursday confirmed."),
    ]
    card = mod.analyze(turns, "Reservation confirmed.")
    assert card["verdict"] == "PROPAGATED"
    assert any(a.startswith("unreported_chain") for a in card["advisories"])


def test_unconfirmed_correction_verdict():
    turns = [
        _turn("agent", "Tuesday. Sorry, I meant Thursday."),
        _turn("callee", "Hmm, okay."),
        _turn("agent", "Anything else?"),
    ]
    card = mod.analyze(turns, "Booked for Thursday.")
    assert card["verdict"] == "CORRECTIONS_UNCONFIRMED"
    assert card["counts"]["unconfirmed"] == 1


def test_agent_restate_later_confirms():
    turns = [
        _turn("agent", "Your pickup is Tuesday. Sorry, I meant Thursday."),
        _turn("callee", "Mmhmm."),
        _turn("agent", "One more thing - your pickup is Thursday at 9 a.m."),
    ]
    card = mod.analyze(turns, "Thursday 09:00 pickup.")
    assert card["verdict"] == "PROPAGATED"
    assert card["corrections"][0]["confirmed"] is True


def test_callee_ack_outside_window_unconfirmed():
    turns = [
        _turn("agent", "Your pickup is scheduled for Tuesday."),
        _turn("agent", "Sorry, I meant Thursday."),
        _turn("callee", "Hmm."),
        _turn("agent", "Also, parking is free."),
        _turn("callee", "Thursday, right, got it."),
    ]
    card = mod.analyze(turns, "Pickup on Thursday.")
    assert card["verdict"] == "CORRECTIONS_UNCONFIRMED"


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_TMP: Path | None = None


def _tmp_dir() -> Path:
    # System temp, outside the repo; removed at process exit so the working
    # tree stays clean after a full run.
    global _TMP
    if _TMP is None:
        _TMP = Path(tempfile.mkdtemp(prefix="ccpa-tests-"))
        atexit.register(shutil.rmtree, _TMP, ignore_errors=True)
    return _TMP


def _write_json(name: str, payload) -> Path:
    p = _tmp_dir() / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def _run_cli(argv: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *argv],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _run_all():
    failures = 0
    tests = [(k, v) for k, v in globals().items() if k.startswith("test_") and callable(v)]
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
    print(f"{len(tests) - failures}/{len(tests)} tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(_run_all())
