from dotenv import load_dotenv
load_dotenv()

import os
import re
import time
import json
import sqlite3
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, field_validator
from calle_client import plan_call, run_call, wait_for_call_result, CalleError
from webhook import escalate_danger_signs, DEMO_FHIR_BASE_URL

app = FastAPI()

DRY_RUN = os.environ.get("DRY_RUN", "true").lower() != "false"
DEMO_PATIENT_ID = os.environ.get("DEMO_PATIENT_ID", "137240223")
API_KEY = os.environ.get("SENTINELCALL_API_KEY", "")
E164_PATTERN = re.compile(r"^\+[1-9]\d{6,14}$")

# --------------------------------------------------------------------------
# FIX (review round 4, point 1): no more silent default to the public
# hapi.fhir.org for real escalations. A real escalation must target an
# EXPLICITLY approved FHIR destination -- the public playground is fine
# for connectivity testing (create_test_patient.py) but must not be where
# clinical Observations land by default, since that server is world-
# readable and unauthenticated.
# --------------------------------------------------------------------------
_allowed_raw = os.environ.get("ALLOWED_FHIR_BASE_URLS", "")
ALLOWED_FHIR_BASE_URLS = {u.strip() for u in _allowed_raw.split(",") if u.strip()}


def require_approved_fhir_destination(fhir_base_url: str):
    if not ALLOWED_FHIR_BASE_URLS:
        raise HTTPException(
            500,
            "ALLOWED_FHIR_BASE_URLS is not configured. No FHIR destination is "
            "approved for real escalation writes -- set this explicitly before "
            "any clinical mutation can occur.",
        )
    if fhir_base_url not in ALLOWED_FHIR_BASE_URLS:
        raise HTTPException(
            403,
            f"'{fhir_base_url}' is not in the explicitly approved FHIR destination "
            f"list. Approved destinations: {sorted(ALLOWED_FHIR_BASE_URLS)}",
        )


