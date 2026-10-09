"""The sample size beside a real-call figure is read out of the record, not remembered.

`evidence/recorded-calls.json` is the only numerator in this entry nobody chose. It holds
twelve calls placed, eleven of them answered, and it deliberately keeps two versions of the
net-new escalation count: `net_new_escalations`, which is what every call comes to when it is
re-filed under today's code, and `net_new_escalations_as_recorded`, which is what the receipts
said before one case was corrected from resolved to undetermined. Keeping both is the point.
Quoting the wrong one is the defect.

Three surfaces had drifted from that file, and an audit of the tree found them rather than
this suite:

  `evidence/README.md` listed the file's own integers and ended on the stale one, two
  paragraphs above the section narrating the correction that made it zero.

  `docs/the-money-in-full.md` put "12 real calls" against three rows of a table headed
  "Net-new per 100 answered calls", and called the sample "twelve calls" in the prose under
  it, while its own prose two paragraphs earlier said eleven and README's copy of the same
  table had always said eleven.

  The money card on the built page read "What 12 calls cannot rule out" over a bound computed
  from `answered`, eleven lines above a paragraph that reads the same record correctly.

An escalation cannot happen on a call nobody answered.

A note on scope, because the first version of this gate got it wrong. It allowed a nearby
sentence explaining the difference between placed and answered to excuse a match, over a
window of 180 characters. In a table that window reaches the next row, so a wrong cell was
excused by the correct cell beside it, and the mutation of the money table survived. Every
check here is now scoped to one sentence, or to one table cell, which is the unit a reader
actually reads.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
RECORD = APP / "evidence" / "recorded-calls.json"

SPELLED = {0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
           7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve",
           13: "thirteen", 14: "fourteen"}

# Words that make a rate a rate. A sample size only matters beside one of these.
A_RATE = r"(?:answered|net[- ]new|escalation|rule fired|cannot rule out|per 100)"


def _counts() -> dict[str, int]:
    return json.loads(RECORD.read_text(encoding="utf-8"))["counts"]


def _documents() -> list[tuple[str, str]]:
    """Every reader-facing document, plus the built page, unflattened.

    `evidence/MUTATIONS.md` records the sentences these rules refuse and the page renders
    that table, so both are cut back to their prose. The README makes real claims inside
    tables, so its rows stay.
    """
    found: list[tuple[str, str]] = []
    for rel in ["README.md", "evidence/README.md", "call-e-feedback.md"]:
        path = APP / rel
        if path.is_file():
            found.append((rel, path.read_text(encoding="utf-8", errors="replace")))
    for path in sorted((APP / "docs").glob("*.md")):
        found.append((f"docs/{path.name}", path.read_text(encoding="utf-8", errors="replace")))

    ledger = APP / "evidence" / "MUTATIONS.md"
    if ledger.is_file():
        found.append(("evidence/MUTATIONS.md", "\n".join(
            ln for ln in ledger.read_text(encoding="utf-8").splitlines()
            if not ln.startswith("|"))))

    page = APP / "out" / "index.html"
    if page.is_file():
        markup = re.sub(r"<tr>.*?</tr>", " ", page.read_text(encoding="utf-8",
                                                             errors="replace"), flags=re.S)
        # A block element ends a unit. Without this the whole money card flattens into one
        # run with no full stop in it, and the footnote under the card excused the label
        # above it, which is the same hole the 180-character window had. A reader takes
        # `<dt>What 12 calls cannot rule out</dt>` as a claim on its own, so the gate does.
        markup = re.sub(r"</(?:dt|dd|p|li|h1|h2|h3|div|figcaption|summary|caption)>",
                        ". ", markup)
        found.append(("out/index.html", html.unescape(re.sub(r"<[^>]+>", " ", markup))))
    return found


def _sentences(body: str) -> list[str]:
    """One sentence at a time, whitespace collapsed, table rows kept whole.

    A markdown row is not a sentence and has no full stop, so it would otherwise join the
    paragraph above and below it into one long unit, which is how the neighbouring cell got
    to excuse the wrong one.
    """
    out: list[str] = []
    for line in body.splitlines():
        if line.lstrip().startswith("|"):
            out.extend(cell.strip() for cell in line.split("|") if cell.strip())
        else:
            out.append(line)
    joined = "\n".join(out)
    return [re.sub(r"\s+", " ", part).strip()
            for part in re.split(r"(?<=[.;:!?])\s+|\n{2,}", joined) if part.strip()]


def test_the_record_still_holds_two_escalation_counts():
    """The precondition. If the file stops keeping both, the gates below are about nothing."""
    counts = _counts()
    for key in ("calls", "answered", "net_new_escalations",
                "net_new_escalations_as_recorded"):
        assert key in counts, (
            f"evidence/recorded-calls.json no longer holds {key}, and the gates below read "
            "their expected numbers out of it")
    assert counts["answered"] < counts["calls"], (
        "every recorded call was answered, so the two denominators have converged and the "
        "gate below can no longer tell a right one from a wrong one. Re-read it.")
    assert counts["net_new_escalations"] != counts["net_new_escalations_as_recorded"], (
        "the re-filed and as-recorded escalation counts now agree. The file kept both to "
        "document a correction; if the correction is gone, so is the reason for this gate.")


def test_no_surface_states_the_stale_escalation_count_as_current():
    """The as-recorded number is quotable, and only in a sentence that says which one it is."""
    counts = _counts()
    stale, current = (counts["net_new_escalations_as_recorded"],
                      counts["net_new_escalations"])

    says_stale = re.compile(
        rf"\b(?:{stale}|{SPELLED[stale]})\b[^.;:!?]{{0,24}}?net[- ]new escalation", re.I)
    # What makes it honest is naming which version it is, in the same sentence. A qualifier a
    # paragraph away does not travel: a reader takes the sentence they are reading.
    qualified = re.compile(
        r"as[- ]recorded|as first written|at the time|before the correction"
        r"|the receipts recorded|originally|used to", re.I)

    claiming = []
    for where, body in _documents():
        for sentence in _sentences(body):
            found = says_stale.search(sentence)
            if found and not qualified.search(sentence):
                claiming.append(f"{where}: " + sentence[:150])

    assert not claiming, (
        f"these state {stale} net-new escalation(s) without saying in the same sentence that "
        f"it is the as-recorded figure. Re-filed under today's code the count is {current}, "
        "which is what evidence/recorded-calls.json holds under `net_new_escalations`:\n  "
        + "\n  ".join(claiming))


def test_no_table_cell_offers_the_placed_count_as_an_answered_denominator():
    """A table whose column is a rate per answered call has the answered count in its cells.

    The structural half of this rule, and the half the first version missed. Three rows of
    `docs/the-money-in-full.md` read "12 real calls" under a column reading "Net-new per 100
    answered calls". A cell is its own unit: what the row beside it says cannot make it true.
    """
    counts = _counts()
    placed, answered = counts["calls"], counts["answered"]
    names_placed = re.compile(rf"^\**\s*(?:{placed}|{SPELLED[placed]})\b[\w\s]{{0,20}}calls?",
                              re.I)

    wrong = []
    for where, body in _documents():
        if where.endswith(".html"):
            continue  # the page's own rows are cut above; its prose is the test below
        # One table at a time. A document holds several, each with its own header, and the
        # first version of this carried the first header it found through the whole file, so
        # a later table was judged against a heading that was not above it. Tables here are
        # contiguous runs of lines starting with a pipe.
        for block in re.findall(r"(?:^[ \t]*\|.*\n?)+", body, re.M):
            rows = [ln for ln in block.splitlines() if ln.strip()]
            cells_per_row = [[c.strip() for c in ln.strip().strip("|").split("|")]
                             for ln in rows]
            body_rows = [c for c in cells_per_row if not set("".join(c)) <= set("-: ")]
            if len(body_rows) < 2:
                continue
            header, data = body_rows[0], body_rows[1:]
            if not any(re.search(rf"per 100 {A_RATE}|answered", h, re.I) for h in header):
                continue
            for row in data:
                for cell in row:
                    if names_placed.match(cell):
                        wrong.append(
                            f"{where}: cell {cell!r} under header "
                            + " | ".join(h for h in header if h))

    assert not wrong, (
        f"these table cells offer the {placed} calls placed as the sample for a column that "
        f"is a rate per answered call. {placed - answered} of them reached nobody and an "
        "escalation cannot happen on a call nobody answered, so the denominator is the "
        f"{answered} that answered:\n  " + "\n  ".join(wrong))


def test_no_sentence_calls_the_placed_count_the_sample_for_a_rate():
    """The prose half, scoped to one sentence.

    "the sample is twelve calls" sat under that table. A sentence that explains the gap
    between placed and answered is doing the opposite of collapsing it, and the sentence
    that replaced this one does exactly that, so it is allowed to name both numbers.
    """
    counts = _counts()
    placed, answered = counts["calls"], counts["answered"]

    sample = re.compile(
        rf"(?:sample is|sample of|measured on|computed over|over)\s+"
        rf"(?:{placed}|{SPELLED[placed]})\b[\w\s]{{0,16}}calls?"
        rf"|(?:{placed}|{SPELLED[placed]})\b[\w\s]{{0,16}}calls?\s+"
        rf"(?:cannot rule out|is the sample|are the sample)", re.I)
    explaining = re.compile(
        rf"\b(?:{answered}|{SPELLED[answered]})\b[\w\s]{{0,16}}(?:answered|of them)"
        rf"|reached nobody|nobody answered|unanswered|answered\b[^.;:!?]{{0,24}}"
        rf"\b(?:{answered}|{SPELLED[answered]})\b", re.I)

    claiming = []
    for where, body in _documents():
        for sentence in _sentences(body):
            found = sample.search(sentence)
            if found and not explaining.search(sentence):
                claiming.append(f"{where}: " + sentence[:150])

    assert not claiming, (
        f"these call the {placed} calls placed the sample for a rate computed over the "
        f"{answered} that were answered, without saying in the same sentence that the two "
        "differ:\n  " + "\n  ".join(claiming))
