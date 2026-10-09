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
        _turn("callee", "Hmm, let me check."),
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
# Adversarial review: missaid fallback, y-not-x, marker recall, boundaries
# ---------------------------------------------------------------------------

def test_missaid_old_falls_back_to_proximity_not_new_value():
    # BLOCKER 1: naive old-candidate search picks "thursday" (== new), so a
    # stale "Tuesday" summary would pass as PROPAGATED.
    turns = [
        _turn("agent", "Tuesday. I missaid the date; I meant Thursday."),
        _turn("callee", "Thursday, yes."),
        _turn("agent", "Great."),
    ]
    card = mod.analyze(turns, "Booked for Tuesday.")
    assert card["verdict"] == "STALE_VALUE_IN_SUMMARY"
    corr = card["corrections"][0]
    assert corr["old_value"] == "tuesday" and corr["new_value"] == "thursday"


def test_y_not_x_reversed_order_stale():
    # BLOCKER 2: "it's X not Y" carries both values in reversed order.
    turns = [
        _turn("agent", "Party of 4. Sorry, correction, it's 2 guests not 4."),
        _turn("callee", "Got it, 2."),
        _turn("agent", "Yes."),
    ]
    card = mod.analyze(turns, "Party of 4 confirmed.")
    assert card["verdict"] == "STALE_VALUE_IN_SUMMARY"
    corr = card["corrections"][0]
    assert corr["marker"] == "y_not_x" and corr["kind"] == "count"
    assert corr["old_value"] == "4" and corr["new_value"] == "2"


def test_i_have_misspoken_marker():
    turns = [
        _turn("agent", "The fee is $20. I have misspoken; the correct total is $45."),
        _turn("callee", "Yes, $45."),
        _turn("agent", "Great."),
    ]
    card = mod.analyze(turns, "Fee is $45.")
    assert card["verdict"] == "PROPAGATED"
    corr = card["corrections"][0]
    assert corr["marker"] == "my_mistake"
    assert corr["old_value"] == "$20" and corr["new_value"] == "$45"


def test_thats_incorrect_marker():
    turns = [
        _turn("agent", "Your delivery is on Tuesday. That's incorrect, it's Friday."),
        _turn("callee", "Friday, got it."),
        _turn("agent", "Friday it is."),
    ]
    card = mod.analyze(turns, "Delivery on Friday.")
    assert card["verdict"] == "PROPAGATED"
    corr = card["corrections"][0]
    assert corr["marker"] == "incorrect"
    assert corr["old_value"] == "tuesday" and corr["new_value"] == "friday"


def test_let_me_correct_that_marker():
    turns = [
        _turn("agent", "Your appointment is at 6 p.m. Let me correct that: 7 p.m."),
        _turn("callee", "7 p.m. works."),
        _turn("agent", "Great."),
    ]
    card = mod.analyze(turns, "Appointment at 19:00.")
    assert card["verdict"] == "PROPAGATED"
    corr = card["corrections"][0]
    assert corr["marker"] == "let_me_correct"
    assert corr["old_value"] == "18:00" and corr["new_value"] == "19:00"


def test_actually_the_total_is_value():
    turns = [
        _turn("agent", "You owe $54. Actually the total is $45 with the discount."),
        _turn("callee", "Got it, $45."),
        _turn("agent", "Thanks."),
    ]
    card = mod.analyze(turns, "Charged $45.")
    assert card["verdict"] == "PROPAGATED"
    corr = card["corrections"][0]
    assert corr["marker"] == "actually_its"
    assert corr["old_value"] == "$54" and corr["new_value"] == "$45"


def test_scratch_pending_new_value_in_next_sentence():
    # "Scratch that" with no value in the marker sentence stays pending;
    # the new value is the first one after the marker sentence.
    turns = [
        _turn("agent", "You're booked for Tuesday. Scratch that. Thursday works better."),
        _turn("callee", "Thursday then."),
        _turn("agent", "Great."),
    ]
    card = mod.analyze(turns, "Booked for Thursday.")
    assert card["verdict"] == "PROPAGATED"
    corr = card["corrections"][0]
    assert corr["marker"] == "scratch"
    assert corr["old_value"] == "tuesday" and corr["new_value"] == "thursday"