# --------------------------------------------------------------------------
# FIX (review round 4, point 3): SQLite-backed durable state, replacing
# the prior in-memory dicts. This survives process restarts -- the
# specific failure mode named in review ("restarts... can lose binding or
# duplicate records"). Stated honestly: a single SQLite file is not a
# distributed-transaction system. For real multi-worker concurrency at
# production scale, a dedicated DB server (Postgres/Redis) is still the
# right next step -- this fixes restart-durability, not horizontal scale.
# --------------------------------------------------------------------------
DB_PATH = os.environ.get("SENTINELCALL_DB_PATH", "sentinelcall_state.sqlite3")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS call_requests (
            idempotency_key TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            ts REAL NOT NULL,
            response TEXT
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS run_to_patient (
            run_id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS escalations (
            run_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            record TEXT
        )
    """)
    conn.commit()
    return conn


def require_api_key(x_api_key: str | None, allow_if_dry_run: bool = False):
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
EMERGENCY_PATTERN = re.compile(r"\b(heavy|severe|a lot|soaking|can'?t see|passed out|fainted)\b", re.I)


def extract_danger_signs_from_transcript(transcript: str) -> tuple[list[str], list[str]]:
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
    patient_date_of_birth: str  # REQUIRED: e.g. "1998-04-12" -- second identifier
    missed_visit_date: str
    patient_id: str
    language: str = "English"
    consent_confirmed: bool = False

    @field_validator("phone")
    @classmethod
    def validate_e164(cls, v):
        if not E164_PATTERN.match(v):
            raise ValueError("phone must be in E.164 format, e.g. +15550100XX")
        return v


def build_goal(patient_first_name: str, patient_date_of_birth: str, missed_visit_date: str) -> str:
    # FIX (review round 4, point 2): identity confirmation now requires
    # TWO identifiers -- first name AND date of birth -- before any
    # clinical or clinic-specific content is disclosed. First-name-only
    # confirmation was correctly flagged as insufficient for maternal
    # health disclosure.
    return (
        f"You are an AI voice assistant. Start by saying you are an AI "
        f"assistant, not a human. Confirm you are speaking with "
        f"{patient_first_name} by asking for their name, AND separately "
        f"confirm their date of birth matches {patient_date_of_birth} -- "
        f"ask for their date of birth as a second identifier, do not state "
        f"it yourself. Do not say anything about a clinic, a missed visit, "
        f"or health topics until BOTH identifiers are confirmed. If either "
        f"does not match, do not reveal any further details; politely end "
        f"the call and report that identity could not be confirmed. "
        f"If both identifiers are confirmed, say you're calling on behalf "
        f"of a maternal health clinic following up on a missed antenatal "
        f"visit on {missed_visit_date}. Ask one at a time: any vaginal "
        f"bleeding, severe headache or vision changes, reduced baby "
        f"movement, swelling in the face or hands, or high fever. "
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

    db = get_db()

    if not DRY_RUN:
        if not req.consent_confirmed:
            raise HTTPException(400, "consent_confirmed must be true to place a real call.")
        if not idempotency_key:
            raise HTTPException(400, "Idempotency-Key header is required for live calls.")

        now = time.time()
        db.execute("DELETE FROM call_requests WHERE ts < ?", (now - 3600,))
        db.commit()

        row = db.execute(
            "SELECT status, response FROM call_requests WHERE idempotency_key = ?",
            (idempotency_key,),
        ).fetchone()
        if row:
            status, response_json = row
            if status == "pending":
                raise HTTPException(409, "A request with this Idempotency-Key is already in flight.")
            return json.loads(response_json)

        db.execute(
            "INSERT INTO call_requests (idempotency_key, status, ts, response) VALUES (?, 'pending', ?, NULL)",
            (idempotency_key, now),
        )
        db.commit()

    goal = build_goal(req.patient_first_name, req.patient_date_of_birth, req.missed_visit_date)

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
            run_id = run.get("run_id")
            if run_id:
                db.execute(
                    "INSERT OR REPLACE INTO run_to_patient (run_id, patient_id) VALUES (?, ?)",
                    (run_id, req.patient_id),
                )
                db.commit()
            response = {
                "status": "call_started",
                "run_id": run_id,
                "plan_id": plan["plan_id"],
                "called": mask_phone(req.phone),
            }
        db.execute(
            "UPDATE call_requests SET status = 'done', response = ? WHERE idempotency_key = ?",
            (json.dumps(response), idempotency_key),
        )
        db.commit()
        return response
    except Exception:
        db.execute(
            "UPDATE call_requests SET status = 'done', response = ? WHERE idempotency_key = ?",
            (json.dumps({"status": "error_uncertain_outcome"}), idempotency_key),
        )
        db.commit()
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

    db = get_db()
    row = db.execute("SELECT status FROM escalations WHERE run_id = ?", (run_id,)).fetchone()
    already_escalated = bool(row)

    return {
        "call_status": result.get("status"),
        "danger_signs_detected_preview": danger_signs,
        "urgent_signs_preview": urgent_signs,
        "already_escalated": already_escalated,
        "note": "Read-only. Use POST /followups/{run_id}/escalate to commit, after human review.",
    }


class EscalationConfirmRequest(BaseModel):
    reviewed_by: str
    confirmed_signs: list[str]
    fhir_base_url: str  # REQUIRED: must be in ALLOWED_FHIR_BASE_URLS


@app.post("/followups/{run_id}/escalate")
async def confirm_escalation(
    run_id: str,
    req: EscalationConfirmRequest,
    x_api_key: str | None = Header(None),
):
    require_api_key(x_api_key)
    require_approved_fhir_destination(req.fhir_base_url)

    db = get_db()

    existing = db.execute("SELECT status, record FROM escalations WHERE run_id = ?", (run_id,)).fetchone()
    if existing:
        status, record_json = existing
        return {"status": status, "run_id": run_id, "record": json.loads(record_json) if record_json else None}

    patient_row = db.execute("SELECT patient_id FROM run_to_patient WHERE run_id = ?", (run_id,)).fetchone()
    if not patient_row:
        raise HTTPException(
            409,
            f"No patient binding found for run {run_id}. Escalation requires a "
            f"call that was created through this app's /followups endpoint.",
        )
    bound_patient_id = patient_row[0]

    try:
        result = wait_for_call_result(run_id, poll_interval_seconds=3, max_wait_seconds=30)
    except CalleError as e:
        raise HTTPException(404, f"Could not verify run {run_id}: {e}")

    if result.get("status") != "COMPLETED":
        raise HTTPException(409, f"Run {run_id} is not in a COMPLETED state; cannot escalate.")

    transcript = result.get("result", {}).get("transcript", "")
    actual_signs, actual_urgent = extract_danger_signs_from_transcript(transcript)
    actual_signs_set = set(actual_signs)

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

    # Reserve BEFORE the external write, durable this time -- a SQLite row,
    # not a dict that vanishes on restart.
    db.execute(
        "INSERT INTO escalations (run_id, status, record) VALUES (?, 'pending', ?)",
        (run_id, json.dumps({"reviewed_by": req.reviewed_by, "confirmed_signs": deduped_signs})),
    )
    db.commit()

    results = await escalate_danger_signs(
        patient_id=bound_patient_id,
        danger_signs=deduped_signs,
        call_id=result.get("result", {}).get("call_id", run_id),
        status="preliminary",
        fhir_base_url=req.fhir_base_url,
    )

    record = {
        "reviewed_by": req.reviewed_by,
        "confirmed_signs": deduped_signs,
        "patient_id": bound_patient_id,
        "fhir_base_url": req.fhir_base_url,
        "urgent_at_call_time": actual_urgent,
        "escalation_results": results,
    }
    db.execute(
        "UPDATE escalations SET status = 'done', record = ? WHERE run_id = ?",
        (json.dumps(record), run_id),
    )
    db.commit()

    return {"status": "escalated", "run_id": run_id, **record}