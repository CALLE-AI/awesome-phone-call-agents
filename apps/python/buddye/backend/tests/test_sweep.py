"""The sweep, end to end, over the mock provider.

These tests are written against the two properties that define the product rather than against the
implementation, because the implementation is a port and the properties are not:

  * **Silence is a finding.** A phone that rings out produces `CheckOutcome.UNREACHABLE`, carries the
    neighbour's risk assessment into the decision, opens an escalation, and — for someone triage put
    at the high bands — has a responder handoff prepared for a human to release. There is no path
    where an unanswered call is a gap the sweep steps over.
  * **BuddyE never dials an emergency service.** It dials neighbours and the people they nominated.
    `test_nothing_dials_anyone_but_neighbours_and_their_contacts` pins the whole set of numbers a
    sweep is capable of ringing, and the packet tests pin that the last rung ends at a document.

And one that is neither, but would be the most embarrassing bug to ship: a sweep must reach
*everybody*. `test_full_sweep_reaches_every_neighbour` asserts thirteen distinct conversations,
because thirteen identical ones would also be thirteen calls.
"""
from __future__ import annotations

import pytest
from sqlmodel import select

from app.calls.mock import MockCallProvider
from app.calls.provider import CandidateRejectedByProvider
from app.db import session_scope
from app.domain.state import EscalationLevel, EscalationStatus, SweepState
from app.models import Hazard, Neighbour, Sweep
from tests.helpers import (
    calls_of,
    escalations_of,
    events_of,
    get_sweep,
    make_sweep,
    mock,
    neighbour_named,
    outcomes_by_name,
    packets_of,
    run_sweep,
    settings_with,
)

pytestmark = pytest.mark.usefixtures("db")

OPTED_OUT = "Gerald Pryce"          # the one person on the roster who said no
NEVER_ANSWERS = "Hazel Nakamura"    # 82, bedbound, insulin in the fridge, critical band
CONTACT_SILENT = "Benny Okonkwo"    # not reached, and his contact does not pick up either
LOW_BAND_SILENT = "Faye Lindqvist"  # wrong number, elevated band


class _RealNamedProvider(MockCallProvider):
    """A mock that claims not to be a mock, so the allowlist and budget guards engage.

    `CallBudget.reserve` and `record_spent_call` both short-circuit on `provider == "mock"`, which is
    exactly right in production and useless for testing the guards. This is the smallest way to make
    them fire without going near a network.
    """

    name = "calle_sdk"


class _RejectsOne(MockCallProvider):
    """A provider that refuses one specific recipient, the way CALL-E does for an unroutable number."""

    def __init__(self, reject_name: str, **kw) -> None:  # noqa: ANN003
        super().__init__(**kw)
        self.reject_name = reject_name

    async def place(self, req, on_event):  # noqa: ANN001, ANN201
        if (req.metadata or {}).get("neighbour_name") == self.reject_name:
            raise CandidateRejectedByProvider("invalid_phone", "the number on file is not routable")
        return await super().place(req, on_event)


# ------------------------------------------------------------------------------------------------
# The sweep fans out
# ------------------------------------------------------------------------------------------------
async def test_full_sweep_reaches_every_neighbour(seeded: str) -> None:
    provider = mock()
    sweep_id = await run_sweep(seeded, provider=provider)
    sweep = get_sweep(sweep_id)

    assert SweepState(sweep.state) is SweepState.COMPLETE
    assert sweep.is_active is False

    with session_scope() as s:
        roster = list(s.exec(select(Neighbour)).all())
        consenting = {n.id for n in roster if n.check_in_consent}
        total = len(roster)
    assert total == 14 and len(consenting) == 13

    # Every consenting neighbour ends the evening with an outcome on the sweep. Not "most of them",
    # not "everyone up to the first success".
    assert set(sweep.outcomes) == consenting
    assert len(calls_of(sweep_id, callee="neighbour")) == 13

    # Thirteen *different* conversations. Thirteen copies of DEFAULT_FIXTURE would satisfy every
    # assertion above and would mean the fixture lookup had silently stopped working.
    summaries = {c.summary for c in calls_of(sweep_id, callee="neighbour")}
    assert len(summaries) == 13


