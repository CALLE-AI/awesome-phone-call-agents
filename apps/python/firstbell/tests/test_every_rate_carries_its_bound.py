"""A published rate carries the bound its sample size earns, and the bound says what of.

This entry already argued that a count of zero is not a rate of zero, and it published one
bound to prove it: 24 net-new escalations per 100 answered calls, which eleven calls cannot
rule out. A reader in the buyer's seat read the money card and asked the obvious next
question, which is what the other rate on the same eleven calls cannot rule out. The card
did not say. The escalation rate it measured is 45 per 100, its own upper limit is 73, and
both sit above the 34.3 where the saving stops.

So the omission was not cosmetic. A card printing one bound and one bare label invited a
reader to take 24 per 100 as what this sample cannot rule out about escalations, when the
escalation rate this run measured is already about twice it. The label said what the sample
was and never said what the rate was of.

Four things are held here.

  The arithmetic, as a precondition. The wider bound has to be the escalation one, it has
  to sit above the crossover, and the net-new bound has to sit below it. Those three facts
  are the whole commercial argument on this page: the narrow reading clears the crossover
  and the wide reading does not. If any of them flips, every sentence built on them is
  wrong and this file's other gates are checking the wording of a false claim.

  The two rates never share a column. `docs/the-money-in-full.md` narrates having made
  exactly that mistake once, when it put a bound measured on real calls straight above a
  crossover derived from an authored outcome mix and called it half the rate to spare. Both
  figures were right and the comparison was not one. Escalations per 100 and net-new per
  100 are rates of different things, so this walks each table and refuses a cell holding a
  figure that belongs only to the other quantity.

  Every surface publishes the wide reading, not just the page. The money document is the
  one a district follows the link to, and it had no mention of the escalation bound or of
  the cost the wide reading prices out to.

  The foot counts the rates it actually prints. The card's own summary sentence says how
  many rates are in it. That sentence is generated beside the rows it describes and it
  would still read "these three rates" over two rows if the escalation count ever went
  missing from the record, which is a small lie nothing else would catch.

The bound direction is deliberate and it is not applied to every rate on the page. An upper
limit is the conservative direction for a rate whose being higher costs a district money,
which is what both of these are. The consent-refusal rate and the held-sibling rate are
evidence that a gate fires rather than quantities anybody staffs a rota against, and a
one-sided upper limit on them would answer a question nobody asked.
"""
from __future__ import annotations

import html
import re
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
if str(APP / "tools") not in sys.path:
    sys.path.insert(0, str(APP / "tools"))

PAGE = APP / "out" / "index.html"
DOC = APP / "docs" / "the-money-in-full.md"

SPELLED = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6}


def _page() -> str:
    if not PAGE.exists():
        pytest.skip("no built page; run tools/judge_page.py with --receipts first")
    return PAGE.read_text(encoding="utf-8", errors="replace")


def _pooled() -> dict:
    import money_across_runs

    pooled = money_across_runs.pooled_live_row()
    assert pooled, (
        "there is no pooled row over the recorded calls, so there is no rate here to bound "
        "and nothing below is testing anything")
    return pooled


def _card() -> str:
    """The money card and the sentence under it, or a skip.

    Sliced from the opening tag to the end of its foot rather than read off the whole page,
    because every assertion here is about what one block says about itself.
    """
    markup = _page()
    start = markup.find("<dl class=money-key>")
    if start < 0:
        pytest.skip("this page has no money card to read, so it states no rates to bound")
    foot = markup.find("money-key-foot", start)
    end = markup.find("</p>", foot) if foot > 0 else markup.find("</dl>", start)
    assert end > start, "the money card has an opening tag and no end"
    return markup[start:end + 4]


def _tables(body: str) -> list[list[list[str]]]:
    """Every contiguous run of pipe lines, as rows of stripped cells.

    One header per table. A previous gate in this repository carried the first header it
    found through a whole document, which judged a later table against a heading that was
    not above it.
    """
    found = []
    for block in re.findall(r"(?:^[ \t]*\|.*\n?)+", body, re.M):
        rows = [[c.strip() for c in line.strip().strip("|").split("|")]
                for line in block.splitlines() if line.strip()]
        rows = [r for r in rows if not set("".join(r)) <= set("-: ")]
        if len(rows) >= 2:
            found.append(rows)
    return found


