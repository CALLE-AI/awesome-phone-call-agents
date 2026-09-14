"""The notification feed: what interrupts a person, what it says, and where it takes them.

Two things are being pinned here, and neither is the plumbing.

The first is that a notification is **derived**, never written. Every test below produces its pings
by running the real thing — a sweep, a reconcile, an authorisation request — and then reading the
feed. Nothing calls a `notify()`. If the feed could be made to say something the record does not
support, that would show up here as a test that passes without the event behind it.

The second is that the words are safe. `dispatch.awaiting_authorisation` is the one notification in
this product where a careless verb would be a lie with consequences: an agency unit is *prepared*
and unsent until a named human approves it, and a ping that reads "EMS dispatched" would tell a
coordinator that help is on the way to a house where nobody has been asked to go.
"""
from __future__ import annotations

import pytest
from sqlmodel import select

from app.api import notifications as feed_mod
from app.db import session_scope
from app.domain.state import AssetKind, IncidentStatus, requires_authorisation
from app.events.bus import bus
from app.models import AgentEvent, Asset, Dispatch, Incident, Neighbour
from app.orchestrator import dispatch as dispatcher
from app.orchestrator import incidents as incident_layer
from tests.helpers import events_of, neighbour_named, run_sweep

pytestmark = pytest.mark.usefixtures("db")


async def _swept_and_synced(hazard_id: str) -> str:
    sweep_id = await run_sweep(hazard_id)
    with session_scope() as s:
        opened = incident_layer.sync_sweep(s, sweep_id)
        payloads = [incident_layer.event_payload(i) for i in opened]
    incident_layer.announce(payloads)
    return sweep_id


def _by_kind(notes: list[dict], kind: str) -> list[dict]:
    return [n for n in notes if n["kind"] == kind]


# ------------------------------------------------------------------------------------------------
# What earns an interruption
# ------------------------------------------------------------------------------------------------
async def test_the_evening_opens_on_an_agent_flagging_somebody(seeded) -> None:  # noqa: ANN001
    """The first thing the console shows is the first thing that happened: triage flagging a person
    at risk. That is the "Walter's agent has flagged a risk" moment the whole flow opens on."""
    await _swept_and_synced(seeded)
    notes = feed_mod.feed(seeded, limit=200)

    assert {"case.flagged", "call.finished", "deployment.opened"} <= {n["kind"] for n in notes}
    assert notes[-1]["kind"] == "case.flagged", "the oldest ping is a case being flagged"
    # newest first: an operator reads the top of the list
    assert [n["event_id"] for n in notes] == sorted((n["event_id"] for n in notes), reverse=True)


async def test_the_http_feed_hands_the_console_a_badge_that_does_not_change_meaning(client) -> None:  # noqa: ANN001
    """`unread` is counted over a fixed window, not over the page that was asked for: a badge that
    says 10 on one screen and 28 on another because the page sizes differ is a badge nobody trusts.
    """
    async with await client() as c:
        hazard = (await c.post("/api/hazards", json={"kind": "heat", "headline": "Excessive Heat Warning — 114F",
                                                     "severity": "warning"})).json()
        small = (await c.get("/api/notifications", params={"hazard_id": hazard["id"], "limit": 1})).json()
        large = (await c.get("/api/notifications", params={"hazard_id": hazard["id"], "limit": 50})).json()

        assert small["unread"] == large["unread"]
        assert small["returned"] == 1 and large["returned"] >= 1
        assert small["notifications"][0]["kind"] == "hazard.declared"
        assert small["notifications"][0]["route"] == f"/hazards/{hazard['id']}"

        marked = (await c.post("/api/notifications/read", json={"hazard_id": hazard["id"], "all": True})).json()
        assert marked["unread"] == 0
        assert (await c.get("/api/notifications", params={"hazard_id": hazard["id"]})).json()["unread"] == 0
        assert (await c.post("/api/notifications/read", json={"hazard_id": hazard["id"]})).status_code == 400
        assert (await c.get("/api/notifications", params={"hazard_id": "haz_nope"})).status_code == 404


async def test_every_headline_names_the_person(seeded) -> None:  # noqa: ANN001
    """"1 new alert" is not information. This product is about individuals, and a captain scanning a
    feed under pressure is looking for a name she recognises."""
    await _swept_and_synced(seeded)
    with session_scope() as s:
        names = {n.name for n in s.exec(select(Neighbour)).all()}

    for note in feed_mod.feed(seeded, limit=200):
        if note["kind"] in {"hazard.declared"}:
            continue
        assert any(name in note["headline"] for name in names), note["headline"]
        assert note["headline"] and not note["headline"].endswith(" ")


