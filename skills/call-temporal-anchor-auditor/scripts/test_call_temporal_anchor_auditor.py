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