def _numbers(cells: list[str]) -> list[float]:
    out = []
    for cell in cells:
        try:
            out.append(round(float(cell.strip().strip("*")), 1))
        except ValueError:
            continue
    return out


def test_the_wide_reading_is_the_wider_bound_and_the_document_says_which_side_of_the_crossover_the_narrow_one_is():
    """The precondition, and the whole argument the money surfaces make.

    Written as one test because the facts are only worth anything together. A bound below
    the crossover means nothing if it is a bound on the wrong quantity, and a bound above
    the crossover means nothing if it is not the pessimistic one.

    It used to assert flatly that the narrow bound clears the crossover, which was true of
    every run this entry had ever published and stopped being true on 2026-09-11: widening
    `safeguarding_escalation` holds two more of the twelve recorded calls open, which lowers
    the desk time removed and raises the callback cost, and the crossover fell from 34.3 to
    22.9 while the bound rose from 24 to 47. A gate written as one side of that comparison
    fails when the data moves rather than when the prose is wrong, and the prose is the
    thing worth gating. So it now asserts the comparison and requires the money document to
    state whichever reading is true.
    """
    pooled = _pooled()
    for key in ("answered", "escalated", "net_new", "net_new_bound", "escalated_bound",
                "crossover_per_100"):
        assert pooled.get(key) is not None, (
            f"the pooled row no longer carries {key}, and the money card reads its rates "
            "and their bounds out of it")

    narrow = 100 * pooled["net_new_bound"]
    wide = 100 * pooled["escalated_bound"]
    crossover = pooled["crossover_per_100"]
    measured = 100 * pooled["escalated"] / pooled["answered"]

    assert wide > narrow, (
        f"the escalation bound ({wide:.1f} per 100) is no longer wider than the net-new "
        f"bound ({narrow:.1f}), so calling it the widest reading of these calls is wrong")
    # Two comparisons, two sentences the document must carry, one exact phrase each. The
    # count and the bound are on opposite sides of the crossover as of 2026-09-11, which is
    # exactly the state a single sentence loses.
    doc = DOC.read_text(encoding="utf-8")
    measured_net_new = 100 * pooled["net_new"] / pooled["answered"]
    for name, value, clears, fails in (
            ("bound", narrow,
             "**The bound sits inside it:**", "**The bound does not clear it at all:**"),
            ("count", measured_net_new,
             "**The count clears the crossover:**",
             "**The count does not clear the crossover:**")):
        said, unsaid = (clears, fails) if value < crossover else (fails, clears)
        assert said in doc, (
            f"the net-new {name} is {value:.1f} per 100 against a crossover of "
            f"{crossover:.1f}, and the document does not carry the sentence that says so: "
            f"{said!r}")
        assert unsaid not in doc, (
            f"the document still carries {unsaid!r} and the {name} is {value:.1f} per 100 "
            f"against a crossover of {crossover:.1f}")

    if narrow >= crossover:
        assert pooled["worst_case_ceiling"] < 0, (
            "the bound is past the crossover, so the worst case has to be a loss")

    assert wide > crossover and measured > crossover, (
        f"the escalation rate ({measured:.1f} per 100) and its bound ({wide:.1f}) no longer "
        f"sit above the {crossover:.1f} where the saving stops, so the card's sentence "
        "saying both are above it is false")


def test_the_money_document_never_puts_the_two_rates_in_one_column():
    """Escalations per 100 and net-new per 100 are rates of different things.

    The document says so about itself, having published 24 against 50.4 once and called it
    half the rate to spare. This is that lesson as a rule rather than a paragraph.
    """
    import money_across_runs

    pooled = _pooled()
    net_new = {round(row["crossover_per_100"], 1)
               for row in money_across_runs.rows(None)
               if row.get("crossover_per_100") is not None}
    net_new.add(round(100 * pooled["net_new_bound"], 1))
    for row in money_across_runs.rows(None):
        if row.get("net_new_per_100") is not None:
            net_new.add(round(row["net_new_per_100"], 1))

    escalation = {round(100 * pooled["escalated_bound"], 1),
                  round(100 * pooled["escalated"] / pooled["answered"], 1)}

    # Only a figure that belongs to exactly one of the two quantities can convict a column.
    # If a crossover ever lands on the escalation rate to a tenth, this gets weaker there
    # rather than wrong, which is the right way round.
    net_new_only, escalation_only = net_new - escalation, escalation - net_new

    body = DOC.read_text(encoding="utf-8")
    wrong = []
    for rows in _tables(body):
        header, data = " | ".join(rows[0]), rows[1:]
        names_net_new = bool(re.search(r"net[- ]new", header, re.I))
        names_escalation = bool(re.search(r"escalations?\b", header, re.I))
        if names_net_new == names_escalation:
            continue  # a header naming both, or neither, is not a column this can judge
        forbidden = escalation_only if names_net_new else net_new_only
        for row in data:
            for value in _numbers(row):
                if value in forbidden:
                    wrong.append(f"{value} under a header reading {header!r}")

    assert not wrong, (
        "these cells put a figure from one quantity in a column headed for the other. "
        "Escalations per 100 and net-new per 100 are not the same rate and a reader who "
        "compares them across a row gets a conclusion neither figure supports, which is the "
        "defect this document already records making once:\n  " + "\n  ".join(wrong))