async def test_sweep_does_not_stop_at_the_first_finding(seeded: str) -> None:
    """ShiftFill stopped when somebody said yes. A heat warning does not become safe because the
    first person answered, so the roster is worked to the end whatever the calls turn up."""
    sweep_id = await run_sweep(seeded)
    outcomes = outcomes_by_name(sweep_id)

    assert outcomes["Rosa Delgado"] == "URGENT"           # first in the queue, and alarming
    assert {"SAFE", "URGENT", "UNREACHABLE"} <= set(outcomes.values())
    assert len(outcomes) == 13                            # nobody after Rosa was dropped
    assert get_sweep(sweep_id).current_index == 13


async def test_every_person_the_sweep_did_not_account_for_is_named(seeded: str) -> None:
    from app.orchestrator.sweep import unaccounted

    sweep_id = await run_sweep(seeded)
    with session_scope() as s:
        missing = unaccounted(s.get(Sweep, sweep_id), list(s.exec(select(Neighbour)).all()))
    assert [m["name"] for m in missing] == [OPTED_OUT]
    assert missing[0]["kind"] == "no_consent"

    # ...and it is said out loud on the stream, not left to be worked out from a gap in a list.
    tail = events_of(get_sweep(sweep_id).hazard_id, type="sweep.unaccounted")
    assert tail and tail[-1]["payload"]["people"][0]["name"] == OPTED_OUT


# ------------------------------------------------------------------------------------------------
# Silence is a finding
# ------------------------------------------------------------------------------------------------
async def test_unanswered_call_becomes_unreachable_and_escalates(seeded: str) -> None:
    sweep_id = await run_sweep(seeded)
    hazel = neighbour_named(NEVER_ANSWERS)

    call = next(c for c in calls_of(sweep_id, callee="neighbour") if c.neighbour_id == hazel.id)
    assert call.status == "NO_ANSWER"
    assert call.outcome == "UNREACHABLE"          # not skipped, not retried away, not an error
    assert call.risk_snapshot["band"] == "critical"

    esc = next(e for e in escalations_of(sweep_id) if e.neighbour_id == hazel.id)
    assert esc.outcome == "UNREACHABLE"
    # Her son was rung, he has a key, and he left immediately — so the ladder stops here rather than
    # climbing to a responder. That is the ladder working, not the ladder failing.
    assert EscalationStatus(esc.status) is EscalationStatus.CONTACT_REACHED
    assert any(r["action"] == "called" for r in esc.rungs)
    assert [c.callee for c in calls_of(sweep_id) if c.neighbour_id == hazel.id] == ["neighbour", "emergency_contact"]


async def test_silence_carries_the_risk_assessment_into_the_decision(seeded: str) -> None:
    """Silence from a bedbound 82-year-old and silence from a healthy 40-year-old are not the same
    event. `decide()` is given the triage, and the reason it writes says so."""
    sweep_id = await run_sweep(seeded)
    hazel = neighbour_named(NEVER_ANSWERS)
    decided = [e for e in events_of(get_sweep(sweep_id).hazard_id, type="check.decided")
               if e["payload"]["neighbour_id"] == hazel.id]
    payload = decided[-1]["payload"]

    assert payload["outcome"] == "UNREACHABLE"
    assert payload["band"] == "critical"
    assert payload["priority"] == 100  # the top of the board: worse than a call that told us something
    assert "critical band" in payload["reason"]


async def test_unreachable_at_a_high_band_prepares_a_handoff_nobody_has_released(seeded: str) -> None:
    sweep_id = await run_sweep(seeded)
    benny = neighbour_named(CONTACT_SILENT)

    esc = next(e for e in escalations_of(sweep_id) if e.neighbour_id == benny.id)
    assert EscalationLevel(esc.level) is EscalationLevel.RESPONDER
    assert EscalationStatus(esc.status) is EscalationStatus.AWAITING_AUTHORISATION

    packet = next(p for p in packets_of(sweep_id) if p.neighbour_id == benny.id)
    # The whole safety property of the product, as an assertion.
    assert packet.released_at is None and packet.released_by == ""
    assert "No emergency service has been contacted" in packet.spoken_script
    assert packet.neighbour_snapshot["address"]  # a responder needs the door, and it is in there
    assert packet.attempts_summary                # and what we tried before asking for one


