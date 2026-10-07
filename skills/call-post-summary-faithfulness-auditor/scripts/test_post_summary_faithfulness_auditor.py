#!/usr/bin/env python3
"""Tests for call-post-summary-faithfulness-auditor (pytest + standalone runner)."""

from __future__ import annotations

import atexit
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import post_summary_faithfulness_auditor as mod

HERE = Path(__file__).resolve().parent


def _turn(spk, txt):
    return {"speaker": spk, "text": txt}


# ---------------------------------------------------------------------------
# Task 1: claim decomposition
# ---------------------------------------------------------------------------

def test_masked_spans_never_anchor():
    claims = mod.decompose_claims("Guest at +1 (415) 555-0196 confirmed.")
    assert all(c["kind"] != "numeric" or "555" not in c["text"] for c in claims)


def test_numeric_claim_dollars():
    claims = mod.decompose_claims("A deposit of $45 was collected.")
    assert any(c["kind"] == "numeric" and c["value"] == "45" for c in claims)


def test_dollars_word_folding():
    claims = mod.decompose_claims("The total came to 45 dollars.")
    assert any(c["kind"] == "numeric" and c["value"] == "45" for c in claims)


def test_spelled_number_is_non_checkable():
    claims = mod.decompose_claims("Party of four confirmed.")
    assert any(c["kind"] == "non_checkable_spelled" for c in claims)


def test_outcome_claim_detected():
    claims = mod.decompose_claims("The guest confirmed the reservation.")
    assert any(c["kind"] == "outcome" for c in claims)


def test_action_claim_detected():
    claims = mod.decompose_claims("A confirmation will be emailed.")
    assert any(c["kind"] == "action" for c in claims)


def test_opinion_non_checkable():
    claims = mod.decompose_claims("The customer was pleased and cooperative.")
    assert claims and all(c["kind"] == "non_checkable_opinion" for c in claims)


# ---------------------------------------------------------------------------
# Task 2: anchoring + verdict engine
# ---------------------------------------------------------------------------

def _turns(*pairs):
    return [{"speaker": a, "text": b} for a, b in pairs]


def test_supported_numeric_anchor():
    claims = mod.decompose_claims("Deposit of $45 collected.")
    res = mod.anchor_claims(claims, _turns(("agent", "There is a $45 deposit."), ("callee", "Okay.")))
    assert res[0]["grade"] == "SUPPORTED"


def test_unsupported_when_absent():
    claims = mod.decompose_claims("Deposit of $45 collected.")
    res = mod.anchor_claims(claims, _turns(("agent", "Thanks, all set."), ("callee", "Great.")))
    assert res[0]["grade"] == "UNSUPPORTED"


def test_different_value_is_not_contradiction():
    claims = mod.decompose_claims("Deposit of $45 collected.")
    res = mod.anchor_claims(claims, _turns(("agent", "The total is $54, deposit $20."), ("callee", "Fine.")))
    assert res[0]["grade"] == "UNSUPPORTED"


def test_outcome_contradiction_positive_vs_decline():
    claims = mod.decompose_claims("The guest confirmed the booking.")
    turns = _turns(("agent", "So that is confirmed?"), ("callee", "Actually no, I can't make it, cancel it."))
    res = mod.anchor_claims(claims, turns)
    assert res[0]["grade"] == "CONTRADICTED"


def test_verdict_priority():
    turns = _turns(("agent", "Confirmed?"), ("callee", "No, cancel it."))
    v = mod.analyze(turns, "Guest confirmed. Total was $45.")
    assert v["verdict"] == "CONTRADICTED_CLAIMS"


def test_faithful_verdict():
    turns = _turns(("agent", "Party of 4 on Wednesday October 14 at 2 p.m., confirmed?"),
                   ("callee", "Yes, confirmed, see you then."))
    v = mod.analyze(turns, "Party of 4 confirmed for Wednesday, October 14 at 2 p.m.")
    assert v["verdict"] == "FAITHFUL"


def test_no_checkable_claims_empty_summary():
    v = mod.analyze(_turns(("agent", "Hello?")), "")
    assert v["verdict"] == "NO_CHECKABLE_CLAIMS" and v["reason"] == "summary_missing"


