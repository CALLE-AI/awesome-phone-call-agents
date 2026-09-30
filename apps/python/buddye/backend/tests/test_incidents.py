"""Escalations becoming incidents: real addresses, derived needs, and a priority that never slips.

These run a whole sweep over the mock provider and then reconcile it, which is the same thing the
background loop does in production. Nothing here waits on a timer or drains a queue — `sync_sweep`
is a pure function of the rows a finished sweep left behind, so "did the sweep produce incidents?"
is a question with an answer rather than a race.
"""
from __future__ import annotations

import pytest
from sqlmodel import select

from datetime import timedelta

from app.config import get_settings
from app.db import session_scope
from app.domain import fleet
from app.domain.geo import path_length_miles, route_between
from app.domain.state import (
    AssetKind,
    AssetStatus,
    CheckOutcome,
    DispatchStatus,
    IncidentStatus,
    requires_authorisation,
)
from app.models import Asset, CheckCall, Dispatch, Escalation, Incident, Neighbour, Sweep, utcnow
from app.orchestrator import escalate as ladder
from app.orchestrator import incidents as incident_layer
from app.orchestrator.reconcile import NullReconciler
from app.sim.movement import COMPASS, advance_dispatch
from tests.helpers import mock, neighbour_named, run_sweep

pytestmark = pytest.mark.usefixtures("db")

#: Maryvale, Phoenix. Every seeded neighbour is inside this box; an incident outside it means a
#: coordinate was invented somewhere, which is the one failure this layer cannot survive.
MARYVALE = (33.46, 33.52, -112.20, -112.14)  # lat_min, lat_max, lon_min, lon_max


async def _swept(seeded: str) -> str:
    return await run_sweep(seeded)


def _sync(sweep_id: str) -> list[str]:
    with session_scope() as s:
        return [i.id for i in incident_layer.sync_sweep(s, sweep_id)]


def _incidents() -> list[Incident]:
    with session_scope() as s:
        rows = list(s.exec(select(Incident)).all())
        for r in rows:
            s.expunge(r)
        return rows


def _by_name() -> dict[str, Incident]:
    with session_scope() as s:
        names = {n.id: n.name for n in s.exec(select(Neighbour)).all()}
        rows = list(s.exec(select(Incident)).all())
        for r in rows:
            s.expunge(r)
        return {names[r.neighbour_id]: r for r in rows}


# ------------------------------------------------------------------------------------------------
async def test_a_sweep_opens_one_incident_per_escalation_at_real_coordinates(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    opened = _sync(sweep_id)

    with session_scope() as s:
        escalations = list(s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id)).all())
        # Plain tuples, not rows: a row read back after its session commits has expired attributes.
        neighbours = {n.id: (n.name, n.lat, n.lon, n.address) for n in s.exec(select(Neighbour)).all()}
    assert len(escalations) == 10, "the seeded evening produces ten escalations"
    assert len(opened) == len(escalations), "every escalation is somebody's address to go to"

    for incident in _incidents():
        name, lat, lon, address = neighbours[incident.neighbour_id]
        # Copied off the neighbour, not joined: what a van was sent to is what was true then.
        assert (incident.lat, incident.lon) == (lat, lon)
        assert incident.address == address
        lat_min, lat_max, lon_min, lon_max = MARYVALE
        assert lat_min < incident.lat < lat_max and lon_min < incident.lon < lon_max, name
        assert incident.status == IncidentStatus.OPEN
        assert incident.escalation_id and incident.hazard_id and incident.sweep_id