async def test_silence_pings_loudest_and_points_at_the_case(seeded) -> None:  # noqa: ANN001
    """Nobody answering is the finding this product exists to surface, so it is severity one and the
    click lands on that person's case page rather than on a list."""
    await _swept_and_synced(seeded)
    notes = feed_mod.feed(seeded, limit=200)
    faye = neighbour_named("Faye Lindqvist")

    silence = [n for n in _by_kind(notes, "call.finished") if n["neighbour_id"] == faye.id]
    assert silence, "nobody answered for Faye; that must reach the console"
    ping = silence[0]
    assert "did not answer" in ping["headline"]
    assert ping["severity"] == "critical" and ping["priority"] == 1
    assert ping["route"] == f"/hazards/{seeded}/sweep/{faye.id}"
    assert ping["call_id"], "the ping carries the call it came from"


async def test_a_deployment_case_points_at_the_incident_not_the_person(seeded) -> None:  # noqa: ANN001
    """This is the hand-off in the console flow: the call is understood, a case is raised, and the
    ping opens Incidents with that case expanded for a human to approve or deny."""
    sweep_id = await _swept_and_synced(seeded)
    rosa = neighbour_named("Rosa Delgado")
    with session_scope() as s:
        incident = s.exec(select(Incident).where(Incident.neighbour_id == rosa.id)).one()
        incident_id, priority = incident.id, incident.priority

    ping = next(n for n in _by_kind(feed_mod.feed(seeded, limit=200), "deployment.opened")
                if n["neighbour_id"] == rosa.id)
    assert ping["incident_id"] == incident_id
    assert ping["route"] == f"/hazards/{seeded}/incidents/{incident_id}"
    assert ping["priority"] == priority and ping["severity"] == "critical"
    assert "Rosa Delgado" in ping["headline"]
    assert sweep_id  # the sweep that produced it is on the record


async def test_only_the_bands_where_harm_is_plausible_flag_a_case(seeded) -> None:  # noqa: ANN001
    """Triage scores the whole block; the whole block is a page, not fourteen interruptions."""
    await _swept_and_synced(seeded)
    flagged = _by_kind(feed_mod.feed(seeded, limit=200), "case.flagged")
    assert flagged, "somebody on this block is high risk under a 114F heat warning"

    triaged = events_of(seeded, type="sweep.triaged")[0]["payload"]["order"]
    bands = {row["neighbour_id"]: row["band"] for row in triaged}
    for note in flagged:
        assert bands[note["neighbour_id"]] in {"critical", "high"}, note["headline"]
    assert len(flagged) < len(triaged), "a flag for everybody is a flag for nobody"
    # one event, one ping per person, and the ids stay distinct
    assert len({n["id"] for n in flagged}) == len(flagged)


async def test_a_safe_call_is_not_an_interruption(seeded) -> None:  # noqa: ANN001
    await _swept_and_synced(seeded)
    yolanda = neighbour_named("Yolanda Cruz")  # she answered and she is fine
    notes = feed_mod.feed(seeded, limit=200)
    assert not [n for n in _by_kind(notes, "call.finished") if n["neighbour_id"] == yolanda.id]


# ------------------------------------------------------------------------------------------------
# The safety property, in words
# ------------------------------------------------------------------------------------------------
async def test_an_agency_request_is_never_described_as_sent(seeded) -> None:  # noqa: ANN001
    """BuddyE prepares an agency unit and stops. The ping is the moment a human is asked to decide,
    and it must not read as though the decision has already been taken.

    The dispatch row and the event are built here exactly as `dispatcher.propose` builds them — the
    real `dispatch_out` payload, `requires_authorisation` true — rather than by running a proposal
    through a model, because what is on trial is the wording of the notification.
    """
    await _swept_and_synced(seeded)
    walter = neighbour_named("Walter Brzezinski")
    with session_scope() as s:
        incident = s.exec(select(Incident).where(Incident.neighbour_id == walter.id)).one()
        incident.priority = 1
        s.add(incident)
        incident_id = incident.id
        ems = Asset(call_sign="M-31", kind=AssetKind.EMS_UNIT, capabilities=["medical"],
                    lat=incident.lat + 0.01, lon=incident.lon, base_lat=incident.lat,
                    base_lon=incident.lon, speed_mph=35.0)
        s.add(ems)
        s.flush()
        assert requires_authorisation(ems.kind), "an EMS unit is the kind a human has to approve"
        dispatch = Dispatch(incident_id=incident_id, asset_id=ems.id, reason="nearest medical unit",
                            requires_authorisation=True, distance_miles=1.0, eta_minutes=3.0)
        s.add(dispatch)
        s.flush()
        payload = dispatcher.dispatch_out(dispatch, ems, incident)
    bus.publish(hazard_id=seeded, neighbour_id=walter.id, type="dispatch.awaiting_authorisation",
                payload={**payload, "note": "prepared and NOT requested"})

    ping = next(n for n in feed_mod.feed(seeded, limit=200)
                if n["kind"] == "deployment.awaiting_authorisation")
    assert "M-31" in ping["headline"] and "Walter Brzezinski" in ping["headline"]
    assert "awaiting your approval" in ping["headline"]
    assert "Nobody has been asked and nothing has been sent." in ping["detail"]
    lowered = (ping["headline"] + " " + ping["detail"]).lower()
    for banned in ("dispatched", "on the way", "on their way", "en route", "is coming",
                   "called 911", "requested", "responding"):
        assert banned not in lowered, f"a prepared agency request must never say {banned!r}"
    # the only mention of sending anything is the one that denies it
    assert "sent" not in lowered.replace("nothing has been sent", "")
    assert ping["route"] == f"/hazards/{seeded}/incidents/{incident_id}"
    assert ping["severity"] == "critical", "a decision only a human can take is not an FYI"


