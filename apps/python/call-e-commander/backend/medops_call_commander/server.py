import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from cryptography.fernet import Fernet
from apps.python.medops_call_commander.auth import verify_jwt_token

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from apps.python.medops_call_commander.adapters.fhir import FHIRAdapter
from apps.python.medops_call_commander.adapters.opendental import OpenDentalAdapter
from apps.python.medops_call_commander.audit.log import AuditLog
from apps.python.medops_call_commander.core.enums import ConsentStatus, PlanState
from apps.python.medops_call_commander.core.exceptions import (
    ConsentDenied,
    MedOpsBaseException,
    UnroutableEvent,
)
from apps.python.medops_call_commander.core.models import AuditEntry, CallPlan, EHREvent
from apps.python.medops_call_commander.executor.executor import CallExecutor
from apps.python.medops_call_commander.gates.consent import ConsentGate
from apps.python.medops_call_commander.gates.hitl import HITLGate
from apps.python.medops_call_commander.providers.calle_mcp import CalleMcpProvider
from apps.python.medops_call_commander.supervisor.router import route

# Load environment
load_dotenv()

ENCRYPTION_KEY = os.environ.get("MEDOPS_ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    ENCRYPTION_KEY = Fernet.generate_key().decode()
fernet = Fernet(ENCRYPTION_KEY)

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medops_server")

app = FastAPI(
    title="MedOps Call Commander",
    description="Multi-agent HITL Phone Call Orchestration for Medical Practice Operations",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared memory state
audit_log = AuditLog()
# In test mode, executor._provider is replaced by conftest.py after import.
_provider = None if os.environ.get("MEDOPS_TEST_MODE") == "1" else CalleMcpProvider()
executor = CallExecutor(_provider)


# Optional HITL Gate via Telegram
hitl_gate: Optional[HITLGate] = None
if os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_ADMIN_CHAT_ID") and os.environ.get("HITL_SIGNING_SECRET"):
    try:
        hitl_gate = HITLGate(audit_log=audit_log)
        logger.info("HITL Telegram Gate initialized.")
    except Exception as e:
        logger.warning("HITL Telegram Gate initialization skipped: %s", e)


# ---------------------------------------------------------------------------
# EHR Consent Source — wired from configured adapter (required for production)
# ---------------------------------------------------------------------------
def _load_consent_source():
    """
    Returns the active EHR adapter to back the ConsentGate.
    Prefers OpenDental if both OPENDENTAL_API_URL and OPENDENTAL_API_KEY are set.
    Falls back to FHIR if FHIR_BASE_URL and FHIR_BEARER_TOKEN are set.
    Raises RuntimeError at startup if neither is configured.

    MEDOPS_TEST_MODE=1 bypasses this check for unit/integration tests only.
    Never set this variable in production or staging environments.
    """
    if os.environ.get("MEDOPS_TEST_MODE") == "1":
        # Minimal stub so server module can be imported in tests.
        # Tests replace consent_gate._source with a real mock in conftest.py.
        class _UnconfiguredStub:
            def get_consent_status(self, patient_id: str, call_type: str) -> str:
                raise RuntimeError("Test stub: consent_gate._source was not replaced by conftest.py")
        return _UnconfiguredStub()

    has_opendental = bool(
        os.environ.get("OPENDENTAL_API_URL")
        and os.environ.get("OPENDENTAL_DEVELOPER_KEY")
    )
    has_fhir = bool(
        os.environ.get("FHIR_BASE_URL") and os.environ.get("FHIR_BEARER_TOKEN")
    )

    if has_opendental:
        logger.info("ConsentGate: using OpenDental adapter.")
        return OpenDentalAdapter()
    if has_fhir:
        logger.info("ConsentGate: using FHIR R4 adapter.")
        return FHIRAdapter()

    raise RuntimeError(
        "No EHR adapter configured. Set OPENDENTAL_API_URL + OPENDENTAL_DEVELOPER_KEY "
        "(+ OPENDENTAL_CUSTOMER_KEY for a real practice) or FHIR_BASE_URL + FHIR_BEARER_TOKEN "
        "in your environment."
    )

consent_gate = ConsentGate(_load_consent_source())



# In-memory storage for active plans
PLANS_DB: Dict[str, CallPlan] = {}
RESULTS_DB: Dict[str, Any] = {}


class TriggerEventRequest(BaseModel):
    event_type: str
    patient_id: str
    patient_phone: str  # E.164 format required, e.g. +12125550100
    priority: Optional[str] = "routine"
    source_system: Optional[str] = "opendental"
    context: Optional[Dict[str, Any]] = None

class ApprovePlanRequest(BaseModel):
    script: Optional[str] = None
    admin_id: Optional[str] = "admin_web"


# Helper serializers
def plan_to_dict(plan: CallPlan) -> Dict[str, Any]:
    return {
        "plan_id": plan.plan_id,
        "idempotency_key": plan.idempotency_key,
        "agent": plan.agent.value,
        "patient_id": plan.patient_id,
        "phone_masked": plan.phone_masked,
        "script": plan.script,
        "priority": plan.priority,
        "source_event": plan.source_event,
        "state": plan.state.value,
        "dry_run": plan.dry_run,
        "created_at": plan.created_at.isoformat(),
        "expires_at": plan.expires_at.isoformat() if plan.expires_at else None,
        "approved_by": plan.approved_by,
        "approved_at": plan.approved_at.isoformat() if plan.approved_at else None,
        "dispatched_at": plan.dispatched_at.isoformat() if plan.dispatched_at else None,
        "scrubbed_at": plan.scrubbed_at.isoformat() if plan.scrubbed_at else None,
        "result_ref": plan.result_ref,
        "is_phi_scrubbed": plan.is_phi_scrubbed(),
    }


# Static assets mount
@app.get("/")
def index_page():
    return {"status": "MedOps Call Commander API Running"}

@app.post("/api/events/trigger")
def trigger_event(req: TriggerEventRequest, _=Depends(verify_jwt_token)):
    """
    Receives an EHR event payload, routes to the appropriate agent, checks patient consent,
    generates a CallPlan in PENDING_APPROVAL, and notifies HITL admin.
    """
    event = EHREvent(
        event_type=req.event_type,
        patient_id=req.patient_id,
        patient_phone=req.patient_phone,
        context=req.context or {"reference_id": f"REF-{req.patient_id}"},
        priority=req.priority or "routine",
        source_system=req.source_system or "opendental",
    )

    try:
        # Step 1: Supervisor Route to Domain Agent
        plan = route(event)

        # Step 2: Check Consent Gate
        consent_gate.check(event.patient_id, plan.agent.value)

        # Step 3: Transition to PENDING_APPROVAL
        plan.state = PlanState.PENDING_APPROVAL
        # Encrypt the E.164 phone number before saving to memory
        plan.phone_e164 = fernet.encrypt(plan.phone_e164.encode()).decode()
        PLANS_DB[plan.plan_id] = plan

        # Step 4: Audit Entry
        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="CREATED",
            agent_type=plan.agent.value,
            admin_id="system",
            reason=f"Event '{event.event_type}' routed to agent '{plan.agent.value}'",
        ))

        # Step 5: Telegram HITL Notification if enabled
        if hitl_gate:
            try:
                hitl_gate.notify(plan)
            except Exception as e:
                logger.warning("Telegram notification failed: %s", e)

        return {"status": "success", "plan": plan_to_dict(plan)}

    except ConsentDenied as e:
        logger.warning("Consent blocked call creation for patient %s: %s", req.patient_id, e)
        audit_log.append(AuditEntry(
            plan_id="N/A",
            action="BLOCKED_CONSENT_DENIED",
            admin_id="system",
            reason=f"Consent denied for patient {req.patient_id}",
        ))
        raise HTTPException(status_code=403, detail=str(e))

    except UnroutableEvent as e:
        raise HTTPException(status_code=400, detail=str(e))
    except MedOpsBaseException as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/config")