async def test_nobody_who_was_safe_gets_an_incident(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    _sync(sweep_id)
    by_name = _by_name()

    # Three people ended the evening safe, and nothing is sent to somebody who is fine.
    assert "Yolanda Cruz" not in by_name
    assert "Charlie Dunn" not in by_name
    assert "Marisol Vega" not in by_name
    assert set(by_name) == {
        "Rosa Delgado", "Ernesto Salgado", "Walter Brzezinski", "Hazel Nakamura", "Benny Okonkwo",
        "Trinidad Bustos", "Ruth Ann Beecham", "Lupe Ibarra", "Faye Lindqvist", "Dorothy Whitfield",
    }


async def test_needs_are_derived_from_what_the_call_actually_established(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    _sync(sweep_id)
    by_name = _by_name()

    # Rosa said something was wrong right now: that is medical and somebody laying eyes on her, and
    # it is also hot in the house, which is water and ice. Nothing here is a guess.
    assert set(by_name["Rosa Delgado"].needs) >= {"medical", "assess", "water", "ice"}
    # Trinidad accepted a ride on the call. A ride is transport, and it comes from the offer key.
    assert "transport" in by_name["Trinidad Bustos"].needs
    # Nobody answered for Faye. The only thing that resolves silence is a person at the door.
    assert by_name["Faye Lindqvist"].needs == ["welfare_check"]


async def test_priority_is_worst_first_and_a_resync_never_makes_it_less_urgent(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    _sync(sweep_id)
    by_name = _by_name()

    assert by_name["Rosa Delgado"].priority == 1 and fleet.priority_label(1) == "life safety"
    assert by_name["Dorothy Whitfield"].priority > by_name["Trinidad Bustos"].priority, (
        "somebody who turned help down is less urgent than somebody who accepted it")

    # A coordinator raises one by hand. A background reconciliation must not quietly undo that.
    target = by_name["Lupe Ibarra"].id
    with session_scope() as s:
        incident = s.get(Incident, target)
        incident.priority = 1
        s.add(incident)
    _sync(sweep_id)
    with session_scope() as s:
        assert s.get(Incident, target).priority == 1


async def test_syncing_twice_opens_nothing_new(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    first = _sync(sweep_id)
    second = _sync(sweep_id)
    third = _sync(sweep_id)

    assert len(first) == 10
    assert second == [] and third == [], "the reconciler is idempotent; a second pass is free"
    assert len(_incidents()) == 10, "one incident per address, never a rival for the same house"


async def test_a_cancelled_escalation_opens_nothing(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    with session_scope() as s:
        esc = s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id)).first()
        esc.status = "CANCELLED"
        s.add(esc)
        cancelled_id = esc.id
    opened = _sync(sweep_id)

    assert len(opened) == 9
    with session_scope() as s:
        assert incident_layer.incident_for_escalation(s, cancelled_id) is None


async def test_the_incident_carries_the_person_and_their_own_words(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    _sync(sweep_id)
    rosa = neighbour_named("Rosa Delgado")

    with session_scope() as s:
        incident = s.exec(select(Incident).where(Incident.neighbour_id == rosa.id)).one()
        situation = incident_layer.situation_for(s, incident)
        reasons = incident_layer.risk_reasons_for(s, incident)
        findings = incident_layer.findings_for(s, incident)

    assert situation["name"] == "Rosa Delgado"
    assert situation["address"] == rosa.address
    assert situation["conditions"], "the clinical facts the dispatch turns on are on the incident"
    assert situation["what_they_said"], "verbatim concerns, not a paraphrase"
    assert reasons, "why triage put her where it did — the sentences the captain's board shows"
    assert findings


async def test_an_incident_needs_a_named_human_to_close_it(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    incident_id = _sync(sweep_id)[0]

    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        for bad in ("", "   ", "1234"):
            with pytest.raises(incident_layer.IncidentRefused):
                incident_layer.resolve(s, incident, resolved_by=bad)
        assert s.get(Incident, incident_id).status == IncidentStatus.OPEN

    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        incident_layer.resolve(s, incident, resolved_by="Alma Reyes", resolution="water dropped, she is fine")
    with session_scope() as s:
        closed = s.get(Incident, incident_id)
        assert closed.status == IncidentStatus.RESOLVED
        assert closed.resolved_at is not None
        assert "Alma Reyes" in closed.resolution


async def test_a_closed_incident_is_not_reopened_by_a_background_pass(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    incident_id = _sync(sweep_id)[0]
    with session_scope() as s:
        incident_layer.resolve(s, s.get(Incident, incident_id), resolved_by="Alma Reyes")
        before = s.get(Incident, incident_id).needs

    _sync(sweep_id)

    with session_scope() as s:
        after = s.get(Incident, incident_id)
        assert after.status == IncidentStatus.RESOLVED
        assert after.needs == before, "a settled incident is not edited by a reconciler"


async def test_opening_incidents_puts_them_on_the_event_stream(seeded) -> None:  # noqa: ANN001
    from tests.helpers import events_of

    sweep_id = await _swept(seeded)
    with session_scope() as s:
        opened = incident_layer.sync_sweep(s, sweep_id)
        payloads = [incident_layer.event_payload(i) for i in opened]
    incident_layer.announce(payloads)

    events = events_of(seeded, type="incident.opened")
    assert len(events) == 10
    sample = events[0]["payload"]
    assert sample["incident_id"] and sample["address"] and sample["priority_label"]
    assert sample["lat"] and sample["lon"]


# ------------------------------------------------------------------------------------------------
# Silence raises its own case
# ------------------------------------------------------------------------------------------------
async def test_an_unanswered_call_raises_a_case_with_no_escalation_in_the_loop(seeded) -> None:  # noqa: ANN001
    """The finding this product exists for must not depend on the ladder having got as far as
    writing a row.

    Nobody answered for Faye. Here the escalation is removed before the reconciler runs — the shape
    a crash between the decision and the escalation write leaves behind — and the deployment case
    still opens, still lands at her real address, and still points back at the call that found the
    silence.
    """
    sweep_id = await _swept(seeded)
    faye = neighbour_named("Faye Lindqvist")
    with session_scope() as s:
        for esc in s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id,
                                                   Escalation.neighbour_id == faye.id)).all():
            s.delete(esc)

    _sync(sweep_id)

    with session_scope() as s:
        incident = s.exec(select(Incident).where(Incident.neighbour_id == faye.id)).one()
        call = s.get(CheckCall, incident.source_call_id)
        assert incident.escalation_id is None, "no escalation was involved in raising this"
        assert call is not None and call.neighbour_id == faye.id
        assert call.outcome == CheckOutcome.UNREACHABLE.value
        assert (incident.lat, incident.lon) == (faye.lat, faye.lon)
        assert incident.address == faye.address
        assert incident.needs == ["welfare_check"], "the only thing that resolves silence is a knock"
        assert incident.summary, "a case with nothing written on it is a case nobody can act on"


async def test_a_case_a_call_raised_is_adopted_rather_than_duplicated(seeded) -> None:  # noqa: ANN001
    """One house, one van. Silence can raise a case seconds before the ladder finishes writing its
    escalation, and when the escalation arrives it must take that case over rather than open a rival
    for the same address."""
    sweep_id = await _swept(seeded)
    faye = neighbour_named("Faye Lindqvist")
    with session_scope() as s:
        esc = s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id,
                                              Escalation.neighbour_id == faye.id)).one()
        s.delete(esc)

    with session_scope() as s:
        call = s.exec(select(CheckCall).where(CheckCall.sweep_id == sweep_id,
                                              CheckCall.neighbour_id == faye.id,
                                              CheckCall.callee == "neighbour")).first()
        first, created = incident_layer.open_for_call(s, call)
        assert created
        raised_id = first.id

    with session_scope() as s:
        esc = ladder.open_escalation(
            s, sweep_id=sweep_id, hazard_id=seeded, neighbour=s.get(Neighbour, faye.id),
            outcome=CheckOutcome.UNREACHABLE, reason="nobody answered",
        )
        s.flush()
        adopted, created = incident_layer.open_for_escalation(s, esc)
        esc_id, adopted_id = esc.id, adopted.id

    assert created is False, "the escalation adopted the case the call had already raised"
    assert adopted_id == raised_id
    with session_scope() as s:
        theirs = list(s.exec(select(Incident).where(Incident.neighbour_id == faye.id)).all())
        assert len(theirs) == 1
        assert theirs[0].escalation_id == esc_id
        assert theirs[0].source_call_id, "and it still points back at the call"


async def test_calling_the_same_person_twice_does_not_raise_a_second_case(seeded) -> None:  # noqa: ANN001
    sweep_id = await _swept(seeded)
    faye = neighbour_named("Faye Lindqvist")
    with session_scope() as s:
        for esc in s.exec(select(Escalation).where(Escalation.neighbour_id == faye.id)).all():
            s.delete(esc)

    _sync(sweep_id)
    _sync(sweep_id)
    _sync(sweep_id)

    with session_scope() as s:
        assert len(list(s.exec(select(Incident).where(Incident.neighbour_id == faye.id)).all())) == 1


async def test_a_human_who_cancelled_the_escalation_is_not_overruled_by_the_call_pass(seeded) -> None:  # noqa: ANN001
    """`sync_calls` is a safety net, not a second opinion. A cancelled escalation is a person
    looking at a finding and saying stop, and raising the same address again two seconds later would
    make the cancel button useless."""
    sweep_id = await _swept(seeded)
    with session_scope() as s:
        esc = s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id)).first()
        esc.status = "CANCELLED"
        s.add(esc)
        cancelled_for = esc.neighbour_id

    _sync(sweep_id)
    _sync(sweep_id)

    with session_scope() as s:
        assert list(s.exec(select(Incident).where(Incident.neighbour_id == cancelled_for)).all()) == []


