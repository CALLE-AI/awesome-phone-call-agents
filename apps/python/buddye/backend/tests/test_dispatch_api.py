"""The operator layer end to end: propose, commit, authorise, decline, and actually arrive.

Everything here runs a real sweep over the mock provider first, because the properties worth pinning
are properties of the whole chain — a welfare call finds somebody in trouble, an incident opens at
their real address, and a van either rolls on its own or waits for a person's name. Nothing is
stubbed except the model, and the model is stubbed only where the point of the test is what happens
when it misbehaves.

The one thing to know about the movement tests: the simulator is not asked to wait. An asset's
`last_moved_at` is wound back so that the *elapsed wall-clock time* it measures is a real number of
minutes, and then the real `MovementSimulator` — with the real `session_scope` factory and the real
`MovementPublisher` from `app/main.py` — is started and left to do exactly what it does in
production. What is asserted is that the position it writes is persisted, that it reaches the
address, and that both facts arrive on the event stream a browser is reading.
"""
from __future__ import annotations

import asyncio
import time
from datetime import timedelta

import pytest
from sqlmodel import select

from app.agents.client import AgentCall
from app.db import session_scope
from app.domain import geo
from app.domain.state import AssetStatus, DispatchStatus, IncidentStatus
from app.models import Asset, Dispatch, Incident, Neighbour, OperatorAction, utcnow
from app.orchestrator import dispatch as dispatcher
from app.orchestrator import incidents as incident_layer
from tests.helpers import events_of, run_sweep

pytestmark = pytest.mark.usefixtures("db")

CAPTAIN = "Alma Reyes"


# ------------------------------------------------------------------------------------------------
# Plumbing
# ------------------------------------------------------------------------------------------------
class FakeClient:
    """An `AgentClient` that never touches a network. `data` is whatever the "model" replied."""

    def __init__(self, data: dict | None, *, error: str | None = None) -> None:
        self.model = "fake/glm"
        self._data = data
        self._error = error
        self.prompts: list[str] = []

    async def complete_json(self, *, agent: str, system: str, user: str, temperature: float = 0.0) -> AgentCall:
        self.prompts.append(user)
        return AgentCall(agent=agent, model=self.model, data=self._data, latency_ms=1234, error=self._error)


async def _sweep_and_sync(hazard_id: str) -> dict[str, str]:
    """Run the evening, reconcile it, and hand back {neighbour name: incident id}."""
    sweep_id = await run_sweep(hazard_id)
    with session_scope() as s:
        incident_layer.sync_sweep(s, sweep_id)
    with session_scope() as s:
        names = {n.id: n.name for n in s.exec(select(Neighbour)).all()}
        return {names[i.neighbour_id]: i.id for i in s.exec(select(Incident)).all()}


def _dispatch(dispatch_id: str) -> Dispatch:
    with session_scope() as s:
        row = s.get(Dispatch, dispatch_id)
        assert row is not None
        s.expunge(row)
        return row


def _asset(asset_id: str) -> Asset:
    with session_scope() as s:
        row = s.get(Asset, asset_id)
        assert row is not None
        s.expunge(row)
        return row


def _incident(incident_id: str) -> Incident:
    with session_scope() as s:
        row = s.get(Incident, incident_id)
        assert row is not None
        s.expunge(row)
        return row


def _rewind(asset_id: str, *, seconds: float) -> None:
    """Put this asset's clock back, so the next simulator tick measures real elapsed driving time.

    The simulator computes movement from wall-clock time and speed, so this is the honest way to
    make a test cover four minutes of driving without waiting four minutes. Nothing about the
    arithmetic is bypassed.
    """
    with session_scope() as s:
        asset = s.get(Asset, asset_id)
        asset.last_moved_at = utcnow() - timedelta(seconds=seconds)
        s.add(asset)


