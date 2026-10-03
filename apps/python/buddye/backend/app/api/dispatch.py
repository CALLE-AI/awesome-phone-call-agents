"""Dispatching: propose, commit, authorise, decline, and the queue of things waiting on a human.

`GET /api/dispatch/pending` is the endpoint this whole layer is built around. It is the list of
ambulances, engines and patrol units that an agent has fully prepared — routed, timed, justified —
and *not* requested. Everything on it is one click from being real and zero clicks from being
nothing, and the click needs a person's name on it.

The two verbs that matter are deliberately different endpoints rather than one with a flag:

* `POST /api/dispatch/{id}/commit` sends a community resource. It refuses an agency unit outright,
  with a 409 and a sentence, rather than quietly doing nothing.
* `POST /api/dispatch/{id}/authorise` takes `{"name": ..., "note": ...}` and is the only path an
  agency unit can take. A blank name is a 400, and so is "system": the name is the record that a
  human decided, and a service account in that field would mean nobody did.

`decline` is a first-class verb for the same reason. A coordinator who says no to an ambulance and
is asked about it a week later needs the reason on the row.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlmodel import select

from app import obs
from app.api.deps import settings_dep
from app.config import Settings
from app.db import session_scope
from app.domain.state import DispatchStatus
from app.models import Asset, Dispatch, Incident
from app.orchestrator import dispatch as dispatcher

router = APIRouter(prefix="/api/dispatch", tags=["dispatch"])


class ProposeIn(BaseModel):
    incident_id: str
    #: Commit it too when it is a community resource. False prepares it and stops, which is what a
    #: coordinator wants when they are deciding rather than reacting.
    auto: bool = True


class AuthoriseIn(BaseModel):
    """One click, one name. `name` is validated by the escalation ladder's own rule."""

    name: str
    note: str = ""


class DeclineIn(BaseModel):
    """Saying no is a decision and is recorded like one: who, and why."""

    name: str
    reason: str


def _out(session, dispatch: Dispatch) -> dict[str, Any]:  # noqa: ANN001
    asset = session.get(Asset, dispatch.asset_id)
    incident = session.get(Incident, dispatch.incident_id)
    return dispatcher.dispatch_out(dispatch, asset, incident)


def _publish(session, dispatch: Dispatch, type: str, extra: dict[str, Any] | None = None) -> tuple[str, dict]:  # noqa: ANN001
    incident = session.get(Incident, dispatch.incident_id)
    payload = {**_out(session, dispatch), **(extra or {})}
    return (incident.hazard_id if incident else ""), payload