def get_config(_=Depends(verify_jwt_token)):
    """
    Returns non-sensitive dashboard configuration.
    MEDOPS_TEST_PHONE is returned in full so the dashboard can pre-fill it,
    but only when explicitly set in .env — never a default.
    """
    test_phone = os.environ.get("MEDOPS_TEST_PHONE", "").strip()
    return {
        "test_phone": test_phone or None,
        "test_mode": bool(test_phone),
        "ehr_adapter": (
            "opendental" if os.environ.get("OPENDENTAL_DEVELOPER_KEY")
            else "fhir" if os.environ.get("FHIR_BASE_URL")
            else "none"
        ),
    }


@app.get("/api/plans")
def list_plans(_=Depends(verify_jwt_token)):
    """List all call plans sorted by creation time descending."""
    sorted_plans = sorted(PLANS_DB.values(), key=lambda p: p.created_at, reverse=True)
    return [plan_to_dict(p) for p in sorted_plans]


@app.get("/api/plans/{plan_id}")
def get_plan(plan_id: str, _=Depends(verify_jwt_token)):
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]
    result = RESULTS_DB.get(plan_id)
    return {"plan": plan_to_dict(plan), "result": result}


@app.post("/api/plans/{plan_id}/approve")
def approve_plan(plan_id: str, req: ApprovePlanRequest, _=Depends(verify_jwt_token)):
    """Approve call plan via Web Dashboard or Telegram callback."""
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]

    if not plan.is_approvable():
        raise HTTPException(
            status_code=400,
            detail=f"Plan is in state '{plan.state.value}', not approvable.",
        )

    # Optional script edit during approval
    if req.script:
        plan.script = req.script

    plan.state = PlanState.APPROVED
    plan.dry_run = False
    plan.approved_by = req.admin_id or "admin_web"
    plan.approved_at = datetime.now(timezone.utc)

    audit_log.append(AuditEntry(
        plan_id=plan.plan_id,
        action="APPROVED",
        agent_type=plan.agent.value,
        admin_id=plan.approved_by,
        reason="Admin approval confirmed",
    ))

    return {"status": "approved", "plan": plan_to_dict(plan)}


