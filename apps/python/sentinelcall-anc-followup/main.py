from dotenv import load_dotenv
load_dotenv()

import os
import re
import secrets
import time
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, field_validator
from calle_client import plan_call, run_call, wait_for_call_result, CalleError
from webhook import escalate_danger_signs

app = FastAPI()

DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"
DEMO_PATIENT_ID = os.environ.get("DEMO_PATIENT_ID", "137240223")

# --------------------------------------------------------------------------
# FIX 1: Authentication + idempotency + consent for the live POST endpoint.
# --------------------------------------------------------------------------
API_KEY = os.environ.get("SENTINELCALL_API_KEY", "")
E164_PATTERN = re.compile(r"^\+[1-9]\d{6,14}$")

# In-memory idempotency store: {idempotency_key: (timestamp, response)}.
# A real deployment should use Redis or a DB with TTL; this is sufficient
# for a demo app and is documented as such.
_seen_requests: dict[str, tuple[float, dict]] = {}
IDEMPOTENCY_WINDOW_SECONDS = 3600

# Tracks which run_ids have already been escalated, so escalation only
# ever fires once per call, regardless of how many times a client polls.
_escalated_runs: set[str] = set()


def require_api_key(x_api_key: str | None):
    if not API_KEY:
        # No key configured -- fine for local dry-run testing, but block
        # any real call from going out unauthenticated.
        if not DRY_RUN:
            raise HTTPException(500, "SENTINELCALL_API_KEY must be set before placing real calls.")
        return
    if x_api_key != API_KEY:
        raise HTTPException(401, "Invalid or missing X-API-Key.")


def mask_phone(phone: str) -> str:
    if len(phone) <= 4:
        return "*" * len(phone)
    return phone[:2] + "*" * (len(phone) - 4) + phone[-2:]


# --------------------------------------------------------------------------
# FIX 2: Speaker- and negation-aware danger-sign extraction.
# The old version substring-matched the ENTIRE transcript, so the bot's own
# question ("any vaginal bleeding?") would false-positive regardless of the
# patient's answer. This version pairs each known bot question with the
# immediately following USER line and only counts it positive if that
# specific answer is affirmative.
# --------------------------------------------------------------------------
QUESTION_TO_SIGN = [
    (re.compile(r"vaginal bleeding", re.I), "vaginal_bleeding"),
    (re.compile(r"headache|vision", re.I), "severe_headache_or_vision_change"),
    (re.compile(r"movement", re.I), "reduced_fetal_movement"),
    (re.compile(r"swelling", re.I), "swelling_face_or_hands"),
    (re.compile(r"fever", re.I), "high_fever"),
]
NEGATIVE_PATTERN = re.compile(r"\b(no|nope|not really|none|never|negative)\b", re.I)
AFFIRMATIVE_PATTERN = re.compile(r"\b(yes|yeah|yep|correct|i do|i have|i am)\b", re.I)


def extract_danger_signs_from_transcript(transcript: str) -> list[str]:
    if not transcript:
        return []

    lines = [l.strip() for l in transcript.splitlines() if l.strip()]
    # Strip leading "[hh:mm:ss] " timestamps if present.
    cleaned = []
    for line in lines:
        line = re.sub(r"^\[\d{2}:\d{2}:\d{2}\]\s*", "", line)
        cleaned.append(line)

    found = []
    for i, line in enumerate(cleaned):
        if not line.upper().startswith("BOT:"):
            continue
        for pattern, sign_key in QUESTION_TO_SIGN:
            if not pattern.search(line):
                continue
            # Find the next USER line after this BOT question.
            for j in range(i + 1, len(cleaned)):
                if cleaned[j].upper().startswith("USER:"):
                    answer = cleaned[j]
                    is_negative = NEGATIVE_PATTERN.search(answer)
                    is_affirmative = AFFIRMATIVE_PATTERN.search(answer)
                    # Only count as positive if affirmative and NOT also
                    # negative (handles "No" appearing before "yes" noise).
                    if is_affirmative and not is_negative:
                        found.append(sign_key)
                    break
    return found


class FollowUpRequest(BaseModel):
    phone: str
    region: str
    patient_first_name: str
    missed_visit_date: str
    language: str = "English"
    consent_confirmed: bool = False  # required True for any live call

    @field_validator("phone")
    @classmethod
    def validate_e164(cls, v):
        if not E164_PATTERN.match(v):
            raise ValueError("phone must be in E.164 format, e.g. +15550100XX")
        return v


def build_goal(patient_first_name: str, missed_visit_date: str) -> str:
    return (
        f"You are an AI voice assistant calling on behalf of a maternal "
        f"health clinic. Say clearly at the start of the call that you are "
        f"an AI assistant, not a human. This is a follow-up for "
        f"{patient_first_name}, who missed a scheduled antenatal visit on "
        f"{missed_visit_date}. Confirm you're speaking with the right "
        f"person, then ask one at a time: any vaginal bleeding, severe "
        f"headache or vision changes, reduced baby movement, swelling in "
        f"the face or hands, or high fever. If any answer is yes, say a "
        f"health worker will call back today -- do not give medical "
        f"advice. Finally ask if they'd like to reschedule their visit."
    )


