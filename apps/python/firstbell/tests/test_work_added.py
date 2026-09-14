"""The labour this run creates, priced at the grade it lands on.

A district operations director read the run and named the gap as the one thing stopping
them signing: the arithmetic prices the work taken off the desk at a secretary's wage and
prices the work it creates at nothing. Their words for the quantity they needed were
"escalations per hundred answered calls that would have closed without the safeguarding
rule, with the sample size behind it".

The run already counted it. `escalated` is exactly that number, because a row that reached
`resolved` satisfied the schema and said something, so without the rule it would have
closed and nobody would have rung back. Nothing named it, nothing priced it, and the
ceiling printed beside it ignored it. On the committed run the honest ceiling is $0.21 a
call rather than $0.59, which is a claim worth being sure about.
"""
from __future__ import annotations

import pytest

from dispatch import Escalation, ItemResult, Resolution, WorkItem
from firstbell.domain import StaffCost, summarise

IN_A = "+915550000001"
IN_B = "+915550000002"


def _row(name: str, resolution: Resolution, escalation: Escalation,
         spoke: bool = True) -> ItemResult:
    """`spoke` is whether somebody picked up, which the resolution cannot say on its own.

    `UNDETERMINED` covers both a person who answered and gave nothing usable and a call
    nobody is known to have answered, so the fixture states which one each row is rather
    than letting the denominator guess.
    """
    return ItemResult(item=WorkItem(id=name, phones=(IN_A,)), resolution=resolution,
                      escalation=escalation, attempts_made=1, placed_by_this_run=True,
                      spoke_to_someone=spoke)


def _wave() -> list[ItemResult]:
    """Two closed, one escalated after a valid answer, one that learned nothing and
    carries the flag anyway, and one nobody reached."""
    return [
        _row("closed-1", Resolution.RESOLVED, Escalation.NONE),
        _row("closed-2", Resolution.RESOLVED, Escalation.NONE),
        _row("net-new", Resolution.RESOLVED, Escalation.SAFEGUARDING),
        # Answered: the call connected and every required field came back unknown.
        _row("already-open", Resolution.UNDETERMINED, Escalation.SAFEGUARDING),
        _row("nobody-home", Resolution.FAILED, Escalation.NONE, spoke=False),
    ]


def test_only_a_case_that_would_have_closed_counts_as_work_added():
    """The whole point of the number, and the reason a total rate is useless to a rota.

    `already-open` carries the safeguarding flag and was going to a person anyway, because
    the call produced nothing usable. Counting it as work the rule created would tell a
    district to staff two callbacks where the rule caused one.
    """
    s = summarise(_wave(), live=True, staff=StaffCost.us_school_office(),
                  escalation_staff=StaffCost.us_school_safeguarding_lead())
    assert s.net_new_escalations == 1
    assert s.escalated_unresolved == 1
    assert s.answered == 4, "a call nobody answered cannot have confirmed anything"
    assert s.net_new_escalation_rate == 0.25


def test_the_added_cost_is_priced_at_the_lead_grade_and_not_the_desk_grade():
    desk = StaffCost.us_school_office()
    lead = StaffCost.us_school_safeguarding_lead()
    assert lead.hourly > desk.hourly, (
        "the post that answers a safeguarding callback costs more than the post whose "
        "time the calls save, which is the entire finding")
    s = summarise(_wave(), live=True, staff=desk, escalation_staff=lead)
    # Per billed attempt, which is the denominator the saving it is subtracted from uses.
    # This fixture has more attempts than answers, so the two denominators give different
    # numbers and the test would pass on either only by accident.
    assert s.calls_placed != s.answered, (
        "the fixture no longer distinguishes attempts billed from calls answered, so "
        "this test can no longer tell which denominator the cost is on")
    assert s.escalation_cost_per_call_lead_minute == (
        s.net_new_escalations / s.calls_placed) * (lead.hourly / 60.0)
    assert s.escalation_cost_per_call_lead_minute != (
        s.net_new_escalations / s.answered) * (lead.hourly / 60.0), (
        "the cost is on the answered-call denominator again, which is the mismatch a "
        "district finance office found: it is taken off a per-attempt saving")