# ------------------------------------------------------------------------------------------------
# One call from the case page
# ------------------------------------------------------------------------------------------------
async def test_a_case_page_call_rings_one_person_and_raises_their_case(seeded) -> None:  # noqa: ANN001
    """The console flow in one function: the operator opens Walter's case, presses call, and what
    comes back is a deployment case for a human to approve — whether he answered or not.

    Nobody else is rung. That is the difference between this and a sweep, and it is the assertion
    that would fail loudest if the case button were ever wired to the roster driver.
    """
    from app.api import cases

    walter = neighbour_named("Walter Brzezinski")
    out = await cases.launch_call(
        seeded, walter.id, settings=get_settings(),
        provider=mock({"Walter Brzezinski": {"status": "NO_ANSWER", "result": None}}),
        reconciler=NullReconciler(), launched_by="Alma Reyes",
    )

    assert out["status"] == "completed"
    assert out["outcome"] == CheckOutcome.UNREACHABLE.value
    assert out["incident_id"], "silence from a power-dependent neighbour raises a case by itself"
    assert out["route"] == f"/hazards/{seeded}/incidents/{out['incident_id']}"

    with session_scope() as s:
        calls = list(s.exec(select(CheckCall).where(CheckCall.hazard_id == seeded)).all())
        assert {c.neighbour_id for c in calls} == {walter.id}, "one person, not a sweep"
        incident = s.get(Incident, out["incident_id"])
        assert incident.neighbour_id == walter.id
        assert incident.source_call_id == out["call_id"]
        assert incident.address == walter.address