# ------------------------------------------------------------------------------------------------
# Read state
# ------------------------------------------------------------------------------------------------
async def test_marking_one_ping_read_leaves_the_others_alone(seeded) -> None:  # noqa: ANN001
    """One `sweep.triaged` event fans out to a ping per person, so read state has to key on the
    notification and not on the event behind it — otherwise dismissing Rosa dismisses everybody."""
    await _swept_and_synced(seeded)
    flagged = _by_kind(feed_mod.feed(seeded, limit=200), "case.flagged")
    assert len(flagged) > 1
    target = flagged[0]

    feed_mod.mark_read(feed_mod.MarkReadIn(hazard_id=seeded, ids=[target["id"]], read_by="Alma Reyes"))
    after = {n["id"]: n["read"] for n in feed_mod.feed(seeded, limit=200)}

    assert after[target["id"]] is True
    assert after[flagged[1]["id"]] is False
    assert sum(1 for v in after.values() if v) == 1


async def test_clearing_the_feed_marks_everything_up_to_now_and_stays_cleared(seeded) -> None:  # noqa: ANN001
    await _swept_and_synced(seeded)
    feed_mod.mark_read(feed_mod.MarkReadIn(hazard_id=seeded, all=True, read_by="Alma Reyes"))
    assert all(n["read"] for n in feed_mod.feed(seeded, limit=200))
    assert feed_mod.feed(seeded, limit=200, unread_only=True) == []

    # something new after the watermark is unread again — clearing the feed is not muting it
    bus.publish(hazard_id=seeded, neighbour_id=neighbour_named("Rosa Delgado").id, type="check.decided",
                payload={"neighbour_id": neighbour_named("Rosa Delgado").id, "name": "Rosa Delgado",
                         "outcome": "URGENT", "reason": "she said the cooler quit"})
    unread = feed_mod.feed(seeded, limit=200, unread_only=True)
    assert len(unread) == 1 and "Rosa Delgado" in unread[0]["headline"]


async def test_read_state_is_a_receipt_on_the_event_log_not_a_private_table(seeded) -> None:  # noqa: ANN001
    """So a captain who clears the feed on her laptop sees it cleared on the tablet, and the audit
    trail records that a named person looked."""
    await _swept_and_synced(seeded)
    feed_mod.mark_read(feed_mod.MarkReadIn(hazard_id=seeded, all=True, read_by="Alma Reyes"))
    with session_scope() as s:
        receipts = [dict(r.payload or {}) for r in s.exec(select(AgentEvent).where(
            AgentEvent.hazard_id == seeded, AgentEvent.type == feed_mod.READ_EVENT)).all()]
    assert len(receipts) == 1
    assert receipts[0]["all"] is True and receipts[0]["read_by"] == "Alma Reyes"