def test_date_prefix_no_false_support():
    claims = mod.decompose_claims("Booked for October 1.")
    res = mod.anchor_claims(claims, _turns(("agent", "October 14 works."), ("callee", "Great.")))
    c = [x for x in res if x["kind"] == "date_time" and x["value"] == "oct 1"][0]
    assert c["grade"] == "UNSUPPORTED"


def test_time_substring_no_false_support():
    claims = mod.decompose_claims("Reservation at 2 p.m.")
    res = mod.anchor_claims(claims, _turns(("agent", "Meet at 12 p.m."), ("callee", "Ok.")))
    c = [x for x in res if x["kind"] == "date_time"][0]
    assert c["grade"] == "UNSUPPORTED"


def test_day_first_date_claim_and_anchor():
    claims = mod.decompose_claims("Reservation for 14 October.")
    assert any(x["kind"] == "date_time" and x["value"] == "oct 14" for x in claims)
    res = mod.anchor_claims(claims, _turns(("agent", "We have October 14."), ("callee", "Great.")))
    assert [x for x in res if x["value"] == "oct 14"][0]["grade"] == "SUPPORTED"


def test_month_first_anchors_day_first_turn():
    claims = mod.decompose_claims("Reservation for October 14.")
    res = mod.anchor_claims(claims, _turns(("agent", "Sure, 14 October works."), ("callee", "Great.")))
    assert [x for x in res if x["value"] == "oct 14"][0]["grade"] == "SUPPORTED"


def test_slash_date_claim_and_anchor():
    claims = mod.decompose_claims("Booked for 10/14.")
    assert any(x["kind"] == "date_time" and x["value"] == "oct 14" for x in claims)
    res = mod.anchor_claims(claims, _turns(("agent", "That is October 14."), ("callee", "Ok.")))
    assert [x for x in res if x["value"] == "oct 14"][0]["grade"] == "SUPPORTED"


def test_24h_clock_folds_to_meridiem_turn():
    claims = mod.decompose_claims("Reservation at 14:00.")
    assert any(x["kind"] == "date_time" and x["value"] == "14:00" for x in claims)
    res = mod.anchor_claims(claims, _turns(("agent", "We meet at 2 p.m."), ("callee", "Ok.")))
    assert [x for x in res if x["value"] == "14:00"][0]["grade"] == "SUPPORTED"


def test_12h_clock_anchors_24h_turn():
    claims = mod.decompose_claims("Reservation at 2 p.m.")
    res = mod.anchor_claims(claims, _turns(("agent", "Meet at 14:00."), ("callee", "Ok.")))
    assert [x for x in res if x["kind"] == "date_time"][0]["grade"] == "SUPPORTED"


def test_masked_only_sentence_non_checkable_masked():
    claims = mod.decompose_claims(mod.mask_pii("Customer reached at 415-555-0196."))
    assert any(c["kind"] == "non_checkable_masked" for c in claims)


def test_kind_absent_reason():
    claims = mod.decompose_claims("Fee is $75.")
    res = mod.anchor_claims(claims, _turns(("agent", "Thanks for your patience."), ("callee", "Appreciated.")))
    c = res[0]
    assert c["grade"] == "UNSUPPORTED" and c.get("reason") == "kind_absent_from_transcript"


def test_kind_present_no_absent_reason():
    claims = mod.decompose_claims("Fee is $75.")
    res = mod.anchor_claims(claims, _turns(("agent", "It was $70 total."), ("callee", "Fine.")))
    c = res[0]
    assert c["grade"] == "UNSUPPORTED" and "reason" not in c


def test_coverage_gap_advisory():
    turns = _turns(("agent", "Confirmed for October 14?"), ("callee", "Yes, confirmed."))
    v = mod.analyze(turns, "The call ended politely.")
    assert v["coverage_gaps"] == ["outcome"]


# ---------------------------------------------------------------------------
# Task 3: CLI analyze + craft
# ---------------------------------------------------------------------------

def _run(args):
    return subprocess.run(
        [sys.executable, str(HERE / "post_summary_faithfulness_auditor.py"), *args],
        capture_output=True, text=True,
    )


_TMP: Path | None = None


def _tmp_dir() -> Path:
    # System temp, outside the repo; removed at process exit so the working
    # tree stays clean after a full run.
    global _TMP
    if _TMP is None:
        _TMP = Path(tempfile.mkdtemp(prefix="psfa-tests-"))
        atexit.register(shutil.rmtree, _TMP, ignore_errors=True)
    return _TMP