def test_the_money_document_publishes_the_wide_reading_and_what_it_costs():
    """The document a district follows the link to, which had neither figure.

    It priced the saving in full and left the cost the pessimistic reading produces to the
    page. A reader who takes the document as the complete version, which its own title
    invites, met only the good number.
    """
    pooled = _pooled()
    body = DOC.read_text(encoding="utf-8")
    wide = 100 * pooled["escalated_bound"]
    measured = 100 * pooled["escalated"] / pooled["answered"]
    cost = pooled["ceiling_if_every_escalation_is_new"]

    assert f"{measured:.1f}" in body, (
        f"the document does not state the escalation rate these calls measured "
        f"({measured:.1f} per 100)")
    assert f"{wide:.1f}" in body, (
        f"the document does not state what this sample cannot rule out about that rate "
        f"({wide:.1f} per 100)")
    assert cost is not None and cost < 0, (
        "pricing every escalation as a callback no longer produces a cost, so the sentence "
        "below is describing arithmetic that has changed")
    assert f"${abs(cost):.2f}" in body, (
        f"the document states the bound and not the cost it prices out to "
        f"(${abs(cost):.2f} a call)")


def test_the_card_says_what_each_bound_is_a_rate_of():
    """A bare "per 100" beside "cannot rule out" is the defect this replaced.

    The label named the sample and never the quantity, so the one figure a reader could
    take away was ambiguous in the direction that flattered the entry.
    """
    pooled = _pooled()
    card = _card()
    flat = html.unescape(re.sub(r"<[^>]+>", " ", card))
    flat = re.sub(r"\s+", " ", flat)

    narrow = f"{100 * pooled['net_new_bound']:.0f}"
    wide = f"{100 * pooled['escalated_bound']:.0f}"

    assert re.search(rf"{narrow}\s+net[- ]new per 100", flat), (
        f"the card prints {narrow} per 100 without saying it is a net-new rate. The "
        "escalation rate on the same calls is about twice it, so the unqualified label "
        f"reads as a bound on escalations:\n  {flat[:400]}")
    assert re.search(rf"\b{wide}\s+per 100", flat), (
        f"the card no longer prints the escalation rate's own bound ({wide} per 100), "
        "which is the wider of the two and the one a finance office plans against")
    assert "escalation" in flat.lower(), (
        "the card prints two bounds and names neither quantity in words")