async def test_a_case_page_call_that_reaches_them_raises_the_case_from_what_they_said(seeded) -> None:  # noqa: ANN001
    from app.api import cases

    rosa = neighbour_named("Rosa Delgado")
    out = await cases.launch_call(seeded, rosa.id, settings=get_settings(),
                                  provider=mock(), reconciler=NullReconciler())

    assert out["status"] == "completed" and out["incident_id"]
    with session_scope() as s:
        incident = s.get(Incident, out["incident_id"])
        call = s.get(CheckCall, out["call_id"])
        # the needs are derived from the conversation, not from the fact that a call happened
        assert incident.needs and incident.outcome == call.outcome
        assert call.transcript, "the case page has the conversation to show"


async def test_a_second_case_call_is_a_second_attempt_not_a_repeat_of_the_first(seeded) -> None:  # noqa: ANN001
    """"Call him again" has to mean a new call. The runner's idempotency key is built from the
    attempt number, so reusing it would quietly hand back the first call's result."""
    from app.api import cases

    walter = neighbour_named("Walter Brzezinski")
    first = await cases.launch_call(seeded, walter.id, settings=get_settings(),
                                    provider=mock(), reconciler=NullReconciler())
    second = await cases.launch_call(seeded, walter.id, settings=get_settings(),
                                     provider=mock(), reconciler=NullReconciler())

    assert first["call_id"] != second["call_id"]
    assert second["attempt"] == first["attempt"] + 1
    with session_scope() as s:
        # ... and still one case for the one address
        assert len(list(s.exec(select(Incident).where(Incident.neighbour_id == walter.id)).all())) == 1


async def test_a_case_call_never_leaves_an_empty_active_sweep_behind(seeded) -> None:  # noqa: ANN001
    """A sweep that is active with no driver attached is a trap: a restart resumes it and rings the
    whole roster, and the "Start sweep" button hands it back instead of starting a real one. So a
    case call on a never-swept hazard files under a sweep that is closed from birth."""
    from app.api import cases
    from app.seed_helpers import resumable_sweeps

    rosa = neighbour_named("Rosa Delgado")
    await cases.launch_call(seeded, rosa.id, settings=get_settings(),
                            provider=mock(), reconciler=NullReconciler())

    with session_scope() as s:
        sweeps = list(s.exec(select(Sweep).where(Sweep.hazard_id == seeded)).all())
        assert len(sweeps) == 1
        assert sweeps[0].is_active is False
        assert sweeps[0].call_order == [rosa.id], "the record says who this sweep actually rang"
    assert resumable_sweeps() == [], "nothing here would be resumed into a roster-wide sweep"