def test_scratch_in_sentence_value_is_superseded_old():
    # "Scratch the Tuesday part" names the value being REMOVED, not the new one.
    turns = [
        _turn("agent", "Tuesday works? Great. Actually, scratch the Tuesday part. Let's do Friday instead."),
        _turn("callee", "Friday, yes."),
        _turn("agent", "Friday it is."),
    ]
    card = mod.analyze(turns, "Booked for Tuesday.")
    assert card["verdict"] == "STALE_VALUE_IN_SUMMARY"
    corr = card["corrections"][0]
    assert corr["marker"] == "scratch"
    assert corr["old_value"] == "tuesday" and corr["new_value"] == "friday"
    check = card["summary_checks"][0]
    assert check["outcome"] == "stale" and "tuesday" in check["stale_values_in_summary"]


def test_scratch_in_sentence_value_without_later_new_value_no_event():
    # Conservative: with no value later in the turn, the replacement cannot be
    # determined deterministically, so no correction event fires.
    turns = [
        _turn("agent", "You're booked for Tuesday. Scratch the Tuesday part."),
        _turn("callee", "Okay."),
        _turn("agent", "Great."),
    ]
    card = mod.analyze(turns, "Booked for Tuesday.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"
    assert card["corrections"] == []


def test_weekday_possessive_in_summary_not_matched():
    # Boundary rule: a weekday followed by ' or a letter is a different token
    # ("Tuesday's") and never matches a superseded/final weekday value.
    turns = [
        _turn("agent", "We reserved Tuesday. Sorry, I said Tuesday; I meant Thursday."),
        _turn("callee", "Thursday, yes."),
        _turn("agent", "Thursday confirmed."),
    ]
    card = mod.analyze(turns, "Tuesday's booking stands.")
    assert card["summary_checks"][0]["outcome"] == "unreported"
    assert card["verdict"] == "PROPAGATED"
    assert any(a.startswith("unreported_chain: thursday") for a in card["advisories"])


def test_ack_okay_confirms_chain():
    turns = [
        _turn("agent", "Your pickup is Tuesday. Sorry, I meant Thursday."),
        _turn("callee", "Okay."),
        _turn("agent", "Great."),
    ]
    card = mod.analyze(turns, "Pickup Thursday.")
    assert card["corrections"][0]["confirmed"] is True
    assert card["verdict"] == "PROPAGATED"


# ---------------------------------------------------------------------------
# Guard tests: false-positive suppression
# ---------------------------------------------------------------------------

def test_guard_question_sentence_skipped():
    card = mod.analyze([_turn("agent", "What I mean is, are you free on Friday?")], "Follow-up needed.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_guard_actually_positive_news():
    card = mod.analyze([_turn("agent", "Actually, great news! Your table is ready.")], "Table ready.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_guard_bare_sorry_not_a_correction():
    card = mod.analyze([_turn("agent", "Sorry about the wait. Your table for 4 is ready.")], "Table ready.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_guard_questioned_correction_skipped():
    card = mod.analyze([_turn("agent", "You said the 4th, did you mean the 5th?")], "Follow-up needed.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_guard_callee_self_correction_ignored():
    turns = [
        _turn("agent", "Your table is set for Tuesday."),
        _turn("callee", "Wait, sorry, I said Tuesday; I meant Thursday."),
    ]
    card = mod.analyze(turns, "Reservation confirmed for Tuesday.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_guard_other_correction_not_agent_self_correction():
    turns = [
        _turn("agent", "So that's Tuesday."),
        _turn("callee", "No, Thursday."),
        _turn("agent", "Thursday, my apologies for the confusion."),
    ]
    card = mod.analyze(turns, "Booked for Thursday.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_guard_masked_phone_values_skipped():
    card = mod.analyze(
        [_turn("agent", "I have +14155550151. Sorry, I meant +14155550153.")],
        "Number on file.",
    )
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_no_turns_reason_transcript_missing():
    card = mod.analyze([], "Reservation confirmed for Thursday.")
    assert card["verdict"] == "NO_SELF_CORRECTIONS"
    assert card["reason"] == "transcript_missing"


def test_empty_summary_advisory_summary_missing():
    turns = [
        _turn("agent", "Your table is set for Tuesday. Sorry, I said Tuesday; I meant Thursday."),
        _turn("callee", "Thursday works."),
        _turn("agent", "Great, see you Thursday."),
    ]
    card = mod.analyze(turns, "")
    assert card["verdict"] == "PROPAGATED"
    assert "summary_missing" in card["advisories"]
    assert card["summary_checks"] == []


def test_date_forms_october_ordinal():
    turns = [
        _turn("agent", "Your slot is October 14th. Sorry, I meant October 15th."),
        _turn("callee", "The 15th, yes."),
        _turn("agent", "Done."),
    ]
    card = mod.analyze(turns, "Booked for Oct 15.")
    assert card["verdict"] == "PROPAGATED"
    assert card["corrections"][0]["old_value"] == "oct-14"
    assert card["corrections"][0]["new_value"] == "oct-15"


def test_slash_date_and_clock():
    turns = [
        _turn("agent", "That's 10/14 at 2 p.m. Correction: 10/15 at 9 a.m."),
        _turn("callee", "Okay, October 15 at 9 a.m. works for us."),
        _turn("agent", "Great, see you then."),
    ]
    card = mod.analyze(turns, "Rescheduled to 10/15 09:00.")
    assert card["verdict"] == "PROPAGATED"
    assert card["corrections"][0]["old_value"] == "oct-14"


def test_boundary_oct_14_not_in_oct_140():
    turns = [
        _turn("agent", "You're booked for oct 1. Sorry, I meant oct 14."),
        _turn("callee", "The 14th, yes."),
        _turn("agent", "Right."),
    ]
    card = mod.analyze(turns, "Booked for oct 140.")
    assert card["summary_checks"][0]["outcome"] == "unreported"
    assert card["verdict"] == "PROPAGATED"
    assert any(a.startswith("unreported_chain") for a in card["advisories"])


# ---------------------------------------------------------------------------
# Extras: split safety, adjacency, craft, CLI real shape
# ---------------------------------------------------------------------------

def test_am_pm_safe_sentence_split_survives():
    turns = [
        _turn("agent", "Your appointment is at 2:30 p.m. Sorry, I meant 3 p.m."),
        _turn("callee", "3 p.m. confirmed."),
        _turn("agent", "See you at 3 p.m."),
    ]
    card = mod.analyze(turns, "Appointment at 15:00.")
    corr = card["corrections"]
    assert corr and corr[0]["kind"] == "clock"
    assert corr[0]["old_value"] == "14:30" and corr[0]["new_value"] == "15:00"
    assert card["verdict"] == "PROPAGATED"


def test_consecutive_agent_turns_proximity():
    turns = [
        _turn("agent", "The total comes to $54."),
        _turn("agent", "Actually, it's $45 with the discount."),
        _turn("callee", "Got it, $45."),
    ]
    card = mod.analyze(turns, "Charged $45.")
    assert card["corrections"][0]["old_value"] == "$54"
    assert card["verdict"] == "PROPAGATED"


def test_craft_template_contains_restate():
    proc = _run_cli(["craft"])
    assert proc.returncode == 0
    assert "re-state the corrected value" in proc.stdout
    assert "never a value you superseded" in proc.stdout


def test_cli_wrapped_real_shape_stale():
    p = _write_json("wrapped-stale.json", {
        "call_id": "cli-corr-001", "status": "COMPLETED",
        "result": {
            "post_summary": "Booked for Tuesday.",
            "transcript": [
                {"speaker": "agent", "text": "We reserved Tuesday. Sorry, I meant Thursday."},
                {"speaker": "callee", "text": "Thursday, yes."},
                {"speaker": "agent", "text": "Thursday confirmed."},
            ],
        },
    })
    proc = _run_cli(["analyze", "--call-result", str(p)])
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "STALE_VALUE_IN_SUMMARY"
    assert card["call_id"] == "cli-corr-001"
    assert card["skill"] == "call-correction-propagation-auditor"


# ---------------------------------------------------------------------------
# Reference fixtures (hand-traced against the CLI)
# ---------------------------------------------------------------------------

_REFERENCES = HERE.parent / "references"


def test_fixture_propagated():
    proc = _run_cli(["analyze", "--call-result", str(_REFERENCES / "example-call-result.json")])
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-correct-001"
    assert card["verdict"] == "PROPAGATED"
    assert card["counts"]["correction_events"] == 1


def test_fixture_stale():
    proc = _run_cli(["analyze", "--call-result", str(_REFERENCES / "example-call-result-stale.json")])
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-correct-002"
    assert card["verdict"] == "STALE_VALUE_IN_SUMMARY"


def test_fixture_none():
    proc = _run_cli(["analyze", "--call-result", str(_REFERENCES / "example-call-result-none.json")])
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-correct-003"
    assert card["verdict"] == "NO_SELF_CORRECTIONS"


def test_fixture_goal_matches_craft_template():
    goal = (_REFERENCES / "example-goal.txt").read_text(encoding="utf-8")
    assert goal == mod.craft_template()


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
