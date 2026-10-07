#!/usr/bin/env python3
"""Tests for the call-temporal-anchor-auditor skill.

Run:
    python3 -m pytest skills/call-temporal-anchor-auditor/scripts/test_call_temporal_anchor_auditor.py -v
    python3 skills/call-temporal-anchor-auditor/scripts/test_call_temporal_anchor_auditor.py
"""

from __future__ import annotations

import atexit
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
SKILL_DIR = SCRIPTS.parent
EXAMPLE_FULL = SKILL_DIR / "references" / "example-transcript.json"
EXAMPLE_CONFLICT = SKILL_DIR / "references" / "example-transcript-conflict.json"
EXAMPLE_RELATIVE = SKILL_DIR / "references" / "example-transcript-relative.json"
CALLED_AT = "2026-10-07T09:00:00-07:00"

_TMP_DIRS: list[str] = []


def _mktemp() -> Path:
    d = Path(tempfile.mkdtemp(prefix="ctaa-test-"))
    _TMP_DIRS.append(str(d))
    return d


def _cleanup_tmp() -> None:
    for d in _TMP_DIRS:
        shutil.rmtree(d, ignore_errors=True)


atexit.register(_cleanup_tmp)

sys.path.insert(0, str(SCRIPTS))
from call_temporal_anchor_auditor import (  # noqa: E402
    collect_expressions,
    craft_template,
    find_conflicts,
    load_call_result,
    load_transcript_list,
    main,
    mask_pii,
    parse_called_at,
)


def _turns(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"speaker": s, "text": t} for s, t in pairs]


def _classes(exprs: list[dict]) -> list[str]:
    return [e["class"] for e in exprs]


def _by_class(exprs: list[dict], cls: str) -> list[dict]:
    return [e for e in exprs if e["class"] == cls]


WEDNESDAY = parse_called_at("2026-10-07T09:00:00-07:00")


# ---------------------------------------------------------------- loading


def test_load_wrapped_shape():
    d = _mktemp()
    p = d / "r.json"
    p.write_text(
        json.dumps(
            {
                "status": "COMPLETED",
                "result": {"transcript": _turns(("agent", "hi"), ("callee", "hello"))},
            }
        ),
        encoding="utf-8",
    )
    data = load_call_result(p)
    assert data["turns"][1]["speaker"] == "callee"


def test_load_wraped_call_id():
    d = _mktemp()
    p = d / "r.json"
    p.write_text(json.dumps({"call_id": "run-x", "result": {"transcript": []}}), encoding="utf-8")
    assert load_call_result(p)["call_id"] == "run-x"


def test_load_call_result_array_raises():
    d = _mktemp()
    p = d / "arr.json"
    p.write_text(json.dumps([{"speaker": "agent"}]), encoding="utf-8")
    try:
        load_call_result(p)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


def test_load_transcript_bare_list():
    d = _mktemp()
    p = d / "t.json"
    p.write_text(json.dumps(_turns(("agent", "at 2 p.m."))), encoding="utf-8")
    data = load_transcript_list(p)
    assert data["turns"][0]["text"] == "at 2 p.m."
    assert data["call_id"] is None


def test_load_transcript_non_list_raises():
    d = _mktemp()
    p = d / "t.json"
    p.write_text(json.dumps({"transcript": []}), encoding="utf-8")
    try:
        load_transcript_list(p)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


# ---------------------------------------------------------------- called-at parsing


def test_parse_called_at_offset():
    dt = parse_called_at("2026-10-07T18:30:00+07:00")
    assert dt.year == 2026 and dt.month == 10 and dt.day == 7


def test_parse_called_at_z_suffix():
    assert parse_called_at("2026-10-07T09:00:00Z") is not None


def test_parse_called_at_invalid_raises():
    try:
        parse_called_at("not-a-date")
        raise AssertionError("expected ValueError")
    except ValueError:
        pass


# ---------------------------------------------------------------- masking


def test_mask_pii_keeps_last_two():
    assert mask_pii("call 5551234567 now") == "call ########67 now"


def test_mask_pii_short_runs_untouched():
    assert mask_pii("October 14 at 2 p.m.") == "October 14 at 2 p.m."


# ---------------------------------------------------------------- resolution


def test_resolve_tomorrow_from_wednesday():
    exprs = collect_expressions(_turns(("agent", "We will see you tomorrow.")), WEDNESDAY)[0]
    resolved = _by_class(exprs, "relative_resolved")
    assert len(resolved) == 1
    assert resolved[0]["value"] == "2026-10-08"