def test_the_card_names_which_figure_to_quote_and_never_promises_the_ceiling():
    """The largest label on this page used to say save over a number the README calls a
    ceiling.

    A district buyer in a blind seat read the card, counted four money figures across the
    entry and said they could not tell which one it stood behind. Two answers belong in the
    card rather than eighty lines under it: the smaller figure to quote, which is the demo
    run's because one command reproduces it, and the cost this becomes under the reading
    that prices every escalated call as a callback.

    Both are checked against what `money_across_runs` computes, not against a literal,
    because a card that hard codes a price is the defect the rest of this page is about.
    """
    card = html.unescape(_card())
    pooled = _pooled()

    headline = re.search(r"<dt>([^<]*)</dt>", card)
    assert headline, "the money card no longer opens with a label"
    label = headline.group(1).lower()
    assert "can save" not in label or label.startswith("the most"), (
        f"the card's first label reads {headline.group(1)!r}, which promises a saving. The "
        "figure under it prices every removed attempt at a desk rate nobody has audited, "
        "and the README calls it a ceiling and not a saving")

    import money_across_runs
    demo = money_across_runs.demo_row()["net_ceiling"]
    every = pooled["ceiling_if_every_escalation_is_new"]
    assert every < 0, (
        "the pessimistic reading is no longer a cost, so the sentence this gate checks is "
        "about something that has stopped being true")

    assert f"${demo:,.2f}" in card, (
        f"the card does not name the figure to quote (${demo:,.2f}, the demo run's), so a "
        "reader is left to pick between the four money numbers on this page")
    assert f"${abs(every):,.2f}" in card, (
        f"the card does not name the cost the widest reading prices out to "
        f"(${abs(every):,.2f} a call), which is the figure a finance office plans against")
    # Whichever of the two is smaller is the one the card must tell a reader to quote, and
    # the card has to name it as the smaller one. This used to assert flatly that the demo
    # run was smaller, which was true until the safeguarding rule widened on 2026-09-11 and
    # the recorded calls' net ceiling fell below it. A gate asserting which figure wins
    # fails when the data moves; a gate asserting that the card picked the winner fails when
    # the card is wrong, which is the thing worth catching.
    smaller = min(demo, pooled["net_ceiling"])
    larger = max(demo, pooled["net_ceiling"])
    picked = re.search(r"Quote the (?:demo run's )?\$([\d,.]+)", card)
    assert picked, "the card no longer tells a reader which figure to quote"
    assert float(picked.group(1).replace(",", "")) == round(smaller, 2), (
        f"the card tells a reader to quote ${picked.group(1)} and the smaller of the two "
        f"figures is ${smaller:,.2f}, so it is pointing at the more flattering one")
    assert f"${larger:,.2f}" in card, (
        f"the card names only the figure it recommends. The other one (${larger:,.2f}) has "
        "to be on the card too, or a reader cannot see that a choice was made")
    assert "the smaller of the two" in card, (
        "the card no longer says why the figure it names is the one to quote")


def test_the_card_foot_counts_the_rates_it_actually_prints():
    """The sentence under the rows says how many of them are rates. It has to be right.

    Generated beside the rows it describes, which is what makes it worth gating: the count
    is spelled out in words and would go on reading "these three rates" over two rows if the
    escalation count ever went missing from the record.
    """
    card = _card()
    values = re.findall(r"<dd>(.*?)</dd>", card, re.S)
    assert values, "the money card has no figures in it"
    rates = [v for v in values if "per 100" in v]

    foot = re.search(r"these\s+(\w+)\s+rates", html.unescape(card))
    assert foot, (
        "the card's foot no longer says how many rates it prints, which is the sentence "
        "this gate exists to keep true")
    claimed = SPELLED.get(foot.group(1).lower())
    assert claimed is not None, (
        f"the foot says {foot.group(1)!r} rates and that is not a number this can check")
    assert claimed == len(rates), (
        f"the foot claims {claimed} rates and the card prints {len(rates)}: "
        + "; ".join(re.sub(r"<[^>]+>", "", v).strip() for v in rates))


def test_the_foot_counts_the_rates_on_a_card_that_prints_one_fewer():
    """The count is only worth checking on a card whose row count can change.

    The gate above reads the built page, and on this record the escalation bound always
    prints, so the foot always says three over three rows and the comparison can only ever
    agree. The count used to be assigned inside the same branch that added the fourth row,
    so the two could not disagree and that gate's own docstring described a failure nothing
    could reach.

    A card built from a record with no escalations prints one rate fewer. That is the state
    where a literal shows, so both states are checked here and the number is read off the
    rows in each.
    """
    import judge_page

    for escalated, expected in ((_pooled().get("escalated"), None), (0, None)):
        pooled = dict(_pooled())
        pooled["escalated"] = escalated
        card = judge_page._money_key_block({"pooled": pooled})

        values = re.findall(r"<dd>(.*?)</dd>", card, re.S)
        rates = [one for one in values if "per 100" in one]
        foot = re.search(r"these\s+(\w+)\s+rates", html.unescape(card))
        assert foot, (
            f"a card built with escalated={escalated} prints no count of its rates, and "
            "that sentence is the one a reader checks the rows against")
        claimed = SPELLED.get(foot.group(1).lower())
        assert claimed is not None, (
            f"the foot says {foot.group(1)!r} rates, which is not a number this can check")
        assert claimed == len(rates), (
            f"with escalated={escalated} the foot claims {claimed} rates and the card "
            f"prints {len(rates)}: "
            + "; ".join(re.sub(r"<[^>]+>", "", one).strip() for one in rates))
