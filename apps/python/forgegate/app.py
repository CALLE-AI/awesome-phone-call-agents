"""ForgeGate — a CALL-E-powered human-verification gate for autonomous
physical/OT security actions.

POST /incident                 score an incident; if it crosses the risk
                                threshold, dispatch a CALL-E call and gate
                                the proposed action on the human decision.
                                Fail-closed: anything but a clean APPROVE
                                holds the action.
GET  /incidents/{incident_id}  audit trail for one incident.
GET  /incidents                full audit trail.
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
        description=payload.description,
        signals=payload.signals,
        risk_score=risk_score,
        proposed_action=payload.proposed_action
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
                "description": incident.get("description", ""),
                "proposed_action": incident.get("proposed_action", ""),
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

    existing = audit_log.has_existing_call(incident_id)
    if existing:
        logger.info(
            "incident %s already has a call on record (%s); refusing to dispatch a duplicate",
            incident_id,
            existing.get("call_id"),
        )
        return {
            "incident_id": incident_id,
            "risk_score": assessment.score,
            "action_state": existing.get("action_state"),
            "call_id": existing.get("call_id"),
            "call_placed": False,
            "note": "idempotent: reused existing call result, no duplicate call placed",
        }

    task_text = task_composer.compose_task(incident, assessment.score)
    key = calle_client.idempotency_key(incident_id)

    try:
        result = calle_client.place_call(task_text, incident_id)
    except calle_client.CalleDispatchError as exc:
        audit_log.append_activity("dispatch_failed", incident_id, str(exc))
        logger.error("call dispatch failed for %s: %s", incident_id, exc)
        audit_log.append_entry(
            {
                "incident_id": incident_id,
                "source": incident.get("source"),
                "description": incident.get("description", ""),
                "proposed_action": incident.get("proposed_action", ""),
                "risk_score": assessment.score,
                "threshold": assessment.threshold,
                "call_id": None,
                "disposition": "DISPATCH_FAILED",
                "action_state": "HELD",
                "idempotency_key": key,
                "task_text": task_text,
                "error": str(exc),
            }
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    action_state = calle_client.resolve_action_state(result.disposition)

    audit_log.append_activity("call_dispatched", incident_id, f"call_id={result.call_id}")
    audit_log.append_activity("disposition_received", incident_id, f"{result.disposition}: {result.reason}")
    audit_log.append_activity("action_resolved", incident_id, action_state)

    entry = audit_log.append_entry(
        {
            "incident_id": incident_id,
            "source": incident.get("source"),
            "description": incident.get("description", ""),
            "proposed_action": incident.get("proposed_action", ""),
            "risk_score": assessment.score,
            "threshold": assessment.threshold,
            "call_id": result.call_id,
            "disposition": result.disposition,
            "reason": result.reason,
            "transcript_evidence": result.transcript_evidence,
            "action_state": action_state,
            "idempotency_key": key,
            "task_text": task_text,
            "dry_run": result.dry_run,
        }
    )

    logger.info(
        "incident %s -> call %s -> disposition %s -> action %s",
        incident_id,
        result.call_id,
        result.disposition,
        entry["action_state"],
    )

    return {
        "incident_id": incident_id,
        "risk_score": assessment.score,
        "call_placed": True,
        "call_id": result.call_id,
        "disposition": result.disposition,
        "reason": result.reason,
        "action_state": entry["action_state"],
    }


@app.post("/incident/{incident_id}/action")
def post_incident_action(incident_id: str, payload: PostActionPayload):
    if payload.action not in ("discard", "escalate"):
        raise HTTPException(status_code=400, detail="action must be discard or escalate")
    
    entries = audit_log.read_for_incident(incident_id)
    if not entries:
        raise HTTPException(status_code=404, detail="Incident not found")
    
    original_entry = entries[-1]
    
    action_map = {"discard": "DISCARDED", "escalate": "ESCALATED"}
    action_state = action_map[payload.action]
    
    updated_entry = dict(original_entry)
    updated_entry.update({
        "action_state": action_state,
        "post_action": payload.action,
        "post_action_reason": payload.reason,
    })
    updated_entry.pop("timestamp", None)
    
    audit_log.append_entry(updated_entry)
    audit_log.append_activity("post_action", incident_id, f"{payload.action.upper()}: {payload.reason or 'No reason provided'}")
    
    return {"action_state": action_state}


@app.get("/incidents/{incident_id}/status")
def get_incident_status(incident_id: str):
    entries = audit_log.read_for_incident(incident_id)
    entry = entries[-1] if entries else None
    return {
        "incident_id": incident_id,
        "call_phase": calle_client.get_call_phase(incident_id),
        "entry": entry
    }


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: str):
    entries = audit_log.read_for_incident(incident_id)
    if not entries:
        raise HTTPException(status_code=404, detail="no audit entries for this incident_id")
    return {"incident_id": incident_id, "entries": entries}


@app.get("/incidents")
def list_incidents():
    return {"entries": audit_log.read_all()}


@app.get("/activity-feed")
def get_activity_feed(limit: int = 100):
    return {"activities": audit_log.read_activity(limit)}


@app.post("/reset")
def reset():
    audit_log.clear_all()
    calle_client.clear_call_phases()
    audit_log.clear_activity()
    return {"status": "ok", "message": "exchange audit log cleared"}


# Registered last so it never shadows the API routes above: Starlette matches
# routes in registration order, and this mount is a catch-all for "/".
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="dashboard")