def test_resolve_bare_weekday_thursday():
    exprs = collect_expressions(_turns(("agent", "Can you do it on Thursday?")), WEDNESDAY)[0]
    derived = _by_class(exprs, "relative_derived")
    assert len(derived) == 1
    assert derived[0]["value"] == "2026-10-08"


def test_resolve_bare_weekday_tuesday_strictly_future():
    exprs = collect_expressions(_turns(("agent", "How about on Tuesday?")), WEDNESDAY)[0]
    derived = _by_class(exprs, "relative_derived")
    assert len(derived) == 1
    assert derived[0]["value"] == "2026-10-13"


def test_resolve_bare_weekday_next_week_not_today():
    # Wednesday called-at: bare "Wednesday" must skip today, land Oct 14.
    exprs = collect_expressions(_turns(("agent", "See you on Wednesday.")), WEDNESDAY)[0]
    derived = _by_class(exprs, "relative_derived")
    assert derived[0]["value"] == "2026-10-14"


def test_next_friday_never_resolved():
    exprs = collect_expressions(_turns(("agent", "Let us say next Friday.")), WEDNESDAY)[0]
    amb = _by_class(exprs, "ambiguous")
    assert len(amb) == 1
    assert amb[0]["reason"] == "dialect-dependent"
    assert not _by_class(exprs, "relative_derived")


def test_in_2_weeks():
    exprs = collect_expressions(_turns(("agent", "Follow up in 2 weeks.")), WEDNESDAY)[0]
    assert _by_class(exprs, "relative_resolved")[0]["value"] == "2026-10-21"


def test_in_one_week_word_form():
    exprs = collect_expressions(_turns(("agent", "I will check in a week.")), WEDNESDAY)[0]
    assert _by_class(exprs, "relative_resolved")[0]["value"] == "2026-10-14"


def test_next_month_same_day():
    exprs = collect_expressions(_turns(("agent", "Renewal is next month.")), WEDNESDAY)[0]
    assert _by_class(exprs, "relative_resolved")[0]["value"] == "2026-11-07"


def test_next_month_clamp_to_month_end():
    dt = parse_called_at("2026-10-31T09:00:00-07:00")
    exprs = collect_expressions(_turns(("agent", "Renewal is next month.")), dt)[0]
    assert _by_class(exprs, "relative_resolved")[0]["value"] == "2026-11-30"


def test_tonight_resolves_zero_days():
    exprs = collect_expressions(_turns(("agent", "The driver arrives tonight.")), WEDNESDAY)[0]
    assert _by_class(exprs, "relative_resolved")[0]["value"] == "2026-10-07"


def test_day_after_tomorrow():
    exprs = collect_expressions(_turns(("agent", "We deliver the day after tomorrow.")), WEDNESDAY)[0]
    assert _by_class(exprs, "relative_resolved")[0]["value"] == "2026-10-09"


# ---------------------------------------------------------------- clock classes


def test_at_2_is_clock_ambiguous():
    exprs = collect_expressions(_turns(("agent", "We can do it at 2.")), WEDNESDAY)[0]
    amb = _by_class(exprs, "clock_ambiguous")
    assert len(amb) == 1
    assert not _by_class(exprs, "clock_absolute")


def test_at_2_pm_is_absolute_1400():
    exprs = collect_expressions(_turns(("agent", "We can do it at 2 p.m.")), WEDNESDAY)[0]
    assert _by_class(exprs, "clock_absolute")[0]["value"] == "14:00"


def test_1400_colon_is_absolute():
    exprs = collect_expressions(_turns(("agent", "We close at 14:00.")), WEDNESDAY)[0]
    assert _by_class(exprs, "clock_absolute")[0]["value"] == "14:00"


def test_230_pm_is_1430():
    exprs = collect_expressions(_turns(("agent", "Try 2:30 p.m. instead.")), WEDNESDAY)[0]
    assert _by_class(exprs, "clock_absolute")[0]["value"] == "14:30"


def test_noon_is_band_not_clock():
    exprs = collect_expressions(_turns(("agent", "Lunch is at noon.")), WEDNESDAY)[0]
    assert _classes(exprs) == ["band"]


# ---------------------------------------------------------------- date classes


def test_month_day_absolute():
    exprs = collect_expressions(_turns(("agent", "Pickup on October 14.")), WEDNESDAY)[0]
    absd = _by_class(exprs, "absolute_date")
    assert len(absd) == 1
    assert absd[0]["value"] == "oct 14"
    assert absd[0]["resolved_date"] == "2026-10-14"