@app.post("/followups")
async def trigger_followup(
    req: FollowUpRequest,
    x_api_key: str | None = Header(None),
    idempotency_key: str | None = Header(None),
):
    require_api_key(x_api_key)

    if not DRY_RUN:
        if not req.consent_confirmed:
            raise HTTPException(
                400,
                "consent_confirmed must be true to place a real call. "
                "Confirm the recipient has agreed to receive this call before setting DRY_RUN=false.",
            )
        if not idempotency_key:
            raise HTTPException(400, "Idempotency-Key header is required for live calls.")

        now = time.time()
        # Clean expired entries and check for a duplicate request.
        expired = [k for k, (ts, _) in _seen_requests.items() if now - ts > IDEMPOTENCY_WINDOW_SECONDS]
        for k in expired:
            del _seen_requests[k]
        if idempotency_key in _seen_requests:
            return _seen_requests[idempotency_key][1]

    goal = build_goal(req.patient_first_name, req.missed_visit_date)

    if DRY_RUN:
        response = {
            "status": "dry_run",
            "would_call": mask_phone(req.phone),
            "region": req.region,
            "goal_preview": goal,
            "note": "DRY_RUN is enabled by default. Set DRY_RUN=false, provide consent_confirmed=true, and an Idempotency-Key header to place a real call.",
        }
        return response

    plan = plan_call(phone=req.phone, goal=goal, region=req.region, language=req.language)
    if not plan.get("ready_to_run"):
        response = {"status": "needs_more_info", "clarifying_questions": plan.get("clarifying_questions", [])}
        _seen_requests[idempotency_key] = (time.time(), response)
        return response

    run = run_call(plan_id=plan["plan_id"], confirm_token=plan["confirm_token"])
    response = {
        "status": "call_started",
        "run_id": run.get("run_id"),
        "plan_id": plan["plan_id"],
        "called": mask_phone(req.phone),
    }
    _seen_requests[idempotency_key] = (time.time(), response)
    return response


# --------------------------------------------------------------------------
# FIX 3: GET is now read-only. It reports the call status, transcript, and
# a PREVIEW of detected danger signs, but does NOT write to CliniqBridge.
# --------------------------------------------------------------------------
@app.get("/followups/{run_id}")
async def check_followup(run_id: str, x_api_key: str | None = Header(None)):
    require_api_key(x_api_key)

    if DRY_RUN:
        return {"status": "dry_run", "note": "No live run exists in dry-run mode."}

    try:
        result = wait_for_call_result(run_id, poll_interval_seconds=3, max_wait_seconds=120)
    except CalleError as e:
        return {"status": "still_running_or_error", "detail": str(e)}

    transcript = result.get("result", {}).get("transcript", "")
    danger_signs = extract_danger_signs_from_transcript(transcript)

    return {
        "call_status": result.get("status"),
        "danger_signs_detected_preview": danger_signs,
        "already_escalated": run_id in _escalated_runs,
        "note": "This endpoint is read-only. Call POST /followups/{run_id}/escalate to commit an escalation after human review.",
    }


# --------------------------------------------------------------------------
# FIX 3 (cont'd) + FIX 4: Escalation is now an explicit, separate,
# idempotent action -- not a side effect of polling. It requires a human
# to have reviewed the detected signs, and writes the FHIR Observation with
# status "preliminary" (not "final"), since the SNOMED codes used here are
# unverified against an authoritative terminology source (see README).
# --------------------------------------------------------------------------
class EscalationConfirmRequest(BaseModel):
    reviewed_by: str  # name/ID of the human who reviewed the transcript
    confirmed_signs: list[str]  # signs the reviewer confirms are real, from the preview list


@app.post("/followups/{run_id}/escalate")
async def confirm_escalation(
    run_id: str,
    req: EscalationConfirmRequest,
    x_api_key: str | None = Header(None),
):
    require_api_key(x_api_key)

    if run_id in _escalated_runs:
        return {"status": "already_escalated", "run_id": run_id}

    if not req.confirmed_signs:
        raise HTTPException(400, "confirmed_signs must be non-empty -- nothing to escalate.")

    results = await escalate_danger_signs(
        patient_id=DEMO_PATIENT_ID,
        danger_signs=req.confirmed_signs,
        call_id=run_id,
        status="preliminary",  # not "final" -- unverified codes, human-reviewed but not clinically validated
    )
    _escalated_runs.add(run_id)

    return {
        "status": "escalated",
        "run_id": run_id,
        "reviewed_by": req.reviewed_by,
        "escalation_results": results,
    }