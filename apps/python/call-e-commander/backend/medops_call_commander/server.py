import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from cryptography.fernet import Fernet
from medops_call_commander.auth import verify_jwt_token, verify_clinical_admin_role

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, field_validator

from medops_call_commander.adapters.fhir import FHIRAdapter
from medops_call_commander.adapters.opendental import OpenDentalAdapter
from medops_call_commander.audit.log import AuditLog
from medops_call_commander.core.enums import ConsentStatus, PlanState
from medops_call_commander.core.exceptions import (
    ConsentDenied,
    MedOpsBaseException,
    UnroutableEvent,
)
from medops_call_commander.core.models import AuditEntry, CallPlan, EHREvent
from medops_call_commander.executor.executor import CallExecutor
from medops_call_commander.gates.consent import ConsentGate
from medops_call_commander.gates.hitl import HITLGate
from medops_call_commander.providers.calle_mcp import CalleMcpProvider
from medops_call_commander.supervisor.router import route

load_dotenv()

_BYPASS_AT_BOOT = os.environ.get("MEDOPS_BYPASS_AUTH", "").lower() in ("1", "true", "yes", "on")
if _BYPASS_AT_BOOT and os.environ.get("CALLE_MOCK_MODE", "").lower() not in ("1", "true", "yes", "on"):
    os.environ["CALLE_MOCK_MODE"] = "1"

