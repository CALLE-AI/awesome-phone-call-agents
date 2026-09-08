"""The volume figure is recomputed from its registered inputs, not read off the prose.

A reader in the buyer's seat put it plainly: every figure in this entry is per call, so there
is no annual total for a finance director. The pilot document was candid about why, which is
that how many unexplained absences a district handles in a morning is a number a school office
has and this project does not. Candour is not an answer to a board paper.

`docs/what-a-pilot-would-look-like.md` now derives one from California's certified 2023-24
absence data, in four printed lines. This gate holds every one of them.

The reason it recomputes rather than string-matches is the class of defect this entry keeps
finding in itself. A derived figure typed into prose is a second copy of a number, and the
second copy is the one that goes stale. Four inputs and a school-year length are registered in
`evidence/statistics.json` with the sentence each came from; the arithmetic lives here; and the
document is checked against the result. Change an input at source and this fails rather than
publishing a rate that no longer follows from it.

Two things it deliberately also checks, because the figure is more dangerous than it is useful
if either goes missing from the page beside it.

  That the document says the figure is a ceiling and not an estimate. California's test is
  absence without a valid excuse, which is wider than absence nobody explained: a parent who
  telephones to report a holiday has explained it and it is still unexcused. A reader who takes
  28 per 1,000 as the number of families this software would ring is being over-sold, by us.

  That both ends of the money are printed. The saving and the cost the widest reading produces
  are one multiplication apart from the same volume, and publishing the annual saving without
  the annual cost is the vendor move this entry was built to argue against.

One figure in the source is not used and the document says why: Los Angeles Unified's own row
works out at 41 per 1,000 a school day and reports 0.0% of absence days as out-of-school
suspension, where the state reports 0.9%. For a district of 396,000 students that is a coding
difference rather than a fact about children.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
if str(APP / "tools") not in sys.path:
    sys.path.insert(0, str(APP / "tools"))

DOC = APP / "docs" / "what-a-pilot-would-look-like.md"
REGISTER = APP / "evidence" / "statistics.json"

# The five registered inputs, by the id they carry in the register.
ENROLMENT = "ca-eligible-enrolment"
WITH_ABSENCES = "ca-students-with-absences"
AVERAGE_DAYS = "ca-average-days-absent"
UNEXCUSED_SHARE = "ca-unexcused-absence-share"
SCHOOL_YEAR = "ca-instructional-days"

EXAMPLE_DISTRICT = 10_000


def _register() -> dict[str, dict]:
    held = json.loads(REGISTER.read_text(encoding="utf-8"))["figures"]
    return {figure["id"]: figure for figure in held}


def _number(figure: dict) -> float:
    """The registered value as arithmetic, with the percent sign meaning what it says."""
    bare = str(figure["value"]).replace(",", "").replace("$", "").strip()
    if bare.endswith("%"):
        return float(bare.rstrip("%")) / 100
    return float(bare)


def _derived() -> dict[str, float]:
    """The four printed lines, recomputed from the register.

    Ordered exactly as the document prints them so a failure names the line that moved.
    """
    held = _register()
    for key in (ENROLMENT, WITH_ABSENCES, AVERAGE_DAYS, UNEXCUSED_SHARE, SCHOOL_YEAR):
        assert key in held, (
            f"evidence/statistics.json no longer registers {key}, and the volume figure in "
            f"{DOC.name} is derived from it")

    enrolment = _number(held[ENROLMENT])
    with_absences = _number(held[WITH_ABSENCES])
    average = _number(held[AVERAGE_DAYS])
    share = _number(held[UNEXCUSED_SHARE])
    year = _number(held[SCHOOL_YEAR])

    absence_days = average * with_absences
    unexcused_days = absence_days * share
    a_student_a_year = unexcused_days / enrolment
    return {
        "absence_days": absence_days,
        "unexcused_days": unexcused_days,
        "a_student_a_year": a_student_a_year,
        "per_thousand_a_day": a_student_a_year / year * 1000,
        "school_year": year,
    }


def _doc() -> str:
    """The document with its whitespace collapsed.

    Collapsed on purpose. Every assertion below is about a sentence or a figure and none of
    them is about where the file happens to wrap. The first version read the raw text, and
    the definition it looked for was broken across two lines, so the gate failed on a
    document that said exactly what it had been asked to say.
    """
    return re.sub(r"\s+", " ", DOC.read_text(encoding="utf-8"))


def test_every_line_of_the_derivation_is_one_the_register_produces():
    """The four printed lines, each checked against the arithmetic rather than each other.

    Whole counts to the nearest unit, the rate to a tenth, which is the precision the
    document prints them at. A tighter tolerance would fail on the document's own rounding
    and a looser one would let a real drift through.
    """
    got = _derived()
    doc = _doc()

    assert f"{got['absence_days']:,.0f}" in doc, (
        f"the derivation's first line no longer prints {got['absence_days']:,.0f} absence "
        "days, which is the average days absent times the students who missed a day")
    assert f"{got['unexcused_days']:,.0f}" in doc, (
        f"the second line no longer prints {got['unexcused_days']:,.0f} unexcused days")
    assert f"{got['a_student_a_year']:.1f} unexcused absences a student a year" in doc, (
        f"the third line no longer prints {got['a_student_a_year']:.1f} unexcused absences "
        "a student a year")
    assert f"{got['per_thousand_a_day']:.1f} per 1,000" in doc, (
        f"the document does not print the rate the register produces "
        f"({got['per_thousand_a_day']:.1f} per 1,000 a school day)")


def test_the_headline_rounds_the_derived_rate_and_does_not_replace_it():
    """A round number is what a reader remembers, so it has to be the derived one rounded."""
    got = _derived()
    doc = _doc()
    rounded = round(got["per_thousand_a_day"])
    assert re.search(rf"About {rounded} unexplained absences per 1,000", doc), (
        f"the headline is not 'About {rounded}', which is what "
        f"{got['per_thousand_a_day']:.1f} rounds to")
    assert str(int(got["school_year"])) in doc, (
        "the document divides by a school year it does not name")


def test_the_school_year_sensitivity_is_computed_and_not_asserted():
    """The year length moves the answer more than any rounding in the source, so it is shown.

    Both alternatives are recomputed here. The document used to be able to say anything at
    all about them.
    """
    got = _derived()
    doc = _doc()
    for days in (175, 185):
        at = got["a_student_a_year"] / days * 1000
        assert f"{at:.1f} at {days}" in doc, (
            f"the document does not state the rate at {days} instructional days "
            f"({at:.1f} per 1,000). The year length is the largest lever on this figure "
            "and a reader who cannot see it cannot judge the number")


def test_the_annual_example_is_that_volume_times_the_money_the_tool_computes():
    """The multiplication a finance director does, done here from both sources.

    The volume comes from the register and the two rates come from
    `money_across_runs.pooled_live_row`, so the annual figures in the document cannot drift
    from either half.
    """
    from money_across_runs import pooled_live_row

    pooled = pooled_live_row()
    assert pooled, "there is no pooled row, so there is no per-call figure to annualise"
    got = _derived()
    doc = _doc()

    a_year = got["a_student_a_year"] * EXAMPLE_DISTRICT
    a_morning = a_year / got["school_year"]
    assert f"{a_morning:,.0f} calls on a school morning" in doc, (
        f"the document does not state {a_morning:,.0f} calls a morning for a "
        f"{EXAMPLE_DISTRICT:,}-student district")
    assert f"{a_year:,.0f} in a year" in doc, (
        f"the document does not state {a_year:,.0f} calls a year")

    saving = a_year * pooled["net_ceiling"]
    cost = a_year * abs(pooled["ceiling_if_every_escalation_is_new"])
    # To the hundred dollars, which is the precision a board paper uses and the precision
    # the document prints. Both ends, because one end is a sales figure.
    assert f"${round(saving, -2):,.0f}" in doc.replace("**", ""), (
        f"the document does not state the annual saving the tool's own per-call figure "
        f"produces at this volume (${round(saving, -2):,.0f})")
    assert f"${round(cost, -2):,.0f}" in doc.replace("**", ""), (
        f"the document states an annual saving and not the annual cost the widest reading "
        f"of the same calls produces (${round(cost, -2):,.0f}). Publishing one without the "
        "other is the thing this entry argues against")


def test_the_document_says_the_figure_is_a_ceiling_and_why():
    """The figure is more dangerous than useful without this sentence beside it.

    California counts a telephoned-in holiday as unexcused, so the measure is wider than
    the thing this software acts on. A reader who takes 28 per 1,000 for the number of
    families it would ring has been over-sold.
    """
    doc = _doc()
    assert re.search(r"without a valid excuse", doc), (
        "the document publishes an unexcused-absence rate without the publisher's "
        "definition of unexcused, which is what makes it a ceiling rather than a measure")
    assert re.search(r"\bceiling\b", doc), (
        "nothing in the document says the volume figure is a ceiling on what this software "
        "would call about")
    assert re.search(r"subset|upper bound", doc), (
        "the document does not say the call volume is smaller than the absence volume, so "
        "a reader multiplies the per-call money by too many calls")
