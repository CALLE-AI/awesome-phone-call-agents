"""Every figure in the page's cost band traces to the register or to the receipt.

A district administrator reading this page as a buyer measured the gap: the first cost
figure was at 77% of the page's depth, inside a terminal dump, and the strings for a price
appeared nowhere at all. The foot of the page meanwhile cited four figures about school
budgets as sources for claims the page never made, which reads like a citation list left
behind after the paragraph was cut.

The band answers that. This file holds it to the same rule as everything else here: the
sourced numbers come out of `evidence/statistics.json` with their publishers, and the
derived ones are computed off the receipt by the arithmetic the program itself prints.
A typed number would pass every other test in this repository.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / "tools"))

RECEIPT = "06-locale-matched-pairs.json"


def _run() -> dict:
    for base in (Path("D:/calle-workshop/receipts"), APP / "evidence" / "receipts"):
        path = base / RECEIPT
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    pytest.skip("the receipts are held outside this repository and are not on this machine")


def _figures() -> dict:
    record = json.loads((APP / "evidence" / "statistics.json").read_text(encoding="utf-8"))
    return {f["id"]: f for f in record["figures"]}


def test_every_sourced_figure_in_the_band_is_the_registered_value():
    """The register is the record `tests/test_claims.py` polices, so the page reads it.

    One of these was corrected the day this test was written: the enrolment was cited to
    a US News page that serves a different district entirely, at HTTP 200.
    """
    import judge_page
    facts = judge_page.money_facts(_run())
    reg = _figures()
    for key, fid in (("sis", "chccs-sis-renewal"), ("enrolment", "chccs-enrolment"),
                     ("allotment", "texas-basic-allotment"),
                     ("districts", "us-regular-districts"),
                     ("schools", "us-public-schools")):
        assert facts[key]["value"] == reg[fid]["value"]
        assert facts[key]["url"].startswith("https://")
        assert facts[key]["publisher"]


def test_the_per_student_figure_is_the_division_and_not_a_typed_number():
    import judge_page
    facts = judge_page.money_facts(_run())
    reg = _figures()
    expected = (float(reg["chccs-sis-renewal"]["value"].replace(",", ""))
                / float(reg["chccs-enrolment"]["value"].replace(",", "")))
    assert facts["per_student"] == expected
    assert f"${expected:,.2f}" == "$13.89"


def test_the_per_absence_figure_divides_the_allotment_by_the_school_year():
    import judge_page
    facts = judge_page.money_facts(_run())
    allotment = float(_figures()["texas-basic-allotment"]["value"].replace(",", ""))
    assert facts["per_absence"] == allotment / 175


def test_the_ceiling_credits_only_the_attempts_behind_a_closed_record():
    """The same rule the program prints, and the same one a mutation already caught.

    Crediting every billed attempt would raise this figure, and it is the number a reader
    is most likely to quote, so it is the one worth being sure about.
    """
    import judge_page
    from firstbell.domain import StaffCost
    facts = judge_page.money_facts(_run())
    desk = StaffCost.us_school_office()
    assert facts["ceiling_at_three"] == (facts["removed"] / facts["placed"]) * (
        desk.hourly / 60.0) * 3
    assert facts["removed"] < facts["placed"], (
        "on this run four attempts are still open, so a ceiling that used all of them "
        "would be claiming credit for work still on a desk")


def test_the_band_prices_the_added_work_at_the_lead_grade():
    import judge_page
    from firstbell.domain import StaffCost
    facts = judge_page.money_facts(_run())
    lead = StaffCost.us_school_safeguarding_lead()
    assert facts["lead"].annual == lead.annual > facts["desk"].annual
    if facts["answered"]:
        assert facts["added_at_three"] == (
            facts["net_new"] / facts["answered"]) * (lead.hourly / 60.0) * 3


def test_a_zero_count_still_carries_its_bound():
    """Nothing moved on these calls, and seven calls cannot say the rate is nought."""
    import judge_page
    facts = judge_page.money_facts(_run())
    assert facts["net_new"] == 0
    assert facts["bound"] > 0.3, (
        "seven answered calls with no movement still allow a rate above 30 per 100, and "
        "the band has to say so rather than reading zero as settled")


def test_the_worst_case_is_not_clamped_to_a_flattering_zero():
    """A constant standing in for a quantity that went negative is a failure this
    project keeps finding in other people's measurements.

    At the top of the interval seven calls allow, the callbacks cost more than the calls
    save. The band says that sentence. It used to print $0.00, which hides the finding
    behind something that looks like a measurement.
    """
    import judge_page
    facts = judge_page.money_facts(_run())
    assert facts["worst_at_three"] < 0
    markup = judge_page.money_markup(_run())
    assert "$0.00" not in markup
    assert "the callbacks cost more than the calls save" in markup


def test_the_band_claims_no_saving_and_no_recovered_funding():
    """Explaining an absence does not make a student present.

    The attendance figure is on the page because it is what one absence is worth to a
    district, not because this software recovers any of it, and the sentence beside it
    has to say so. A page carrying a funding number without that sentence is claiming it.
    """
    import judge_page
    markup = judge_page.money_markup(_run())
    assert "this run claims none of it" in markup
    assert "Not a saving" in markup
    # The sentence used to be that nobody has a price. The account has been billed
    # since, so what the band must still refuse to claim is a saving, and what it must
    # still say is that the figure beside the price is a ceiling.
    assert "publishes no price" in markup
    assert "not a price CALL-E stands behind" in markup


def test_the_band_reaches_the_page_rather_than_only_the_test():
    """A generated block nothing renders is a function, not a section."""
    out = APP / "out" / "index.html"
    if not out.exists():
        pytest.skip("no built page; run tools/judge_page.py first")
    page = out.read_text(encoding="utf-8")
    assert "class=money" in page
    for value in ("157,664", "13.89", "35.51", "13,303", "99,297"):
        assert value in page, f"{value} is computed and never shown"


def test_a_run_that_answered_nothing_does_not_kill_the_page_build():
    """The band's own third outcome, and it was missing.

    A run that placed calls and answered none has no escalation rate, because the
    denominator is zero. `bound` and `worst_at_three` come back None, and the old code
    multiplied them: `TypeError: unsupported operand type(s) for *: 'int' and 'NoneType'`,
    which killed the whole page build rather than one paragraph.

    The guard above the paragraph asked whether the ceiling existed, and on this run the
    ceiling is `0.0`, which is a number. That is the shape of the defect this project
    spends its time hunting, in its own page builder: a quantity that cannot be measured,
    handled as though it always can be.

    Every other test in this file reads the one committed receipt where every row was
    answered and every row made exactly one attempt, so none of them could reach it.
    """
    run = {"calls_placed": 3, "items": [
        {"id": "S-1", "resolution": "failed", "attempts": 2, "structured_result": None},
        {"id": "S-2", "resolution": "failed", "attempts": 1, "structured_result": None},
    ]}
    import judge_page

    facts = judge_page.money_facts(run)
    assert facts["answered"] == 0
    assert facts["bound"] is None and facts["worst_at_three"] is None
    assert facts["ceiling_at_three"] == 0.0, (
        "the ceiling is no longer a number on this run, so the guard above the paragraph "
        "would catch it and this test would stop testing anything"
    )

    markup = judge_page.money_markup(run)
    assert markup, "the band went silent instead of saying what it could not measure"
    assert "and nobody answered, so it says nothing" in markup
    assert "that rate needs an answered call" in markup
    # Narrowed twice now, and both narrowings are the same shape: this run may not state
    # its own bound, and a bound from another run is allowed if it says which run. It first
    # asserted "per 100" appeared nowhere, which stopped being true when the band began
    # naming the pooled figure; then it asserted "cannot rule out" appeared nowhere, which
    # stopped being true when the three-figure block above the paragraph started saying
    # "What 12 calls cannot rule out". The claim that matters is unchanged and now it is
    # the claim being made: this run has no denominator, so no sentence may bound it.
    assert f'{facts["answered"]} calls cannot rule out' not in markup, (
        "the band states a bound on a run with no answered call to bound"
    )
    assert "answered calls" in markup, (
        "the band no longer names any rate at all. The pooled figures over every recorded "
        "call are the one thing this run can still be compared against, so losing them "
        "would make a zero-answer page emptier than it has to be"
    )
    # This used to assert that "per 100" appeared nowhere, which is a stronger claim than
    # the one that matters and it stopped being true when the band started naming the
    # pooled figure over every recorded call. A rate from another run is allowed here; a
    # rate from this one is not, because this one has no denominator. The narrowing is
    # written down because loosening an assertion to make a suite green is the move this
    # project spends its time catching.
    assert "Across all 12 calls" in markup, (
        "the pooled figure is the only measured one in the entry and the band dropped it"
    )
    # The other two figures in the cell are not properties of this run and have to survive
    # it: the price came off a billing panel and the headline ceiling off the demo run.
    assert "billed" in markup and "one month" in markup


def test_a_run_with_one_answered_call_still_states_the_bound():
    """The branch above must not swallow the ordinary case."""
    import judge_page

    run = {"calls_placed": 2, "items": [
        {"id": "S-1", "resolution": "resolved", "attempts": 1,
         "structured_result": {"parent_confirmed_aware": "yes", "spoke_with": "guardian",
                               "reason_category": "illness", "expected_return": "today"}},
        {"id": "S-2", "resolution": "failed", "attempts": 1, "structured_result": None},
    ]}
    markup = judge_page.money_markup(run)
    assert "per 100" in markup, "the bound stopped being published on a run that has one"
    assert "nobody answered, so it says nothing" not in markup


def test_the_cost_cell_leads_with_the_billed_price_and_not_a_typed_one():
    """The two figures on the left of the band come from files, not from this file.

    A buyer found four per-call figures across three surfaces, every one of them real and
    none of them naming its run. The page now leads with what the account was billed and
    with the demo run's ceiling, both read from `tools/money_across_runs.py`, which is the
    module the README table and `tests/test_observed_price.py` also read. A number typed
    into the page builder would pass every other test in this repository.
    """
    import judge_page
    from money_across_runs import demo_row, observed

    facts = judge_page.money_facts(_run())
    price = observed()["observed"]
    assert facts["price"] == price
    assert facts["demo"]["net_ceiling"] == demo_row()["net_ceiling"]

    markup = judge_page.money_markup(_run())
    assert f"${price['per_call_usd']:,.2f}" in markup
    assert f"${demo_row()['net_ceiling']:,.2f}" in markup
    assert "two minutes" in markup, (
        "the page quotes the billed price without the reason it may be per-minute")


def test_the_cell_says_the_page_receipt_is_a_third_run():
    """Naming the run is the fix. A figure with no run beside it is what caused this."""
    import judge_page
    markup = judge_page.money_markup(_run())
    assert "receipt is a third run" in markup
    assert "money_across_runs.py" in markup, (
        "the page states a handful of figures and does not say where the rest are")