# ------------------------------------------------------------------------------------------------
# The live path
# ------------------------------------------------------------------------------------------------
async def test_a_notification_reaches_an_open_console_without_a_poll(seeded) -> None:  # noqa: ANN001
    """The tap publishes derived pings onto the stream the console is already holding open, so one
    appears on screen without anybody asking for it."""
    rosa = neighbour_named("Rosa Delgado")
    event = bus.publish(hazard_id=seeded, neighbour_id=rosa.id, type="check.decided",
                        payload={"neighbour_id": rosa.id, "name": "Rosa Delgado",
                                 "outcome": "UNREACHABLE", "reason": "nobody picked up",
                                 "call_id": "call_x"})

    published = feed_mod.publish_for_event(event)

    assert len(published) == 1
    pushed = events_of(seeded, type=feed_mod.PUSH_EVENT)
    assert len(pushed) == 1
    # and the pushed object is the same one the HTTP feed derives, so a client can dedupe on id
    from_feed = next(n for n in feed_mod.feed(seeded, limit=50) if n["kind"] == "call.finished")
    assert pushed[0]["payload"]["id"] == from_feed["id"] == published[0]["id"]
    assert pushed[0]["payload"]["route"] == from_feed["route"]


async def test_the_tap_does_not_notify_about_its_own_notifications(seeded) -> None:  # noqa: ANN001
    """The tap publishes onto the same bus it is installed on. Without the type guard that is
    unbounded recursion that fills the event table."""
    rosa = neighbour_named("Rosa Delgado")
    event = bus.publish(hazard_id=seeded, neighbour_id=rosa.id, type="check.decided",
                        payload={"neighbour_id": rosa.id, "name": "Rosa Delgado", "outcome": "URGENT"})
    pushed = feed_mod.publish_for_event(event)
    echoed = events_of(seeded, type=feed_mod.PUSH_EVENT)

    assert len(pushed) == 1 and len(echoed) == 1
    assert feed_mod.publish_for_event(echoed[0]) == []
    assert feed_mod.publish_for_event(
        {"id": 1, "hazard_id": seeded, "type": feed_mod.READ_EVENT, "payload": {"all": True}}) == []


# ------------------------------------------------------------------------------------------------
# Shape
# ------------------------------------------------------------------------------------------------
async def test_every_notification_carries_what_the_console_needs(seeded) -> None:  # noqa: ANN001
    await _swept_and_synced(seeded)
    for note in feed_mod.feed(seeded, limit=200):
        assert set(note) >= {"id", "severity", "priority", "headline", "at", "read", "route",
                             "hazard_id", "kind"}
        assert note["severity"] in {"critical", "warning", "info"}
        assert 1 <= note["priority"] <= 5
        assert note["route"].startswith(f"/hazards/{seeded}")
        assert note["at"], "a ping with no time on it cannot be ordered or aged"
        assert note["read"] is False


async def test_the_tap_writes_the_ping_immediately_after_the_event_it_came_from(seeded) -> None:  # noqa: ANN001
    """Installed on the bus rather than run as a background relay, so the event log is quiescent the
    moment the thing that caused it is finished. A second producer writing into the shared log at a
    time nobody controls would make `since_event_id` replay depend on scheduling."""
    from app.events.bus import bus as live_bus

    untap = feed_mod.install()
    try:
        rosa = neighbour_named("Rosa Delgado")
        source = live_bus.publish(hazard_id=seeded, neighbour_id=rosa.id, type="check.decided",
                                  payload={"neighbour_id": rosa.id, "name": "Rosa Delgado",
                                           "outcome": "URGENT", "reason": "the cooler quit"})
    finally:
        untap()

    log = [e for e in events_of(seeded) if e["id"] >= source["id"]]
    assert [e["type"] for e in log] == ["check.decided", feed_mod.PUSH_EVENT]
    assert log[1]["payload"]["headline"] == "Rosa Delgado needs help right now"
    # installing twice does not double every ping
    untap2 = feed_mod.install()
    feed_mod.install()
    try:
        live_bus.publish(hazard_id=seeded, neighbour_id=rosa.id, type="check.decided",
                         payload={"neighbour_id": rosa.id, "name": "Rosa Delgado", "outcome": "URGENT"})
    finally:
        untap2()
    assert len(events_of(seeded, type=feed_mod.PUSH_EVENT)) == 2


async def test_a_settled_incident_still_has_its_history_in_the_feed(seeded) -> None:  # noqa: ANN001
    """The feed is a record of what happened, not a work queue: closing a case does not rewrite the
    ping that raised it."""
    sweep_id = await _swept_and_synced(seeded)
    with session_scope() as s:
        incident = s.exec(select(Incident).where(Incident.sweep_id == sweep_id)).first()
        incident_layer.resolve(s, incident, resolved_by="Alma Reyes")
        incident_id = incident.id
        assert s.get(Incident, incident_id).status == IncidentStatus.RESOLVED

    assert any(n["incident_id"] == incident_id
               for n in _by_kind(feed_mod.feed(seeded, limit=200), "deployment.opened"))