@app.post("/api/plans/{plan_id}/dispatch")
def dispatch_plan(plan_id: str, background_tasks: BackgroundTasks, _=Depends(verify_jwt_token)):
    """Dispatches an approved CallPlan to CALL-E."""
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]

    if not plan.is_dispatchable():
        raise HTTPException(
            status_code=400,
            detail=f"Plan cannot be dispatched in state '{plan.state.value}'. Must be APPROVED with dry_run=False.",
        )

    # Run dispatch
    try:
        # Decrypt phone_e164 exactly before dispatch
        if plan.phone_e164:
            plan.phone_e164 = fernet.decrypt(plan.phone_e164.encode()).decode()
        call_result = executor.run(plan)

        # Store result
        RESULTS_DB[plan_id] = {
            "plan_id": call_result.plan_id,
            "outcome": call_result.outcome.value,
            "transcript_ref": call_result.transcript_ref,
            "structured": call_result.structured,
            "completed_at": call_result.completed_at.isoformat(),
        }

        # Audit log dispatch & outcome
        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="DISPATCHED",
            agent_type=plan.agent.value,
            admin_id="system",
            reason=f"Call dispatched to CALL-E (ref: {call_result.transcript_ref})",
        ))

        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="COMPLETED",
            agent_type=plan.agent.value,
            admin_id="system",
            reason=f"Call completed with outcome '{call_result.outcome.value}'",
        ))

        # Scrub PHI phone_e164 post-dispatch
        plan.phone_e164 = ""
        plan.scrubbed_at = datetime.now(timezone.utc)

        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="PHI_SCRUBBED",
            admin_id="system",
            reason="E.164 phone zeroed post-dispatch",
        ))

        return {
            "status": "completed",
            "plan": plan_to_dict(plan),
            "result": RESULTS_DB[plan_id],
        }

    except Exception as e:
        plan.state = PlanState.FAILED
        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="FAILED",
            admin_id="system",
            reason=f"Execution error: {str(e)}",
        ))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/plans/{plan_id}/dismiss")
def dismiss_plan(plan_id: str, _=Depends(verify_jwt_token)):
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]
    plan.state = PlanState.DISMISSED
    audit_log.append(AuditEntry(
        plan_id=plan.plan_id,
        action="DISMISSED",
        admin_id="admin_web",
        reason="Plan dismissed by admin",
    ))
    return {"status": "dismissed", "plan": plan_to_dict(plan)}


@app.get("/api/audit")
def get_audit_log(_=Depends(verify_jwt_token)):
    """Retrieve full audit log entries."""
    entries = audit_log.all()
    return [
        {
            "plan_id": e.plan_id,
            "action": e.action,
            "agent_type": e.agent_type,
            "admin_id": e.admin_id,
            "reason": e.reason,
            "timestamp": e.timestamp.isoformat(),
        }
        for e in entries
    ]


@app.post("/hitl/webhook")
async def telegram_webhook(request: Request):
    """Incoming Telegram Webhook callback endpoint."""
    if not hitl_gate:
        return JSONResponse(content={"ok": False, "reason": "HITL gate disabled"}, status_code=400)

    payload = await request.json()
    logger.info("Telegram Webhook payload received: %s", payload)

    # Process callback query
    callback_query = payload.get("callback_query")
    if callback_query:
        data = callback_query.get("data", "")
        parts = data.split(":")
        if len(parts) >= 2:
            plan_id = parts[0]
            action = parts[1]
            if plan_id in PLANS_DB:
                plan = PLANS_DB[plan_id]
                admin_id = str(callback_query.get("from", {}).get("username", "telegram_admin"))
                if action == "approve":
                    plan.state = PlanState.APPROVED
                    plan.dry_run = False
                    plan.approved_by = admin_id
                    plan.approved_at = datetime.now(timezone.utc)
                    audit_log.append(AuditEntry(
                        plan_id=plan_id,
                        action="APPROVED",
                        admin_id=admin_id,
                        reason="Telegram HITL Callback Approve",
                    ))
                elif action == "dismiss":
                    plan.state = PlanState.DISMISSED
                    audit_log.append(AuditEntry(
                        plan_id=plan_id,
                        action="DISMISSED",
                        admin_id=admin_id,
                        reason="Telegram HITL Callback Dismiss",
                    ))

    return {"ok": True}

@app.get("/api/audit")
def get_audit_logs(token_payload=Depends(verify_jwt_token)):
    role = token_payload.get("role", "admin")
    if role != "admin" and role != "super_admin":
        raise HTTPException(status_code=403, detail="Not authorized to view audit logs")
        
    logs = audit_log.get_logs()
    return {"logs": [log.model_dump() for log in logs]}