async def test_a_case_call_files_under_the_evening_sweep_when_there_is_one(seeded) -> None:  # noqa: ANN001
    """A captain ringing somebody back at nine o'clock is still part of tonight. Filing that call
    somewhere else would split the person's record in two."""
    from app.api import cases

    sweep_id = await _swept(seeded)
    rosa = neighbour_named("Rosa Delgado")
    out = await cases.launch_call(seeded, rosa.id, settings=get_settings(),
                                  provider=mock(), reconciler=NullReconciler())

    assert out["sweep_id"] == sweep_id
    with session_scope() as s:
        assert len(list(s.exec(select(Sweep).where(Sweep.hazard_id == seeded)).all())) == 1


# ------------------------------------------------------------------------------------------------
# What the tracker on the map is told about a unit going to one of these
# ------------------------------------------------------------------------------------------------
def _en_route_to(priority: int, kind: AssetKind) -> tuple[Dispatch, Asset, Incident]:
    """A unit under way to a Maryvale address. Real coordinates, a real route, a real clock."""
    incident = Incident(hazard_id="haz_x", sweep_id="swp_x", neighbour_id="nbr_x",
                        priority=priority, lat=33.5081, lon=-112.1738, address="2118 N 51st Ave")
    route = route_between(33.4942, -112.1543, incident.lat, incident.lon)
    asset = Asset(call_sign="M-31", kind=kind, status=AssetStatus.EN_ROUTE, speed_mph=30.0,
                  lat=route[0][0], lon=route[0][1], last_moved_at=utcnow())
    dispatch = Dispatch(incident_id=incident.id, asset_id=asset.id, status=DispatchStatus.EN_ROUTE,
                        route=route, progress=0.0, committed_at=asset.last_moved_at)
    return dispatch, asset, incident


def test_every_tick_carries_what_a_tracker_widget_needs() -> None:
    """Speed, heading, distance remaining, ETA and percent complete are computed here, from
    persisted state and elapsed wall-clock time, and sent on every tick — so a browser never has to
    estimate a position or count a clock down at a rate it invented."""
    dispatch, asset, incident = _en_route_to(3, AssetKind.WELLNESS_VAN)
    total = path_length_miles(dispatch.route)

    change = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(minutes=2),
                              incident=incident)

    assert change["speed_mph"] == 30.0, "the speed the ETA was actually divided by"
    assert change["heading"] and change["heading"] in COMPASS
    assert 0 < change["distance_remaining_miles"] < total
    assert change["eta_minutes"] > 0
    assert change["eta_at"], "the clock time the arithmetic points at, not just a duration"
    assert 0 < change["percent_complete"] < 100
    # the numbers agree with each other rather than being three independent guesses
    assert round(change["travelled_miles"] + change["distance_remaining_miles"], 3) == round(total, 3)
    assert abs(change["eta_minutes"] - (change["distance_remaining_miles"] / 30.0) * 60.0) < 0.1
    assert change["incident_id"] == incident.id


def test_only_an_agency_unit_on_a_life_safety_run_shows_a_light_bar() -> None:
    """A light bar means something specific and it is never decoration. `requires_authorisation` is
    the single source of truth for what counts as an agency unit, so a kind added to the fleet later
    cannot quietly acquire lights."""
    dispatch, asset, incident = _en_route_to(1, AssetKind.EMS_UNIT)
    lit = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(seconds=30),
                           incident=incident)
    assert lit["lights_on"] is True

    # a water drop is not a life safety run, whatever the priority on the incident says
    dispatch, asset, incident = _en_route_to(1, AssetKind.WATER_ICE_TRUCK)
    assert requires_authorisation(asset.kind) is False
    water = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(seconds=30),
                             incident=incident)
    assert water["lights_on"] is False

    # ... and neither is an agency unit going to a routine welfare call
    dispatch, asset, incident = _en_route_to(4, AssetKind.EMS_UNIT)
    routine = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(seconds=30),
                               incident=incident)
    assert routine["lights_on"] is False


def test_the_lights_go_out_at_the_kerb_and_are_never_guessed() -> None:
    dispatch, asset, incident = _en_route_to(1, AssetKind.EMS_UNIT)
    minutes = (path_length_miles(dispatch.route) / asset.speed_mph) * 60.0
    arrived = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(minutes=minutes),
                               incident=incident)
    assert arrived["arrived"] is True and arrived["lights_on"] is False
    assert arrived["eta_minutes"] == 0.0 and arrived["percent_complete"] == 100.0

    # and a tick that cannot establish the incident behind the run does not draw a lit vehicle
    dispatch, asset, _ = _en_route_to(1, AssetKind.EMS_UNIT)
    blind = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(seconds=30))
    assert blind["lights_on"] is False


