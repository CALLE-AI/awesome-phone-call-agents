from dotenv import load_dotenv
load_dotenv()

import os
from fastapi import FastAPI
from pydantic import BaseModel
from calle_client import plan_call, run_call, wait_for_call_result, CalleError
from webhook import escalate_danger_signs

app = FastAPI()

# --------------------------------------------------------------------------
# SAFETY: dry-run by default, per this repo's CONTRIBUTING.md requirement
# that runnable apps must default to a no-call path and require explicit
# opt-in for live calling. Set DRY_RUN=false in .env only when you intend
# to place a real call.
# --------------------------------------------------------------------------
DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"

# Synthetic test patient created on the public HAPI FHIR server -- see
# create_test_patient.py. Not a real person.
DEMO_PATIENT_ID = os.environ.get("DEMO_PATIENT_ID", "137240223")

DANGER_SIGN_KEYWORDS = {
    "vaginal_bleeding": ["bleeding", "blood"],
    "severe_headache_or_vision_change": ["headache", "blurry vision", "vision change", "blurred vision"],
    "reduced_fetal_movement": ["baby not moving", "less movement", "reduced movement", "not kicking"],
    "swelling_face_or_hands": ["swelling", "swollen"],
    "high_fever": ["fever", "high temperature"],
}


def mask_phone(phone: str) -> str:
    """Mask all but the last 2 digits, per repo safety requirements."""
    if len(phone) <= 4:
        return "*" * len(phone)
    return phone[:2] + "*" * (len(phone) - 4) + phone[-2:]


def extract_danger_signs_from_transcript(transcript: str) -> list[str]:
    if not transcript:
        return []
    lowered = transcript.lower()
    return [key for key, kws in DANGER_SIGN_KEYWORDS.items() if any(k in lowered for k in kws)]


class FollowUpRequest(BaseModel):
    phone: str          # must be E.164, e.g. +15550100XX (use fictional reserved numbers in examples)
    region: str
    patient_first_name: str
    missed_visit_date: str
    language: str = "English"


def build_goal(patient_first_name: str, missed_visit_date: str) -> str:
    return (
        f"This is a follow-up call on behalf of a maternal health clinic for "
        f"{patient_first_name}, who missed a scheduled antenatal visit on "
        f"{missed_visit_date}. Confirm you're speaking with the right person, "
        f"then ask one at a time: any vaginal bleeding, severe headache or "
        f"vision changes, reduced baby movement, swelling in the face or hands, "
        f"or high fever. If any answer is yes, say a health worker will call "
        f"back today -- do not give medical advice. Finally ask if they'd like "
        f"to reschedule their visit. Clearly repeat back each symptom the "
        f"person confirms, using these exact words if positive: bleeding, "
        f"headache, reduced movement, swelling, or fever."
    )


@app.post("/followups")
async def trigger_followup(req: FollowUpRequest):
    goal = build_goal(req.patient_first_name, req.missed_visit_date)

    if DRY_RUN:
        # No CALL-E call is placed. This is the default behavior.
        return {
            "status": "dry_run",
            "would_call": mask_phone(req.phone),
            "region": req.region,
            "goal_preview": goal,
            "note": "DRY_RUN is enabled by default. Set DRY_RUN=false in .env to place a real call.",
        }

    plan = plan_call(phone=req.phone, goal=goal, region=req.region, language=req.language)
    if not plan.get("ready_to_run"):
        return {"status": "needs_more_info", "clarifying_questions": plan.get("clarifying_questions", [])}

    run = run_call(plan_id=plan["plan_id"], confirm_token=plan["confirm_token"])
    return {
        "status": "call_started",
        "run_id": run.get("run_id"),
        "plan_id": plan["plan_id"],
        "called": mask_phone(req.phone),
    }


@app.get("/followups/{run_id}")
async def check_followup(run_id: str):
    if DRY_RUN:
        return {"status": "dry_run", "note": "No live run exists in dry-run mode."}

    try:
        result = wait_for_call_result(run_id, poll_interval_seconds=3, max_wait_seconds=120)
    except CalleError as e:
        return {"status": "still_running_or_error", "detail": str(e)}

    transcript = result.get("result", {}).get("transcript", "")
    danger_signs = extract_danger_signs_from_transcript(transcript)

    escalation_results = []
    if danger_signs:
        escalation_results = await escalate_danger_signs(
            patient_id=DEMO_PATIENT_ID,
            danger_signs=danger_signs,
            call_id=result.get("result", {}).get("call_id", ""),
        )

    return {
        "call_status": result.get("status"),
        "transcript": transcript,
        "danger_signs_detected": danger_signs,
        "cliniqbridge_escalations": escalation_results,
    }