# ------------------------------------------------------------------------------------------------
# Reading
# ------------------------------------------------------------------------------------------------
@router.get("")
def list_dispatches(
    incident_id: str | None = Query(default=None),
    hazard_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(Dispatch)
        if incident_id:
            q = q.where(Dispatch.incident_id == incident_id)
        rows = list(s.exec(q.order_by(Dispatch.proposed_at)).all())
        if hazard_id:
            ids = {i.id for i in s.exec(select(Incident).where(Incident.hazard_id == hazard_id)).all()}
            rows = [d for d in rows if d.incident_id in ids]
        if status:
            rows = [d for d in rows if str(d.status) == status.upper()]
        return [obs.redact(_out(s, d)) for d in rows]


@router.get("/pending")
def pending(hazard_id: str | None = Query(default=None)) -> list[dict[str, Any]]:
    """Everything waiting on a named human. Worst incident first.

    Each row carries the agent's justification — the specific fact that needs a paramedic rather
    than a neighbour with water — because the person clicking has seconds and a form to fill in is
    not a decision aid.
    """
    with session_scope() as s:
        rows = [
            d for d in s.exec(select(Dispatch).where(Dispatch.status == DispatchStatus.PROPOSED)
                              .order_by(Dispatch.proposed_at)).all()
            if d.requires_authorisation
        ]
        incidents = {i.id: i for i in s.exec(select(Incident)).all()}
        if hazard_id:
            rows = [d for d in rows if (i := incidents.get(d.incident_id)) is not None and i.hazard_id == hazard_id]
        rows.sort(key=lambda d: (int(getattr(incidents.get(d.incident_id), "priority", 5) or 5), d.proposed_at))
        out = []
        for d in rows:
            incident = incidents.get(d.incident_id)
            row = _out(s, d)
            row["justification"] = _justification(s, d)
            row["incident_priority"] = incident.priority if incident else None
            row["incident_summary"] = incident.summary if incident else ""
            row["name"] = _neighbour_name(s, incident)
            out.append(obs.redact(row))
        return out


def _justification(session, dispatch: Dispatch) -> str:  # noqa: ANN001
    """The agent's grounds for asking, off its own provenance row rather than re-derived."""
    from app.models import OperatorAction

    rows = list(session.exec(
        select(OperatorAction).where(OperatorAction.incident_id == dispatch.incident_id,
                                     OperatorAction.kind == "dispatch_proposal")
        .order_by(OperatorAction.created_at)).all())
    for row in reversed(rows):
        output = row.output or {}
        if str(output.get("asset_id") or "") == dispatch.asset_id:
            return str(output.get("justification") or row.rationale or "")
    return ""


def _neighbour_name(session, incident: Incident | None) -> str:  # noqa: ANN001
    from app.models import Neighbour

    if incident is None:
        return ""
    nbr = session.get(Neighbour, incident.neighbour_id)
    return nbr.name if nbr else incident.neighbour_id


# ------------------------------------------------------------------------------------------------
# Writing
# ------------------------------------------------------------------------------------------------
@router.post("/propose")
async def propose(body: ProposeIn, settings: Settings = Depends(settings_dep)) -> dict[str, Any]:
    """Prepare a dispatch for one incident, and commit it if it is a community resource.

    Takes as long as the model takes — up to about a minute on the free tier — and degrades to the
    deterministic pick rather than failing. 404 if the incident is gone; 409 if it is already closed.
    """
    try:
        if body.auto:
            out = await dispatcher.auto_dispatch(body.incident_id)
        else:
            out = await dispatcher.propose(body.incident_id)
    except dispatcher.DispatchRefused as exc:
        raise HTTPException(409, str(exc)) from exc
    if out is None:
        raise HTTPException(
            409, "no asset is available, in range, capable and free for this incident; "
                 "GET /api/incidents/{id}/candidates says why for each unit")
    return obs.redact(out)


@router.get("/{dispatch_id}")
def get_dispatch(dispatch_id: str) -> dict[str, Any]:
    with session_scope() as s:
        dispatch = s.get(Dispatch, dispatch_id)
        if dispatch is None:
            raise HTTPException(404, "dispatch not found")
        return obs.redact(_out(s, dispatch))


@router.post("/{dispatch_id}/commit")
def commit(dispatch_id: str, start: bool = Query(default=True)) -> dict[str, Any]:
    """Send a community resource. 409 for anything that needs a human — see `/authorise`."""
    from app.events.bus import bus

    with session_scope() as s:
        dispatch = s.get(Dispatch, dispatch_id)
        if dispatch is None:
            raise HTTPException(404, "dispatch not found")
        try:
            dispatcher.commit(s, dispatch, committed_by="coordinator")
            if start:
                dispatcher.start(s, dispatch)
        except dispatcher.DispatchRefused as exc:
            raise HTTPException(409, str(exc)) from exc
        s.flush()
        hazard_id, payload = _publish(s, dispatch, "dispatch.committed")
    bus.publish(hazard_id=hazard_id, type="dispatch.committed", payload=obs.redact(payload))
    if start:
        bus.publish(hazard_id=hazard_id, type="dispatch.en_route", payload=obs.redact(payload))
    return obs.redact(payload)


@router.post("/{dispatch_id}/authorise")
def authorise(dispatch_id: str, body: AuthoriseIn, start: bool = Query(default=True)) -> dict[str, Any]:
    """A named human approves. The only path an EMS, fire or police unit can take.

    400 when the name is missing or is not a person's name — that is not validation pedantry, it is
    the entire safety property of this endpoint in one field.
    """
    from app.events.bus import bus

    with session_scope() as s:
        dispatch = s.get(Dispatch, dispatch_id)
        if dispatch is None:
            raise HTTPException(404, "dispatch not found")
        was_proposed = str(dispatch.status) == "PROPOSED"
        try:
            dispatcher.authorise(s, dispatch, name=body.name, note=body.note)
            if start:
                dispatcher.start(s, dispatch)
        except dispatcher.DispatchRefused as exc:
            # An unnamed authorisation is the caller's mistake (400); a dispatch that has already
            # moved on is a conflict (409).
            raise HTTPException(400 if was_proposed else 409, str(exc)) from exc
        s.flush()
        hazard_id, payload = _publish(s, dispatch, "dispatch.authorised")
    bus.publish(hazard_id=hazard_id, type="dispatch.authorised", payload=obs.redact(payload))
    if start:
        bus.publish(hazard_id=hazard_id, type="dispatch.en_route", payload=obs.redact(payload))
    return obs.redact(payload)


@router.post("/{dispatch_id}/decline")
def decline(dispatch_id: str, body: DeclineIn) -> dict[str, Any]:
    """A named human says no, and says why. The reason becomes part of the incident record."""
    from app.events.bus import bus

    with session_scope() as s:
        dispatch = s.get(Dispatch, dispatch_id)
        if dispatch is None:
            raise HTTPException(404, "dispatch not found")
        try:
            dispatcher.decline(s, dispatch, name=body.name, reason=body.reason)
        except dispatcher.DispatchRefused as exc:
            raise HTTPException(400, str(exc)) from exc
        s.flush()
        hazard_id, payload = _publish(s, dispatch, "dispatch.declined")
    bus.publish(hazard_id=hazard_id, type="dispatch.declined", payload=obs.redact(payload))
    return obs.redact(payload)


@router.post("/{dispatch_id}/start")
def start_dispatch(dispatch_id: str) -> dict[str, Any]:
    """COMMITTED -> EN_ROUTE. From here the movement simulator owns the position."""
    from app.events.bus import bus

    with session_scope() as s:
        dispatch = s.get(Dispatch, dispatch_id)
        if dispatch is None:
            raise HTTPException(404, "dispatch not found")
        try:
            dispatcher.start(s, dispatch)
        except dispatcher.DispatchRefused as exc:
            raise HTTPException(409, str(exc)) from exc
        s.flush()
        hazard_id, payload = _publish(s, dispatch, "dispatch.en_route")
    bus.publish(hazard_id=hazard_id, type="dispatch.en_route", payload=obs.redact(payload))
    return obs.redact(payload)


@router.post("/{dispatch_id}/complete")
def complete(dispatch_id: str, note: str = Query(default="")) -> dict[str, Any]:
    """ARRIVED -> COMPLETED. The unit is free again, from wherever it finished."""
    from app.events.bus import bus

    with session_scope() as s:
        dispatch = s.get(Dispatch, dispatch_id)
        if dispatch is None:
            raise HTTPException(404, "dispatch not found")
        try:
            dispatcher.complete(s, dispatch, note=note)
        except dispatcher.DispatchRefused as exc:
            raise HTTPException(409, str(exc)) from exc
        s.flush()
        hazard_id, payload = _publish(s, dispatch, "dispatch.completed")
    bus.publish(hazard_id=hazard_id, type="dispatch.completed", payload=obs.redact(payload))
    return obs.redact(payload)
