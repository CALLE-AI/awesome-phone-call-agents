from dotenv import load_dotenv
load_dotenv()

import os
import re
import time
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, field_validator
from calle_client import plan_call, run_call, wait_for_call_result, CalleError
from webhook import escalate_danger_signs

app = FastAPI()

DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"
DEMO_PATIENT_ID = os.environ.get("DEMO_PATIENT_ID", "137240223")
API_KEY = os.environ.get("SENTINELCALL_API_KEY", "")
E164_PATTERN = re.compile(r"^\+[1-9]\d{6,14}$")

# --------------------------------------------------------------------------
# KNOWN, STATED LIMITATION (not silently hidden): this is a single-process,
# in-memory store. It does not solve cross-worker races or survive a
# restart. A production deployment needs a real datastore (Redis/DB) with
# atomic reserve-then-confirm semantics. This demo fixes the *ordering*
# bug (reserving before the external call, not after) but does not claim
# to be safe under multi-worker concurrency.
# --------------------------------------------------------------------------
_call_requests: dict[str, dict] = {}  # idempotency_key -> {"status": "pending"|"done", "ts": float, "response": dict|None}
_escalated_runs: dict[str, dict] = {}  # run_id -> escalation record
IDEMPOTENCY_WINDOW_SECONDS = 3600


def require_api_key(x_api_key: str | None, allow_if_dry_run: bool = False):
    """
    allow_if_dry_run: only relevant to endpoints that themselves check
    DRY_RUN before doing anything real. The /escalate endpoint MUST NOT
    pass allow_if_dry_run=True, because escalation performs a real FHIR
    write regardless of the app's DRY_RUN setting -- that was the bug
    flagged in review: DRY_RUN gated call-placing but never gated
    escalation, so escalation was reachable unauthenticated whenever no
    key was configured.
    """
    if not API_KEY:
        if allow_if_dry_run and DRY_RUN:
            return
        raise HTTPException(
            500,
            "SENTINELCALL_API_KEY must be set. This endpoint performs a real "
            "action (a call or a clinical data write) and cannot run unauthenticated.",
        )
    if x_api_key != API_KEY:
        raise HTTPException(401, "Invalid or missing X-API-Key.")


def mask_phone(phone: str) -> str:
    if len(phone) <= 4:
        return "*" * len(phone)
    return phone[:2] + "*" * (len(phone) - 4) + phone[-2:]


# --------------------------------------------------------------------------
# Speaker- and negation-aware extraction, round 2: broader negation
# coverage. "Yes, I do not have bleeding" previously slipped through
# because only whole-word "no/nope/none/never/negative/not really" were
# checked. Now also catches "not", "n't", "don't", "doesn't", "didn't",
# "isn't", "haven't", "without".
# --------------------------------------------------------------------------
QUESTION_TO_SIGN = [
    (re.compile(r"vaginal bleeding", re.I), "vaginal_bleeding"),
    (re.compile(r"headache|vision", re.I), "severe_headache_or_vision_change"),
    (re.compile(r"movement", re.I), "reduced_fetal_movement"),
    (re.compile(r"swelling", re.I), "swelling_face_or_hands"),
    (re.compile(r"fever", re.I), "high_fever"),
]
NEGATIVE_PATTERN = re.compile(
    r"\b(no|nope|none|never|negative|not|n't|don'?t|doesn'?t|didn'?t|isn'?t|haven'?t|without)\b",
    re.I,
)
AFFIRMATIVE_PATTERN = re.compile(r"\b(yes|yeah|yep|correct|i do|i have|i am)\b", re.I)

# A blunt, deliberately conservative emergency keyword set. If matched
# alongside an affirmative bleeding/headache answer, this is flagged
# separately as urgent -- distinct from the routine "call back today"
# framing, because that framing is not safe for a genuinely acute symptom.
EMERGENCY_PATTERN = re.compile(r"\b(heavy|severe|a lot|soaking|can'?t see|passed out|fainted)\b", re.I)


