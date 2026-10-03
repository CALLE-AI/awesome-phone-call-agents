"""The commit path: the only place in BuddyE where a `Dispatch` changes state.

Everything else in the operator layer answers questions. `app.domain.fleet` says who *could* go,
`app.agents.dispatch_agent` says who *should* and why, `app.sim.movement` says where they are. This
module is where an answer becomes a commitment, and it is deliberately the narrowest surface in the
system: no other module assigns `Dispatch.status`, `Asset.status`, `authorised_by` or
`decline_reason`, and every one of those assignments goes through an `assert_*_transition` helper
rather than being written directly.

The four properties this file exists to hold:

**Community resources auto-dispatch; agency resources need a human.** `commit()` refuses outright to
commit an asset whose kind requires authorisation. The only path for an EMS, fire or police unit is
`authorise()`, which takes a person's name, refuses a blank one and refuses "system" and its
friends by reusing the escalation ladder's own validator. A false ambulance call takes a unit from
somebody else's emergency, so that decision belongs to a person and the record says which person.

**The flag is stamped once.** `Dispatch.requires_authorisation` is written at proposal time from
`domain.state.requires_authorisation(kind)` and read from the column thereafter. If a later edit to
the policy made an ambulance auto-dispatchable, it would not retroactively bless a request a human
never approved — nor un-bless one they did.

**The model proposes, deterministic code disposes.** `propose()` filters with fleet, asks the agent
to rank among the legal candidates only, and then re-validates the answer against freshly read rows
before writing anything. A model that is slow, rate-limited or nonsensical degrades to fleet's own
top pick; it can never produce a dispatch fleet would have refused.

**A decline is part of the record.** Saying no to an ambulance is a decision with the same weight as
saying yes, so `decline()` requires a name and a reason, cancels the dispatch, and marks the
agent's `OperatorAction` row as not accepted.

One structural note, and it is the reason `propose()` looks the way it does: **no database session
is held across the model call.** The free tier runs 20-100 s, sqlite is in WAL mode with a
five-second busy timeout, and an open transaction spanning that await would stall every other writer
in the process. So `propose()` reads the world into plain dicts, closes the session, awaits the
agent, then reopens and re-validates against live rows. The re-validation is not belt and braces: it
is the nurse who was committed to another incident during the twenty seconds the model spent
thinking.
"""
from __future__ import annotations

import logging
from typing import Any

from sqlmodel import Session, select

from app import obs
from app.agents import build_client, propose_dispatch, record_action
from app.agents.client import AgentClient
from app.db import session_scope
from app.domain import fleet, geo
from app.domain.state import (
    AssetStatus,
    DispatchStatus,
    IllegalTransition,
    IncidentStatus,
    assert_asset_transition,
    assert_dispatch_transition,
    requires_authorisation,
)
from app.events.bus import bus
from app.models import Asset, Dispatch, Escalation, HandoffPacket, Incident, OperatorAction, utcnow
from app.orchestrator import escalate as ladder
from app.orchestrator import incidents as incident_layer

log = logging.getLogger("buddye.dispatch")

#: The columns of an Asset that fleet reads. Copied into a plain dict so that everything downstream
#: of the model call is data rather than a row whose session has since closed.
_ASSET_FIELDS = (
    "id", "call_sign", "kind", "status", "operator_name", "capabilities", "capacity",
    "served_this_shift", "speed_mph", "base_lat", "base_lon", "lat", "lon", "heading_deg",
    "current_dispatch_id", "notes",
)

_INCIDENT_FIELDS = (
    "id", "hazard_id", "sweep_id", "neighbour_id", "escalation_id", "source_call_id", "status",
    "priority", "outcome", "summary", "needs", "lat", "lon", "address",
)


class DispatchRefused(RuntimeError):
    """A commitment the record does not permit: an unnamed authorisation, an agency unit committed
    without one, an asset that stopped being legal, an illegal transition."""


