"""
FastAPI Server for Clinical Phone Operations
"""
from __future__ import annotations
import re
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Request, Header, Depends, Security
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field

from .config import config
from .phone import mask_phone
from .adapters.calle_adapter import calle_adapter
from .adapters.ehr_adapter import ehr_adapter
from .domain.dispositions import evaluate_confirmation_disposition
from .domain.models import AppointmentStatus

app = FastAPI(
    title="Bytelytic Clinic OS — Autonomous Healthcare Phone Desk",
    description="Bounded-prototype CALL-E integration demonstrating autonomous healthcare phone workflows.",
    version="1.2.0",
)

API_KEY_HEADER = APIKeyHeader(name="X-API-Key", auto_error=False)


def verify_api_key(
    x_api_key: Optional[str] = Security(API_KEY_HEADER),
    authorization: Optional[str] = Header(None),
) -> str:
    token = x_api_key
    if not token and authorization:
        if authorization.startswith("Bearer "):
            token = authorization[7:].strip()
        else:
            token = authorization.strip()

    if not token or token != config.app_api_key:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: Valid X-API-Key or Authorization header is required.",
        )
    return token


class ConfirmationRequest(BaseModel):
    phone_number: str = Field(default="+15550192834")
    patient_name: str = Field(default="Jane Doe")
    appointment_time: str = Field(default="Tomorrow at 10:30 AM")
    appointment_id: Optional[str] = Field(default="apt-101")


class NoShowRequest(BaseModel):
    phone_number: str = Field(default="+15550192834")
    patient_name: str = Field(default="Jane Doe")
    missed_appointment_time: str = Field(default="Today at 9:00 AM")


class PriorAuthRequest(BaseModel):
    payor_phone: str = Field(default="1-800-676-2583")
    payor_name: str = Field(default="Blue Cross Blue Shield")
    cpt_code: str = Field(default="99213")
    member_id_masked: str = Field(default="MBR-***-8492")


ALLOWED_RESULT_KEYS = {
    "status",
    "task_completed",
    "recipient_masked",
    "completion_confidence",
    "evidence",
    "structured_result",
    "dry_run",
    "created_at",
}


PHONE_PATTERN = re.compile(
    r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\+[1-9]\d{6,14})(?!\d)"
)


def scrub_phone_text(text: str) -> str:
    """Masks any phone number found in arbitrary text for boundary safety."""
    if not text:
        return text
    return PHONE_PATTERN.sub(lambda m: mask_phone(m.group(0)), text)


def deep_mask_phones(obj: Any) -> Any:
    """Recursively walks dictionaries, lists, and strings to mask any phone text."""
    if isinstance(obj, str):
        return scrub_phone_text(obj)
    if isinstance(obj, dict):
        return {k: deep_mask_phones(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_mask_phones(item) for item in obj]
    return obj


def sanitize_call_result(res: Any) -> Dict[str, Any]:
    """
    Sanitizes raw CALL-E execution results by enforcing an explicit key allowlist,
    omitting raw unparsed provider objects, and deeply masking phone text across
    all nested response boundaries (including structured_result and evidence).
    """
    if not isinstance(res, dict):
        status_val = getattr(res, "status", None)
        return {"status": scrub_phone_text(str(status_val)) if status_val is not None else "completed"}

    sanitized = {k: res[k] for k in ALLOWED_RESULT_KEYS if k in res}

    if "recipient" in res and "recipient_masked" not in sanitized:
        sanitized["recipient_masked"] = mask_phone(str(res["recipient"]))

    # Deeply scrub phone text across all nested structures (evidence, structured_result, etc.)
    return deep_mask_phones(sanitized)


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "bytelytic-clinic-os",
        "calle_mode": "dry_run" if config.dry_run else "live",
        "auth_required": True,
    }


@app.post("/calls/confirmation")
def dispatch_confirmation(req: ConfirmationRequest, _auth: str = Depends(verify_api_key)):
    try:
        res = calle_adapter.dispatch_confirmation_call(
            phone=req.phone_number,
            patient_name=req.patient_name,
            appointment_time=req.appointment_time,
            idempotency_key=req.appointment_id,
        )
        return {
            "success": True,
            "recipient": res.get("recipient_masked") or mask_phone(req.phone_number),
            "call_result": sanitize_call_result(res),
        }
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/calls/no-show")
def dispatch_noshow(req: NoShowRequest, _auth: str = Depends(verify_api_key)):
    try:
        res = calle_adapter.dispatch_noshow_recovery_call(
            phone=req.phone_number,
            patient_name=req.patient_name,
            missed_time=req.missed_appointment_time,
        )
        return {
            "success": True,
            "recipient": res.get("recipient_masked") or mask_phone(req.phone_number),
            "call_result": sanitize_call_result(res),
        }
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/calls/prior-auth")
def dispatch_prior_auth(req: PriorAuthRequest, _auth: str = Depends(verify_api_key)):
    try:
        res = calle_adapter.dispatch_prior_auth_call(
            payor_phone=req.payor_phone,
            payor_name=req.payor_name,
            cpt_code=req.cpt_code,
            member_id_masked=req.member_id_masked,
        )
        return {
            "success": True,
            "payor": req.payor_name,
            "recipient": res.get("recipient_masked") or mask_phone(req.payor_phone),
            "call_result": sanitize_call_result(res),
        }
    except (ValueError, PermissionError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/calle/webhook")
async def handle_calle_webhook(request: Request, _auth: str = Depends(verify_api_key)):
    payload = await request.json()
    structured = payload.get("structured_result", {})
    operator_confirmed = payload.get("operator_reviewed", False)
    appointment_id = payload.get("appointment_id", "apt-101")

    new_status, req_review = evaluate_confirmation_disposition(structured, operator_confirmed)
    
    if req_review:
        stage = ehr_adapter.stage_status_update(appointment_id, new_status, str(structured))
        return {
            "received": True,
            "operator_review_required": True,
            "ehr_mutation_gated": True,
            "staged_entry": stage,
        }
    
    apt = ehr_adapter.apply_operator_approval(appointment_id, new_status, "receptionist_operator")
    return {
        "received": True,
        "operator_review_required": False,
        "ehr_mutation_gated": False,
        "appointment_status": apt.status.value,
    }