ENCRYPTION_KEY = os.environ.get("MEDOPS_ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    ENCRYPTION_KEY = Fernet.generate_key().decode()
fernet = Fernet(ENCRYPTION_KEY)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medops_server")

E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
_PHONE_LIKE_PATTERN = re.compile(r"\+?\d[\d\-\s()]{7,}\d")


def _mask_phone_in_text(text: Optional[str]) -> Optional[str]:
    """Strips anything that looks like a phone number from outward-facing text."""
    if not text:
        return text
    return _PHONE_LIKE_PATTERN.sub("[REDACTED-PHONE]", text)


app = FastAPI(
    title="MedOps Call Commander",
    description="Multi-agent HITL Phone Call Orchestration for Medical Practice Operations",
    version="1.0.0",
)

allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
allowed_origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()] if allowed_origins_env else [
    "https://gen-lang-client-0574518291.web.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

audit_log = AuditLog()
_provider = None if os.environ.get("MEDOPS_TEST_MODE") == "1" else CalleMcpProvider()
executor = CallExecutor(_provider)

hitl_gate: Optional[HITLGate] = None
if os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_ADMIN_CHAT_ID") and os.environ.get("HITL_SIGNING_SECRET"):
    try:
        hitl_gate = HITLGate(audit_log=audit_log)
        logger.info("HITL Telegram Gate initialized.")
    except Exception as e:
        logger.warning("HITL Telegram Gate initialization skipped: %s", e)


def _load_consent_source():
    """
    Returns the active EHR adapter to back the ConsentGate.

    MEDOPS_TEST_MODE=1 bypasses this for unit/integration tests only.
    MEDOPS_BYPASS_AUTH also short-circuits consent, but ONLY ever grants
    consent for calls that are themselves forced into CALL-E mock mode
    (enforced above at boot) — so bypass mode can never touch a real
    patient record or place a real call.
    """
    if os.environ.get("MEDOPS_TEST_MODE") == "1":
        class _UnconfiguredStub:
            def get_consent_status(self, patient_id: str, call_type: str) -> str:
                raise RuntimeError("Test stub: consent_gate._source was not replaced by conftest.py")
        return _UnconfiguredStub()

    if _BYPASS_AT_BOOT:
        class _BypassConsent:
            def get_consent_status(self, patient_id: str, call_type: str) -> str:
                return "GRANTED"
        logger.warning(
            "ConsentGate: MEDOPS_BYPASS_AUTH is active. Bypassing EHR consent checks. "
            "CALLE_MOCK_MODE has been force-enabled, so no live call or real record "
            "access can occur while this is set."
        )
        return _BypassConsent()

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

PLANS_DB: Dict[str, CallPlan] = {}
RESULTS_DB: Dict[str, Any] = {}


class TriggerEventRequest(BaseModel):
    event_type: str
    patient_id: str
    patient_phone: str
    priority: Optional[str] = "routine"
    source_system: Optional[str] = "opendental"
    context: Optional[Dict[str, Any]] = None

    @field_validator("patient_phone")
    @classmethod
    def _validate_e164(cls, v: str) -> str:
        if not v.isascii() or not E164_PATTERN.match(v):
            raise ValueError(
                "patient_phone must be a strict ASCII E.164 number, e.g. +12125550100 "
                "(no letters, unicode digits, spaces, or punctuation)."
            )
        return v


class ApprovePlanRequest(BaseModel):
    script: Optional[str] = None
    admin_id: Optional[str] = "admin_web"


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


@app.get("/")
def index_page():
    return {"status": "MedOps Call Commander API Running"}

@app.post("/api/events/trigger")
def trigger_event(req: TriggerEventRequest, auth_payload: dict = Depends(verify_clinical_admin_role)):
    """
    Receives an EHR event payload, routes to the appropriate agent, checks patient consent,
    generates a CallPlan in PENDING_APPROVAL, and notifies HITL admin.
    Requires bounded clinical admin authorization.
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
        plan = route(event)
        consent_gate.check(event.patient_id, plan.agent.value)

        plan.state = PlanState.PENDING_APPROVAL
        plan.phone_e164 = fernet.encrypt(plan.phone_e164.encode()).decode()
        PLANS_DB[plan.plan_id] = plan

        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="CREATED",
            agent_type=plan.agent.value,
            admin_id=auth_payload.get("uid", "system"),
            reason=f"Event '{event.event_type}' routed to agent '{plan.agent.value}'",
        ))

        if hitl_gate:
            try:
                hitl_gate.notify(plan)
            except Exception as e:
                logger.warning("Telegram notification failed: %s", _mask_phone_in_text(str(e)))

        return {"status": "success", "plan": plan_to_dict(plan)}

    except ConsentDenied as e:
        logger.warning("Consent blocked call creation for patient %s", req.patient_id)
        audit_log.append(AuditEntry(
            plan_id="N/A",
            action="BLOCKED_CONSENT_DENIED",
            admin_id=auth_payload.get("uid", "system"),
            reason=f"Consent denied for patient {req.patient_id}",
        ))
        raise HTTPException(status_code=403, detail=_mask_phone_in_text(str(e)))

    except UnroutableEvent as e:
        raise HTTPException(status_code=400, detail=_mask_phone_in_text(str(e)))
    except MedOpsBaseException as e:
        raise HTTPException(status_code=500, detail=_mask_phone_in_text(str(e)))


@app.get("/api/config")
def get_config(_=Depends(verify_jwt_token)):
    """Returns non-sensitive dashboard configuration."""
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
    return {"plans": [plan_to_dict(p) for p in sorted_plans]}


@app.get("/api/plans/{plan_id}")
def get_plan(plan_id: str, _=Depends(verify_jwt_token)):
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]
    result = RESULTS_DB.get(plan_id)
    return {"plan": plan_to_dict(plan), "result": result}


@app.post("/api/plans/{plan_id}/approve")
def approve_plan(plan_id: str, req: ApprovePlanRequest, auth_payload: dict = Depends(verify_clinical_admin_role)):
    """Approve call plan via Web Dashboard or Telegram callback. Requires clinical admin role."""
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]

    if not plan.is_approvable():
        raise HTTPException(
            status_code=400,
            detail=f"Plan is in state '{plan.state.value}', not approvable.",
        )

    if req.script:
        plan.script = req.script

    plan.state = PlanState.APPROVED
    plan.dry_run = False
    plan.approved_by = req.admin_id if (req.admin_id and req.admin_id != "admin_web") else auth_payload.get("uid", "admin_web")
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
def dispatch_plan(plan_id: str, background_tasks: BackgroundTasks, auth_payload: dict = Depends(verify_clinical_admin_role)):
    """
    Dispatches an approved CallPlan to CALL-E. Requires clinical admin role.

    Note on failure semantics: if the executor cannot confirm a result after
    exhausting its polling window, that means the outcome is UNKNOWN, not
    that the call itself is proven to have failed — the call may still be
    active or may have already completed on CALL-E's side.
    """
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]

    if not plan.is_dispatchable():
        raise HTTPException(
            status_code=400,
            detail=f"Plan cannot be dispatched in state '{plan.state.value}'. Must be APPROVED with dry_run=False.",
        )

    try:
        if plan.phone_e164:
            plan.phone_e164 = fernet.decrypt(plan.phone_e164.encode()).decode()
        call_result = executor.run(plan)

        RESULTS_DB[plan_id] = {
            "plan_id": call_result.plan_id,
            "outcome": call_result.outcome.value,
            "transcript_ref": call_result.transcript_ref,
            "structured": call_result.structured,
            "completed_at": call_result.completed_at.isoformat(),
        }

        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="DISPATCHED",
            agent_type=plan.agent.value,
            admin_id=auth_payload.get("uid", "system"),
            reason=f"Call dispatched to CALL-E (ref: {call_result.transcript_ref})",
        ))

        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="COMPLETED",
            agent_type=plan.agent.value,
            admin_id=auth_payload.get("uid", "system"),
            reason=f"Call completed with outcome '{call_result.outcome.value}'",
        ))

        plan.phone_e164 = ""
        plan.scrubbed_at = datetime.now(timezone.utc)

        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="PHI_SCRUBBED",
            admin_id=auth_payload.get("uid", "system"),
            reason="E.164 phone zeroed post-dispatch",
        ))

        return {
            "status": "completed",
            "plan": plan_to_dict(plan),
            "result": RESULTS_DB[plan_id],
        }

    except Exception as e:
        plan.state = PlanState.FAILED
        safe_detail = _mask_phone_in_text(str(e))
        audit_log.append(AuditEntry(
            plan_id=plan.plan_id,
            action="FAILED",
            admin_id=auth_payload.get("uid", "system"),
            reason=f"Execution could not be confirmed (outcome unknown): {safe_detail}",
        ))
        raise HTTPException(
            status_code=500,
            detail=f"Could not confirm call outcome (treated as unresolved, not a confirmed failure): {safe_detail}",
        )


@app.post("/api/plans/{plan_id}/dismiss")
def dismiss_plan(plan_id: str, auth_payload: dict = Depends(verify_clinical_admin_role)):
    """
    Dismisses a pending call plan. Requires clinical admin role.

    This only cancels our own PENDING_APPROVAL record. If the plan has
    already been dispatched to CALL-E, dismissing it here does NOT cancel
    the provider-side call; use the explicit cancel path for that.
    """
    if plan_id not in PLANS_DB:
        raise HTTPException(status_code=404, detail="Plan not found")
    plan = PLANS_DB[plan_id]
    if plan.state not in (PlanState.CREATED, PlanState.QUEUED, PlanState.PENDING_APPROVAL, PlanState.APPROVED):
        raise HTTPException(
            status_code=400,
            detail=f"Plan is in state '{plan.state.value}'; dismiss only cancels pre-dispatch plans and cannot stop a call already sent to CALL-E.",
        )
    plan.state = PlanState.DISMISSED
    admin_id = auth_payload.get("uid", "admin_web")
    audit_log.append(AuditEntry(
        plan_id=plan.plan_id,
        action="DISMISSED",
        admin_id=admin_id,
        reason="Plan dismissed pre-dispatch by authorized admin; CALL-E was never contacted",
    ))
    return {"status": "dismissed", "plan": plan_to_dict(plan)}


@app.get("/api/audit")
def get_audit_log(auth_payload: dict = Depends(verify_clinical_admin_role)):
    """Retrieve full audit log entries for authorized clinical admins."""
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

    secret = os.environ.get("HITL_SIGNING_SECRET") or os.environ.get("TELEGRAM_WEBHOOK_SECRET")
    if secret:
        header_token = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
        if not header_token or header_token != secret:
            logger.warning("Unauthorized Telegram Webhook attempt with invalid/missing secret token.")
            return JSONResponse(content={"ok": False, "reason": "Unauthorized webhook signature"}, status_code=401)

    payload = await request.json()
    logger.info("Telegram Webhook callback received (plan/action only, no PHI logged).")

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
                        reason="Telegram HITL Callback Dismiss (pre-dispatch only)",
                    ))

    return {"ok": True}