def test_a_stopped_unit_reports_no_eta_rather_than_arriving_now() -> None:
    """`None` says "this vehicle is not going anywhere". Zero would read as "arriving now", which is
    the opposite of the truth and the sort of number a coordinator acts on."""
    dispatch, asset, incident = _en_route_to(1, AssetKind.EMS_UNIT)
    asset.speed_mph = 0.0
    change = advance_dispatch(dispatch, asset, now=asset.last_moved_at + timedelta(minutes=5),
                              incident=incident)
    assert change["eta_minutes"] is None and change["eta_at"] is None
    assert change["speed_mph"] == 0.0


# ------------------------------------------------------------------------------------------------
# The button, over HTTP
# ------------------------------------------------------------------------------------------------
async def test_the_call_button_accepts_and_a_second_click_does_not_ring_them_twice(seeded, client) -> None:  # noqa: ANN001
    """The console presses call and gets an answer immediately; the call itself plays out on the
    stream it is already watching. A double-click on a button labelled with a frail person's name
    must not put two calls into that person's house."""
    from app.api import cases

    walter = neighbour_named("Walter Brzezinski")
    async with await client() as c:
        first = await c.post(f"/api/cases/{seeded}/{walter.id}/call", json={"launched_by": "Alma Reyes"})
        second = await c.post(f"/api/cases/{seeded}/{walter.id}/call", json={})

        assert first.status_code == 202
        body = first.json()
        assert body["status"] == "dialing" and body["name"] == "Walter Brzezinski"
        assert body["watch"] == f"/api/stream/hazards/{seeded}"
        assert second.status_code == 409 and "already in progress" in second.json()["detail"]

        for task in cases.in_flight().values():
            await task

    with session_scope() as s:
        calls = list(s.exec(select(CheckCall).where(CheckCall.neighbour_id == walter.id)).all())
        assert len(calls) == 1, "one press, one call, however many times the button was clicked"


async def test_the_call_button_refuses_somebody_who_never_opted_in(seeded, client) -> None:  # noqa: ANN001
    """Consent is checked on the row before anything is scheduled, so the operator is told why
    rather than watching a call quietly not happen."""
    gerald = neighbour_named("Gerald Pryce")
    assert gerald.check_in_consent is False

    async with await client() as c:
        refused = await c.post(f"/api/cases/{seeded}/{gerald.id}/call", json={})
        case = (await c.get(f"/api/cases/{seeded}/{gerald.id}")).json()

    assert refused.status_code == 409
    assert "consent" in refused.json()["detail"]
    assert case["can_call"] == {"allowed": False, "reason": "no consent on file for automated check-in calls",
                                "provider": "mock", "budget_remaining": None}
    with session_scope() as s:
        assert list(s.exec(select(CheckCall).where(CheckCall.neighbour_id == gerald.id)).all()) == []


async def test_the_case_page_is_one_request_and_carries_the_whole_case(seeded, client) -> None:  # noqa: ANN001
    """A case page assembled from six racing fetches shows a half-drawn picture of somebody's
    emergency, so everything it renders comes back together."""
    sweep_id = await _swept(seeded)
    _sync(sweep_id)
    rosa = neighbour_named("Rosa Delgado")

    async with await client() as c:
        case = (await c.get(f"/api/cases/{seeded}/{rosa.id}")).json()
        assert (await c.get(f"/api/cases/{seeded}/nbr_nope")).status_code == 404
        assert (await c.get(f"/api/cases/haz_nope/{rosa.id}")).status_code == 404

    assert set(case) >= {"hazard", "neighbour", "risk", "risk_reasons", "sweep", "calls",
                         "escalations", "handoffs", "incidents", "actions", "timeline", "can_call"}
    assert case["neighbour"]["name"] == "Rosa Delgado"
    assert case["neighbour"]["phone_masked"].endswith(rosa.phone[-4:])
    assert rosa.phone not in str(case), "a raw number never leaves the backend"
    assert case["risk"]["band"] and case["risk_reasons"], "why she is on the screen, in sentences"
    assert case["calls"] and case["calls"][0]["transcript"], "the conversation, not a summary of it"
    assert case["escalations"] and case["escalations"][0]["rungs"], "the ladder, rung by rung"
    assert case["incidents"] and case["incidents"][0]["neighbour_id"] == rosa.id
    assert case["timeline"], "her agent's own log"
    assert case["can_call"]["allowed"] is True
