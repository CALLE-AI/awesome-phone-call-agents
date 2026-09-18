"""The fleet, and where it is right now.

`GET /api/assets/positions` is the endpoint the map layer lives on, and the thing worth knowing
about it is what it is *not*: it is not a seed for a browser animation. Every coordinate it returns
is a column on the `Asset` row that `app.sim.movement` advanced on a wall clock, so two browsers
watching the same van see the same van, a reload does not restart it, and if the backend stops the
vehicles stop where they were. A client that wants smoothness may interpolate between two polls; it
must never invent a position, and it never needs to, because `eta_minutes` and `progress` here are
computed from the route the vehicle is actually on.

Nothing in this module changes anything. Dispatching an asset is `app/api/dispatch.py`, and the
state machine behind it is `app/orchestrator/dispatch.py`.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session, select

from app import obs
from app.db import session_scope
from app.domain import geo
from app.domain.state import AssetStatus, DispatchStatus, requires_authorisation
from app.models import Asset, Dispatch, Incident

router = APIRouter(prefix="/api/assets", tags=["assets"])


def _live(session: Session, asset: Asset) -> dict[str, Any]:
    """The asset plus whatever its current dispatch says about where it is going.

    ETA is recomputed from the remaining length of the route rather than read off the dispatch row,
    because the dispatch's `eta_minutes` is the promise made at departure and this is the answer to
    "when will it be here?" asked now.
    """
    dispatch = session.get(Dispatch, asset.current_dispatch_id) if asset.current_dispatch_id else None
    out: dict[str, Any] = {
        "id": asset.id,
        "call_sign": asset.call_sign,
        "kind": str(asset.kind),
        "status": str(asset.status),
        "operator_name": asset.operator_name,
        "capabilities": list(asset.capabilities or []),
        "capacity": asset.capacity,
        "served_this_shift": asset.served_this_shift,
        "spare_capacity": max(0, int(asset.capacity or 0) - int(asset.served_this_shift or 0)),
        "speed_mph": asset.speed_mph,
        "base_lat": asset.base_lat,
        "base_lon": asset.base_lon,
        "lat": asset.lat,
        "lon": asset.lon,
        "heading_deg": asset.heading_deg,
        "notes": asset.notes,
        # Policy, not a hand-written list: the board marks the units a human must approve using the
        # same function the dispatch layer stamps onto the row.
        "requires_authorisation": _agency(asset.kind),
        "current_dispatch_id": asset.current_dispatch_id,
        "last_moved_at": (asset.last_moved_at.isoformat() + "Z") if asset.last_moved_at else None,
        "destination": None,
    }
    if dispatch is not None and dispatch.route:
        incident = session.get(Incident, dispatch.incident_id)
        remaining = geo.path_length_miles(dispatch.route) * (1.0 - float(dispatch.progress or 0.0))
        out["destination"] = {
            "incident_id": dispatch.incident_id,
            "address": incident.address if incident else "",
            "lat": incident.lat if incident else None,
            "lon": incident.lon if incident else None,
            "progress": round(float(dispatch.progress or 0.0), 4),
            "remaining_miles": round(max(0.0, remaining), 3),
            "eta_minutes": (round(geo.eta_minutes(max(0.0, remaining), asset.speed_mph), 1)
                            if asset.speed_mph > 0 else None),
            "route": [list(p) for p in (dispatch.route or [])],
            "status": str(dispatch.status),
        }
    return out


def _agency(kind: Any) -> bool:
    try:
        return requires_authorisation(kind)
    except ValueError:
        return True  # an unknown kind is never auto-dispatchable; see app.domain.fleet


@router.get("")
def list_assets(
    available_only: bool = Query(default=False),
    kind: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    with session_scope() as s:
        rows = list(s.exec(select(Asset).order_by(Asset.call_sign)).all())
        if kind:
            rows = [a for a in rows if str(a.kind) == kind]
        if available_only:
            rows = [a for a in rows if AssetStatus(a.status) is AssetStatus.AVAILABLE]
        return [obs.redact(_live(s, a)) for a in rows]


@router.get("/positions")
def positions() -> dict[str, Any]:
    """Just enough to draw the map: id, position, heading, and what each unit is doing.

    Deliberately small — a coordinator's browser polls this, and the interesting fields are the ones
    that change. Everything static about an asset is on `GET /api/assets`.
    """
    with session_scope() as s:
        rows = list(s.exec(select(Asset).order_by(Asset.call_sign)).all())
        moving = {
            d.asset_id: d
            for d in s.exec(select(Dispatch).where(Dispatch.status == DispatchStatus.EN_ROUTE)).all()
        }
        out = []
        for a in rows:
            d = moving.get(a.id)
            out.append({
                "id": a.id, "call_sign": a.call_sign, "kind": str(a.kind), "status": str(a.status),
                "lat": a.lat, "lon": a.lon, "heading_deg": a.heading_deg,
                "requires_authorisation": _agency(a.kind),
                "dispatch_id": d.id if d else a.current_dispatch_id,
                "progress": round(float(d.progress or 0.0), 4) if d else None,
                "last_moved_at": (a.last_moved_at.isoformat() + "Z") if a.last_moved_at else None,
            })
        return {"assets": out, "count": len(out), "en_route": len(moving)}


@router.get("/{asset_id}")
def get_asset(asset_id: str) -> dict[str, Any]:
    with session_scope() as s:
        asset = s.get(Asset, asset_id)
        if asset is None:
            raise HTTPException(404, "asset not found")
        out = _live(s, asset)
        out["dispatches"] = [
            {"id": d.id, "incident_id": d.incident_id, "status": str(d.status),
             "proposed_at": d.proposed_at.isoformat() + "Z"}
            for d in s.exec(select(Dispatch).where(Dispatch.asset_id == asset_id)
                            .order_by(Dispatch.proposed_at)).all()
        ]
        return obs.redact(out)
