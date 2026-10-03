"""The Phase 4 evidence artifacts cannot claim more than they hold.

docs/evidence-table.md is checked against the machine-readable cassette
registry, and docs/why-the-phone.md is checked for the freeze's own rules:
verbatim-quote framing, the plain not-found statement where a source does
not exist, and the absolute absence of market-size, frequency,
productivity or recovered-money claims.
"""

from __future__ import annotations

import re
from pathlib import Path

from warrantyops.cassettes import registry_rows

DOCS = Path(__file__).resolve().parents[1] / "docs"
PILLS = ("Recorded CALL-E result", "Synthetic scenario", "Fictional case data")


def evidence_table() -> str:
    return (DOCS / "evidence-table.md").read_text(encoding="utf-8")


def why_the_phone() -> str:
    """The doc with runs of whitespace collapsed, so line-wrapping is free."""

    return " ".join((DOCS / "why-the-phone.md").read_text(encoding="utf-8").split())


# --- the evidence table against the registry ------------------------------------------


def test_every_executed_row_carries_exactly_one_pill():
    executed = evidence_table().split("## Executed evidence")[1].split(
        "## Failed authorized attempts"
    )[0]
    for line in executed.splitlines():
        if not line.strip().startswith("|") or "---" in line or "Evidence class" in line:
            continue
        found = [pill for pill in PILLS if pill in line]
        assert len(found) == 1, (line, found)


def test_no_limitation_row_carries_an_evidence_pill():
    limitations = evidence_table().split("## Limitations")[1]
    for pill in PILLS:
        assert pill not in limitations


def test_the_table_mirrors_the_registry_statuses():
    table = evidence_table()
    by_row = {row.row: row for row in registry_rows()}
    assert "R1 — runtime proof call" in table
    assert by_row["R1"].status == "recorded"
    assert "unavailable — recorded before the cassette program" in table or (
        "recorded before the cassette program" in table
    )
    assert "R2 — stated status" in table
    assert by_row["R2"].status == "synthetic-only"
    # R8/R3 failed and are limitations; the remaining live rows are unexecuted.
    assert by_row["R8"].status == "attempted/failed"
    assert by_row["R3"].status == "recorded"
    for number in (5, 6, 7):
        assert f"R{number} (recorded)" in table
        assert by_row[f"R{number}"].status == "planned/gated"
    assert "R9" in table
    assert "R1b" in table


def test_planned_rows_are_limitations_not_evidence():
    table = evidence_table()
    assert "planned/gated — not executed; no platform fact observed" in table
    assert "Limitations — rows never executed" in table
    assert "never reconstructed" in table


def test_failed_attempts_are_disclosed_without_evidence_pills():
    failed = evidence_table().split("## Failed authorized attempts")[1].split(
        "## Limitations"
    )[0]
    assert "R8" in failed
    assert "one provider call" in failed
    assert "zero retries" in failed
    assert "zero-duration `404`" in failed
    assert "`transcript_turns: 0`" in failed
    assert "`claim_status: UNKNOWN`" in failed
    assert "not evidence" in failed
    assert "`US`/`en-US` routing" in failed
    for pill in PILLS:
        assert pill not in failed


# --- why-the-phone: the freeze's own rules ---------------------------------------------


def test_the_plain_not_found_statement_is_present():
    doc = why_the_phone()
    assert "Not found in public sources:" in doc


def test_no_forbidden_quantified_claims_appear():
    doc = why_the_phone()
    for forbidden in ("$", "%", "billion", "million"):
        assert forbidden not in doc.lower(), forbidden


def test_every_quote_is_followed_by_a_dated_source():
    doc = why_the_phone()
    assert doc.count("2026-09-12") >= 7  # every attribution, one per quote
    assert doc.count("([source](") >= 7  # and a linkable source each time


def test_the_exhaustion_sequence_names_the_three_ordinary_routes():
    doc = why_the_phone()
    for route in (
        "portal status check",
        "documented-code resolution",
        "written follow-up",
    ):
        assert route in doc
    assert "someone must call" in doc
    assert "governed one-call inquiry" in doc


def test_the_doc_declares_its_quotes_are_not_run_evidence():
    doc = why_the_phone()
    assert "not run evidence" in doc
    assert "no quote below is a run" in doc


def test_the_fictional_case_is_labelled_as_such():
    doc = why_the_phone()
    assert "Fictional case data" in doc
    assert "not evidence that any real portal behaves that way" in doc


# --- repository hygiene for the new docs ------------------------------------------------


def test_no_real_shaped_number_appears_in_the_phase4_docs():
    e164 = re.compile(r"\+[1-9]\d{7,14}\b")
    reserved = re.compile(re.escape("+1" + "20255501") + r"\d{2}\b")
    for name in ("evidence-table.md", "why-the-phone.md", "platform-surface-map.md"):
        text = (DOCS / name).read_text(encoding="utf-8")
        for number in e164.findall(text):
            assert reserved.fullmatch(number), (name, number)