async def test_a_low_band_no_answer_stops_at_the_block_captain(seeded: str) -> None:
    """A packet is a page about a frail person's home. Cutting one for every routine no-answer would
    teach the captain to ignore them, so the threshold is a setting and it is honoured."""
    sweep_id = await run_sweep(seeded)
    faye = neighbour_named(LOW_BAND_SILENT)

    esc = next(e for e in escalations_of(sweep_id) if e.neighbour_id == faye.id)
    assert EscalationLevel(esc.level) is EscalationLevel.BLOCK_CAPTAIN
    assert not [p for p in packets_of(sweep_id) if p.neighbour_id == faye.id]

    reasons = [e["payload"] for e in events_of(get_sweep(sweep_id).hazard_id, type="handoff.not_prepared")]
    assert any(r["neighbour_id"] == faye.id and "below HANDOFF_MIN_BAND" in r["reason"] for r in reasons)


async def test_a_recipient_the_provider_rejects_is_unreachable_not_a_skip(seeded: str) -> None:
    """ShiftFill moved to the next candidate. Here "the number we hold for her does not work" is a
    fact about a person nobody has spoken to today, and it has to reach the board as one."""
    provider = _RejectsOne("Trinidad Bustos", delay_s=0)
    sweep_id = await run_sweep(seeded, provider=provider)
    outcomes = outcomes_by_name(sweep_id)

    assert outcomes["Trinidad Bustos"] == "UNREACHABLE"
    assert len(outcomes) == 13  # and the rest of the block was still called
    trinidad = neighbour_named("Trinidad Bustos")
    assert any(e.neighbour_id == trinidad.id for e in escalations_of(sweep_id))


# ------------------------------------------------------------------------------------------------
# Consent
# ------------------------------------------------------------------------------------------------
async def test_a_neighbour_who_opted_out_is_never_dialled(seeded: str) -> None:
    provider = mock()
    sweep_id = await run_sweep(seeded, provider=provider)
    gerald = neighbour_named(OPTED_OUT)

    sweep = get_sweep(sweep_id)
    assert gerald.id not in sweep.call_order
    assert gerald.id not in sweep.outcomes
    assert not [c for c in calls_of(sweep_id) if c.neighbour_id == gerald.id]
    assert gerald.phone not in {r.phone for r in provider.placed}

    # He is still on the board, and the reason is on the record.
    assert sweep.triage[gerald.id]["may_call"] is False
    skipped = [e["payload"] for e in events_of(sweep.hazard_id, type="neighbour.skipped")]
    assert [s["name"] for s in skipped] == [OPTED_OUT]


async def test_the_runner_refuses_a_call_order_that_contains_someone_who_opted_out(seeded: str) -> None:
    """The consent gate lives in two places on purpose. `risk.call_order` drops him; this is the
    second lock, and it is here because the first one is an array index."""
    from app.orchestrator.reconcile import NullReconciler
    from app.orchestrator.runner import Runner

    gerald = neighbour_named(OPTED_OUT)
    sweep_id = make_sweep(seeded)
    with session_scope() as s:  # a corrupted queue, of the kind an off-by-one would produce
        sweep = s.get(Sweep, sweep_id)
        sweep.state = SweepState.CALLING
        sweep.call_order = [gerald.id]
        sweep.triage = {}
        s.add(sweep)

    provider = mock()
    await Runner(sweep_id, provider=provider, reconciler=NullReconciler()).run()

    assert provider.placed == []
    assert calls_of(sweep_id) == []
    skipped = [e["payload"] for e in events_of(seeded, type="call.skipped")]
    assert any(p["neighbour_id"] == gerald.id and "consent" in p["reason"] for p in skipped)
    assert SweepState(get_sweep(sweep_id).state) is SweepState.COMPLETE


