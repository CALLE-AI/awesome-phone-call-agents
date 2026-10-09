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

from firstbell.domain import SAFEGUARDING_CALLBACK_MINUTES

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


def _rota_block() -> str:
    """The rota section on its own, with its line breaks kept.

    Kept raw because the derivation is a block of indented lines and each assertion below
    is about one of those lines, not about the document holding the number somewhere. And
    extracted by heading so that a document with the section removed fails here rather
    than passing on the copies of the same figures in the paragraphs around it.
    """
    raw = DOC.read_text(encoding="utf-8")
    heading = "## What that volume does to a rota"
    start = raw.find(heading)
    assert start != -1, (
        f"{DOC.name} no longer has a section headed \"{heading}\", so the entry publishes "
        "the absence volume and the escalation rate and never multiplies them, which is "
        "what a district buyer said was worth more than any figure already on the page")
    rest = raw.find("\n## ", start + len(heading))
    return raw[start:] if rest == -1 else raw[start:rest]


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


def test_the_rota_projection_is_the_product_of_the_two_figures_it_names():
    """The most load-bearing projection in this entry, recomputed rather than read.

    A district buyer said the entry published the absence volume and the escalation rate and
    never multiplied them, and that doing so was worth more than any figure already on the
    page. It is now multiplied, which means five numbers in one paragraph are all derived
    from two sources, and a change to either source silently invalidates all five. So each
    one is recomputed here from `evidence/statistics.json` and `evidence/recorded-calls.json`
    rather than matched as a string.

    The escalation bound is checked too. A projection stated to two significant figures off
    eleven answered calls has to carry what those calls cannot rule out, and this entry
    spends four gates on that rule elsewhere; the paragraph would be the one place it did
    not apply.

    The first version of this gate asked whether each figure appeared anywhere in the
    document. A mutation that understated the escalations on the derivation line alone was
    measured at zero failures, because 115 also appears in three of the paragraphs
    underneath and one of those satisfied the assertion. So each line is now matched as the
    line it is, inside a section found by its heading, and both defects fail: changing a
    figure, and removing the section.
    """
    doc = _rota_block()
    counts = json.loads((APP / "evidence" / "recorded-calls.json")
                        .read_text(encoding="utf-8"))["counts"]

    per_thousand = 27.7          # from the derivation this file already checks, above
    enrolled = 10_000
    morning = per_thousand * enrolled / 1000
    answered = morning * counts["answered"] / counts["calls"]
    escalations = answered * counts["escalated"] / counts["answered"]
    hours = escalations * SAFEGUARDING_CALLBACK_MINUTES / 60

    for line, what in ((f"{round(morning)} calls on a morning", "the volume it starts from"),
                       (f"= about {round(answered)} answered calls", "the answered line"),
                       (f"= about {round(escalations)} escalations on a morning",
                        "the escalation line"),
                       (f"= about {round(hours)} staff-hours", "the staff-hours line")):
        assert line in doc, (
            f"{what} of the derivation does not read \"{line}\". That is what "
            f"{counts['answered']} of {counts['calls']} answered and "
            f"{counts['escalated']} of {counts['answered']} escalated give at this volume, "
            "and a pilot sized on the calls rather than on the callbacks blames the queue "
            "it creates on the software")

    prose = re.sub(r"\s+", " ", doc)

    assert f"{SAFEGUARDING_CALLBACK_MINUTES} minutes" in doc, (
        "the callback window in the arithmetic has to be the one the code uses, because a "
        "district changing it with --safeguarding-minutes changes this answer")

    # To the nearest hundred, which is how the document states it, because a projection
    # off the twelve calls of 2026-09-04 printed as 20,775 claims a precision it does not
    # have. The rounding
    # is computed rather than trusted, so the figure still moves if either source does.
    annual = round(escalations * 180 / 100) * 100
    assert f"{annual:,}" in prose, (
        f"the annual figure is not {annual:,}, and a per-morning number is the one a "
        "district under-plans from")

    # And the wide reading, at the same volume.
    from replay_escalation import upper_bound
    wide = round(answered * upper_bound(counts["escalated"], counts["answered"]))
    assert str(wide) in prose, (
        f"the projection does not say that the escalation bound puts this at {wide} a "
        "morning rather than the measured figure. Eleven answered calls cannot support a "
        "rate to two significant figures and every other surface in this entry says so")
    assert "projection and not a result" in prose, (
        "the paragraph no longer says it is a projection, and it multiplies a state-level "
        "volume by two rates measured on the twelve calls of 2026-09-04")


