"""Hazards and sweeps: declare one, start a sweep over it, read a sweep back.

`POST /api/hazards/{id}/sweep` is the button. It is idempotent twice over — the handler looks for a
live sweep and the DB holds a unique partial index on `sweep(hazard_id) WHERE is_active = 1` — because
the failure mode of a double-click here is fourteen frail people being rung twice in five minutes.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app import obs
from app.api.deps import settings_dep
from app.api.schemas import HazardIn, HazardOut, SweepAccepted
from app.calls.contract import compile_contract
from app.config import Settings
from app.db import session_scope
from app.domain.hazards import parse_hazard
from app.domain.risk import triage
from app.domain.state import HazardStatus, SweepState
from app.events.bus import bus
from app.models import CheckCall, Hazard, Neighbour, Sweep
from app.orchestrator import runner
from app.orchestrator.sweep import hazard_view, load_roster, neighbour_view, open_sweep, sweep_summary

router = APIRouter(prefix="/api/hazards", tags=["hazards"])
sweeps_router = APIRouter(prefix="/api/sweeps", tags=["sweeps"])


def hazard_out(session: Session, hazard: Hazard) -> HazardOut:
    sweeps = session.exec(select(Sweep).where(Sweep.hazard_id == hazard.id)).all()
    active = next((s for s in sweeps if s.is_active), None)
    profile = parse_hazard(hazard)
    return HazardOut(
        id=hazard.id, kind=hazard.kind, headline=hazard.headline, area=hazard.area, severity=hazard.severity,
        status=str(hazard.status), starts_at=hazard.starts_at, ends_at=hazard.ends_at, facts=dict(hazard.facts or {}),
        help_offered=list(hazard.help_offered or []), source=hazard.source, declared_by=hazard.declared_by,
        created_at=hazard.created_at.isoformat() + "Z",
        closed_at=(hazard.closed_at.isoformat() + "Z") if hazard.closed_at else None,
        active_sweep_id=active.id if active else None, sweeps=len(sweeps),
        profile={
            "label": profile.label(),
            "describe": profile.describe(),
            "speakable_facts": profile.speakable_facts(),
            "cuts_power": profile.cuts_power,
            "may_evacuate": profile.may_evacuate,
            "swamp_cooler_compromised": profile.swamp_cooler_compromised,
            "severity_weight": profile.severity_weight,
            **profile.to_dict(),
        },
    )


@router.get("", response_model=list[HazardOut])
def list_hazards() -> list[HazardOut]:
    with session_scope() as s:
        rows = s.exec(select(Hazard).order_by(Hazard.created_at.desc())).all()  # type: ignore[attr-defined]
        return [hazard_out(s, h) for h in rows]


@router.post("", response_model=HazardOut, status_code=201)
def declare_hazard(body: HazardIn, settings: Settings = Depends(settings_dep)) -> HazardOut:
    """Declare a hazard over the block. Declaring does not call anybody — a sweep does."""
    with session_scope() as s:
        hazard = Hazard(
            kind=body.kind, headline=body.headline or body.kind.replace("_", " ").title(),
            area=body.area or settings.AREA_NAME, severity=body.severity, starts_at=body.starts_at,
            ends_at=body.ends_at, facts=dict(body.facts), help_offered=list(body.help_offered),
            source=body.source, declared_by=body.declared_by or settings.BLOCK_CAPTAIN_NAME,
            status=HazardStatus.OPEN,
        )
        s.add(hazard)
        s.flush()
        out = hazard_out(s, hazard)
    bus.publish(hazard_id=out.id, type="hazard.declared",
                payload={"kind": out.kind, "headline": out.headline, "severity": out.severity, "facts": out.facts})
    return out


@router.get("/{hazard_id}", response_model=HazardOut)
def get_hazard(hazard_id: str) -> HazardOut:
    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        if hazard is None:
            raise HTTPException(404, "hazard not found")
        return hazard_out(s, hazard)


@router.post("/{hazard_id}/sweep", response_model=SweepAccepted, status_code=202)
async def start_sweep(hazard_id: str, settings: Settings = Depends(settings_dep)) -> SweepAccepted:
    """Start the sweep. Returns the sweep already running if there is one, rather than starting a second."""
    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        if hazard is None:
            raise HTTPException(404, "hazard not found")
        if s.exec(select(Neighbour)).first() is None:
            raise HTTPException(409, "there is nobody on the roster to sweep")
        sweep, created = open_sweep(s, hazard, provider=settings.CALL_PROVIDER)
        sweep_id, state = sweep.id, str(sweep.state)
    if not created:
        return SweepAccepted(sweep_id=sweep_id, hazard_id=hazard_id, state=state, created=False)
    bus.publish(hazard_id=hazard_id, sweep_id=sweep_id, type="sweep.created",
                payload={"provider": settings.CALL_PROVIDER})
    bus.publish(hazard_id=hazard_id, sweep_id=sweep_id, type="hazard.status",
                payload={"status": HazardStatus.SWEEPING.value})
    runner.spawn(sweep_id)
    return SweepAccepted(sweep_id=sweep_id, hazard_id=hazard_id, state=SweepState.CREATED.value, created=True)


@router.get("/{hazard_id}/sweeps")
def hazard_sweeps(hazard_id: str) -> list[dict[str, Any]]:
    with session_scope() as s:
        if s.get(Hazard, hazard_id) is None:
            raise HTTPException(404, "hazard not found")
        rows = s.exec(select(Sweep).where(Sweep.hazard_id == hazard_id).order_by(Sweep.created_at)).all()
        return [obs.redact(sweep_summary(s, row)) for row in rows]


@router.get("/{hazard_id}/calls")
def hazard_calls(hazard_id: str) -> list[dict[str, Any]]:
    """Every call placed under this hazard, neighbour and emergency contact alike."""
    with session_scope() as s:
        rows = s.exec(select(CheckCall).where(CheckCall.hazard_id == hazard_id).order_by(CheckCall.started_at)).all()  # type: ignore[arg-type]
        names = {n.id: n.name for n in s.exec(select(Neighbour)).all()}
        return [
            obs.redact({
                "id": c.id, "sweep_id": c.sweep_id, "neighbour_id": c.neighbour_id,
                "name": names.get(c.neighbour_id, c.neighbour_id), "callee": c.callee, "attempt": c.attempt,
                "provider": c.provider, "provider_call_id": c.provider_call_id, "status": c.status,
                "task": c.task, "result_schema": c.result_schema, "structured_result": c.structured_result,
                "validation_errors": c.validation_errors, "transcript": c.transcript, "summary": c.summary,
                "reconciled": c.reconciled, "outcome": c.outcome, "outcome_reason": c.outcome_reason,
                "concerns": c.concerns, "task_completed": c.task_completed,
                "completion_confidence": c.completion_confidence, "evidence": c.evidence,
                "risk_snapshot": c.risk_snapshot, "duration_s": c.duration_s,
                "started_at": (c.started_at.isoformat() + "Z") if c.started_at else None,
                "completed_at": (c.completed_at.isoformat() + "Z") if c.completed_at else None,
            })
            for c in rows
        ]


@router.get("/{hazard_id}/contract")
def contract_preview(hazard_id: str, neighbour_id: str | None = None,
                     settings: Settings = Depends(settings_dep)) -> dict[str, Any]:
    """Compile the call contract for one neighbour without dialling anybody.

    The same code path the runner uses, so what this shows is what CALL-E would be sent — which is
    the only honest way to review the wording of a call to a frightened person before it is placed.
    Without `neighbour_id` it previews whoever triage puts first.
    """
    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        if hazard is None:
            raise HTTPException(404, "hazard not found")
        if neighbour_id:
            nbr = s.get(Neighbour, neighbour_id)
            if nbr is None:
                raise HTTPException(404, "neighbour not found")
        else:
            order = [a for a in triage(load_roster(s), hazard) if a.may_call]
            if not order:
                raise HTTPException(404, "nobody on this roster may be called")
            nbr = s.get(Neighbour, order[0].neighbour_id)
            assert nbr is not None
        contract = compile_contract(hazard_view(hazard, settings), neighbour_view(nbr))
        return obs.redact({
            "neighbour": {"id": nbr.id, "name": nbr.name, "phone_masked": obs.mask_phone(nbr.phone),
                          "preferred_language": nbr.preferred_language, "check_in_consent": nbr.check_in_consent},
            "contract": {
                "task": contract.task, "result_schema": contract.result_schema, "objectives": contract.objectives,
                "hard_fields": contract.hard_fields, "soft_fields": contract.soft_fields,
                "must_return": contract.must_return, "locale": contract.locale,
                "help_offers": [o.model_dump() for o in contract.help_offers], "offer_keys": contract.offer_keys,
            },
        })


# ------------------------------------------------------------------------------------------------
@sweeps_router.get("/{sweep_id}")
def get_sweep(sweep_id: str) -> dict[str, Any]:
    with session_scope() as s:
        sweep = s.get(Sweep, sweep_id)
        if sweep is None:
            raise HTTPException(404, "sweep not found")
        summary = sweep_summary(s, sweep)
        summary["triage"] = dict(sweep.triage or {})
        summary["call_order"] = list(sweep.call_order or [])
        return obs.redact(summary)