async def test_nothing_dials_anyone_but_neighbours_and_their_contacts(seeded: str) -> None:
    """The set of numbers a sweep is capable of ringing, pinned.

    There is no emergency number in it, and there is no code path that could put one there: the
    responder rung is a document, and the only way out of that document is a person's name.
    """
    provider = mock()
    sweep_id = await run_sweep(seeded, provider=provider)

    with session_scope() as s:
        roster = list(s.exec(select(Neighbour)).all())
        allowed = ({n.phone for n in roster if n.check_in_consent}
                   | {n.contact_phone for n in roster if n.contact_phone})
    dialled = {r.phone for r in provider.placed}

    assert dialled and dialled <= allowed
    assert {c.callee for c in calls_of(sweep_id)} <= {"neighbour", "emergency_contact"}
    assert not any(p in {"911", "+1911", "112", "999"} for p in dialled)
    # Packets were prepared and not one of them was released by the machine.
    packets = packets_of(sweep_id)
    assert packets and all(p.released_at is None for p in packets)


async def test_a_handoff_packet_cannot_be_released_without_a_named_human(seeded: str) -> None:
    from app.models import Escalation, HandoffPacket
    from app.orchestrator import escalate as ladder

    sweep_id = await run_sweep(seeded)
    packet_id = packets_of(sweep_id)[0].id

    for who in ("", "   ", "system", "automation", "BuddyE", "1234"):
        with session_scope() as s:
            packet = s.get(HandoffPacket, packet_id)
            esc = s.get(Escalation, packet.escalation_id)
            with pytest.raises(ladder.ReleaseRefused):
                ladder.release(s, packet, escalation=esc, released_by=who)
        assert packets_of(sweep_id)[0].released_at is None

    with session_scope() as s:
        packet = s.get(HandoffPacket, packet_id)
        esc = s.get(Escalation, packet.escalation_id)
        ladder.release(s, packet, escalation=esc, released_by="Alma Reyes", note="calling it in myself")
    released = next(p for p in packets_of(sweep_id) if p.id == packet_id)
    assert released.released_at is not None and released.released_by == "Alma Reyes"


# ------------------------------------------------------------------------------------------------
# The guards ShiftFill proved, kept
# ------------------------------------------------------------------------------------------------
async def test_numbers_not_on_the_allowlist_are_never_dialled(seeded: str) -> None:
    provider = _RealNamedProvider(delay_s=0)
    settings = settings_with(CALL_PROVIDER="calle_sdk", DIALABLE_NUMBERS="", CALL_BUDGET_ENFORCE=True)
    sweep_id = await run_sweep(seeded, provider=provider, settings=settings)

    assert provider.placed == []
    sweep = get_sweep(sweep_id)
    assert SweepState(sweep.state) is SweepState.COMPLETE
    assert sweep.outcomes == {}  # an operator gate is not a finding about the person
    skipped = [e["payload"] for e in events_of(seeded, type="call.skipped")]
    assert len(skipped) == 13 and all("not allowlisted" in p["reason"] for p in skipped)


async def test_budget_exhaustion_is_terminal_and_leaves_the_rest_unaccounted(seeded: str) -> None:
    from app.orchestrator.sweep import unaccounted

    with session_scope() as s:
        numbers = ",".join(n.phone for n in s.exec(select(Neighbour)).all())
    provider = _RealNamedProvider(delay_s=0)
    settings = settings_with(CALL_PROVIDER="calle_sdk", DIALABLE_NUMBERS=numbers, CALL_BUDGET_MAX=2)
    sweep_id = await run_sweep(seeded, provider=provider, settings=settings)

    sweep = get_sweep(sweep_id)
    assert SweepState(sweep.state) is SweepState.BUDGET_EXHAUSTED
    assert sweep.is_active is False
    assert len(provider.placed) == 2
    with session_scope() as s:
        missing = unaccounted(sweep, list(s.exec(select(Neighbour)).all()))
    # Everyone the budget cut off is named, with a reason — the sweep does not end quietly.
    assert len(missing) == 12
    assert {m["kind"] for m in missing} == {"no_consent", "not_dialled"}

    # And the same is true of what actually reached the captain's board. Asserted on the emitted
    # event, not on a fresh call: the list is computed from the sweep's own state, so publishing it
    # a moment before the terminal transition would put "still to be called" against eleven people
    # nobody is going to ring — a reassuring lie, and invisible to a test that re-reads the DB.
    tail = events_of(seeded, type="sweep.unaccounted")[-1]["payload"]
    assert tail["count"] == 12
    assert {p["kind"] for p in tail["people"]} == {"no_consent", "not_dialled"}
    assert not any(p["kind"] == "still_running" for p in tail["people"])