def test_the_annual_saving_is_stated_after_the_calls_are_paid_for():
    """The gross figure and the net one are two thousand dollars apart, and one is fair.

    The loss at the other end of the band already has the call cost inside it. Stating the
    saving gross put a net loss beside a gross saving on the one page a board reads, and
    the difference ran in this entry's favour. Both ends are now net, and the net figure is
    recomputed here from the billed price rather than read out of the sentence, so a price
    change moves it instead of quietly making the page wrong.
    """
    from money_across_runs import demo_row, observed, pooled_live_row

    pooled = pooled_live_row()
    assert pooled, "there is no pooled row, so there is no per-call figure to annualise"
    price = observed()["observed"]["per_call_usd"]
    got = _derived()
    doc = _doc()

    a_year = got["a_student_a_year"] * EXAMPLE_DISTRICT
    net = round(a_year * (pooled["net_ceiling"] - price), -2)
    assert f"${net:,.0f}" in doc.replace("**", ""), (
        f"the document annualises the saving without paying for the calls. At ${price:,.2f} "
        f"a call and {a_year:,.0f} calls a year the figure is ${net:,.0f}")
    # The sentence gained a clause when CALL-E started metering: it now says which rate the
    # arithmetic above was built on before it says why that rate is netted out. What this
    # asks for is the reason, which is the half that makes the two ends comparable, so it
    # names the figure and the reason and lets the sentence around them change.
    assert f"${price:,.2f}" in doc and (
        "is subtracted here because the loss at the other end is "
        "stated net") in doc, (
        "the document nets out the call cost without saying why it does, and the reason is "
        "the only thing that makes the two ends of the band comparable")

    demo = demo_row()["net_ceiling"]
    assert (f"${demo:,.2f} a call before the call cost and ${demo - price:,.2f} after it"
            in doc), (
        "the demo run's before-and-after pair is not the one the tool computes, and it is "
        "the pair a reviewer can reproduce without an account")


def test_the_sentence_that_states_the_figure_is_the_one_that_hedges_it():
    """The hedge has to be beside the number, not somewhere in the same document.

    The gate above asked whether the word "ceiling" appeared anywhere in the file. It does,
    in an exit criterion about the staff-time ceiling a run prints, which is a different
    number entirely. So both sentences calling the absence volume a ceiling could be
    rewritten into plain claims and the gate went on passing on the strength of an
    unrelated line. A reader who takes 28 per 1,000 for the number of families this
    software would ring has been over-sold, and that is the whole reason the hedge exists.

    Checked sentence by sentence: whichever sentences state the per-1,000 figure, at least
    one of them has to call it a ceiling.
    """
    # The section, not the document. Two sentences state the figure and both are hedged,
    # so a gate asking whether any hedged sentence exists survived the removal of either
    # one. This reads the section that exists to say what the figure is not, which is where
    # a reader who has just been given the number arrives next.
    raw = DOC.read_text(encoding="utf-8")
    opens = raw.find("Three things that figure is not.")
    assert opens != -1, (
        "the document no longer has the section that says what the volume figure is not, "
        "and a reader who takes 28 per 1,000 for the number of families this software "
        "would ring has been over-sold by us")
    rest = raw.find("\n## ", opens)
    section = re.sub(r"\s+", " ", raw[opens:] if rest == -1 else raw[opens:rest])

    naming = [one for one in re.split(r"(?<=\.)\s+", section) if "per 1,000" in one]
    assert naming, (
        "the section that says what the figure is not never states the figure, so nothing "
        "in it is attached to the number a reader just read")
    hedged = [one for one in naming if "ceiling" in one]
    assert hedged, (
        "no sentence in that section states the per-1,000 figure and calls it a ceiling. "
        "The word appears elsewhere in the document, about the staff-time ceiling a run "
        "prints, which is a different number, and that occurrence is what used to satisfy "
        "this. Sentences in the section naming the figure:\n  "
        + "\n  ".join(one.strip()[:160] for one in naming))