def _tmp_wrapped():
    p = _tmp_dir() / "wrapped.json"
    p.write_text(json.dumps({
        "call_id": "cli-wrapped-001", "status": "COMPLETED",
        "result": {
            "post_summary": "Guest confirmed party of 4 for October 14.",
            "transcript": [
                {"speaker": "agent", "text": "Party of 4 on October 14, confirmed?"},
                {"speaker": "callee", "text": "Yes, confirmed."},
            ],
        },
    }), encoding="utf-8")
    return p


def test_cli_wrapped_shape_real_get_call_run():
    p = _run(["analyze", "--call-result", str(_tmp_wrapped())])
    assert p.returncode == 0, p.stderr
    card = json.loads(p.stdout)
    assert card["verdict"] == "FAITHFUL" and "disclaimer" in card and card["call_id"] == "cli-wrapped-001"


def test_cli_exit2_invalid_json():
    bad = _tmp_dir() / "bad.json"
    bad.write_text("{oops", encoding="utf-8")
    assert _run(["analyze", "--call-result", str(bad)]).returncode == 2


def test_cli_exit2_json_array():
    arr = _tmp_dir() / "arr.json"
    arr.write_text("[]", encoding="utf-8")
    assert _run(["analyze", "--call-result", str(arr)]).returncode == 2


def test_cli_exit2_missing_arg():
    assert _run(["analyze"]).returncode == 2


def test_cli_flat_shape():
    p = _tmp_dir() / "flat.json"
    p.write_text(json.dumps({
        "call_id": "cli-flat-001", "status": "COMPLETED",
        "post_summary": "Guest confirmed party of 4 for October 14.",
        "transcript": [
            {"speaker": "agent", "text": "Party of 4 on October 14, confirmed?"},
            {"speaker": "callee", "text": "Yes, confirmed."},
        ],
    }), encoding="utf-8")
    r = _run(["analyze", "--call-result", str(p)])
    assert r.returncode == 0 and json.loads(r.stdout)["verdict"] == "FAITHFUL"


def test_cli_craft_contains_policy():
    p = _run(["craft", "--task", "confirm the reservation", "--facts", "party of 4, October 14, 2 p.m."])
    assert p.returncode == 0 and "only what was spoken" in p.stdout.lower()


def test_cli_craft_empty_task_exit2():
    r = _run(["craft", "--task", "   ", "--facts", "x"])
    assert r.returncode == 2
    assert "task must not be empty" in r.stderr


# ---------------------------------------------------------------------------
# Edge behaviors: transcript shapes and opinion-only summaries
# ---------------------------------------------------------------------------

def test_transcript_as_plain_string():
    # A raw string transcript normalizes to a single agent turn.
    p = _tmp_dir() / "str-transcript.json"
    p.write_text(json.dumps({
        "call_id": "cli-str-001", "status": "COMPLETED",
        "post_summary": "Confirmed for October 14.",
        "transcript": "Agent: confirmed for October 14",
    }), encoding="utf-8")
    r = _run(["analyze", "--call-result", str(p)])
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "FAITHFUL" and card["call_id"] == "cli-str-001"


def test_transcript_null():
    # A null transcript means zero turns; date claims grade UNSUPPORTED with
    # the kind_absent reason instead of crashing.
    p = _tmp_dir() / "null-transcript.json"
    p.write_text(json.dumps({
        "call_id": "cli-null-001", "status": "COMPLETED",
        "post_summary": "Confirmed for October 14.",
        "transcript": None,
    }), encoding="utf-8")
    r = _run(["analyze", "--call-result", str(p)])
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "UNSUPPORTED_CLAIMS"
    date_claims = [c for c in card["claims"] if c["kind"] == "date_time"]
    assert date_claims and all(
        c["grade"] == "UNSUPPORTED" and c.get("reason") == "kind_absent_from_transcript"
        for c in date_claims
    )


def test_transcript_mixed_list_skips_non_dicts():
    # Non-dict items in the transcript list are skipped, not fatal.
    p = _tmp_dir() / "mixed-transcript.json"
    p.write_text(json.dumps({
        "call_id": "cli-mixed-001", "status": "COMPLETED",
        "post_summary": "Confirmed for October 14.",
        "transcript": [
            "Agent: plain string turn, not a dict",
            {"speaker": "agent", "text": "Confirmed for October 14?"},
            {"speaker": "callee", "text": "Yes, confirmed."},
        ],
    }), encoding="utf-8")
    r = _run(["analyze", "--call-result", str(p)])
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "FAITHFUL" and card["call_id"] == "cli-mixed-001"


