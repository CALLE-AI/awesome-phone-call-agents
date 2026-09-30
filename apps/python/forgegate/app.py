"""ForgeGate — a CALL-E-powered human-verification gate for autonomous
physical/OT security actions.

POST /incident                 score an incident; if it crosses the risk
                                threshold, dispatch a CALL-E call and gate
                                the proposed action on the human decision.
                                Fail-closed: anything but a clean APPROVE
                                holds the action.
POST /incident/create          create incident from UI/operator form.
POST /incident/{id}/action     reconcile held incident with operator decision.
GET  /incidents/{incident_id}  audit trail for one incident.
GET  /incidents                full audit trail.
GET  /incidents/{id}/status    live status polling endpoint for UI.
GET  /activity-feed            terminal activity stream.
GET  /scenarios                the demo scenario payloads (for the dashboard's patch keys).
GET  /health                   liveness + current dry_run setting + risk threshold.
GET  /                          the Manual Exchange dashboard (static/index.html).
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import audit_log
import calle_client
import risk_engine
import safety
import task_composer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("forgegate")

APP_DIR = Path(__file__).parent
SCENARIOS_DIR = APP_DIR / "scenarios"
STATIC_DIR = APP_DIR / "static"

app = FastAPI(
    title="ForgeGate",
    description="Human-verification gate: calls a person before an autonomous "
    "agent takes an irreversible physical/OT action.",
    version="0.1.0",
)


class IncidentPayload(BaseModel):
    incident_id: str
    source: str
    description: Optional[str] = ""
    signals: dict = Field(default_factory=dict)
    risk_score: Optional[float] = None
    proposed_action: str


class CreateIncidentPayload(BaseModel):
    incident_id: Optional[str] = None
    source: str
    severity: str  # "critical", "high", "medium", "low"
    description: str
    proposed_action: str
    signals: dict = Field(default_factory=dict)


class PostActionPayload(BaseModel):
    action: str  # "discard" or "escalate"
    reason: str = ""


@app.get("/health")
def health():
    calle_client.reload_config()
    return {
        "status": "ok",
        "dry_run": calle_client.DRY_RUN,
        "risk_threshold": risk_engine.DEFAULT_THRESHOLD,
        "approved_origins": sorted(calle_client.APPROVED_ORIGINS),
    }


@app.get("/scenarios")
def list_scenarios():
    """Reads the demo scenario JSON files so the dashboard's patch keys never
    duplicate what's already in scenarios/*.json."""
    scenarios = []
    if SCENARIOS_DIR.exists():
        for path in sorted(SCENARIOS_DIR.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            scenarios.append({"name": path.stem, "payload": payload})
    return {"scenarios": scenarios}


@app.post("/incident/create")
def create_incident(payload: CreateIncidentPayload):
    incident_id = payload.incident_id or f"INC-{int(time.time()) % 100000:05d}"
    severity_map = {"critical": 0.95, "high": 0.85, "medium": 0.5, "low": 0.15}
    risk_score = severity_map.get(payload.severity, 0.5)

    incident_payload = IncidentPayload(
        incident_id=incident_id,
        source=payload.source,
        description=safety.mask_text(payload.description),
        signals=payload.signals,
        risk_score=risk_score,
        proposed_action=safety.mask_text(payload.proposed_action),
    )

    result = post_incident(incident_payload)
    result["incident_id"] = incident_id
    return result


@app.post("/incident")
def post_incident(payload: IncidentPayload):
    calle_client.reload_config()
    incident = payload.model_dump()
    incident_id = incident["incident_id"]
    assessment = risk_engine.evaluate(incident)

    audit_log.append_activity("risk_evaluated", incident_id, f"score={assessment.score:.2f}, threshold={assessment.threshold:.2f}")

    if not assessment.crossed:
        audit_log.append_entry(
            {
                "incident_id": incident_id,
                "source": incident.get("source"),
                "description": safety.mask_text(incident.get("description", "")),
                "proposed_action": safety.mask_text(incident.get("proposed_action", "")),
                "risk_score": assessment.score,
                "threshold": assessment.threshold,
                "call_id": None,
                "disposition": None,
                "action_state": "AUTO-CLEARED",
                "idempotency_key": None,
            }
        )
        audit_log.append_activity("auto_cleared", incident_id, f"score={assessment.score:.2f} below threshold")
        logger.info(
            "incident %s auto-cleared (score=%.2f < threshold=%.2f)",
            incident_id,
            assessment.score,
            assessment.threshold,
        )
        return {
            "incident_id": incident_id,
            "risk_score": assessment.score,
            "action_state": "AUTO-CLEARED",
            "call_placed": False,
        }

    existing = audit_log.has_unreconciled_incident(incident_id)
    if existing:
        logger.info(
            "incident %s has prior state on record (%s); refusing redispatch until reconciliation",
            incident_id,
            existing.get("action_state"),
        )
        return {
            "incident_id": incident_id,
            "risk_score": existing.get("risk_score", assessment.score),
            "action_state": existing.get("action_state"),
            "call_id": existing.get("call_id"),
            "disposition": existing.get("disposition"),
            "call_placed": False,
            "note": "idempotent: preserved prior incident intent, refusing redispatch until reconciliation",
        }

    task_text = task_composer.compose_task(incident, assessment.score)
    key = calle_client.idempotency_key(incident_id)

    try:
        result = calle_client.place_call(task_text, incident_id)
    except calle_client.CalleDispatchError as exc:
        masked_exc = safety.mask_text(str(exc))
        audit_log.append_activity("dispatch_failed", incident_id, masked_exc)
        logger.error("call dispatch failed for %s: %s", incident_id, masked_exc)
        audit_log.append_entry(
            {
                "incident_id": incident_id,
                "source": incident.get("source"),
                "description": safety.mask_text(incident.get("description", "")),
                "proposed_action": safety.mask_text(incident.get("proposed_action", "")),
                "risk_score": assessment.score,
                "threshold": assessment.threshold,
                "call_id": None,
                "disposition": "DISPATCH_FAILED",
                "action_state": "HELD",
                "idempotency_key": key,
                "task_text": safety.mask_text(task_text),
                "error": masked_exc,
            }
        )
        raise HTTPException(status_code=502, detail=masked_exc) from exc

    action_state = calle_client.resolve_action_state(result.disposition)

    audit_log.append_activity("call_dispatched", incident_id, f"call_id={result.call_id}")
    audit_log.append_activity("disposition_received", incident_id, f"{result.disposition}: {result.reason}")
    audit_log.append_activity("action_resolved", incident_id, action_state)

    audit_log.append_entry(
        {
            "incident_id": incident_id,
            "source": incident.get("source"),
            "description": safety.mask_text(incident.get("description", "")),
            "proposed_action": safety.mask_text(incident.get("proposed_action", "")),
            "risk_score": assessment.score,
            "threshold": assessment.threshold,
            "call_id": result.call_id,
            "disposition": result.disposition,
            "reason": safety.mask_text(result.reason),
            "transcript_evidence": safety.mask_text(result.transcript_evidence),
            "action_state": action_state,
            "idempotency_key": key,
            "task_text": safety.mask_text(task_text),
            "dry_run": result.dry_run,
        }
    )

    logger.info(
        "incident %s -> call %s -> disposition %s -> action %s",
        incident_id,
        result.call_id,
        result.disposition,
        action_state,
    )
    return {
        "incident_id": incident_id,
        "risk_score": assessment.score,
        "action_state": action_state,
        "call_id": result.call_id,
        "disposition": result.disposition,
        "reason": safety.mask_text(result.reason),
        "transcript_evidence": safety.mask_text(result.transcript_evidence),
        "call_placed": True,
    }


@app.post("/incident/{incident_id}/action")
def post_incident_action(incident_id: str, payload: PostActionPayload):
    """Allows operator to explicitly reconcile a HELD incident (e.g. escalate or discard)."""
    action = payload.action.strip().lower()
    if action not in ("discard", "escalate"):
        raise HTTPException(status_code=400, detail="Action must be either 'discard' or 'escalate'")

    existing_entries = audit_log.read_for_incident(incident_id)
    if not existing_entries:
        raise HTTPException(status_code=404, detail=f"Incident {incident_id} not found")

    last_entry = existing_entries[-1]
    new_action_state = "DISCARDED" if action == "discard" else "ESCALATED"
    reason = safety.mask_text(payload.reason)

    updated_entry = audit_log.append_entry(
        {
            "incident_id": incident_id,
            "source": last_entry.get("source"),
            "description": last_entry.get("description", ""),
            "proposed_action": last_entry.get("proposed_action", ""),
            "risk_score": last_entry.get("risk_score"),
            "threshold": last_entry.get("threshold"),
            "call_id": last_entry.get("call_id"),
            "disposition": last_entry.get("disposition"),
            "reason": last_entry.get("reason", ""),
            "transcript_evidence": last_entry.get("transcript_evidence", ""),
            "action_state": new_action_state,
            "post_action": action,
            "post_action_reason": reason,
            "idempotency_key": last_entry.get("idempotency_key"),
            "task_text": last_entry.get("task_text", ""),
            "dry_run": last_entry.get("dry_run", True),
        }
    )

    audit_log.append_activity("post_action", incident_id, f"{action}: {reason}")
    logger.info("incident %s reconciled via post-action: %s -> %s", incident_id, action, new_action_state)

    return {
        "incident_id": incident_id,
        "action_state": new_action_state,
        "post_action": action,
        "entry": updated_entry,
    }


@app.get("/incidents/{incident_id}/status")
def get_incident_status(incident_id: str):
    """Polled by dashboard during active calls to track phase and final disposition."""
    phase = calle_client.get_call_phase(incident_id)
    entries = audit_log.read_for_incident(incident_id)
    latest_entry = entries[-1] if entries else None
    return {
        "incident_id": incident_id,
        "call_phase": phase,
        "entry": latest_entry,
    }


@app.get("/activity-feed")
def get_activity_feed(limit: int = 100):
    return {"activities": audit_log.read_activity(limit=limit)}


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: str):
    entries = audit_log.read_for_incident(incident_id)
    if not entries:
        raise HTTPException(status_code=404, detail=f"incident {incident_id} not found")
    return {"incident_id": incident_id, "entries": entries, "history": entries}


@app.get("/incidents")
def list_incidents():
    all_entries = audit_log.read_all()
    return {"entries": all_entries, "incidents": all_entries}


@app.post("/reset")
def reset_exchange():
    audit_log.clear_all()
    calle_client.clear_call_phases()
    logger.info("exchange reset: cleared audit log, activity feed, and active call phases")
    return {"status": "ok", "message": "All exchange logs, activity feed, and active calls cleared"}


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
