"""The roster, and what a given hazard means for each person on it.

`GET /api/neighbours?hazard_id=...` is the board the captain works from. Without a hazard it is just
a list of people; with one, every row carries the triage assessment — score, band, the sentences that
produced it, and how long triage thinks that person has. That is the whole argument of the product in
one response: the same fourteen people reorder completely between a heat warning and a power cut.

Everyone is listed, including the neighbour who never opted in. He is on the captain's list and she
still needs to see him; `check_in_consent: false` and a `risk.may_call: false` say plainly that
BuddyE will not ring him, which is different from pretending he is not there.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session, select

from app import obs
from app.api.schemas import NeighbourOut
from app.db import session_scope
from app.domain.risk import assess, triage
from app.models import CheckCall, Escalation, HandoffPacket, Hazard, Neighbour, Sweep

router = APIRouter(prefix="/api/neighbours", tags=["neighbours"])


def neighbour_out(nbr: Neighbour, *, risk: dict[str, Any] | None = None,
                  outcome: str | None = None, outcome_reason: str | None = None,
                  last_call_at: str | None = None) -> NeighbourOut:
    return NeighbourOut(
        id=nbr.id, name=nbr.name, phone_masked=obs.mask_phone(nbr.phone), address=nbr.address, unit=nbr.unit,
        access_notes=nbr.access_notes, lat=nbr.lat, lon=nbr.lon, age_band=nbr.age_band, lives_alone=nbr.lives_alone,
        conditions=list(nbr.conditions or []), power_dependent=nbr.power_dependent,
        power_backup_hours=nbr.power_backup_hours, cooling=nbr.cooling, heating=nbr.heating, mobility=nbr.mobility,
        has_transport=nbr.has_transport, preferred_language=nbr.preferred_language, contact_name=nbr.contact_name,
        contact_relation=nbr.contact_relation, has_contact_phone=bool((nbr.contact_phone or "").strip()),
        check_in_consent=nbr.check_in_consent, notes=nbr.notes, is_demo=nbr.is_demo,
        risk=risk, outcome=outcome, outcome_reason=outcome_reason, last_call_at=last_call_at,
    )


def _latest_sweep(session: Session, hazard_id: str) -> Sweep | None:
    rows = session.exec(select(Sweep).where(Sweep.hazard_id == hazard_id).order_by(Sweep.created_at)).all()
    return rows[-1] if rows else None


@router.get("", response_model=list[NeighbourOut])
def list_neighbours(hazard_id: str | None = Query(default=None)) -> list[NeighbourOut]:
    """The roster, worst-first when a hazard is named and alphabetical when one is not."""
    with session_scope() as s:
        rows = list(s.exec(select(Neighbour).order_by(Neighbour.name)).all())
        if not hazard_id:
            return [neighbour_out(n) for n in rows]
        hazard = s.get(Hazard, hazard_id)
        if hazard is None:
            raise HTTPException(404, "hazard not found")
        # Prefer the sweep's stored triage: it is what the calls were actually ordered by, and
        # re-scoring live would quietly disagree with the record if the roster has been edited since.
        sweep = _latest_sweep(s, hazard_id)
        stored = dict(sweep.triage or {}) if sweep else {}
        outcomes = dict(sweep.outcomes or {}) if sweep else {}
        calls = {}
        if sweep is not None:
            for c in s.exec(select(CheckCall).where(CheckCall.sweep_id == sweep.id, CheckCall.callee == "neighbour")).all():
                prev = calls.get(c.neighbour_id)
                if prev is None or (c.started_at or c.completed_at) and (c.started_at or c.completed_at) >= (prev.started_at or prev.completed_at):
                    calls[c.neighbour_id] = c
        assessments = {a.neighbour_id: a.to_dict() for a in triage(rows, hazard)} if not stored else stored
        out = []
        for nbr in rows:
            risk = assessments.get(nbr.id) or assess(nbr, hazard).to_dict()
            call = calls.get(nbr.id)
            at = (call.completed_at or call.started_at) if call else None
            out.append(neighbour_out(
                nbr, risk=risk, outcome=outcomes.get(nbr.id),
                outcome_reason=call.outcome_reason if call else None,
                last_call_at=(at.isoformat() + "Z") if at else None,
            ))
        out.sort(key=lambda n: (-(n.risk or {}).get("score", 0), n.name))
        return out


@router.get("/{neighbour_id}")
def get_neighbour(neighbour_id: str, hazard_id: str | None = Query(default=None)) -> dict[str, Any]:
    """One person: their row, their risk under a hazard, every call, and where their escalation got to."""
    with session_scope() as s:
        nbr = s.get(Neighbour, neighbour_id)
        if nbr is None:
            raise HTTPException(404, "neighbour not found")
        risk = None
        if hazard_id:
            hazard = s.get(Hazard, hazard_id)
            if hazard is None:
                raise HTTPException(404, "hazard not found")
            sweep = _latest_sweep(s, hazard_id)
            risk = (dict(sweep.triage or {}).get(neighbour_id) if sweep else None) or assess(nbr, hazard).to_dict()

        q = select(CheckCall).where(CheckCall.neighbour_id == neighbour_id)
        if hazard_id:
            q = q.where(CheckCall.hazard_id == hazard_id)
        calls = s.exec(q.order_by(CheckCall.started_at)).all()  # type: ignore[arg-type]
        eq = select(Escalation).where(Escalation.neighbour_id == neighbour_id)
        if hazard_id:
            eq = eq.where(Escalation.hazard_id == hazard_id)
        escalations = list(s.exec(eq.order_by(Escalation.created_at)).all())
        packets = list(s.exec(
            select(HandoffPacket).where(HandoffPacket.escalation_id.in_([e.id for e in escalations] or [""]))  # type: ignore[attr-defined]
        ).all())
        return obs.redact({
            "neighbour": neighbour_out(nbr, risk=risk).model_dump(),
            "calls": [{
                "id": c.id, "sweep_id": c.sweep_id, "callee": c.callee, "attempt": c.attempt, "status": c.status,
                "outcome": c.outcome, "outcome_reason": c.outcome_reason, "concerns": c.concerns,
                "structured_result": c.structured_result, "transcript": c.transcript, "summary": c.summary,
                "duration_s": c.duration_s,
                "started_at": (c.started_at.isoformat() + "Z") if c.started_at else None,
                "completed_at": (c.completed_at.isoformat() + "Z") if c.completed_at else None,
            } for c in calls],
            "escalations": [{
                "id": e.id, "outcome": e.outcome, "level": str(e.level), "status": str(e.status),
                "reason": e.reason, "rungs": e.rungs, "resolved_by": e.resolved_by, "resolved_note": e.resolved_note,
            } for e in escalations],
            "handoffs": [{
                "id": p.id, "escalation_id": p.escalation_id, "recommended_action": p.recommended_action,
                "released": p.released_at is not None, "released_by": p.released_by,
            } for p in packets],
        })