def test_ordinal_of_form():
    exprs = collect_expressions(_turns(("agent", "Pickup on the 14th of October.")), WEDNESDAY)[0]
    absd = _by_class(exprs, "absolute_date")
    assert absd[0]["value"] == "oct 14"


def test_abbreviated_month_form():
    exprs = collect_expressions(_turns(("agent", "Pickup on Jan 5.")), WEDNESDAY)[0]
    assert _by_class(exprs, "absolute_date")[0]["value"] == "jan 5"


def test_slash_date_us_mmdd():
    exprs = collect_expressions(_turns(("agent", "Pickup on 10/14.")), WEDNESDAY)[0]
    absd = _by_class(exprs, "absolute_date")
    assert absd[0]["value"] == "oct 14"
    assert absd[0]["resolved_date"] == "2026-10-14"


def test_weekday_adjacent_to_date_is_absorbed():
    # "Wednesday, October 14" is one compound anchor: only the absolute_date
    # expression is emitted, no stray relative_derived weekday.
    exprs = collect_expressions(_turns(("agent", "Pickup Wednesday, October 14 at 2 p.m.")), WEDNESDAY)[0]
    assert _classes(exprs) == ["absolute_date", "clock_absolute"]


# ---------------------------------------------------------------- no called-at


def test_no_called_at_tomorrow_unresolvable():
    exprs = collect_expressions(_turns(("agent", "We will see you tomorrow.")), None)[0]
    assert _classes(exprs) == ["unresolvable_without_call_time"]


def test_no_called_at_bare_weekday_unresolvable():
    exprs = collect_expressions(_turns(("agent", "See you on Tuesday.")), None)[0]
    assert _classes(exprs) == ["unresolvable_without_call_time"]


def test_no_called_at_pair_checks_skipped():
    turns = _turns(("agent", "It is Tuesday, October 14 at 2."))
    exprs = collect_expressions(turns, None)[0]
    conflicts, notes = find_conflicts(turns, exprs, None)
    assert conflicts == []
    assert any("skipped" in n for n in notes)


# ---------------------------------------------------------------- callee turns


def test_callee_turns_ignored_but_counted():
    turns = _turns(("callee", "how about next Tuesday?"), ("agent", "Confirmed."))
    exprs, callee_mentions = collect_expressions(turns, WEDNESDAY)
    assert exprs == []
    assert callee_mentions == 1


def test_callee_clock_counted():
    turns = _turns(("callee", "Make it 2 p.m. please."), ("agent", "Done."))
    _, callee_mentions = collect_expressions(turns, WEDNESDAY)
    assert callee_mentions == 1


def test_agent_roles_variants():
    for role in ("agent", "assistant", "system", "bot"):
        turns = _turns((role, "See you tomorrow."))
        exprs, _ = collect_expressions(turns, WEDNESDAY)
        assert len(exprs) == 1, role


# ---------------------------------------------------------------- conflicts


def test_pair_consistent_no_conflict():
    turns = _turns(("agent", "Pickup Wednesday, October 14 at 2 p.m."))
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert conflicts == []


def test_pair_weekday_date_mismatch_conflict():
    # 2026-10-14 is a Wednesday; agent said Tuesday.
    turns = _turns(("agent", "It is Tuesday, October 14 at 2. Please be home."))
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert len(conflicts) == 1
    assert conflicts[0]["type"] == "INTERNAL_DATE_CONFLICT"
    assert conflicts[0]["turn_index"] == 0


def test_cross_turn_weekday_disagreement_conflict():
    turns = _turns(
        ("agent", "Pickup Wednesday, October 14."),
        ("callee", "Okay."),
        ("agent", "Correction: pickup Friday, October 14."),
    )
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert any(c["type"] == "INTERNAL_DATE_CONFLICT" for c in conflicts)


def test_multi_slot_single_turn_no_false_conflict():
    # 2026-10-14 is a Wednesday and 2026-10-16 is a Friday; each weekday sits
    # adjacent to its own date, so the cross-product must not fire.
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(("agent", "We can do Wednesday, October 14 or Friday, October 16."))
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["conflicts"] == []
    assert card["verdict"] != "INTERNAL_DATE_CONFLICT"


def test_true_same_turn_conflict_still_fires():
    # 2026-10-14 is a Wednesday; agent said Tuesday right next to the date.
    turns = _turns(("agent", "Let me confirm Tuesday, October 14 at 2 p.m."))
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert len(conflicts) == 1
    assert conflicts[0]["type"] == "INTERNAL_DATE_CONFLICT"
    assert conflicts[0]["stated_weekday"] == "tuesday"