async def _simulate_until(predicate, *, timeout_s: float = 8.0) -> bool:  # noqa: ANN001
    """Run the production simulator, wired exactly as `app/main.py` wires it, until something is true."""
    from app.main import MovementPublisher
    from app.sim.movement import MovementSimulator

    sim = MovementSimulator(session_scope, tick_seconds=0.02, emit=MovementPublisher())
    sim.start()
    try:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            await asyncio.sleep(0.02)
            if predicate():
                return True
        return False
    finally:
        await sim.stop()


# ------------------------------------------------------------------------------------------------
# Community resources: nobody clicks
# ------------------------------------------------------------------------------------------------
async def test_a_community_asset_auto_dispatches_and_physically_arrives(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    # Lupe accepted a water and ice drop. Nothing about that justifies an agency unit, so whatever
    # the ranking picks is a community resource and it goes without anybody being asked.
    out = await dispatcher.auto_dispatch(incidents["Lupe Ibarra"])

    assert out is not None
    assert out["requires_authorisation"] is False
    assert out["status"] == "EN_ROUTE"
    assert out["committed_by"] == "agent" and out["authorised_by"] == ""
    assert out["eta_minutes"] > 0 and out["distance_miles"] > 0
    assert len(out["route"]) >= 2, "a real polyline, which is what the map draws and the sim walks"

    incident = _incident(incidents["Lupe Ibarra"])
    assert incident.status == IncidentStatus.DISPATCHED
    asset_id = out["asset_id"]
    start_lat, start_lon = _asset(asset_id).lat, _asset(asset_id).lon

    # A little driving: the position moves, and it moves in the database, not in a browser.
    _rewind(asset_id, seconds=25)
    moved = await _simulate_until(lambda: _dispatch(out["id"]).progress > 0.0)
    assert moved, "the simulator advanced nothing in eight seconds of ticking"
    mid = _asset(asset_id)
    assert (mid.lat, mid.lon) != (start_lat, start_lon)
    assert mid.heading_deg is not None
    assert _dispatch(out["id"]).status == DispatchStatus.EN_ROUTE

    # Now the rest of the drive. Real minutes of elapsed time, real miles, real arrival.
    _rewind(asset_id, seconds=1800)
    arrived = await _simulate_until(lambda: _dispatch(out["id"]).status == DispatchStatus.ARRIVED)
    assert arrived, "the van never reached the address"

    final = _asset(asset_id)
    assert final.status == AssetStatus.ON_SCENE
    # It is at the house, not near it: within a hundredth of a mile of the incident's coordinates.
    assert geo.haversine_miles(final.lat, final.lon, incident.lat, incident.lon) < 0.02
    done = _dispatch(out["id"])
    assert done.arrived_at is not None and done.progress == 1.0
    assert _incident(incidents["Lupe Ibarra"]).status == IncidentStatus.ON_SCENE

    # And the board saw all of it.
    assert events_of(seeded, type="asset.moved"), "no movement reached the event stream"
    arrivals = events_of(seeded, type="asset.arrived")
    assert arrivals and arrivals[-1]["payload"]["dispatch_id"] == out["id"]


async def test_completing_a_dispatch_frees_the_asset_where_it_finished(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    out = await dispatcher.auto_dispatch(incidents["Lupe Ibarra"])
    _rewind(out["asset_id"], seconds=1800)
    assert await _simulate_until(lambda: _dispatch(out["id"]).status == DispatchStatus.ARRIVED)

    at_house = (_asset(out["asset_id"]).lat, _asset(out["asset_id"]).lon)
    with session_scope() as s:
        dispatcher.complete(s, s.get(Dispatch, out["id"]), note="water and ice left in the kitchen")

    asset = _asset(out["asset_id"])
    assert asset.status == AssetStatus.AVAILABLE
    assert asset.current_dispatch_id is None
    # No pretend return leg: the next job starts from the doorstep it is standing on.
    assert (asset.lat, asset.lon) == at_house
    assert _dispatch(out["id"]).status == DispatchStatus.COMPLETED


async def test_an_asset_committed_to_one_incident_is_not_offered_to_the_next(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    first = await dispatcher.auto_dispatch(incidents["Lupe Ibarra"])
    second = await dispatcher.auto_dispatch(incidents["Trinidad Bustos"])

    assert second is not None
    assert second["asset_id"] != first["asset_id"], "one van, one address at a time"

    with session_scope() as s:
        incident = s.get(Incident, incidents["Trinidad Bustos"])
        report = dispatcher.eligibility_for(s, incident)
        excluded = {e.call_sign: e for e in report.excluded}
    taken = first["call_sign"]
    assert taken in excluded, "the committed van is excluded by name"
    assert excluded[taken].code in {"status", "committed"}
    assert taken in excluded[taken].reason, "the exclusion is a sentence a coordinator can read"


# ------------------------------------------------------------------------------------------------
# Agency resources: a person clicks, or nobody goes
# ------------------------------------------------------------------------------------------------
async def test_an_ems_request_cannot_be_committed_without_a_name_and_can_be_with_one(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    # Walter's concentrator is off and he told us something is wrong. That is the one shape of
    # finding that justifies putting an ambulance in front of a human at all.
    out = await dispatcher.auto_dispatch(incidents["Walter Brzezinski"])

    assert out is not None
    assert out["requires_authorisation"] is True
    assert out["kind"] == "EMS_UNIT"
    assert out["status"] == "PROPOSED", "an agency unit is prepared, not sent"
    assert out["authorised_by"] == "" and out["committed_by"] == ""
    assert "named human" in out["status_note"]

    # The asset has not been taken and is not moving.
    assert _asset(out["asset_id"]).status == AssetStatus.AVAILABLE
    assert _asset(out["asset_id"]).current_dispatch_id is None

    # Software cannot commit it. Not with a flag, not with a different verb.
    with session_scope() as s:
        with pytest.raises(dispatcher.DispatchRefused, match="agency unit"):
            dispatcher.commit(s, s.get(Dispatch, out["id"]), committed_by="agent")
    assert _dispatch(out["id"]).status == DispatchStatus.PROPOSED

    # Nor can a nameless human, nor a service account.
    for bad in ("", "   ", "system", "automation", "1234"):
        with session_scope() as s:
            with pytest.raises(dispatcher.DispatchRefused):
                dispatcher.authorise(s, s.get(Dispatch, out["id"]), name=bad)
    assert _dispatch(out["id"]).status == DispatchStatus.PROPOSED
    assert _asset(out["asset_id"]).status == AssetStatus.AVAILABLE

    # A named person can, with one call.
    with session_scope() as s:
        dispatcher.authorise(s, s.get(Dispatch, out["id"]), name=CAPTAIN, note="his concentrator is off")

    committed = _dispatch(out["id"])
    assert committed.status == DispatchStatus.COMMITTED
    assert committed.authorised_by == CAPTAIN and committed.authorised_at is not None
    assert committed.committed_by == CAPTAIN
    assert _asset(out["asset_id"]).status == AssetStatus.ASSIGNED
    assert _incident(incidents["Walter Brzezinski"]).status == IncidentStatus.DISPATCHED


async def test_authorising_marks_the_agents_own_record_as_accepted_by_that_person(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    out = await dispatcher.auto_dispatch(incidents["Walter Brzezinski"])
    with session_scope() as s:
        dispatcher.authorise(s, s.get(Dispatch, out["id"]), name=CAPTAIN)

    with session_scope() as s:
        rows = list(s.exec(select(OperatorAction).where(
            OperatorAction.incident_id == incidents["Walter Brzezinski"],
            OperatorAction.kind == "dispatch_proposal")).all())
        accepted = [r for r in rows if r.accepted is True]
        assert accepted, "the human side of the provenance record was never written"
        assert accepted[-1].accepted_by == CAPTAIN


async def test_authorising_releases_the_handoff_packet_the_same_click_prepared(seeded, fleet_seeded) -> None:  # noqa: ANN001
    from app.models import HandoffPacket

    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Walter Brzezinski"]
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        packets = list(s.exec(select(HandoffPacket).where(
            HandoffPacket.escalation_id == incident.escalation_id)).all())
        has_packet = bool(packets)
        packet_id = packets[0].id if packets else ""
        assert all(p.released_at is None for p in packets), "a prepared packet has told nobody anything"

    out = await dispatcher.auto_dispatch(incident_id)
    with session_scope() as s:
        dispatcher.authorise(s, s.get(Dispatch, out["id"]), name=CAPTAIN, note="ambulance approved")

    if has_packet:
        with session_scope() as s:
            packet = s.get(HandoffPacket, packet_id)
            assert packet.released_at is not None
            assert packet.released_by == CAPTAIN


async def test_an_incident_with_no_packet_can_still_have_its_ambulance_approved(seeded, fleet_seeded) -> None:  # noqa: ANN001
    """A missing or unreleasable packet must not be the reason an ambulance cannot be approved."""
    from app.models import HandoffPacket

    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Walter Brzezinski"]
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        for packet in s.exec(select(HandoffPacket).where(
                HandoffPacket.escalation_id == incident.escalation_id)).all():
            s.delete(packet)

    out = await dispatcher.auto_dispatch(incident_id)
    with session_scope() as s:
        dispatcher.authorise(s, s.get(Dispatch, out["id"]), name=CAPTAIN)
    assert _dispatch(out["id"]).status == DispatchStatus.COMMITTED


async def test_a_declined_request_records_who_said_no_and_why(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    out = await dispatcher.auto_dispatch(incidents["Walter Brzezinski"])

    with session_scope() as s:
        with pytest.raises(dispatcher.DispatchRefused, match="reason"):
            dispatcher.decline(s, s.get(Dispatch, out["id"]), name=CAPTAIN, reason="")
    with session_scope() as s:
        with pytest.raises(dispatcher.DispatchRefused):
            dispatcher.decline(s, s.get(Dispatch, out["id"]), name="system", reason="no")

    with session_scope() as s:
        dispatcher.decline(s, s.get(Dispatch, out["id"]), name=CAPTAIN,
                           reason="his nephew is already there with a generator")

    declined = _dispatch(out["id"])
    assert declined.status == DispatchStatus.CANCELLED
    assert CAPTAIN in declined.decline_reason and "nephew" in declined.decline_reason
    assert _asset(out["asset_id"]).status == AssetStatus.AVAILABLE, "declining frees nothing because nothing was taken"

    with session_scope() as s:
        rows = list(s.exec(select(OperatorAction).where(
            OperatorAction.incident_id == incidents["Walter Brzezinski"])).all())
        assert any(r.accepted is False and r.accepted_by == CAPTAIN for r in rows)


# ------------------------------------------------------------------------------------------------
# The model proposes, deterministic code disposes
# ------------------------------------------------------------------------------------------------
async def test_a_model_that_returns_nonsense_degrades_to_the_deterministic_pick(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Lupe Ibarra"]
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        expected = dispatcher.eligibility_for(s, incident).best().call_sign

    client = FakeClient({"asset_id": "ast_a_helicopter_i_remembered", "reason": "trust me"})
    out = await dispatcher.propose(incident_id, client=client)

    assert client.prompts, "the model was actually asked"
    assert out is not None
    assert out["call_sign"] == expected, "an invented asset is refused and fleet's own pick stands"
    assert out["source"] == "deterministic"
    assert "not on the shortlist" in out["fallback_reason"]
    assert out["status"] == "PROPOSED"


async def test_a_model_that_times_out_still_produces_a_dispatch_and_says_why(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    client = FakeClient(None, error="TimeoutError: the gateway took too long")
    out = await dispatcher.auto_dispatch(incidents["Lupe Ibarra"], client=client)

    assert out is not None
    assert out["status"] == "EN_ROUTE", "a model outage degrades the prose, never the dispatch"
    assert out["source"] == "deterministic"
    assert "Timeout" in out["fallback_reason"]


async def test_a_legal_model_choice_is_used_and_recorded_as_the_models(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Lupe Ibarra"]
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        ranked = dispatcher.eligibility_for(s, incident).to_dict()["candidates"]
    assert len(ranked) >= 2
    second = ranked[1]  # a legal candidate that is not the one fleet would have picked

    client = FakeClient({"asset_id": second["asset_id"],
                         "reason": "she keeps insulin in the fridge, so send the truck with ice",
                         "agency_request": False, "justification": ""})
    out = await dispatcher.propose(incident_id, client=client)

    assert out is not None
    assert out["asset_id"] == second["asset_id"]
    assert out["source"] == "model" and out["model"] == "fake/glm"
    assert "insulin" in out["reason"]
    # The numbers are the record's, not the model's: it was never asked to do arithmetic.
    assert out["eta_minutes"] == pytest.approx(second["eta_minutes"], abs=0.1)


async def test_an_agency_request_without_a_justification_is_not_put_in_front_of_a_human(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Walter Brzezinski"]
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        agency = next(c for c in dispatcher.eligibility_for(s, incident).candidates
                      if c.requires_authorisation)

    client = FakeClient({"asset_id": agency.asset_id, "reason": "high risk, to be safe",
                         "agency_request": True, "justification": ""})
    out = await dispatcher.propose(incident_id, client=client)

    assert out is not None
    assert out["source"] == "deterministic"
    assert "justification" in out["fallback_reason"]


async def test_every_proposal_leaves_a_provenance_row(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    client = FakeClient({"asset_id": "nope", "reason": "x"})
    await dispatcher.propose(incidents["Lupe Ibarra"], client=client)

    with session_scope() as s:
        rows = list(s.exec(select(OperatorAction).where(
            OperatorAction.incident_id == incidents["Lupe Ibarra"])).all())
        assert rows, "an agent that assigns a truck without leaving a trail is not usable here"
        row = next(r for r in rows if r.agent == "dispatch_agent")
        assert row.kind == "dispatch_proposal"
        assert row.model == "fake/glm" and row.latency_ms == 1234
        assert row.inputs["candidates"] and row.rationale
        assert row.accepted is None, "an agent never marks its own work accepted"


async def test_an_incident_the_fleet_could_not_serve_is_retried_when_a_unit_frees_up(seeded, fleet_seeded) -> None:  # noqa: ANN001
    """An address that arrived while every van was out must not stay "no unit available" all evening.

    The retry is deliberately gated on the deterministic filter finding a candidate, so an incident
    nobody can serve costs nothing and never reaches a model — and the moment somebody can go, it is
    picked up on the next pass.
    """
    incidents = await _sweep_and_sync(seeded)
    with session_scope() as s:
        for asset in s.exec(select(Asset)).all():
            # Every community unit is out. Nothing can be sent to a welfare check.
            if not dispatcher.requires_authorisation(asset.kind):
                asset.status = AssetStatus.OUT_OF_SERVICE
                s.add(asset)

    stranded = incidents["Faye Lindqvist"]  # nobody answered; the need is a knock on the door
    assert await dispatcher.auto_dispatch(stranded) is None
    # Faye needs a knock on the door and no community unit is on the road. An agency welfare check
    # is not offered for her, so there is nothing to retry — and retrying costs nothing to discover.
    assert stranded not in incident_layer.stalled_incidents()

    with session_scope() as s:
        wv1 = s.exec(select(Asset).where(Asset.call_sign == "WV-1")).one()
        wv1.status = AssetStatus.AVAILABLE
        s.add(wv1)

    backlog = incident_layer.stalled_incidents()
    assert stranded in backlog, "a freed unit puts the stranded address back in the queue"
    out = await dispatcher.auto_dispatch(stranded)
    assert out is not None and out["status"] == "EN_ROUTE"


async def test_a_committed_unit_cannot_be_declined_out_from_under_itself(seeded, fleet_seeded) -> None:  # noqa: ANN001
    """Declining is for a request. A van that is already rolling is recalled, and this is not that.

    The state table allows CANCELLED from EN_ROUTE, and taking that edge here would strand the
    asset: ASSIGNED or EN_ROUTE with `current_dispatch_id` pointing at a dead row, excluded by
    fleet as committed and ignored by the simulator, which only walks EN_ROUTE dispatches. It would
    freeze on the map for the rest of the evening.
    """
    incidents = await _sweep_and_sync(seeded)
    out = await dispatcher.auto_dispatch(incidents["Lupe Ibarra"])
    assert out["status"] == "EN_ROUTE"

    with session_scope() as s:
        with pytest.raises(dispatcher.DispatchRefused, match="recalled, not declined"):
            dispatcher.decline(s, s.get(Dispatch, out["id"]), name=CAPTAIN, reason="changed my mind")

    still = _dispatch(out["id"])
    asset = _asset(out["asset_id"])
    assert still.status == DispatchStatus.EN_ROUTE
    assert asset.status == AssetStatus.EN_ROUTE
    assert asset.current_dispatch_id == out["id"], "the van is still attached to the job it is driving to"


async def test_nothing_is_sent_to_an_incident_a_coordinator_has_closed(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Walter Brzezinski"]
    out = await dispatcher.propose(incident_id)          # prepared, not sent
    with session_scope() as s:
        incident_layer.resolve(s, s.get(Incident, incident_id), resolved_by=CAPTAIN,
                               resolution="his nephew got there first")

    # The stale proposal is still on the screen. Clicking it must not take a unit.
    with session_scope() as s:
        with pytest.raises(dispatcher.DispatchRefused, match="closed incident"):
            dispatcher.authorise(s, s.get(Dispatch, out["id"]), name=CAPTAIN)
    assert _dispatch(out["id"]).status == DispatchStatus.PROPOSED
    assert _asset(out["asset_id"]).status == AssetStatus.AVAILABLE
    assert _asset(out["asset_id"]).served_this_shift == 0

    with pytest.raises(dispatcher.DispatchRefused):
        await dispatcher.propose(incident_id)


async def test_a_declined_incident_is_not_proposed_again_by_the_autopilot(seeded, fleet_seeded) -> None:  # noqa: ANN001
    """A human said no. Asking again on the next pass would make the decline button useless."""
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Walter Brzezinski"]
    out = await dispatcher.auto_dispatch(incident_id)
    with session_scope() as s:
        dispatcher.decline(s, s.get(Dispatch, out["id"]), name=CAPTAIN,
                           reason="his nephew is there with a generator")

    assert incident_id not in incident_layer.stalled_incidents()


async def test_the_backlog_is_worked_worst_first(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    backlog = incident_layer.stalled_incidents()
    with session_scope() as s:
        priorities = [s.get(Incident, i).priority for i in backlog]
    assert priorities == sorted(priorities), "the fleet is finite; whoever is offered it first takes it"
    assert priorities[0] == 1


# ------------------------------------------------------------------------------------------------
# The HTTP surface
# ------------------------------------------------------------------------------------------------
async def test_the_api_refuses_to_commit_an_agency_unit_and_takes_a_named_authorisation(client, seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    out = await dispatcher.propose(incidents["Walter Brzezinski"])
    assert out["requires_authorisation"] is True

    async with await client() as c:
        pending = (await c.get("/api/dispatch/pending")).json()
        assert [p["id"] for p in pending] == [out["id"]]
        assert pending[0]["name"] == "Walter Brzezinski"
        assert pending[0]["incident_priority"] == 1

        refused = await c.post(f"/api/dispatch/{out['id']}/commit")
        assert refused.status_code == 409 and "agency unit" in refused.json()["detail"]

        unnamed = await c.post(f"/api/dispatch/{out['id']}/authorise", json={"name": "  "})
        assert unnamed.status_code == 400

        robot = await c.post(f"/api/dispatch/{out['id']}/authorise", json={"name": "automation"})
        assert robot.status_code == 400

        ok = await c.post(f"/api/dispatch/{out['id']}/authorise",
                          json={"name": CAPTAIN, "note": "concentrator is off"})
        assert ok.status_code == 200
        body = ok.json()
        assert body["status"] == "EN_ROUTE" and body["authorised_by"] == CAPTAIN

        assert (await c.get("/api/dispatch/pending")).json() == []


async def test_the_api_declines_a_request_and_keeps_the_reason(client, seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    out = await dispatcher.propose(incidents["Walter Brzezinski"])

    async with await client() as c:
        bad = await c.post(f"/api/dispatch/{out['id']}/decline", json={"name": CAPTAIN, "reason": ""})
        assert bad.status_code == 400

        ok = await c.post(f"/api/dispatch/{out['id']}/decline",
                          json={"name": CAPTAIN, "reason": "the fire crew is already on the street"})
        assert ok.status_code == 200
        assert ok.json()["status"] == "CANCELLED"
        assert "fire crew" in ok.json()["decline_reason"]

        listed = (await c.get("/api/dispatch", params={"incident_id": incidents["Walter Brzezinski"]})).json()
        assert listed[0]["decline_reason"] == ok.json()["decline_reason"]


async def test_the_incident_endpoints_show_the_address_the_needs_and_why_not_everyone_else(client, seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Rosa Delgado"]

    async with await client() as c:
        listed = (await c.get("/api/incidents", params={"hazard_id": seeded})).json()
        assert len(listed) == 10
        assert listed[0]["priority"] == 1, "worst first"

        detail = (await c.get(f"/api/incidents/{incident_id}")).json()
        assert detail["address"] and detail["lat"] and detail["lon"]
        assert detail["needs"] and detail["need_detail"]["needs"][0]["reason"]
        assert detail["situation"]["what_they_said"]

        cands = (await c.get(f"/api/incidents/{incident_id}/candidates")).json()
        assert cands["candidates"], "somebody can go"
        assert cands["excluded"], "and everybody who cannot is named with a sentence"
        assert all(e["reason"] and e["code"] for e in cands["excluded"])
        assert all(c_["eta_minutes"] > 0 for c_ in cands["candidates"])


async def test_assets_report_live_positions_that_are_server_state(client, seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    out = await dispatcher.auto_dispatch(incidents["Lupe Ibarra"])
    _rewind(out["asset_id"], seconds=25)
    assert await _simulate_until(lambda: _dispatch(out["id"]).progress > 0.0)

    async with await client() as c:
        positions = (await c.get("/api/assets/positions")).json()
        assert positions["count"] == 12, "six community units, two accessible, four agency"
        assert positions["en_route"] == 1
        moving = next(a for a in positions["assets"] if a["id"] == out["asset_id"])
        assert moving["status"] == "EN_ROUTE" and moving["progress"] > 0

        rows = (await c.get("/api/assets")).json()
        agency = [a for a in rows if a["requires_authorisation"]]
        assert {a["call_sign"] for a in agency} == {"R-15", "R-25", "E-15", "812A"}
        detail = next(a for a in rows if a["id"] == out["asset_id"])
        assert detail["destination"]["address"] and detail["destination"]["eta_minutes"] >= 0
        # The position the API reports is the row the simulator wrote, not a client-side guess.
        assert (detail["lat"], detail["lon"]) == (_asset(out["asset_id"]).lat, _asset(out["asset_id"]).lon)


async def test_the_demo_reset_puts_the_whole_fleet_including_the_agency_units_on_the_board(client) -> None:  # noqa: ANN001
    async with await client() as c:
        body = (await c.post("/api/demo/reset")).json()
        assert body["assets"] == 12
        assert body["assets_needing_authorisation"] == 4

        again = (await c.post("/api/demo/reset")).json()
        assert again["assets"] == 12, "the reset is idempotent, not additive"

        health = (await c.get("/api/health")).json()
        assert health["operator"]["assets"] == 12
        assert health["operator"]["awaiting_authorisation"] == 0


async def test_paperwork_is_generated_from_the_record_unsigned_and_unsent(client, seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Faye Lindqvist"]

    async with await client() as c:
        doc = (await c.post("/api/documents/generate",
                            json={"form": "ICS-214", "incident_id": incident_id})).json()
        assert doc["form"] == "ICS-214" and doc["body"]
        assert doc["approved_by"] == "" and doc["approved"] is False

        assert (await c.post(f"/api/documents/{doc['id']}/approve",
                             json={"approved_by": "system"})).status_code == 400
        signed = (await c.post(f"/api/documents/{doc['id']}/approve",
                               json={"approved_by": CAPTAIN})).json()
        assert signed["approved_by"] == CAPTAIN and signed["approved"] is True

        msg = (await c.post("/api/correspondence/draft",
                            json={"kind": "contact", "incident_id": incident_id})).json()
        assert msg["body"] and msg["sent_at"] is None
        assert "nobody has been contacted" in msg["status_note"]
        # Approving is not sending, and there is no endpoint that sends.
        approved = (await c.post(f"/api/correspondence/{msg['id']}/approve",
                                 json={"approved_by": CAPTAIN})).json()
        assert approved["approved_by"] == CAPTAIN and approved["sent_at"] is None

        listed = (await c.get("/api/correspondence", params={"incident_id": incident_id})).json()
        assert [m["id"] for m in listed] == [msg["id"]]


async def test_the_hazard_stream_carries_the_operator_layer(seeded, fleet_seeded) -> None:  # noqa: ANN001
    incidents = await _sweep_and_sync(seeded)
    with session_scope() as s:
        payloads = [incident_layer.event_payload(i) for i in s.exec(select(Incident)).all()]
    incident_layer.announce(payloads)
    await dispatcher.auto_dispatch(incidents["Lupe Ibarra"])
    await dispatcher.auto_dispatch(incidents["Walter Brzezinski"])

    types = {e["type"] for e in events_of(seeded)}
    assert {"incident.opened", "dispatch.proposed", "dispatch.committed", "dispatch.en_route",
            "dispatch.awaiting_authorisation"} <= types

    waiting = [e for e in events_of(seeded, type="dispatch.awaiting_authorisation")]
    assert waiting and "NOT requested" in waiting[0]["payload"]["note"]


# ------------------------------------------------------------------------------------------------
async def test_an_unlocated_incident_is_visible_and_refuses_to_dispatch(seeded, fleet_seeded) -> None:  # noqa: ANN001
    """(0, 0) is in the Atlantic. Better a visible incident nobody can be sent to than a silent one."""
    incidents = await _sweep_and_sync(seeded)
    incident_id = incidents["Lupe Ibarra"]
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        incident.lat, incident.lon = 0.0, 0.0
        s.add(incident)

    out = await dispatcher.auto_dispatch(incident_id)
    assert out is None, "nothing is sent to an address the system does not have"

    with session_scope() as s:
        report = dispatcher.eligibility_for(s, s.get(Incident, incident_id))
    assert report.candidates == ()
    assert "no coordinates" in report.error


@pytest.fixture()
def fleet_seeded(seeded):  # noqa: ANN001, ANN201
    """The full fleet, agency units included — what `app/main.py` plants at startup."""
    from app import seed_assets as fleet_seed

    with session_scope() as s:
        fleet_seed.seed_assets(s)
    return seeded