# ------------------------------------------------------------------------------------------------
# Views. Plain data, safe to hold across an await.
# ------------------------------------------------------------------------------------------------
def _view(row: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in fields:
        value = getattr(row, name, None)
        out[name] = list(value) if isinstance(value, list) else (str(value) if hasattr(value, "value") else value)
    return out


def dispatch_out(dispatch: Dispatch, asset: Asset | None = None, incident: Incident | None = None) -> dict[str, Any]:
    """One dispatch as the API and the event bus render it."""
    return {
        "id": dispatch.id,
        "incident_id": dispatch.incident_id,
        "asset_id": dispatch.asset_id,
        "call_sign": asset.call_sign if asset else "",
        "kind": str(asset.kind) if asset else "",
        "operator_name": asset.operator_name if asset else "",
        "status": str(dispatch.status),
        "reason": dispatch.reason,
        "proposed_by": dispatch.proposed_by,
        "committed_by": dispatch.committed_by,
        "requires_authorisation": bool(dispatch.requires_authorisation),
        "authorised_by": dispatch.authorised_by,
        "authorised_at": (dispatch.authorised_at.isoformat() + "Z") if dispatch.authorised_at else None,
        "decline_reason": dispatch.decline_reason,
        "distance_miles": round(float(dispatch.distance_miles or 0.0), 2),
        "eta_minutes": round(float(dispatch.eta_minutes or 0.0), 1),
        "route": [list(p) for p in (dispatch.route or [])],
        "progress": round(float(dispatch.progress or 0.0), 4),
        "proposed_at": dispatch.proposed_at.isoformat() + "Z",
        "committed_at": (dispatch.committed_at.isoformat() + "Z") if dispatch.committed_at else None,
        "arrived_at": (dispatch.arrived_at.isoformat() + "Z") if dispatch.arrived_at else None,
        "completed_at": (dispatch.completed_at.isoformat() + "Z") if dispatch.completed_at else None,
        "address": incident.address if incident else "",
        "incident_lat": incident.lat if incident else None,
        "incident_lon": incident.lon if incident else None,
        "asset_lat": asset.lat if asset else None,
        "asset_lon": asset.lon if asset else None,
        # Said in the payload rather than left to be inferred from a null, exactly as the handoff
        # packet does: a PROPOSED agency unit has not been asked for and nobody is on their way.
        "status_note": _status_note(dispatch),
    }


def _status_note(dispatch: Dispatch) -> str:
    status = DispatchStatus(dispatch.status)
    if status is DispatchStatus.PROPOSED and dispatch.requires_authorisation:
        return "prepared only — an agency unit stays proposed until a named human approves it, and nobody has been asked"
    if status is DispatchStatus.PROPOSED:
        return "proposed — nothing has been committed yet"
    if status is DispatchStatus.CANCELLED and dispatch.decline_reason:
        return dispatch.decline_reason
    return ""


def _publish(hazard_id: str, type: str, payload: dict[str, Any], *, neighbour_id: str | None = None) -> None:
    bus.publish(hazard_id=hazard_id, neighbour_id=neighbour_id, type=type, payload=obs.redact(payload))


# ------------------------------------------------------------------------------------------------
# Proposing
# ------------------------------------------------------------------------------------------------
def eligibility_for(session: Session, incident: Incident) -> fleet.Eligibility:
    """Who could legally take this incident, and a sentence for everyone who could not.

    Shared by `propose()` and by the API's "why not WV-2?" endpoint, so the coordinator's screen and
    the dispatch decision can never be looking at two different candidate lists.
    """
    assets = list(session.exec(select(Asset)).all())
    needs = _needs(session, incident)
    return fleet.eligible(assets, incident, needs)


def _needs(session: Session, incident: Incident) -> fleet.NeedSet:
    """The incident's needs, re-derived from the escalation behind it when there is one.

    Deriving beats reading the column back: `fleet.needs_for` carries the priority, the band and
    whether an agency unit may be considered at all, and none of those live on the Incident row.
    """
    esc = session.get(Escalation, incident.escalation_id) if incident.escalation_id else None
    if esc is not None:
        needs, _ = incident_layer.needs_for_escalation(session, esc)
        return needs
    return fleet.needs_for(incident)


async def propose(
    incident_id: str,
    *,
    client: AgentClient | None = None,
    proposed_by: str = "agent",
    settings: Any = None,
) -> dict[str, Any] | None:
    """Prepare one dispatch for one incident and write it as PROPOSED. Returns the row, or None.

    None means the fleet had nothing legal to send — not that nothing was tried. The reason is in
    the `OperatorAction` row the agent layer writes on every path, including that one.
    """
    # ---- phase 1: read the world, then let go of it -------------------------------------------
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        if incident is None:
            raise DispatchRefused(f"no incident {incident_id!r}")
        if IncidentStatus(incident.status) in incident_layer.SETTLED:
            raise DispatchRefused(
                f"incident {incident_id} is {incident.status}; nothing more is dispatched to a closed incident")
        hazard = incident_layer.hazard_of(s, incident)
        hazard_view = {
            "kind": hazard.kind, "headline": hazard.headline, "area": hazard.area,
            "severity": hazard.severity, "facts": dict(hazard.facts or {}),
        } if hazard is not None else {}
        needs = _needs(s, incident)
        situation = incident_layer.situation_for(s, incident)
        risk_reasons = incident_layer.risk_reasons_for(s, incident)
        findings = incident_layer.findings_for(s, incident)
        incident_view = _view(incident, _INCIDENT_FIELDS)
        asset_views = [_view(a, _ASSET_FIELDS) for a in s.exec(select(Asset)).all()]
        hazard_id = incident.hazard_id
        neighbour_id = incident.neighbour_id

    report = fleet.eligible(asset_views, incident_view, needs)
    if client is None:
        client = build_client(settings)

    by_id = {v["id"]: v for v in asset_views}

    def _validate(candidate: Any) -> fleet.ValidationResult:
        """Fleet's gate, given the asset as it was read — the agent hands back a candidate, not a row."""
        asset_id = candidate.get("asset_id") if isinstance(candidate, dict) else getattr(candidate, "asset_id", "")
        return fleet.validate_choice(by_id.get(str(asset_id), {}), incident_view, needs)

    # ---- phase 2: the model, with no session open ----------------------------------------------
    proposal = await propose_dispatch(
        hazard_id=hazard_id,
        hazard=hazard_view,
        incident={**incident_view, "needs": list(needs), "priority_label": fleet.priority_label(needs.priority),
                  "agency_justified": needs.agency_justified, "agency_reason": needs.agency_reason},
        incident_id=incident_id,
        situation=situation,
        risk_reasons=risk_reasons,
        findings=findings,
        needs=list(needs),
        candidates=[c.to_dict() for c in fleet.rank(report.candidates, priority=needs.priority)],
        client=client,
        validate=_validate,
    )
    if proposal is None:
        _publish(hazard_id, "dispatch.none_available", {
            "incident_id": incident_id, "needs": list(needs), "error": report.error,
            "excluded": [e.to_dict() for e in report.excluded],
            "note": "no asset is available, in range, capable and free; nobody has been sent",
        }, neighbour_id=neighbour_id)
        return None

    # ---- phase 3: re-validate against live rows and write -------------------------------------
    with session_scope() as s:
        incident = s.get(Incident, incident_id)
        if incident is None:
            raise DispatchRefused(f"incident {incident_id} disappeared while a dispatch was being prepared")
        needs = _needs(s, incident)
        assets = list(s.exec(select(Asset)).all())
        chosen = next((a for a in assets if a.id == proposal.asset_id), None)
        check = fleet.validate_choice(chosen, incident, needs) if chosen is not None else None
        override = ""
        reason_text = proposal.reason
        if chosen is None or not check:
            # The chosen unit stopped being legal while the model was thinking. Fall back to whatever
            # is legal *now* rather than committing the stale pick — this is the whole reason the
            # gate runs a second time.
            override = (check.reason if check is not None else f"asset {proposal.asset_id} is gone")
            best, report = fleet.deterministic_choice(assets, incident, needs)
            if best is None:
                record_action(
                    hazard_id=incident.hazard_id, incident_id=incident_id, kind="dispatch_proposal",
                    agent="dispatch", inputs={"proposed_asset_id": proposal.asset_id},
                    output={}, rationale="", error=f"{override}; and nothing else is eligible now",
                    session=s,
                )
                return None
            chosen = next(a for a in assets if a.id == best.asset_id)
            check = fleet.validate_choice(chosen, incident, needs)
            reason_text = f"{best.reason} (re-picked at commit time: {override})"
            record_action(
                hazard_id=incident.hazard_id, incident_id=incident_id, kind="dispatch_proposal",
                agent="dispatch",
                inputs={"proposed_asset_id": proposal.asset_id, "proposed_call_sign": proposal.call_sign},
                output={"asset_id": chosen.id, "call_sign": chosen.call_sign},
                rationale=f"the proposed unit was no longer eligible ({override}); "
                          f"{chosen.call_sign} is the deterministic pick from the fleet as it stands now",
                session=s,
            )

        dispatch = Dispatch(
            incident_id=incident.id,
            asset_id=chosen.id,
            status=DispatchStatus.PROPOSED,
            reason=reason_text,
            proposed_by=proposed_by,
            # Stamped once, here, from the single source of truth. Read from this column for the
            # rest of the row's life — see the module docstring.
            requires_authorisation=requires_authorisation(chosen.kind),
            distance_miles=float(check.distance_miles or 0.0),
            eta_minutes=float(check.eta_minutes or 0.0),
        )
        s.add(dispatch)
        # A proposal is the moment somebody (or something) has decided what this address needs.
        # That is what TRIAGED means, and there is no OPEN -> DISPATCHED edge to skip it with.
        incident_layer.mark_triaged(s, incident)
        s.flush()
        out = dispatch_out(dispatch, chosen, incident)
        out["justification"] = proposal.justification
        out["source"] = "deterministic" if override else proposal.source
        out["fallback_reason"] = override or proposal.fallback_reason
        out["model"] = proposal.model
        out["latency_ms"] = proposal.latency_ms
        out["action_id"] = proposal.action_id
        hazard_id, neighbour_id = incident.hazard_id, incident.neighbour_id

    _publish(hazard_id, "dispatch.proposed", out, neighbour_id=neighbour_id)
    if out["requires_authorisation"]:
        _publish(hazard_id, "dispatch.awaiting_authorisation", {
            **out, "note": "an agency unit has been prepared and NOT requested; a named human "
                           "approves it with one click, or declines it",
        }, neighbour_id=neighbour_id)
    return out


# ------------------------------------------------------------------------------------------------
# Committing
# ------------------------------------------------------------------------------------------------
def _load(session: Session, dispatch_id: str) -> tuple[Dispatch, Asset, Incident]:
    dispatch = session.get(Dispatch, dispatch_id)
    if dispatch is None:
        raise DispatchRefused(f"no dispatch {dispatch_id!r}")
    asset = session.get(Asset, dispatch.asset_id)
    incident = session.get(Incident, dispatch.incident_id)
    if asset is None or incident is None:
        raise DispatchRefused(f"dispatch {dispatch_id} has lost its asset or its incident")
    return dispatch, asset, incident


def _mark_reviewed(session: Session, incident_id: str, asset_id: str, *, accepted: bool, by: str) -> None:
    """Record on the agent's own provenance row that a human looked at it and what they said.

    `record_action` deliberately cannot write these two columns — an agent that could mark its own
    work accepted would make the human-approval property unverifiable afterwards. This is the human
    side of the same record.
    """
    rows = list(
        session.exec(
            select(OperatorAction).where(
                OperatorAction.incident_id == incident_id,
                OperatorAction.kind == "dispatch_proposal",
            ).order_by(OperatorAction.created_at)
        ).all()
    )
    match = next((r for r in reversed(rows) if str((r.output or {}).get("asset_id") or "") == asset_id), None)
    if match is None:
        return
    match.accepted = accepted
    match.accepted_by = by
    session.add(match)


def _take_asset(session: Session, dispatch: Dispatch, asset: Asset, incident: Incident) -> None:
    """The shared body of commit and authorise: the asset is now this incident's."""
    if IncidentStatus(incident.status) in incident_layer.SETTLED:
        # `propose()` refuses a closed incident; so must the click that arrives ten seconds after a
        # coordinator closed one. `mark_dispatched` no-ops silently on a settled row, so without
        # this a stale proposal would take a van and burn a stop for an address nobody is going to.
        raise DispatchRefused(
            f"incident {incident.id} is {incident.status}; nothing is sent to a closed incident")
    check = fleet.validate_choice(asset, incident, _needs(session, incident))
    if not check:
        # Fleet's gate runs again here on purpose. Between a proposal and a click, the van may have
        # been committed to somebody else — committing anyway would double-book it.
        raise DispatchRefused(f"{asset.call_sign} can no longer take this incident: {check.reason}")

    assert_dispatch_transition(DispatchStatus(dispatch.status), DispatchStatus.COMMITTED)
    dispatch.status = DispatchStatus.COMMITTED
    dispatch.committed_at = utcnow()
    dispatch.distance_miles = float(check.distance_miles or dispatch.distance_miles or 0.0)
    dispatch.eta_minutes = float(check.eta_minutes or dispatch.eta_minutes or 0.0)

    assert_asset_transition(AssetStatus(asset.status), AssetStatus.ASSIGNED)
    asset.status = AssetStatus.ASSIGNED
    asset.current_dispatch_id = dispatch.id
    # Counted at commit, not at arrival: a van with one stop left that has been given one is full,
    # and fleet must not offer it again while it is driving there.
    asset.served_this_shift = int(asset.served_this_shift or 0) + 1

    incident_layer.mark_dispatched(session, incident)
    session.add(dispatch)
    session.add(asset)


def commit(session: Session, dispatch: Dispatch, *, committed_by: str = "agent") -> Dispatch:
    """Commit a community asset. Refuses anything that needs a human, by kind and by column.

    This is the auto-dispatch path: sending a neighbour with a case of water to a hot house is a
    recoverable mistake and waiting for a click costs more than it saves. An ambulance is not, so
    this function will not commit one at any price — `authorise()` is the only door.
    """
    asset = session.get(Asset, dispatch.asset_id)
    incident = session.get(Incident, dispatch.incident_id)
    if asset is None or incident is None:
        raise DispatchRefused(f"dispatch {dispatch.id} has lost its asset or its incident")
    if dispatch.requires_authorisation or requires_authorisation(asset.kind):
        # Both are checked. The column is what a human approved against; the function is the policy
        # as it stands. Either one saying "a person must decide" is enough to stop here.
        raise DispatchRefused(
            f"{asset.call_sign} is an agency unit: it stays PROPOSED until a named human authorises it. "
            f"Software does not commit an ambulance, a fire crew or a police welfare check.")
    try:
        _take_asset(session, dispatch, asset, incident)
    except IllegalTransition as exc:
        raise DispatchRefused(str(exc)) from exc
    dispatch.committed_by = committed_by
    session.add(dispatch)
    return dispatch


def authorise(session: Session, dispatch: Dispatch, *, name: str, note: str = "") -> Dispatch:
    """A named human approves a prepared dispatch with one click. The only path for an agency unit.

    The name is validated by the escalation ladder's own `_validate_releaser`, deliberately rather
    than by a second, weaker check written here: "system" must fail to authorise an ambulance for
    exactly the reason it fails to release a handoff packet, and two validators would eventually
    disagree about which names are people.

    Any handoff packet already prepared for the same neighbour is released by the same click — a
    coordinator approving an ambulance should not then have to approve the page that goes with it.
    A packet that is not in a releasable state is recorded as such and is not an error: most
    incidents never reached the responder rung and have no packet at all.
    """
    try:
        who = ladder._validate_releaser(name)  # noqa: SLF001 — one validator, deliberately shared
    except ladder.ReleaseRefused as exc:
        raise DispatchRefused(str(exc)) from exc

    asset = session.get(Asset, dispatch.asset_id)
    incident = session.get(Incident, dispatch.incident_id)
    if asset is None or incident is None:
        raise DispatchRefused(f"dispatch {dispatch.id} has lost its asset or its incident")
    try:
        _take_asset(session, dispatch, asset, incident)
    except IllegalTransition as exc:
        raise DispatchRefused(str(exc)) from exc

    dispatch.authorised_by = who
    dispatch.authorised_at = utcnow()
    dispatch.committed_by = who
    session.add(dispatch)
    _mark_reviewed(session, incident.id, asset.id, accepted=True, by=who)
    released = _release_linked_packet(session, incident, who=who, note=note)
    if released:
        log.info("dispatch %s authorised by %s; handoff packet %s released", dispatch.id, who, released)
    return dispatch


def _release_linked_packet(session: Session, incident: Incident, *, who: str, note: str) -> str:
    """Release the handoff packet behind this incident's escalation, if there is a releasable one.

    Returns the packet id, or "". Refusals are swallowed on purpose: `escalate.release` requires the
    escalation to be at AWAITING_AUTHORISATION, and most incidents never climbed that far. Turning
    that into a 500 would mean an ambulance could not be approved for anybody who did not also have
    a packet, which is the wrong failure by a wide margin.
    """
    if not incident.escalation_id:
        return ""
    esc = session.get(Escalation, incident.escalation_id)
    if esc is None:
        return ""
    packet = session.exec(
        select(HandoffPacket).where(HandoffPacket.escalation_id == esc.id)
    ).first()
    if packet is None or packet.released_at is not None:
        return ""
    try:
        ladder.release(session, packet, escalation=esc, released_by=who,
                       note=note or f"released alongside the dispatch authorised by {who}")
    except (ladder.ReleaseRefused, IllegalTransition) as exc:
        log.info("handoff packet %s not released with this authorisation: %s", packet.id, exc)
        return ""
    return packet.id


def decline(session: Session, dispatch: Dispatch, *, name: str, reason: str) -> Dispatch:
    """A named human says no. Recorded, because a decline is a decision with a decision's weight.

    A coordinator who declines an ambulance and is later asked why needs the answer on the row, not
    in somebody's memory. Both the name and the reason are required for that to be true.
    """
    try:
        who = ladder._validate_releaser(name)  # noqa: SLF001 — the same validator as everywhere else
    except ladder.ReleaseRefused as exc:
        raise DispatchRefused(str(exc)) from exc
    why = " ".join(str(reason or "").split())
    if not why:
        raise DispatchRefused("declining a dispatch requires a reason; it becomes part of the incident record")
    # Only a *request* can be declined. `DISPATCH_TRANSITIONS` allows CANCELLED from COMMITTED,
    # EN_ROUTE and ARRIVED too, and cancelling one of those here would leave the asset ASSIGNED or
    # EN_ROUTE with `current_dispatch_id` pointing at a dead row: fleet would exclude it as
    # committed, the simulator would not move it (it only walks EN_ROUTE dispatches), and the van
    # would freeze on the map for the rest of the evening. Recalling a unit that is already rolling
    # is a different act with a different state path, and it is not this one.
    if DispatchStatus(dispatch.status) is not DispatchStatus.PROPOSED:
        raise DispatchRefused(
            f"dispatch {dispatch.id} is {dispatch.status}; a unit that is already committed is "
            f"recalled, not declined")
    try:
        assert_dispatch_transition(DispatchStatus(dispatch.status), DispatchStatus.CANCELLED)
    except IllegalTransition as exc:
        raise DispatchRefused(str(exc)) from exc
    dispatch.status = DispatchStatus.CANCELLED
    dispatch.decline_reason = f"declined by {who}: {why}"
    session.add(dispatch)
    _mark_reviewed(session, dispatch.incident_id, dispatch.asset_id, accepted=False, by=who)
    return dispatch


# ------------------------------------------------------------------------------------------------
# Moving
# ------------------------------------------------------------------------------------------------
def start(session: Session, dispatch: Dispatch) -> Dispatch:
    """COMMITTED -> EN_ROUTE: compute the route and the real ETA, and hand the asset to the simulator.

    The route is the one the map draws and the one `app.sim.movement` walks, and the ETA is measured
    along that same polyline rather than as the crow flies — what you watch and what you were
    promised cannot drift apart. From here the position is advanced on a wall clock by the movement
    simulator and nothing else; if the backend stops, the vehicle stops where it was.
    """
    asset = session.get(Asset, dispatch.asset_id)
    incident = session.get(Incident, dispatch.incident_id)
    if asset is None or incident is None:
        raise DispatchRefused(f"dispatch {dispatch.id} has lost its asset or its incident")
    if not (incident.lat or incident.lon):
        raise DispatchRefused(
            f"incident {incident.id} has no coordinates; there is nowhere to send {asset.call_sign}")
    try:
        assert_dispatch_transition(DispatchStatus(dispatch.status), DispatchStatus.EN_ROUTE)
        assert_asset_transition(AssetStatus(asset.status), AssetStatus.EN_ROUTE)
    except IllegalTransition as exc:
        raise DispatchRefused(str(exc)) from exc

    route = geo.route_between(asset.lat, asset.lon, incident.lat, incident.lon)
    miles = geo.path_length_miles(route)
    dispatch.route = route
    dispatch.distance_miles = miles
    dispatch.eta_minutes = geo.eta_minutes(miles, asset.speed_mph)
    dispatch.progress = 0.0
    dispatch.status = DispatchStatus.EN_ROUTE
    asset.status = AssetStatus.EN_ROUTE
    asset.heading_deg = geo.bearing_degrees(asset.lat, asset.lon, incident.lat, incident.lon)
    # The simulator measures elapsed time from here. Without it the first tick would credit the van
    # with every second since it was committed and teleport it most of the way there.
    asset.last_moved_at = utcnow()
    session.add(dispatch)
    session.add(asset)
    return dispatch


def complete(session: Session, dispatch: Dispatch, *, note: str = "") -> Dispatch:
    """ARRIVED -> COMPLETED. The asset is released from this incident and stays where it finished.

    BuddyE does not simulate a return leg, and pretending to would be the one dishonest number on
    the map: a volunteer who has just dropped water off takes the next job from the doorstep they
    are standing on, not from a depot they never drove back to.
    """
    asset = session.get(Asset, dispatch.asset_id)
    if asset is None:
        raise DispatchRefused(f"dispatch {dispatch.id} has lost its asset")
    try:
        assert_dispatch_transition(DispatchStatus(dispatch.status), DispatchStatus.COMPLETED)
    except IllegalTransition as exc:
        raise DispatchRefused(str(exc)) from exc
    dispatch.status = DispatchStatus.COMPLETED
    dispatch.completed_at = utcnow()
    if note:
        dispatch.reason = f"{dispatch.reason} | {note}" if dispatch.reason else note
    status = AssetStatus(asset.status)
    if status is AssetStatus.ON_SCENE:
        assert_asset_transition(status, AssetStatus.RETURNING)
        asset.status = AssetStatus.RETURNING
    if AssetStatus(asset.status) is AssetStatus.RETURNING:
        assert_asset_transition(AssetStatus.RETURNING, AssetStatus.AVAILABLE)
        asset.status = AssetStatus.AVAILABLE
    else:
        # The simulator sets ARRIVED and ON_SCENE together, so this means something moved the asset
        # out from under its dispatch. Freeing the dispatch link while leaving the status alone is
        # the safe half; saying so loudly is the other half, because a unit in a status the fleet
        # will not offer is a unit that has quietly left the shift.
        log.warning("dispatch %s completed while %s was %s, not on scene; leaving its status alone",
                    dispatch.id, asset.call_sign, asset.status)
    asset.current_dispatch_id = None
    session.add(dispatch)
    session.add(asset)
    return dispatch


# ------------------------------------------------------------------------------------------------
# The whole pipeline
# ------------------------------------------------------------------------------------------------
async def auto_dispatch(incident_id: str, *, client: AgentClient | None = None) -> dict[str, Any] | None:
    """Propose, and send it if — and only if — it is a community resource.

    This is the line the product is built on. A wellness van, a water truck, a ride: committed and
    rolling without anybody clicking, because the cost of being wrong is a wasted trip. An
    ambulance, an engine, a patrol car: fully prepared, visible on the board, and stopped dead at
    PROPOSED until a person puts their name to it.
    """
    proposal = await propose(incident_id, client=client)
    if proposal is None:
        return None
    if proposal["requires_authorisation"]:
        return proposal

    with session_scope() as s:
        dispatch, asset, incident = _load(s, proposal["id"])
        commit(s, dispatch, committed_by="agent")
        start(s, dispatch)
        s.flush()
        out = dispatch_out(dispatch, asset, incident)
        # Carry the provenance forward: a coordinator reading "WV-2 is on its way" is entitled to
        # know whether that was a judgment or a default, and which model made it if either.
        out.update({k: proposal[k] for k in
                    ("source", "fallback_reason", "model", "latency_ms", "action_id", "justification")
                    if k in proposal})
        hazard_id, neighbour_id = incident.hazard_id, incident.neighbour_id
    _publish(hazard_id, "dispatch.committed", out, neighbour_id=neighbour_id)
    _publish(hazard_id, "dispatch.en_route", out, neighbour_id=neighbour_id)
    return out