def test_proximity_boundary_far_weekday_not_paired():
    # Monday is far from the date, so it must not be paired with it.
    turns = _turns(
        ("agent", "We are closed Mondays. Your table will be ready on Wednesday, October 14.")
    )
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert conflicts == []


def test_clock_restatement_meridiem_drift_conflict():
    turns = _turns(
        ("agent", "See you at 2 p.m. on October 14."),
        ("callee", "Okay."),
        ("agent", "Sorry, I meant 2 a.m. on October 14."),
    )
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert any(c["type"] == "INTERNAL_CLOCK_CONFLICT" for c in conflicts)


def test_identical_restatement_no_clock_conflict():
    turns = _turns(
        ("agent", "Pickup Wednesday, October 14 at 2 p.m."),
        ("callee", "Got it."),
        ("agent", "To restate: Wednesday, October 14 at 2 p.m."),
    )
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert conflicts == []


def test_24h_and_12h_same_time_no_conflict():
    turns = _turns(
        ("agent", "Pickup at 14:00."),
        ("callee", "When?"),
        ("agent", "That is 2 p.m."),
    )
    exprs = collect_expressions(turns, WEDNESDAY)[0]
    conflicts, _ = find_conflicts(turns, exprs, WEDNESDAY)
    assert conflicts == []


# ---------------------------------------------------------------- analysis (Task 12)


def test_fully_anchored_end_to_end():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(
        ("agent", "Your pickup is scheduled for Wednesday, October 14 at 2 p.m."),
        ("callee", "Got it, Wednesday the 14th at 2 p.m. works."),
        ("agent", "To restate: Wednesday, October 14 at 2 p.m. We will see you then."),
    )
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["verdict"] == "FULLY_ANCHORED"
    assert card["commitment_findings"] == []
    assert card["conflicts"] == []


def test_relative_only_commitment_finding():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(("agent", "Can I confirm? We will see you tomorrow evening."))
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["verdict"] == "RELATIVE_ONLY_COMMITMENTS"
    assert len(card["commitment_findings"]) == 1
    f = card["commitment_findings"][0]
    assert f["turn_index"] == 0
    assert "tomorrow" in f["expression"]


def test_conflict_beats_relative_only():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(("agent", "It is Tuesday, October 14 at 2. Please be home."))
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["conflicts"], "expected a date conflict"
    assert card["verdict"] == "INTERNAL_DATE_CONFLICT"


def test_relative_only_beats_ambiguous():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(
        ("agent", "We will see you tomorrow evening."),
        ("callee", "Okay."),
        ("agent", "And I will call you back next week."),
    )
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["verdict"] == "RELATIVE_ONLY_COMMITMENTS"


def test_no_time_references():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(("agent", "Hello, this is the survey assistant. Goodbye."), ("callee", "Fine."))
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["verdict"] == "NO_TIME_REFERENCES"


def test_ambiguous_without_commitment_findings():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(("agent", "The office is closed next Friday."))
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["verdict"] == "AMBIGUOUS_TIME_REFERENCES"


def test_no_time_references_when_only_callee_mentions():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(("agent", "Understood, thank you."), ("callee", "Can we do Tuesday?"))
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["verdict"] == "NO_TIME_REFERENCES"
    assert card["callee_time_mentions"] == 1


def test_output_contract_fields():
    from call_temporal_anchor_auditor import analyze_call

    card = analyze_call(_turns(("agent", "See you tomorrow.")), WEDNESDAY, CALLED_AT)
    for key in (
        "verdict",
        "called_at_echo",
        "expressions",
        "commitment_findings",
        "callee_time_mentions",
        "conflicts",
        "counts",
        "disclaimer",
    ):
        assert key in card
    assert card["called_at_echo"] == CALLED_AT


def test_disclaimer_present_and_hedged():
    from call_temporal_anchor_auditor import analyze_call

    card = analyze_call(_turns(("agent", "See you tomorrow.")), WEDNESDAY, CALLED_AT)
    assert "heuristic" in card["disclaimer"].lower()


# ---------------------------------------------------------------- review fixes (F1-F5)


def test_colon_clock_no_meridiem_hour12_ambiguous():
    exprs = collect_expressions(_turns(("agent", "Pickup is at 2:30.")), WEDNESDAY)[0]
    amb = _by_class(exprs, "clock_ambiguous")
    assert len(amb) == 1
    assert amb[0]["reason"] == "12-hour clock without meridiem"
    assert not _by_class(exprs, "clock_absolute")