def extract_danger_signs_from_transcript(transcript: str) -> tuple[list[str], list[str]]:
    """Returns (danger_signs, urgent_signs). urgent_signs is a subset."""
    if not transcript:
        return [], []

    lines = [re.sub(r"^\[\d{2}:\d{2}:\d{2}\]\s*", "", l.strip()) for l in transcript.splitlines() if l.strip()]

    found, urgent = [], []
    for i, line in enumerate(lines):
        if not line.upper().startswith("BOT:"):
            continue
        for pattern, sign_key in QUESTION_TO_SIGN:
            if not pattern.search(line):
                continue
            for j in range(i + 1, len(lines)):
                if lines[j].upper().startswith("USER:"):
                    answer = lines[j]
                    is_negative = NEGATIVE_PATTERN.search(answer)
                    is_affirmative = AFFIRMATIVE_PATTERN.search(answer)
                    if is_affirmative and not is_negative:
                        found.append(sign_key)
                        if EMERGENCY_PATTERN.search(answer):
                            urgent.append(sign_key)
                    break
    return found, urgent


class FollowUpRequest(BaseModel):
    phone: str
    region: str
    patient_first_name: str
    missed_visit_date: str
    language: str = "English"
    consent_confirmed: bool = False

    @field_validator("phone")
    @classmethod
    def validate_e164(cls, v):
        if not E164_PATTERN.match(v):
            raise ValueError("phone must be in E.164 format, e.g. +15550100XX")
        return v


def build_goal(patient_first_name: str, missed_visit_date: str) -> str:
    # FIX (review round 2, point 4): identity is now verified BEFORE any
    # clinic-specific or clinical context is revealed. Also adds an
    # explicit emergency branch: severe/heavy symptoms get told to seek
    # care immediately, not "call back today."
    return (
        f"You are an AI voice assistant. Start by saying you are an AI "
        f"assistant, not a human, and ask to confirm you are speaking with "
        f"{patient_first_name} -- do not say anything about a clinic, a "
        f"missed visit, or health topics until identity is confirmed. If "
        f"the person says they are not {patient_first_name}, do not reveal "
        f"any further details; politely end the call and report that "
        f"{patient_first_name} was not reached. "
        f"If identity is confirmed, say you're calling on behalf of a "
        f"maternal health clinic following up on a missed antenatal visit "
        f"on {missed_visit_date}. Ask one at a time: any vaginal bleeding, "
        f"severe headache or vision changes, reduced baby movement, "
        f"swelling in the face or hands, or high fever. "
        f"If the person describes a symptom as heavy, severe, soaking, "
        f"loss of vision, or fainting, do NOT say a health worker will "
        f"call back today -- instead say this sounds urgent and they "
        f"should seek emergency medical care right now or call local "
        f"emergency services, and end the call promptly. "
        f"For any other yes answer, say a health worker will call back "
        f"today. Do not give medical advice yourself. Finally ask if "
        f"they'd like to reschedule their visit."
    )


@app.post("/followups")
async def trigger_followup(
    req: FollowUpRequest,
    x_api_key: str | None = Header(None),
    idempotency_key: str | None = Header(None),
):
    require_api_key(x_api_key, allow_if_dry_run=True)

    if not DRY_RUN:
        if not req.consent_confirmed:
            raise HTTPException(400, "consent_confirmed must be true to place a real call.")
        if not idempotency_key:
            raise HTTPException(400, "Idempotency-Key header is required for live calls.")

        now = time.time()
        expired = [k for k, v in _call_requests.items() if now - v["ts"] > IDEMPOTENCY_WINDOW_SECONDS]
        for k in expired:
            del _call_requests[k]

        existing = _call_requests.get(idempotency_key)
        if existing:
            if existing["status"] == "pending":
                raise HTTPException(409, "A request with this Idempotency-Key is already in flight.")
            return existing["response"]

        # FIX (review round 2, point 2): reserve the key as "pending"
        # BEFORE calling run_call, not after. Previously a lost/ambiguous
        # response from run_call could result in a retry placing a second
        # real call, because nothing was recorded until after a response
        # was received.
        _call_requests[idempotency_key] = {"status": "pending", "ts": now, "response": None}

    goal = build_goal(req.patient_first_name, req.missed_visit_date)

    if DRY_RUN:
        return {
            "status": "dry_run",
            "would_call": mask_phone(req.phone),
            "region": req.region,
            "goal_preview": goal,
        }

    try:
        plan = plan_call(phone=req.phone, goal=goal, region=req.region, language=req.language)
        if not plan.get("ready_to_run"):
            response = {"status": "needs_more_info", "clarifying_questions": plan.get("clarifying_questions", [])}
        else:
            run = run_call(plan_id=plan["plan_id"], confirm_token=plan["confirm_token"])
            response = {
                "status": "call_started",
                "run_id": run.get("run_id"),
                "plan_id": plan["plan_id"],
                "called": mask_phone(req.phone),
            }
        _call_requests[idempotency_key] = {"status": "done", "ts": time.time(), "response": response}
        return response
    except Exception:
        # Do not leave the key stuck as "pending" forever on failure --
        # mark it failed explicitly so a human can check before any
        # automatic retry, rather than silently clearing it.
        _call_requests[idempotency_key] = {"status": "done", "ts": time.time(), "response": {"status": "error_uncertain_outcome"}}
        raise