async def test_idempotency_key_is_written_before_the_dial_and_is_stable(seeded: str) -> None:
    sweep_id = await run_sweep(seeded)
    keys = [c.idempotency_key for c in calls_of(sweep_id)]
    assert len(keys) == len(set(keys))
    for call in calls_of(sweep_id):
        assert call.idempotency_key == f"{sweep_id}:{call.neighbour_id}:{call.callee}:{call.attempt}"


async def test_restart_mid_sweep_reuses_the_call_instead_of_redialing(seeded: str) -> None:
    """A driver that comes back after a crash must not ring the first half of the block again."""
    from app.orchestrator.reconcile import NullReconciler
    from app.orchestrator.runner import Runner

    sweep_id = await run_sweep(seeded)
    before = {c.id for c in calls_of(sweep_id)}
    escalations_before = len(escalations_of(sweep_id))

    with session_scope() as s:  # rewind the driver to the top of a finished roster
        sweep = s.get(Sweep, sweep_id)
        sweep.state = SweepState.CALLING
        sweep.is_active = True
        sweep.current_index = 0
        s.add(sweep)

    provider = mock()
    await Runner(sweep_id, provider=provider, reconciler=NullReconciler()).run()

    assert provider.placed == []                       # every leg resumed from its stored row
    assert {c.id for c in calls_of(sweep_id)} == before  # no new CheckCall rows
    assert len(escalations_of(sweep_id)) == escalations_before  # and no second ladder per person
    assert get_sweep(sweep_id).calls_made == len(before)


async def test_a_second_sweep_of_a_hazard_already_being_swept_is_the_same_sweep(seeded: str) -> None:
    first = make_sweep(seeded)
    second = make_sweep(seeded)
    assert first == second

    with session_scope() as s:
        rows = list(s.exec(select(Sweep).where(Sweep.hazard_id == seeded)).all())
    assert len(rows) == 1


async def test_a_second_hazard_reorders_the_same_roster(seeded: str) -> None:
    """The claim the product is built on, as a test: the same fourteen people, a different hazard,
    a different queue. Walter barely registers in a heat warning and is first in a blackout."""
    from app.seed import declare_outage

    heat_sweep = await run_sweep(seeded)
    heat_order = get_sweep(heat_sweep).call_order

    with session_scope() as s:
        outage = declare_outage(s)
        outage_id = outage.id
    outage_sweep = await run_sweep(outage_id)
    outage_order = get_sweep(outage_sweep).call_order

    with session_scope() as s:
        names = {n.id: n.name for n in s.exec(select(Neighbour)).all()}
    assert names[heat_order[0]] == "Rosa Delgado"
    assert names[outage_order[0]] == "Walter Brzezinski"
    assert set(heat_order) == set(outage_order)  # the same people, re-sorted; nobody is dropped


async def test_the_call_a_neighbour_gets_is_the_contract_the_hazard_compiled(seeded: str) -> None:
    """The task and schema stored on the row are what CALL-E was actually sent, which is what makes
    the trace worth reading afterwards."""
    sweep_id = await run_sweep(seeded)
    rosa = neighbour_named("Rosa Delgado")
    call = next(c for c in calls_of(sweep_id, callee="neighbour") if c.neighbour_id == rosa.id)

    assert "Rosa" in call.task and "Delgado" not in call.task  # first names only on the call
    assert call.result_schema["additionalProperties"] is False
    assert call.risk_snapshot["band"] == "critical"
    assert call.help_offered and all("text" in o for o in call.help_offered)

    from app.calls.contract import assert_calle_schema_subset

    assert_calle_schema_subset(call.result_schema)  # what we send stays inside CALL-E's dialect


