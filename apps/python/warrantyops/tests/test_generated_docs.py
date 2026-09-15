"""The generated documents are projections of code, and stay that way.

``docs/refusals.md`` renders from the refusal catalog; the catalog is
checked against the live enums at render time. ``docs/state-machine.md``
renders from the transition tables; the tables are checked against the live
enums here. These tests are the gate: a member added without a catalog row,
a transition missing from its table, or a hand edit to either file fails
the suite — regeneration is byte-identical or the docs are stale.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from warrantyops.refusals_catalog import (
    ENTRIES,
    SECTIONS,
    catalog_problems,
    render_refusals_markdown,
)
from warrantyops.statemachine import (
    ATTEMPT_TRANSITIONS,
    CLAIM_TRANSITIONS,
    REVIEW_TRANSITIONS,
    TABLES,
    TERMINAL_TRANSITIONS,
    TRANSPORT_TRANSITIONS,
    WRITE_BACK_TRANSITIONS,
    render_markdown,
)

DOCS_DIR = Path(__file__).resolve().parents[1] / "docs"


def test_the_docs_directory_ships_both_files():
    assert (DOCS_DIR / "refusals.md").is_file()
    assert (DOCS_DIR / "state-machine.md").is_file()


def test_regenerating_refusals_is_byte_identical():
    on_disk = (DOCS_DIR / "refusals.md").read_text(encoding="utf-8")
    assert on_disk == render_refusals_markdown()


def test_regenerating_the_state_machine_is_byte_identical():
    on_disk = (DOCS_DIR / "state-machine.md").read_text(encoding="utf-8")
    assert on_disk == render_markdown()


def test_the_catalog_covers_every_enum_member_exactly():
    assert catalog_problems() == []


def test_every_refusal_member_is_documented_with_all_three_columns():
    document = (DOCS_DIR / "refusals.md").read_text(encoding="utf-8")
    for enum_name, _title, _gate in SECTIONS:
        for value in ENTRIES[enum_name]:
            row = f"| `{value}` |"
            assert row in document, f"{enum_name}.{value} missing from docs/refusals.md"
    assert document.count("| `") == sum(
        len(entries) for entries in ENTRIES.values()
    )


def _table_covers_enum(table, enum, label):
    names = set(table)
    names.discard("∅")
    for member in enum:
        assert member.value in names or any(
            member.value in targets for targets in table.values()
        ), f"{label}: {member.value} absent from the transition table"
    for state in names:
        assert state in {m.value for m in enum}, f"{label}: {state} is not a member"


def test_every_transition_table_covers_its_enum_exactly():
    from warrantyops.contract import ClaimStatus
    from warrantyops.ledger import AttemptState
    from warrantyops.outcome import TerminalState, TransportState
    from warrantyops.review import ReviewDecision
    from warrantyops.writeback import WriteBackOutcome

    _table_covers_enum(ATTEMPT_TRANSITIONS, AttemptState, "attempt")
    _table_covers_enum(TRANSPORT_TRANSITIONS, TransportState, "transport")
    _table_covers_enum(TERMINAL_TRANSITIONS, TerminalState, "terminal")
    _table_covers_enum(CLAIM_TRANSITIONS, ClaimStatus, "claim")
    _table_covers_enum(REVIEW_TRANSITIONS, ReviewDecision, "review")
    # The review table's APPROVE edge names the write-back outcome, so the
    # write-back vocabulary is the union it may point into.
    names = set(WRITE_BACK_TRANSITIONS)
    names.discard("∅")
    for state in names:
        assert state in {m.value for m in WriteBackOutcome}
    for member in WriteBackOutcome:
        assert member.value in names, f"write-back: {member.value} absent"


def test_the_rendered_machine_renders_every_table():
    document = render_markdown()
    for title, _subtitle, table in TABLES:
        assert f"## {title}" in document
        for state in table:
            if state == "∅":
                continue
            assert f"`{state}`" in document


# --- drift between the catalog and its enums is named, never rendered ----------


def test_a_member_without_a_catalog_entry_is_a_named_problem(monkeypatch):
    entries = ENTRIES["EnvelopeRefusal"]
    dropped = next(iter(entries))
    monkeypatch.delitem(entries, dropped)
    assert catalog_problems() == [f"EnvelopeRefusal.{dropped}: no catalog entry"]
    with pytest.raises(ValueError, match="out of sync"):
        render_refusals_markdown()


def test_an_entry_that_names_no_member_is_a_named_problem(monkeypatch):
    monkeypatch.setitem(ENTRIES["EnvelopeRefusal"], "GHOST", {})
    assert catalog_problems() == ["EnvelopeRefusal.GHOST: entry names a non-member"]


def test_a_catalog_section_without_an_enum_is_a_named_problem(monkeypatch):
    monkeypatch.setitem(ENTRIES, "NoSuchEnum", {})
    assert catalog_problems() == ["NoSuchEnum: catalog section has no enum"]