def test_opinion_only_reason():
    # A summary with zero checkable claims routes NO_CHECKABLE_CLAIMS with
    # reason opinion_only.
    v = mod.analyze(_turns(("agent", "Thanks for your time.")), "The customer seemed satisfied and was polite throughout.")
    assert v["verdict"] == "NO_CHECKABLE_CLAIMS" and v["reason"] == "opinion_only"


# ---------------------------------------------------------------------------
# Task 4: fixtures
# ---------------------------------------------------------------------------

_REFS = HERE.parent / "references"


def _analyze_fixture(name):
    return _run(["analyze", "--call-result", str(_REFS / name)])


def test_decimal_amount_anchors_turn_decimal():
    claims = mod.decompose_claims("Paid $45.50.")
    res = mod.anchor_claims(claims, _turns(("agent", "You paid 45.50 dollars."), ("callee", "Ok.")))
    assert res[0]["grade"] == "SUPPORTED"


def test_decimal_amount_anchors_plain_run():
    claims = mod.decompose_claims("Total 45.50 dollars.")
    res = mod.anchor_claims(claims, _turns(("agent", "The total is 45.50."), ("callee", "Ok.")))
    assert res[0]["grade"] == "SUPPORTED"


def test_mask_tail_no_numeric_leak():
    claims = mod.decompose_claims(mod.mask_pii("Reference 123456 78 minutes were logged."))
    assert not any(c["kind"] == "numeric" and c["value"] == "78" for c in claims)


def test_call_us_back_outcome_anchor():
    claims = mod.decompose_claims("Agent will call back tomorrow.")
    res = mod.anchor_claims(
        claims, _turns(("agent", "We will follow up."), ("callee", "She said she would call us back."))
    )
    c = [x for x in res if x["kind"] == "outcome"][0]
    assert c["grade"] == "SUPPORTED"


def test_contradiction_records_turn():
    claims = mod.decompose_claims("The guest confirmed the booking.")
    turns = _turns(
        ("agent", "So that is confirmed?"),
        ("callee", "Hi."),
        ("callee", "Actually no, I can't make it, cancel it."),
    )
    res = mod.anchor_claims(claims, turns)
    assert res[0]["grade"] == "CONTRADICTED" and res[0]["contradicted_by_turn"] == 2


def test_outcome_affirmative_ack_support():
    claims = mod.decompose_claims("Customer accepted.")
    turns = _turns(
        ("agent", "Thanks for staying with us."),
        ("callee", "Hi."),
        ("callee", "Yep, lock it in."),
    )
    res = mod.anchor_claims(claims, turns)
    c = [x for x in res if x["kind"] == "outcome"][0]
    assert c["grade"] == "SUPPORTED" and c["turn_index"] == 2


def test_fixture_faithful():
    r = _analyze_fixture("example-call-result.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "FAITHFUL" and card["call_id"] == "demo-faithful-001"


def test_fixture_unsupported():
    r = _analyze_fixture("example-call-result-unsupported.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "UNSUPPORTED_CLAIMS"
    unsupported = [c for c in card["claims"] if c["grade"] == "UNSUPPORTED"]
    assert len(unsupported) >= 2


def test_fixture_contradicted():
    r = _analyze_fixture("example-call-result-contradicted.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "CONTRADICTED_CLAIMS" and card["call_id"] == "demo-faithful-003"


def test_fixture_flat_shape():
    r = _analyze_fixture("example-call-result-flat.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "FAITHFUL" and card["call_id"] == "demo-faithful-004"


def test_fixture_no_checkable():
    r = _analyze_fixture("example-call-result-no-checkable.json")
    assert r.returncode == 0, r.stderr
    card = json.loads(r.stdout)
    assert card["verdict"] == "NO_CHECKABLE_CLAIMS" and card["reason"] == "opinion_only"
    assert card["call_id"] == "demo-faithful-005"


# ---------------------------------------------------------------------------
# Standalone runner (must stay LAST)
# ---------------------------------------------------------------------------

def _run_all() -> int:
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