def test_the_printed_ceiling_falls_once_the_added_work_is_paid_for():
    """A ceiling that ignores the labour the rule creates is too high.

    Both figures are printed, and the second says the first ignores it. Publishing only
    the higher one is the mistake a district catches in week one of a pilot, which is the
    worst possible moment to catch it.
    """
    s = summarise(_wave(), live=True, staff=StaffCost.us_school_office(),
                  escalation_staff=StaffCost.us_school_safeguarding_lead())
    text = "\n".join(s.lines())
    assert "work this run adds" in text
    assert "1 of 4 answered call(s) would have closed" in text
    before = s.break_even_per_call_minute * 3
    after = before - s.escalation_cost_per_call_lead_minute * 3
    assert after < before
    assert f"${after:,.2f} a call, at 3 minutes for each of the two" in text
    assert f"(from ${before:,.2f}" in text


def test_a_run_where_the_rule_added_nothing_says_zero_rather_than_going_quiet():
    """The retrospective zero, which is the answer on every real call placed so far.

    A block that appeared only when the number was interesting would be a block a reader
    could not trust when it appeared. Zero of four is a measurement.
    """
    calm = [r for r in _wave() if r.item.id != "net-new"]
    s = summarise(calm, live=True, staff=StaffCost.us_school_office(),
                  escalation_staff=StaffCost.us_school_safeguarding_lead())
    assert s.net_new_escalations == 0
    assert s.net_new_escalation_rate == 0.0
    assert s.escalation_cost_per_call_lead_minute == 0.0
    text = "\n".join(s.lines())
    assert "0 of 3 answered call(s) would have closed" in text
    assert "ceiling after it" in text


def test_a_run_nobody_answered_reports_no_rate_rather_than_zero():
    """Third outcome. No denominator is not a rate of nought."""
    s = summarise([_row("nobody-home", Resolution.FAILED, Escalation.NONE)], live=True,
                  staff=StaffCost.us_school_office(),
                  escalation_staff=StaffCost.us_school_safeguarding_lead())
    assert s.answered == 0
    assert s.net_new_escalation_rate is None
    assert s.escalation_cost_per_call_lead_minute is None
    assert "work this run adds   not computed" in "\n".join(s.lines())


def test_no_escalation_wage_leaves_the_block_out_rather_than_pricing_it_at_nothing():
    s = summarise(_wave(), live=True, staff=StaffCost.us_school_office(),
                  escalation_staff=None)
    assert s.escalation_cost_per_call_lead_minute is None
    assert "not computed" in "\n".join(s.lines())


def test_the_lead_wage_carries_its_source_like_every_other_money_figure():
    lead = StaffCost.us_school_safeguarding_lead()
    cite = lead.cite()
    assert "77,800" in cite and "$37.40/hour" in cite
    assert "bls.gov" in lead.source_url
    assert "Elementary and secondary schools" in lead.industry


def test_a_wage_of_zero_is_refused_rather_than_making_the_added_work_free():
    with pytest.raises(ValueError):
        StaffCost(annual=0.0, currency="$", hours_per_year=2_080,
                  occupation="x", industry="y", source="z", source_url="", year=2025)


def _upper_bound():
    """`tools/` is not a package, so the tool is imported by path like the others."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
    import replay_escalation
    return replay_escalation.upper_bound


def test_a_zero_count_gets_the_bound_its_sample_size_earns():
    """Twelve quiet calls do not mean a quiet rule, and the bound is what says so.

    Checked against the closed form for zero events, which is the one case exact enough
    to check arithmetic against rather than a table.
    """
    upper_bound = _upper_bound()
    for trials in (5, 11, 12, 40, 400):
        closed_form = 1 - 0.05 ** (1 / trials)
        assert abs(upper_bound(0, trials) - closed_form) < 1e-9, (
            f"the bisection disagrees with the closed form at n={trials}")
    assert round(100 * upper_bound(0, 11)) == 24, (
        "the eleven real calls moved nothing and still cannot rule out 24 per 100")


def test_the_bound_matches_a_published_clopper_pearson_value():
    """One event in ten: the exact one-sided 95% upper limit is 0.3942."""
    assert abs(_upper_bound()(1, 10) - 0.3942) < 0.001


def test_more_calls_buy_a_tighter_bound():
    upper_bound = _upper_bound()
    bounds = [upper_bound(0, n) for n in (11, 50, 200, 1000)]
    assert bounds == sorted(bounds, reverse=True)
    assert bounds[-1] < 0.01, "a thousand quiet calls should bound the rate below 1 in 100"


def test_a_rate_that_saturates_is_reported_as_certain_rather_than_as_a_number():
    assert _upper_bound()(7, 7) == 1.0


def test_a_bound_on_no_calls_is_refused():
    with pytest.raises(ValueError):
        _upper_bound()(0, 0)