def test_colon_clock_24h_absolute():
    exprs = collect_expressions(_turns(("agent", "Pickup is at 14:30.")), WEDNESDAY)[0]
    abs_clk = _by_class(exprs, "clock_absolute")
    assert len(abs_clk) == 1
    assert abs_clk[0]["value"] == "14:30"


def test_no_meridiem_colon_cannot_fully_anchor():
    from call_temporal_anchor_auditor import analyze_call

    turns = _turns(
        ("agent", "We can book you October 14."),
        ("callee", "Sure."),
        ("agent", "Pickup is at 2:30."),
    )
    card = analyze_call(turns, WEDNESDAY, CALLED_AT)
    assert card["verdict"] != "FULLY_ANCHORED"


def test_a_week_from_today_offsets_and_suppresses_bare_today():
    exprs = collect_expressions(_turns(("agent", "Let us talk a week from today.")), WEDNESDAY)[0]
    resolved = _by_class(exprs, "relative_resolved")
    assert len(resolved) == 1
    assert resolved[0]["value"] == "2026-10-14"
    assert not any(e["text"].lower() == "today" for e in exprs)


def test_three_days_from_today():
    exprs = collect_expressions(_turns(("agent", "Check back 3 days from today.")), WEDNESDAY)[0]
    resolved = _by_class(exprs, "relative_resolved")
    assert len(resolved) == 1
    assert resolved[0]["value"] == "2026-10-10"


def test_bare_ordinal_day_resolves_with_called_at():
    exprs = collect_expressions(_turns(("agent", "See you the 14th at 2 p.m.")), WEDNESDAY)[0]
    absd = _by_class(exprs, "absolute_date")
    assert len(absd) == 1
    assert absd[0]["value"] == "oct 14"
    assert absd[0]["resolved_date"] == "2026-10-14"


def test_bare_ordinal_day_fully_anchored():
    from call_temporal_anchor_auditor import analyze_call

    card = analyze_call(_turns(("agent", "See you the 14th at 2 p.m.")), WEDNESDAY, CALLED_AT)
    assert card["verdict"] == "FULLY_ANCHORED"


def test_bare_ordinal_day_without_called_at_unresolvable():
    exprs = collect_expressions(_turns(("agent", "See you the 14th at 2 p.m.")), None)[0]
    bare = [e for e in exprs if e["text"].lower() == "the 14th"]
    assert len(bare) == 1
    assert bare[0]["class"] == "unresolvable_without_call_time"


def test_bare_day_32_invalid_date():
    exprs = collect_expressions(_turns(("agent", "See you the 32nd at 2 p.m.")), WEDNESDAY)[0]
    inv = _by_class(exprs, "invalid_date")
    assert len(inv) == 1
    assert inv[0]["reason"] == "date does not exist in 2026"


def test_feb29_non_leap_invalid_date_not_fully_anchored():
    from call_temporal_anchor_auditor import analyze_call

    card = analyze_call(
        _turns(("agent", "See you February 29 at 3 p.m.")), WEDNESDAY, CALLED_AT
    )
    assert card["verdict"] != "FULLY_ANCHORED"
    inv = [e for e in card["expressions"] if e["class"] == "invalid_date"]
    assert len(inv) == 1
    assert inv[0]["reason"] == "date does not exist in 2026"


def test_feb29_leap_year_resolves():
    leap = parse_called_at("2028-01-05T09:00:00-07:00")
    exprs = collect_expressions(_turns(("agent", "See you February 29 at 3 p.m.")), leap)[0]
    absd = _by_class(exprs, "absolute_date")
    assert len(absd) == 1
    assert absd[0]["resolved_date"] == "2028-02-29"


def test_ordinal_preceded_weekday_ambiguous():
    exprs = collect_expressions(
        _turns(("agent", "How does the first Friday of next month sound?")), WEDNESDAY
    )[0]
    fri = [e for e in exprs if e["text"].lower() == "friday"]
    assert len(fri) == 1
    assert fri[0]["class"] == "ambiguous"
    assert fri[0]["reason"] == "complex ordinal weekday expression"
    assert not _by_class(exprs, "relative_derived")


# ---------------------------------------------------------------- craft


