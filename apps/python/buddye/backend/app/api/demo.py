"""Demo controls and the dashboard.

`POST /api/demo/outage` is the one worth understanding. It declares a power cut over the same
fourteen people mid-demo, and the point is what happens to the order: Walter Brzezinski, who barely
registers under a heat warning, comes out first because his oxygen concentrator runs off wall power
and the outage has an ETA attached. Nothing is pre-computed — the same `risk.triage` runs against a
different `HazardProfile` and produces a different queue, live.

Neither endpoint dials anybody. Declaring a hazard and sweeping it are separate acts, here and
everywhere else.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlmodel import select

from app import obs
from app.api.deps import settings_dep
from app.api.schemas import DashboardOut
from app.calls.budget import count_real_calls
from app.config import Settings
from app.db import session_scope
from app.domain.state import HazardStatus
from app.models import Asset, CheckCall, Dispatch, Escalation, HandoffPacket, Hazard, Incident, Neighbour, Sweep
from app.orchestrator import runner
from app.orchestrator.sweep import unaccounted
from app.seed_helpers import declare_outage, reset_demo
from app import seed_assets as fleet_seed

router = APIRouter(prefix="/api", tags=["demo"])


@router.post("/demo/reset")
async def reset(settings: Settings = Depends(settings_dep)) -> dict[str, Any]:
    """Wipe and re-seed the block and the fleet. The real-call ledger survives; the free tier is not
    refunded.

    `app.seed.seed` plants the six community units. The agency units — two ambulances, an engine and
    a patrol car — come from `app.seed_assets`, which is the superset, and they are seeded on
    purpose: leaving them off the board would have *hidden* the authorisation rule rather than
    enforced it. A coordinator who never sees an ambulance on the map learns nothing about who is
    allowed to spend one. They are on the map, they can be proposed and routed, and
    `app.domain.state.requires_authorisation` stops every one of them at PROPOSED until a named
    human clicks.

    Called qualified (`fleet_seed.seed_assets`) because `app.seed` has a module-level function of
    the same name that plants only the community six; an unqualified import would be shadowed by it
    and the agency units would silently never appear.
    """
    out = reset_demo(settings)
    with session_scope() as s:
        planted = fleet_seed.seed_assets(s)
        agency = sum(1 for a in planted if a.call_sign in fleet_seed.agency_call_signs())
        out["assets"] = len(planted)
        out["assets_needing_authorisation"] = agency
    return out


@router.post("/demo/outage")
async def outage() -> dict[str, Any]:
    """Declare the power cut over the same roster. Idempotent by kind."""
    return declare_outage()


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(settings: Settings = Depends(settings_dep)) -> DashboardOut:
    with session_scope() as s:
        neighbours = list(s.exec(select(Neighbour)).all())
        sweeps = list(s.exec(select(Sweep)).all())
        hazards_open = int(s.exec(
            select(func.count()).select_from(Hazard).where(Hazard.status != HazardStatus.CLOSED)
        ).one())
        escalations = list(s.exec(select(Escalation)).all())
        packets = list(s.exec(select(HandoffPacket)).all())
        counts: dict[str, int] = {}
        missing = 0
        for sweep in sweeps:
            for value in (sweep.outcomes or {}).values():
                counts[str(value)] = counts.get(str(value), 0) + 1
            if sweep.is_active or sweep.completed_at:
                missing += len(unaccounted(sweep, neighbours))
        return DashboardOut(
            neighbours=len(neighbours),
            consenting=sum(1 for n in neighbours if n.check_in_consent),
            hazards_open=hazards_open,
            active_sweeps=sum(1 for sweep in sweeps if sweep.is_active),
            calls_made=sum(sweep.calls_made for sweep in sweeps),
            outcome_counts=counts,
            unaccounted=missing,
            escalations_open=sum(1 for e in escalations if str(e.status) not in {"RESOLVED", "CANCELLED"}),
            handoffs_prepared=len(packets),
            handoffs_released=sum(1 for p in packets if p.released_at is not None),
            real_calls_used=count_real_calls(s),
            real_calls_budget=settings.CALL_BUDGET_MAX,
            provider=settings.CALL_PROVIDER,
            block_captain=settings.BLOCK_CAPTAIN_NAME,
            area=settings.AREA_NAME,
        )


@router.get("/health")
def health(settings: Settings = Depends(settings_dep)) -> dict[str, Any]:
    with session_scope() as s:
        calls = int(s.exec(select(func.count()).select_from(CheckCall)).one())
    return obs.redact({
        "ok": True, "provider": settings.CALL_PROVIDER, "calls_recorded": calls,
        "operator": operator_summary(),
        "active_sweeps": list(runner.active_tasks().keys()),
        "emergency_contacts_callable": settings.CALL_EMERGENCY_CONTACTS,
        "handoff_min_band": settings.HANDOFF_MIN_BAND,
    })


def operator_summary() -> dict[str, Any]:
    """The operator layer in six numbers, for the health endpoint and the demo board.

    `awaiting_authorisation` is the one to read: agency units an agent has fully prepared and NOT
    requested. It is the count of decisions sitting with a human, and it is the number that should
    never quietly go up on its own.
    """
    with session_scope() as s:
        assets = list(s.exec(select(Asset)).all())
        incidents = list(s.exec(select(Incident)).all())
        dispatches = list(s.exec(select(Dispatch)).all())
        return {
            "assets": len(assets),
            "assets_available": sum(1 for a in assets if str(a.status) == "AVAILABLE"),
            "assets_en_route": sum(1 for a in assets if str(a.status) == "EN_ROUTE"),
            "incidents_open": sum(1 for i in incidents if str(i.status) in
                                  {"OPEN", "TRIAGED", "DISPATCHED", "ON_SCENE"}),
            "incidents_total": len(incidents),
            "dispatches_committed": sum(1 for d in dispatches if str(d.status) in
                                        {"COMMITTED", "EN_ROUTE", "ARRIVED", "COMPLETED"}),
            "awaiting_authorisation": sum(1 for d in dispatches
                                          if str(d.status) == "PROPOSED" and d.requires_authorisation),
            "declined": sum(1 for d in dispatches if str(d.status) == "CANCELLED" and d.decline_reason),
        }