async def test_the_emergency_contact_call_is_a_different_call(seeded: str) -> None:
    """It reuses the neighbour's schema — it already clears CALL-E's dialect and the useful answers
    are the same — but nothing about the task is reused: you do not read a woman's medical file to
    her daughter, and you never imply an ambulance is coming."""
    sweep_id = await run_sweep(seeded)
    contact_calls = calls_of(sweep_id, callee="emergency_contact")
    assert contact_calls

    call = contact_calls[0]
    with session_scope() as s:
        nbr = s.get(Neighbour, call.neighbour_id)
        contact_name, contact_phone = nbr.contact_name, nbr.contact_phone
    assert contact_name and contact_name in call.task
    assert "emergency service" in call.task and "has been called" in call.task
    assert call.idempotency_key.endswith(":emergency_contact:1")

    from app.calls.contract import assert_calle_schema_subset

    assert_calle_schema_subset(call.result_schema)


async def test_the_hazard_does_not_close_while_anyone_is_unaccounted_for(seeded: str) -> None:
    """CLOSED means what domain/state.py says it means. A sweep that leaves open escalations puts the
    hazard back to OPEN, which is not a tidy ending and is not meant to be."""
    sweep_id = await run_sweep(seeded)
    with session_scope() as s:
        hazard = s.get(Hazard, get_sweep(sweep_id).hazard_id)
        assert str(hazard.status) == "OPEN"
        assert hazard.closed_at is None


async def test_a_sweep_of_an_empty_roster_completes_instead_of_hanging(seeded: str) -> None:
    with session_scope() as s:
        for nbr in s.exec(select(Neighbour)).all():
            s.delete(nbr)
    sweep_id = await run_sweep(seeded)
    sweep = get_sweep(sweep_id)
    assert SweepState(sweep.state) is SweepState.COMPLETE and sweep.call_order == []


async def test_every_call_lands_on_the_stream_with_its_neighbour_attached(seeded: str) -> None:
    """The board is the event stream, so an event a client cannot attribute to a person is useless."""
    sweep_id = await run_sweep(seeded)
    hazard_id = get_sweep(sweep_id).hazard_id
    types = [e["type"] for e in events_of(hazard_id)]

    assert "sweep.triaged" in types and "sweep.unaccounted" in types
    for name in ("call.started", "call.completed", "check.decided", "escalation.opened"):
        rows = events_of(hazard_id, type=name)
        assert rows, f"no {name} events on the stream"
        assert all(e["neighbour_id"] for e in rows), f"{name} without a neighbour_id"

    with session_scope() as s:
        numbers = {n.phone for n in s.exec(select(Neighbour)).all()}
    blob = str(events_of(hazard_id))
    assert not any(p in blob for p in numbers)  # phones are masked on the way onto the bus


async def test_a_crash_mid_sweep_still_says_who_was_never_reached(seeded: str) -> None:
    """The case where the list matters most is the one where the code did not get to the end."""
    from app.orchestrator.reconcile import NullReconciler
    from app.orchestrator.runner import Runner

    class _Explodes(MockCallProvider):
        async def place(self, req, on_event):  # noqa: ANN001, ANN201
            raise RuntimeError("the provider fell over in a way nobody anticipated")

    sweep_id = make_sweep(seeded)
    await Runner(sweep_id, provider=_Explodes(delay_s=0), reconciler=NullReconciler()).run()

    sweep = get_sweep(sweep_id)
    assert SweepState(sweep.state) is SweepState.FAILED
    assert sweep.is_active is False and "RuntimeError" in (sweep.error or "")

    tail = events_of(seeded, type="sweep.unaccounted")[-1]["payload"]
    assert tail["count"] == 14  # the whole block, named, with a reason each
    assert not any(p["kind"] == "still_running" for p in tail["people"])