def test_craft_template_contents():
    text = craft_template("Confirm the repair window", "2026-10-14", "2 p.m.")
    assert text.startswith("GOAL: Confirm the repair window")
    assert 'example: "Wednesday, October 14, at 2 p.m."' in text
    assert text.rstrip().endswith("SLOT: 2026-10-14 at 2 p.m.")
    assert "TIME DISCIPLINE:" in text
    assert 'never use bare "next <weekday>"' in text


# ---------------------------------------------------------------- CLI


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / "call_temporal_anchor_auditor.py"), *args],
        capture_output=True,
        text=True,
    )


def _write_tmp(payload, name: str = "in.json") -> Path:
    d = _mktemp()
    p = d / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return p


def test_cli_fixture_full_anchored():
    proc = _run("analyze", "--call-result", str(EXAMPLE_FULL), "--called-at", CALLED_AT)
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-temporal-001"
    assert card["verdict"] == "FULLY_ANCHORED"


def test_cli_fixture_conflict():
    proc = _run("analyze", "--call-result", str(EXAMPLE_CONFLICT), "--called-at", CALLED_AT)
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-temporal-002"
    assert card["verdict"] == "INTERNAL_DATE_CONFLICT"


def test_cli_fixture_relative():
    proc = _run("analyze", "--call-result", str(EXAMPLE_RELATIVE), "--called-at", CALLED_AT)
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["call_id"] == "demo-temporal-003"
    assert card["verdict"] == "RELATIVE_ONLY_COMMITMENTS"


def test_cli_fixture_relative_without_called_at_notes():
    proc = _run("analyze", "--call-result", str(EXAMPLE_RELATIVE))
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    unresolved = [e for e in card["expressions"] if e["class"] == "unresolvable_without_call_time"]
    assert unresolved
    assert card["called_at_echo"] is None
    assert any("skipped" in n for n in card["notes"])


def test_cli_transcript_bare_list_path():
    p = _write_tmp(_turns(("agent", "Pickup on Thursday at 2 p.m.")))
    proc = _run("analyze", "--transcript", str(p), "--called-at", CALLED_AT)
    assert proc.returncode == 0, proc.stderr
    card = json.loads(proc.stdout)
    assert card["verdict"] == "FULLY_ANCHORED"
    assert "call_id" not in card


def test_cli_bad_json_exit2():
    d = _mktemp()
    p = d / "bad.json"
    p.write_text("{not json", encoding="utf-8")
    proc = _run("analyze", "--call-result", str(p))
    assert proc.returncode == 2
    assert proc.stderr.strip()


def test_cli_call_result_array_exit2():
    p = _write_tmp([{"speaker": "agent", "text": "hi"}])
    proc = _run("analyze", "--call-result", str(p))
    assert proc.returncode == 2


def test_cli_transcript_non_array_exit2():
    p = _write_tmp({"transcript": []})
    proc = _run("analyze", "--transcript", str(p))
    assert proc.returncode == 2


def test_cli_neither_flag_exit2():
    proc = _run("analyze")
    assert proc.returncode == 2


def test_cli_both_flags_exit2():
    p1 = _write_tmp({"result": {"transcript": []}})
    p2 = _write_tmp(_turns(("agent", "hi")), "t.json")
    proc = _run("analyze", "--call-result", str(p1), "--transcript", str(p2))
    assert proc.returncode == 2


def test_cli_bad_iso_exit2():
    p = _write_tmp({"result": {"transcript": _turns(("agent", "hi"))}})
    proc = _run("analyze", "--call-result", str(p), "--called-at", "tomorrow-ish")
    assert proc.returncode == 2


def test_cli_nonexistent_file_exit2():
    proc = _run("analyze", "--call-result", "Z:/nope/missing.json")
    assert proc.returncode == 2
    assert "not found" in proc.stderr


def test_cli_craft_exit0():
    proc = _run("craft", "--task", "Confirm the pickup", "--date", "2026-10-14", "--time", "2 p.m.")
    assert proc.returncode == 0
    assert proc.stdout.startswith("GOAL: Confirm the pickup")
    assert proc.stdout.rstrip().endswith("SLOT: 2026-10-14 at 2 p.m.")


def test_cli_craft_empty_task_exit2():
    proc = _run("craft", "--task", "   ", "--date", "2026-10-14", "--time", "2 p.m.")
    assert proc.returncode == 2


def test_cli_craft_missing_date_exit2():
    proc = _run("craft", "--task", "Confirm the pickup", "--time", "2 p.m.")
    assert proc.returncode == 2


def test_main_returns_int():
    assert main(["craft", "--task", "x", "--date", "2026-10-14", "--time", "2 p.m."]) == 0


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
