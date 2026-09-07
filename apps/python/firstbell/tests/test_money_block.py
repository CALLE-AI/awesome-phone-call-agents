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
    assert "does not publish a price per call" in markup


def test_the_band_reaches_the_page_rather_than_only_the_test():
    """A generated block nothing renders is a function, not a section."""
    out = APP / "out" / "index.html"
    if not out.exists():
        pytest.skip("no built page; run tools/judge_page.py first")
    page = out.read_text(encoding="utf-8")
    assert "class=money" in page
    for value in ("157,664", "13.89", "35.51", "13,303", "99,297"):
        assert value in page, f"{value} is computed and never shown"
