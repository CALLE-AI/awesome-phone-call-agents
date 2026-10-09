"""Escalations and responder handoffs — the endpoints where a human is in the loop.

Nothing in this module contacts anybody. It reads the ladder back, lets a captain close an
escalation with her name on it, and exposes the one transition that turns a prepared handoff packet
into a released one. That transition is `POST /api/handoffs/{id}/release`, it requires a person's
name, and `app.orchestrator.escalate.release` refuses an empty one and refuses "system",
"automation" and their friends. Releasing does not transmit anything either: it records that a named
human decided a responder should be told, and hands back the script for them to read.

The routes are deliberately boring. The interesting property is what is missing — there is no
endpoint here, and none anywhere in this codebase, that places a call to an emergency service.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session, select

from app import obs
from app.db import session_scope
from app.api.schemas import ReleaseIn, ResolveIn
from app.domain.state import EscalationStatus, IllegalTransition
from app.events.bus import bus
from app.models import Escalation, HandoffPacket, Neighbour
from app.orchestrator import escalate as ladder

router = APIRouter(prefix="/api/escalations", tags=["escalations"])
handoffs_router = APIRouter(prefix="/api/handoffs", tags=["escalations"])

OPEN_STATUSES = {EscalationStatus.OPEN, EscalationStatus.CONTACT_REACHED, EscalationStatus.AWAITING_AUTHORISATION,
                 EscalationStatus.RELEASED}


def _escalation_out(session: Session, esc: Escalation) -> dict[str, Any]:
    nbr = session.get(Neighbour, esc.neighbour_id)
    packets = session.exec(select(HandoffPacket).where(HandoffPacket.escalation_id == esc.id)).all()
    return {
        "id": esc.id, "sweep_id": esc.sweep_id, "hazard_id": esc.hazard_id, "neighbour_id": esc.neighbour_id,
        "name": nbr.name if nbr else esc.neighbour_id,
        "address": nbr.address if nbr else "",
        "outcome": esc.outcome, "level": str(esc.level), "status": str(esc.status), "reason": esc.reason,
        "trigger_call_id": esc.trigger_call_id, "rungs": list(esc.rungs or []),
        "contact_name": nbr.contact_name if nbr else "", "contact_relation": nbr.contact_relation if nbr else "",
        "resolved_by": esc.resolved_by, "resolved_note": esc.resolved_note,
        "created_at": esc.created_at.isoformat() + "Z", "updated_at": esc.updated_at.isoformat() + "Z",
        "resolved_at": (esc.resolved_at.isoformat() + "Z") if esc.resolved_at else None,
        "handoffs": [_packet_out(p) for p in packets],
    }


def _packet_out(packet: HandoffPacket, *, full: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": packet.id, "escalation_id": packet.escalation_id, "neighbour_id": packet.neighbour_id,
        "hazard_id": packet.hazard_id, "recommended_action": packet.recommended_action,
        "spoken_script": packet.spoken_script, "last_words": packet.last_words, "concerns": list(packet.concerns or []),
        "last_contact_at": (packet.last_contact_at.isoformat() + "Z") if packet.last_contact_at else None,
        "prepared_at": packet.prepared_at.isoformat() + "Z",
        # The safety property, stated in the payload rather than left to be inferred from a null.
        "released": packet.released_at is not None,
        "released_at": (packet.released_at.isoformat() + "Z") if packet.released_at else None,
        "released_by": packet.released_by, "release_note": packet.release_note,
        "status_note": ("released by " + packet.released_by) if packet.released_at
        else "prepared only — no emergency service has been contacted and nobody has been sent",
    }
    if full:
        out["neighbour_snapshot"] = dict(packet.neighbour_snapshot or {})
        out["hazard_snapshot"] = dict(packet.hazard_snapshot or {})
        out["attempts_summary"] = list(packet.attempts_summary or [])
    return out


@router.get("")
def list_escalations(hazard_id: str | None = Query(default=None), sweep_id: str | None = Query(default=None),
                     open_only: bool = Query(default=False)) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(Escalation)
        if hazard_id:
            q = q.where(Escalation.hazard_id == hazard_id)
        if sweep_id:
            q = q.where(Escalation.sweep_id == sweep_id)
        rows = list(s.exec(q.order_by(Escalation.created_at)).all())
        if open_only:
            rows = [e for e in rows if EscalationStatus(e.status) in OPEN_STATUSES]
        return [obs.redact(_escalation_out(s, e)) for e in rows]


@router.get("/{escalation_id}")
def get_escalation(escalation_id: str) -> dict[str, Any]:
    with session_scope() as s:
        esc = s.get(Escalation, escalation_id)
        if esc is None:
            raise HTTPException(404, "escalation not found")
        return obs.redact(_escalation_out(s, esc))


@router.post("/{escalation_id}/resolve")
def resolve_escalation(escalation_id: str, body: ResolveIn) -> dict[str, Any]:
    """Close an escalation. Requires the name of the person who decided this neighbour is accounted for."""
    with session_scope() as s:
        esc = s.get(Escalation, escalation_id)
        if esc is None:
            raise HTTPException(404, "escalation not found")
        try:
            ladder.resolve(s, esc, resolved_by=body.resolved_by, note=body.note)
        except ladder.ReleaseRefused as exc:
            raise HTTPException(400, str(exc)) from exc
        except IllegalTransition as exc:
            raise HTTPException(409, str(exc)) from exc
        s.flush()
        out = _escalation_out(s, esc)
        hazard_id, sweep_id, neighbour_id = esc.hazard_id, esc.sweep_id, esc.neighbour_id
    bus.publish(hazard_id=hazard_id, sweep_id=sweep_id, neighbour_id=neighbour_id, type="escalation.resolved",
                payload=obs.redact({"escalation_id": escalation_id, "resolved_by": body.resolved_by, "note": body.note}))
    return obs.redact(out)


# ------------------------------------------------------------------------------------------------
@handoffs_router.get("")
def list_handoffs(hazard_id: str | None = Query(default=None),
                  unreleased_only: bool = Query(default=False)) -> list[dict[str, Any]]:
    with session_scope() as s:
        q = select(HandoffPacket)
        if hazard_id:
            q = q.where(HandoffPacket.hazard_id == hazard_id)
        rows = list(s.exec(q.order_by(HandoffPacket.prepared_at)).all())
        if unreleased_only:
            rows = [p for p in rows if p.released_at is None]
        return [obs.redact(_packet_out(p)) for p in rows]


@handoffs_router.get("/{packet_id}")
def get_handoff(packet_id: str) -> dict[str, Any]:
    """The whole page a responder would be given — including the address and the medical fact.

    Deliberately not redacted beyond phone numbers: a packet with the address masked out is a
    document that helps nobody, and putting it in front of a human is the entire point of preparing it.
    """
    with session_scope() as s:
        packet = s.get(HandoffPacket, packet_id)
        if packet is None:
            raise HTTPException(404, "handoff packet not found")
        return obs.redact(_packet_out(packet, full=True))


@handoffs_router.post("/{packet_id}/release")
def release_handoff(packet_id: str, body: ReleaseIn) -> dict[str, Any]:
    """A named human authorises telling a responder. The only path out of a prepared packet.

    400 when the name is missing or is not a person's name. That is not validation pedantry: the
    released_by field is the only record that a human made this decision, and "system" in it would
    mean nobody did.
    """
    with session_scope() as s:
        packet = s.get(HandoffPacket, packet_id)
        if packet is None:
            raise HTTPException(404, "handoff packet not found")
        esc = s.get(Escalation, packet.escalation_id)
        if esc is None:
            raise HTTPException(409, "the escalation behind this packet is gone; refusing to release it")
        try:
            ladder.release(s, packet, escalation=esc, released_by=body.released_by, note=body.note)
        except ladder.ReleaseRefused as exc:
            raise HTTPException(400, str(exc)) from exc
        except IllegalTransition as exc:
            raise HTTPException(409, str(exc)) from exc
        s.flush()
        out = _packet_out(packet, full=True)
        hazard_id, sweep_id, neighbour_id, esc_id = packet.hazard_id, esc.sweep_id, packet.neighbour_id, esc.id
    bus.publish(hazard_id=hazard_id, sweep_id=sweep_id, neighbour_id=neighbour_id, type="handoff.released",
                payload=obs.redact({"packet_id": packet_id, "escalation_id": esc_id,
                                    "released_by": out["released_by"], "note": body.note,
                                    "recommended_action": out["recommended_action"]}))
    return obs.redact(out)
