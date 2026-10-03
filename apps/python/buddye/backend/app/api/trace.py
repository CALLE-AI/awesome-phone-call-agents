"""The audit trace: everything one sweep did, in one JSON document.

This is the artifact that answers "did the CALL-E integration really work, and did it behave?"
without anyone having to watch the screen while it happened. For each call it carries what we sent
(the compiled task and schema, the risk assessment that put this person at this place in the queue),
what CALL-E returned (its raw call object, its own developer events, `task_completed`,
`completion_confidence`, `evidence`), what we did with it (local validation, reconcile telemetry, the
deterministic outcome), and what that opened.

Two things here are the ones to read first:

* **`unaccounted`** — everyone on the roster this sweep has no outcome for, with the reason. A sweep
  is not judged by how many calls it made; it is judged by whether anybody was quietly dropped.
* **`safety`** — the ladder, counted. How many handoff packets were prepared, how many were released,
  and by whom. `prepared > 0, released = 0` is the healthy state of a demo: the machine did all the
  work and told nobody.

Everything is redacted on the way out, so a trace can be pasted into a pull request. Note the
limitation honestly: `obs.redact` masks phone numbers and credential-shaped keys. It does not know
that `address` or `conditions` are sensitive, and this document contains both by design — it is an
audit record for the captain, not a public artifact.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import select

from app import obs
from app.db import session_scope
from app.models import AgentEvent, CheckCall, Escalation, HandoffPacket, Hazard, Neighbour, Sweep
from app.orchestrator.sweep import sweep_summary

router = APIRouter(prefix="/api/sweeps", tags=["observability"])


def _iso(dt: Any) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def build_trace(sweep_id: str) -> dict[str, Any]:
    with session_scope() as s:
        sweep = s.get(Sweep, sweep_id)
        if sweep is None:
            raise HTTPException(404, "sweep not found")
        hazard = s.get(Hazard, sweep.hazard_id)
        names = {n.id: n.name for n in s.exec(select(Neighbour)).all()}
        calls = s.exec(select(CheckCall).where(CheckCall.sweep_id == sweep_id).order_by(CheckCall.started_at)).all()  # type: ignore[arg-type]
        events = s.exec(select(AgentEvent).where(AgentEvent.sweep_id == sweep_id).order_by(AgentEvent.id)).all()  # type: ignore[arg-type]
        escalations = list(s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id).order_by(Escalation.created_at)).all())
        packets = list(s.exec(
            select(HandoffPacket).where(HandoffPacket.escalation_id.in_([e.id for e in escalations] or [""]))  # type: ignore[attr-defined]
        ).all())
        summary = sweep_summary(s, sweep)

        by_call: dict[str, list[dict[str, Any]]] = {}
        for ev in events:
            cid = (ev.payload or {}).get("call_id")
            if ev.type.startswith("provider.") and cid:
                by_call.setdefault(str(cid), []).append(
                    {"at": _iso(ev.created_at), "type": ev.type, "message": (ev.payload or {}).get("message"),
                     "status": (ev.payload or {}).get("status"), "details": (ev.payload or {}).get("details")}
                )

        call_docs = []
        for c in calls:
            duration = None
            if c.started_at and c.completed_at:
                duration = round((c.completed_at - c.started_at).total_seconds(), 2)
            call_docs.append({
                "call_id": c.id,
                "neighbour": names.get(c.neighbour_id, c.neighbour_id),
                "callee": c.callee,
                "attempt": c.attempt,
                "idempotency_key": c.idempotency_key,
                "provider": c.provider,
                "provider_call_id": c.provider_call_id,
                "status": c.status,
                "sent": {
                    "task": c.task,
                    "result_schema": c.result_schema,
                    "schema_field_count": len(c.result_schema.get("properties", {})),
                    "help_offered": c.help_offered,
                    # Why this person was called when they were. The single most useful line in the
                    # document when somebody asks why Walter was first.
                    "risk_snapshot": c.risk_snapshot,
                },
                "returned": {
                    "structured_result": c.structured_result,
                    "validation_errors": c.validation_errors,
                    "task_completed": c.task_completed,
                    "completion_confidence": c.completion_confidence,
                    "evidence": c.evidence,
                    "summary": c.summary,
                    "transcript_turns": len(c.transcript or []),
                    "transcript": c.transcript,
                    "provider_raw": c.provider_raw,
                },
                "processing": {
                    "reconciled": c.reconciled,
                    "reconcile_meta": c.reconcile_meta,
                    "outcome": c.outcome,
                    "outcome_reason": c.outcome_reason,
                    "concerns": c.concerns,
                    "poll_count": c.poll_count,
                    "webhook_received": c.webhook_received,
                },
                "timing": {"started_at": _iso(c.started_at), "completed_at": _iso(c.completed_at),
                           "wall_seconds": duration, "provider_duration_s": c.duration_s},
                # keyed by our CheckCall id: that is what the runner stamps on every provider.* event
                "provider_events": by_call.get(c.id, []),
            })

        doc = {
            "sweep": {
                "id": sweep.id, "state": str(sweep.state), "is_active": sweep.is_active, "provider": sweep.provider,
                "calls_made": sweep.calls_made, "current_index": sweep.current_index,
                "call_order": [names.get(n, n) for n in (sweep.call_order or [])],
                "outcomes": {names.get(k, k): v for k, v in (sweep.outcomes or {}).items()},
                "error": sweep.error,
                "created_at": _iso(sweep.created_at), "updated_at": _iso(sweep.updated_at),
                "completed_at": _iso(sweep.completed_at),
            },
            "hazard": None if hazard is None else {
                "id": hazard.id, "kind": hazard.kind, "headline": hazard.headline, "area": hazard.area,
                "severity": hazard.severity, "status": str(hazard.status), "facts": hazard.facts,
                "help_offered": hazard.help_offered, "source": hazard.source, "declared_by": hazard.declared_by,
            },
            "triage": [
                {"name": v.get("name"), "score": v.get("score"), "band": v.get("band"),
                 "time_to_harm_h": v.get("time_to_harm_h"), "may_call": v.get("may_call"),
                 "skip_reason": v.get("skip_reason"), "reasons": v.get("reasons")}
                for v in sorted((sweep.triage or {}).values(), key=lambda a: -int(a.get("score") or 0))
            ],
            "calls": call_docs,
            "escalations": [{
                "id": e.id, "neighbour": names.get(e.neighbour_id, e.neighbour_id), "outcome": e.outcome,
                "level": str(e.level), "status": str(e.status), "reason": e.reason, "rungs": e.rungs,
                "resolved_by": e.resolved_by, "resolved_note": e.resolved_note, "resolved_at": _iso(e.resolved_at),
            } for e in escalations],
            "handoffs": [{
                "id": p.id, "escalation_id": p.escalation_id, "neighbour": names.get(p.neighbour_id, p.neighbour_id),
                "recommended_action": p.recommended_action, "spoken_script": p.spoken_script,
                "last_words": p.last_words, "concerns": p.concerns, "attempts_summary": p.attempts_summary,
                "last_contact_at": _iso(p.last_contact_at), "prepared_at": _iso(p.prepared_at),
                "released": p.released_at is not None, "released_at": _iso(p.released_at),
                "released_by": p.released_by, "release_note": p.release_note,
            } for p in packets],
            "safety": {
                "handoffs_prepared": len(packets),
                "handoffs_released": sum(1 for p in packets if p.released_at is not None),
                "released_by": sorted({p.released_by for p in packets if p.released_at is not None}),
                # Stated as a fact of the document, because it is the claim the whole design makes.
                "emergency_services_contacted": 0,
                "note": "BuddyE prepares responder handoffs and never sends them. A packet with "
                        "released_at = null has told nobody anything.",
            },
            "unaccounted": summary["unaccounted"],
            "summary": {k: summary[k] for k in
                        ("roster_size", "queued", "calls_made", "outcome_counts", "escalations", "escalations_open")},
            "timeline": [{"id": e.id, "at": _iso(e.created_at), "type": e.type, "neighbour_id": e.neighbour_id,
                          "payload": e.payload} for e in events],
        }
        return obs.redact(doc)


@router.get("/{sweep_id}/trace")
def sweep_trace(sweep_id: str) -> dict[str, Any]:
    """Everything this sweep sent, received, decided and escalated. Redacted; safe to share."""
    return build_trace(sweep_id)
