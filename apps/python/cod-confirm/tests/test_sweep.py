"""The sweep itself, end to end, with the phone line replaced.

The decision table had tests. The loop that drives it did not, and that is
where a `needs-human` order hit an undefined name and crashed a live run.
These exercise the loop, not the rules.
"""
from __future__ import annotations

import pytest

from codconfirm import agent, orders, phones, run as sweeper


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    book = tmp_path / "orders.json"
    book.write_text(orders.SEED_FILE.read_text(encoding="utf-8"), encoding="utf-8")
    monkeypatch.setattr(orders, "DATA_FILE", book)
    monkeypatch.delenv("CALL_ALLOWLIST", raising=False)
    monkeypatch.delenv("CALL_ALLOW_ANY", raising=False)
    monkeypatch.delenv("DEMO_PHONE", raising=False)


def answer_with(monkeypatch, outcome: agent.CallOutcome) -> None:
    monkeypatch.setattr(sweeper, "simulate_call", lambda order, seed=None: outcome)


def test_a_needs_human_order_completes_the_sweep(monkeypatch):
    """The crash: this branch reached for a name that was never bound."""
    answer_with(monkeypatch, agent.CallOutcome(
        result={"reached_customer": "yes", "confirmed": "yes",
                "address_correct": "yes"},          # no quote, so it escalates
        transcript=["  0s bot: hello", "  6s user: mm"],
        summary="the customer never said yes",
    ))
    all_orders, _ = sweeper.sweep(live=False, limit=1)
    touched = [o for o in all_orders if o.attempts > 0]
    assert touched, "the sweep should have handled one order"
    assert touched[0].status == orders.NEEDS_HUMAN


def test_the_transcript_is_kept_for_whoever_finishes_the_order(monkeypatch):
    answer_with(monkeypatch, agent.CallOutcome(
        result={"reached_customer": "yes", "confirmed": "yes",
                "address_correct": "yes"},
        transcript=["  0s bot: hello"],
        summary="a summary",
    ))
    all_orders, _ = sweeper.sweep(live=False, limit=1)
    notes = " ".join(next(o for o in all_orders if o.attempts > 0).notes)
    assert "transcript" in notes and "summary" in notes


def test_a_spoken_phone_number_never_reaches_the_notes(monkeypatch):
    """People read numbers out on calls, and notes are read by a person later."""
    answer_with(monkeypatch, agent.CallOutcome(
        result={"reached_customer": "yes", "confirmed": "yes",
                "address_correct": "yes"},
        transcript=["  8s user: call me on +99912345678 instead"],
        summary="asked to be rung on +99912345678",
    ))
    all_orders, _ = sweeper.sweep(live=False, limit=1)
    notes = " ".join(next(o for o in all_orders if o.attempts > 0).notes)
    assert "12345678" not in notes
    assert "+999" in notes, "masked, but still recognisable as a number"


def test_an_ambiguous_call_stops_the_whole_sweep(monkeypatch):
    """Carrying on would leave earlier orders queued for a second ring."""
    answer_with(monkeypatch, agent.CallOutcome(
        ambiguous=True, reason="connection dropped"))
    all_orders, _ = sweeper.sweep(live=False)
    assert len([o for o in all_orders if o.attempts > 0]) == 1


def test_a_live_run_refuses_without_an_allowlist(monkeypatch):
    """Fail closed: decide what may be dialled before dialling anything."""
    monkeypatch.setenv("CALLE_API_KEY", "test-key")
    with pytest.raises(SystemExit) as exit_:
        sweeper.sweep(live=True, limit=1)
    assert "CALL_ALLOWLIST" in str(exit_.value)


def test_there_is_no_way_to_ask_for_everything(monkeypatch):
    """The blanket permission is gone, and no environment variable brings it back."""
    monkeypatch.delenv("CALL_ALLOWLIST", raising=False)
    for name in ("CALL_ALLOW_ANY", "CALL_ALLOW_ALL", "CALL_UNRESTRICTED"):
        monkeypatch.setenv(name, "1")
    with pytest.raises(phones.UnsafeNumber):
        phones.require_authorisation()


def test_an_allowlist_is_what_a_live_run_may_dial(monkeypatch):
    monkeypatch.setenv("CALL_ALLOWLIST", "+99900000019, +99900000011")
    assert phones.require_authorisation() == {"+99900000019", "+99900000011"}