@app.get("/followups/{run_id}")
async def check_followup(run_id: str, x_api_key: str | None = Header(None)):
    require_api_key(x_api_key, allow_if_dry_run=True)

    if DRY_RUN:
        return {"status": "dry_run"}

    try:
        result = wait_for_call_result(run_id, poll_interval_seconds=3, max_wait_seconds=120)
    except CalleError as e:
        return {"status": "still_running_or_error", "detail": str(e)}

    transcript = result.get("result", {}).get("transcript", "")
    danger_signs, urgent_signs = extract_danger_signs_from_transcript(transcript)

    return {
        "call_status": result.get("status"),
        "danger_signs_detected_preview": danger_signs,
        "urgent_signs_preview": urgent_signs,
        "already_escalated": run_id in _escalated_runs,
        "note": "Read-only. Use POST /followups/{run_id}/escalate to commit, after human review.",
    }


class EscalationConfirmRequest(BaseModel):
    reviewed_by: str
    confirmed_signs: list[str]


@app.post("/followups/{run_id}/escalate")
async def confirm_escalation(
    run_id: str,
    req: EscalationConfirmRequest,
    x_api_key: str | None = Header(None),
):
    # FIX (review round 2, point 1 -- the critical one): escalation is a
    # real, unconditional FHIR write. It must ALWAYS require a real key,
    # regardless of the app's DRY_RUN setting. allow_if_dry_run is
    # deliberately NOT passed here.
    require_api_key(x_api_key)

    if run_id in _escalated_runs:
        return {"status": "already_escalated", "run_id": run_id, "record": _escalated_runs[run_id]}

    # FIX (review round 2, point 3): escalation must be bound to the
    # actual run -- re-fetch the real result and recompute the preview
    # ourselves, rather than trusting arbitrary client-supplied signs for
    # an arbitrary run_id.
    try:
        result = wait_for_call_result(run_id, poll_interval_seconds=3, max_wait_seconds=30)
    except CalleError as e:
        raise HTTPException(404, f"Could not verify run {run_id}: {e}")

    if result.get("status") != "COMPLETED":
        raise HTTPException(409, f"Run {run_id} is not in a COMPLETED state; cannot escalate.")

    transcript = result.get("result", {}).get("transcript", "")
    actual_signs, actual_urgent = extract_danger_signs_from_transcript(transcript)
    actual_signs_set = set(actual_signs)

    # Confirmed signs must be a subset of what's actually verifiable from
    # this run's real transcript -- the reviewer cannot invent findings.
    invalid = set(req.confirmed_signs) - actual_signs_set
    if invalid:
        raise HTTPException(
            400,
            f"confirmed_signs {sorted(invalid)} are not present in this run's actual transcript "
            f"({sorted(actual_signs_set)}). Escalation must match verified evidence.",
        )
    if not req.confirmed_signs:
        raise HTTPException(400, "confirmed_signs must be non-empty.")

    deduped_signs = sorted(set(req.confirmed_signs))

    results = await escalate_danger_signs(
        patient_id=DEMO_PATIENT_ID,
        danger_signs=deduped_signs,
        call_id=result.get("result", {}).get("call_id", run_id),
        status="preliminary",
    )

    record = {
        "reviewed_by": req.reviewed_by,
        "confirmed_signs": deduped_signs,
        "urgent_at_call_time": actual_urgent,
        "escalation_results": results,
    }
    _escalated_runs[run_id] = record

    return {"status": "escalated", "run_id": run_id, **record}