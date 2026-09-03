"""Runner and answer-grading tests.

The behaviours worth locking down are the refusals: stop when filled, never
count a hedge, never exceed the budget, never call the scarce donor first.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from raktdaan import commitment, compat, order
from raktdaan.policy import Consent, Donor

TODAY = date(2026, 9, 3)
OK = Consent(recall_consent=True, recorded_on=date(2026, 1, 1))


def donor(ref: str, group: str = "A+", wb_days: int | None = 300, **kw) -> Donor:
    base = dict(
        ref=ref,
        phone=f"+91000000{ref[-4:]}",
        group=group,
        sex="M",
        date_of_birth=date(1993, 4, 4),
        weight_kg=70.0,
        last_hb_g_dl=14.5,
        last_whole_blood=TODAY - timedelta(days=wb_days) if wb_days is not None else None,
        consent=OK,
    )
    base.update(kw)
    return Donor(**base)


def request(units: int = 1, group: str = "A+", component: str = compat.RED_CELLS):
    return order.Request("REQ-T", group, component, units_needed=units)


def replies(mapping):
    def dial(d: Donor, req: order.Request) -> order.CallOutcome:
        state = mapping.get(d.ref, order.NO_ANSWER)
        return order.CallOutcome(d.ref, state)

    return dial

def test_dispatch_stops_the_instant_the_need_is_met() -> None:
    roster = [donor(f"RD-{i:04d}") for i in range(1, 11)]
    plan = order.build_plan(roster, request(units=1), TODAY)
    assert plan.eligible_count == 10
    report = order.run(plan, replies({r.ref: order.CONFIRMED for r in roster}))
    assert report.calls_placed == 1
    assert report.filled
    assert len(report.never_called) == 9


def test_a_hedge_never_fills_the_need() -> None:
    roster = [donor(f"RD-{i:04d}") for i in range(1, 4)]
    plan = order.build_plan(roster, request(units=1), TODAY)
    report = order.run(plan, replies({r.ref: order.UNCLEAR for r in roster}))
    assert not report.filled
    assert report.units_confirmed == 0
    assert report.calls_placed == 3
    assert len(report.unclear) == 3


def test_the_call_budget_is_a_hard_stop() -> None:
    roster = [donor(f"RD-{i:04d}") for i in range(1, 21)]
    plan = order.build_plan(roster, request(units=5), TODAY)
    report = order.run(plan, replies({}), max_calls=4)
    assert report.calls_placed == 4
    assert not report.filled
    assert len(report.no_answer) == 4


def test_scarce_donors_are_called_last_and_reported_as_spared() -> None:
    roster = [
        donor("RD-0001", "O-"),
        donor("RD-0002", "O+"),
        donor("RD-0003", "A-"),
        donor("RD-0004", "A+"),
    ]
    plan = order.build_plan(roster, request(units=1, group="A+"), TODAY)
    refs = [d.ref for d in plan.queue]
    # A+ first (identical, and the narrowest use), O- dead last (serves all
    # eight recipient groups). A- and O+ each serve four, so they genuinely tie
    # and sit in the middle in either order.
    assert refs[0] == "RD-0004", refs
    assert refs[-1] == "RD-0001", refs
    assert set(refs[1:3]) == {"RD-0002", "RD-0003"}, refs
    report = order.run(plan, replies({"RD-0004": order.CONFIRMED}))
    assert report.calls_placed == 1
    # The A-, O+ and O- units were never spent on a need A+ could serve.
    assert report.scarce_spared == {"A-": 1, "O+": 1, "O-": 1}


def test_first_time_donors_sort_last_within_their_band() -> None:
    roster = [
        donor("RD-0001", "A+", wb_days=None, first_time_donor=True),
        donor("RD-0002", "A+", wb_days=100),
        donor("RD-0003", "A+", wb_days=400),
    ]
    plan = order.build_plan(roster, request(units=3), TODAY)
    assert [d.ref for d in plan.queue] == ["RD-0003", "RD-0002", "RD-0001"]

def test_a_dialler_answering_for_the_wrong_donor_is_a_hard_error() -> None:
    plan = order.build_plan([donor("RD-0001")], request(), TODAY)

    def wrong(d, req):
        return order.CallOutcome("RD-9999", order.CONFIRMED)

    try:
        order.run(plan, wrong)
    except ValueError as exc:
        assert "RD-9999" in str(exc)
    else:
        raise AssertionError("accepted an outcome for a donor it never dialled")


def test_nobody_eligible_is_a_clean_empty_run_not_a_crash() -> None:
    plan = order.build_plan([donor("RD-0001", "B+")], request(group="A+"), TODAY)
    report = order.run(plan, replies({}))
    assert report.calls_placed == 0
    assert not report.filled
    assert report.suppressed_histogram == {"group_incompatible": 1}


def test_requests_validate_themselves() -> None:
    for bad in (0, -3):
        try:
            order.Request("R", "A+", compat.RED_CELLS, bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted units_needed={bad}")
    try:
        order.Request("R", "Z+", compat.RED_CELLS, 1)
    except ValueError:
        pass
    else:
        raise AssertionError("accepted a nonsense blood group")


def test_outcomes_reject_unknown_commitment_states() -> None:
    try:
        order.CallOutcome("RD-0001", "probably_yes")
    except ValueError:
        pass
    else:
        raise AssertionError("accepted an invented commitment state")


def test_hedges_outrank_agreement() -> None:
    for text in (
        "Yes of course, I'll try to come",
        "haan haan, koshish karunga",
        "sure, let's see",
        "ok maybe tomorrow",
        "Yes, I think so",
    ):
        state, why = commitment.grade(text)
        assert state == order.UNCLEAR, (text, state, why)

def test_agreement_without_a_window_is_not_a_commitment() -> None:
    for text in ("Yes I will come", "haan ji bilkul", "sure, count me in", "okay"):
        state, _ = commitment.grade(text)
        assert state == order.UNCLEAR, text


def test_agreement_with_a_clock_time_is_a_commitment() -> None:
    for text in (
        "Yes, I can come 10 to 12 tomorrow",
        "haan, 4 pm",
        "okay 9 to 11 am works",
        "sure, 11 baje aa jaunga",
        "seri, 3 to 5",
    ):
        state, why = commitment.grade(text)
        assert state == order.CONFIRMED, (text, state, why)


def test_declines_and_opt_outs() -> None:
    for text in ("No thanks", "I can't", "nahi ji", "mudiyathu", "I'm travelling"):
        assert commitment.grade(text)[0] == order.DECLINED, text
    assert commitment.grade("please remove me from your list")[0] == order.DECLINED
    assert commitment.wants_opt_out("stop calling me")
    assert not commitment.wants_opt_out("yes, 10 to 12")


def test_silence_and_nonsense_are_never_yes() -> None:
    assert commitment.grade(None, answered=False)[0] == order.NO_ANSWER
    assert commitment.grade("")[0] == order.UNCLEAR
    assert commitment.grade("hello? who is this")[0] == order.UNCLEAR
    assert commitment.grade("...")[0] == order.UNCLEAR


def test_a_bare_time_with_no_agreement_is_not_a_commitment() -> None:
    # Somebody reading out a number is not somebody agreeing to donate.
    assert commitment.grade("it is 4 pm here")[0] == order.UNCLEAR


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - reporting harness
            failures += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}")
        else:
            print(f"ok   {name}")
    print("\n" + ("all runner and grading tests passed" if not failures else f"{failures} failed"))
    sys.exit(1 if failures else 0)
