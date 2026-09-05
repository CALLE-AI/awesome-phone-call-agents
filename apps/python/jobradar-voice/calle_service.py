import hashlib
import json
import os
import sqlite3
import time
from typing import Any

import httpx
from dotenv import load_dotenv

from live_result_parser import parse_hiring_result
from safety import is_valid_e164

load_dotenv(override=True)

USE_MOCK_CALLS = os.getenv("USE_MOCK_CALLS", "true").lower() == "true"
CALLE_API_KEY = os.getenv("CALLE_API_KEY", "").strip()
CALLE_BASE_URL = os.getenv("CALLE_BASE_URL", "https://api.heycall-e.com").rstrip("/")
DB_PATH = os.getenv("JOBRADAR_DB_PATH", "jobradar.db")

TERMINAL_STATUSES = {"completed", "failed", "cancelled", "canceled"}
MIN_CONFIDENCE = 0.70


def _stable_idempotency_key(
    business_name: str,
    phone_number: str,
    candidate_role: str,
) -> str:
    payload = f"{business_name.strip().lower()}|{phone_number}|{candidate_role.strip().lower()}"
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]
    return f"jobradar_{digest}"


def _checkpoint_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS provider_call_checkpoints (
            idempotency_key TEXT PRIMARY KEY,
            call_id TEXT NOT NULL,
            expected_phone_hash TEXT NOT NULL,
            status TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )
        """
    )
    conn.commit()
    return conn


def _phone_hash(phone: str) -> str:
    return hashlib.sha256(phone.encode("utf-8")).hexdigest()


def _get_checkpoint(idempotency_key: str) -> dict | None:
    conn = _checkpoint_db()
    try:
        row = conn.execute(
            """
            SELECT call_id, expected_phone_hash, status
            FROM provider_call_checkpoints
            WHERE idempotency_key = ?
            """,
            (idempotency_key,),
        ).fetchone()
        if not row:
            return None
        return {
            "call_id": row[0],
            "expected_phone_hash": row[1],
            "status": row[2],
        }
    finally:
        conn.close()


def _save_checkpoint(
    idempotency_key: str,
    call_id: str,
    phone_number: str,
    status: str,
) -> None:
    conn = _checkpoint_db()
    try:
        conn.execute(
            """
            INSERT INTO provider_call_checkpoints
                (idempotency_key, call_id, expected_phone_hash, status, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(idempotency_key) DO UPDATE SET
                call_id = excluded.call_id,
                expected_phone_hash = excluded.expected_phone_hash,
                status = excluded.status,
                updated_at = excluded.updated_at
            """,
            (
                idempotency_key,
                call_id,
                _phone_hash(phone_number),
                status,
                int(time.time()),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _task_prompt(phone_number: str, candidate_role: str) -> str:
    return (
        f"Call {phone_number}. This is an authorized JobRadar Voice call. "
        "Introduce yourself as JobRadar Voice AI assistant. "
        "First ask which language the recipient prefers: English or Hindi. "
        "After they choose, keep the entire remaining conversation in that language "
        "unless they explicitly request a change. "
        "Ask permission to speak for about one minute about hiring. "
        "If permission is denied, thank them and end. "
        f"If permission is given, ask whether they are currently hiring for {candidate_role}. "
        "If hiring, ask ONE BY ONE and wait after each question: exact number of openings, "
        "exact monthly salary or range, shift, required experience, required skills, "
        "joining timeline, whether JobRadar may refer suitable candidates, and whether "
        "JobRadar may contact them again for future hiring. "
        "Repeat numeric answers back for confirmation. "
        "Use only facts actually spoken by the recipient. Never infer or fabricate a value. "
        "If an answer is unclear, ask once again; if still unclear, mark it not confirmed. "
        "Before ending, recap only confirmed facts in the selected language."
    )


RECIPIENT_RESULT_SCHEMA = {
    "type": "object",
    "required": [
        "selected_language",
        "permission_to_continue",
        "hiring_status",
        "job_title",
        "number_of_openings",
        "salary_min",
        "salary_max",
        "shift",
        "experience_required",
        "skills_required",
        "joining_timeline",
        "candidate_referrals_allowed",
        "future_follow_up_allowed",
    ],
    "properties": {
        "selected_language": {
            "type": "string",
            "enum": ["english", "hindi", "hinglish", "unknown"],
        },
        "permission_to_continue": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
        },
        "hiring_status": {
            "type": "string",
            "enum": ["hiring_now", "hiring_soon", "not_hiring", "unclear"],
        },
        "job_title": {"type": "string"},
        "number_of_openings": {"type": "integer", "minimum": 0},
        "salary_min": {"type": "integer", "minimum": 0},
        "salary_max": {"type": "integer", "minimum": 0},
        "shift": {
            "type": "string",
            "enum": ["day", "night", "rotational", "day_night", "other", "unknown"],
        },
        "experience_required": {"type": "string"},
        "skills_required": {
            "type": "array",
            "items": {"type": "string"},
        },
        "joining_timeline": {"type": "string"},
        "candidate_referrals_allowed": {
            "type": "string",
            "enum": ["yes", "no", "unclear"],
        },
        "future_follow_up_allowed": {
            "type": "string",
            "enum": ["yes", "no", "unclear"],
        },
    },
}


def _extract_reported_phone(recipient: dict) -> str | None:
    for key in ("phone", "phone_number"):
        value = recipient.get(key)
        if isinstance(value, str) and value.startswith("+"):
            return value
    phones = recipient.get("phones")
    if isinstance(phones, list) and phones and isinstance(phones[0], str):
        return phones[0]
    return None


def _user_authored_turns(recipient: dict) -> list[dict]:
    turns = []
    for attempt in recipient.get("attempts", []) or []:
        if not isinstance(attempt, dict):
            continue
        for turn in attempt.get("transcript_turns", []) or []:
            if not isinstance(turn, dict):
                continue
            speaker = str(turn.get("speaker", "")).lower()
            text = str(turn.get("text", "")).strip()
            if speaker in {"user", "callee", "human", "recipient"} and text:
                turns.append(turn)
    return turns


def _confidence_score(call: dict) -> float:
    confidence = call.get("completion_confidence")
    if isinstance(confidence, (int, float)):
        return float(confidence)
    if isinstance(confidence, dict):
        try:
            return float(confidence.get("score", 0))
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _validate_provider_result(
    call: dict,
    expected_phone: str,
) -> tuple[dict, dict]:
    if not isinstance(call, dict):
        raise RuntimeError("CALL-E response was not a JSON object.")

    if call.get("status") != "completed":
        raise RuntimeError(
            f"CALL-E call is not safely terminal-completed: {call.get('status')!r}"
        )

    if call.get("task_completed") is not True:
        raise RuntimeError("CALL-E did not confirm task_completed=true.")

    if _confidence_score(call) < MIN_CONFIDENCE:
        raise RuntimeError("CALL-E completion confidence is below the verification threshold.")

    recipients = call.get("recipients")
    if not isinstance(recipients, list) or len(recipients) != 1:
        raise RuntimeError("Expected exactly one CALL-E recipient result.")

    recipient = recipients[0]
    if not isinstance(recipient, dict):
        raise RuntimeError("CALL-E recipient result is invalid.")

    if recipient.get("status") != "completed":
        raise RuntimeError("Recipient call did not complete.")

    reported_phone = _extract_reported_phone(recipient)
    if reported_phone is not None and reported_phone != expected_phone:
        raise RuntimeError("CALL-E returned a different recipient than requested.")

    structured = recipient.get("structured_result")
    if not isinstance(structured, dict):
        raise RuntimeError("Schema-valid recipient structured_result is missing.")

    missing = [
        key for key in RECIPIENT_RESULT_SCHEMA["required"]
        if key not in structured
    ]
    if missing:
        raise RuntimeError(
            "Recipient structured_result is missing required fields: "
            + ", ".join(missing)
        )

    # Critical hallucination guard:
    # never verify hiring facts from bot-only/generated summaries.
    if not _user_authored_turns(recipient):
        raise RuntimeError(
            "No recipient-authored transcript evidence was captured; result is not verified."
        )

    evidence = call.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise RuntimeError("CALL-E returned no task evidence.")

    return recipient, structured


def _structured_to_jobradar(
    structured: dict,
    call: dict,
    business_name: str,
) -> dict:
    shift_map = {
        "day": "Day",
        "night": "Night",
        "rotational": "Rotational",
        "day_night": "Day / Night",
        "other": "Other",
        "unknown": None,
    }

    hiring_status = structured["hiring_status"]
    permission = structured["permission_to_continue"] == "yes"

    missing = []
    if hiring_status in {"hiring_now", "hiring_soon"}:
        if not structured.get("job_title"):
            missing.append("Role")
        if structured.get("number_of_openings", 0) <= 0:
            missing.append("Openings")
        if structured.get("salary_min", 0) <= 0:
            missing.append("Salary")
        if structured.get("shift") == "unknown":
            missing.append("Shift")
        if not structured.get("joining_timeline"):
            missing.append("Joining timeline")

    verification_status = (
        "verified"
        if permission and hiring_status != "unclear" and not missing
        else "partially_verified"
        if permission and hiring_status != "unclear"
        else "unverified"
    )

    return {
        "business_name": business_name,
        "selected_language": structured.get("selected_language", "unknown").title(),
        "permission_to_continue": permission,
        "hiring_status": hiring_status,
        "job_title": structured.get("job_title") or None,
        "number_of_openings": structured.get("number_of_openings") or None,
        "salary_min": structured.get("salary_min") or None,
        "salary_max": structured.get("salary_max") or None,
        "shift": shift_map.get(structured.get("shift")),
        "experience_required": structured.get("experience_required") or None,
        "skills_required": structured.get("skills_required") or [],
        "joining_timeline": structured.get("joining_timeline") or None,
        "candidate_referrals_allowed": structured.get(
            "candidate_referrals_allowed", "unclear"
        ),
        "future_follow_up_allowed": (
            structured.get("future_follow_up_allowed") == "yes"
        ),
        "missing_information": missing,
        "verification_status": verification_status,
        "follow_up_required": bool(missing),
        "call_summary": str(call.get("summary") or ""),
        "_calle_metadata": {
            "call_id": call.get("id"),
            "status": call.get("status"),
            "task_completed": call.get("task_completed"),
            "completion_confidence": call.get("completion_confidence"),
        },
    }


def _poll_call(
    client: httpx.Client,
    call_id: str,
    idempotency_key: str,
    phone_number: str,
    timeout_seconds: int = 180,
) -> dict:
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        response = client.get(f"{CALLE_BASE_URL}/v1/calls/{call_id}")
        response.raise_for_status()
        call = response.json()
        status = str(call.get("status", "unknown"))
        _save_checkpoint(idempotency_key, call_id, phone_number, status)

        if status in TERMINAL_STATUSES:
            return call

        time.sleep(3)

    # Keep the accepted call ID durable so the same workflow can reconcile it later.
    _save_checkpoint(idempotency_key, call_id, phone_number, "outcome_unknown")
    raise TimeoutError(
        f"CALL-E accepted call {call_id}, but terminal status was not observed yet. "
        "Do not create a new call; retry the same workflow to reconcile this call ID."
    )


def discover_job_from_business(
    business_name: str,
    phone_number: str,
    candidate_role: str = "Warehouse Assistant",
) -> dict:
    if USE_MOCK_CALLS:
        return _run_mock_call(business_name)

    return _run_real_call(
        business_name=business_name,
        phone_number=phone_number,
        candidate_role=candidate_role,
    )


def _run_real_call(
    business_name: str,
    phone_number: str,
    candidate_role: str,
) -> dict:
    if not CALLE_API_KEY:
        raise RuntimeError("CALLE_API_KEY is missing.")

    phone_number = phone_number.strip()
    if not is_valid_e164(phone_number):
        raise RuntimeError(
            "Refusing live dispatch: phone number is not strict E.164."
        )

    idempotency_key = _stable_idempotency_key(
        business_name,
        phone_number,
        candidate_role,
    )

    headers = {
        "Authorization": f"Bearer {CALLE_API_KEY}",
        "Content-Type": "application/json",
    }

    with httpx.Client(headers=headers, timeout=30.0) as client:
        checkpoint = _get_checkpoint(idempotency_key)

        if checkpoint:
            if checkpoint["expected_phone_hash"] != _phone_hash(phone_number):
                raise RuntimeError("Checkpoint recipient mismatch; refusing to continue.")
            call_id = checkpoint["call_id"]
        else:
            payload = {
                "task": _task_prompt(phone_number, candidate_role),
                "recipients": [
                    {
                        "phones": [phone_number],
                        "region": "IN",
                    }
                ],
                "recipient_result_schema": RECIPIENT_RESULT_SCHEMA,
                "metadata": {
                    "workflow": "jobradar_voice",
                    "business_name": business_name,
                    "role": candidate_role,
                },
            }

            response = client.post(
                f"{CALLE_BASE_URL}/v1/calls",
                headers={"Idempotency-Key": idempotency_key},
                json=payload,
            )
            response.raise_for_status()
            accepted = response.json()

            call_id = accepted.get("id")
            if not isinstance(call_id, str) or not call_id.startswith("call_"):
                raise RuntimeError("CALL-E did not return a valid accepted call ID.")

            _save_checkpoint(
                idempotency_key,
                call_id,
                phone_number,
                str(accepted.get("status", "accepted")),
            )

        call = _poll_call(
            client,
            call_id,
            idempotency_key,
            phone_number,
        )

    recipient, structured = _validate_provider_result(
        call,
        expected_phone=phone_number,
    )

    result = _structured_to_jobradar(
        structured,
        call,
        business_name,
    )

    # Transcript is allowed in the local UI, but we do not print or persist
    # the raw provider object/phone number to logs.
    result["call_transcript"] = [
        {
            "speaker": turn.get("speaker"),
            "text": turn.get("text"),
            "offset_seconds": turn.get("offset_seconds"),
        }
        for attempt in recipient.get("attempts", []) or []
        if isinstance(attempt, dict)
        for turn in attempt.get("transcript_turns", []) or []
        if isinstance(turn, dict)
    ]

    return result


def _run_mock_call(business_name: str) -> dict:
    return {
        "business_name": business_name,
        "selected_language": "English",
        "permission_to_continue": True,
        "hiring_status": "hiring_now",
        "job_title": "Warehouse Assistant",
        "number_of_openings": 2,
        "salary_min": 16000,
        "salary_max": 18000,
        "shift": "Night",
        "experience_required": "Fresher accepted",
        "skills_required": ["Packing", "Inventory"],
        "joining_timeline": "Immediate",
        "candidate_referrals_allowed": "yes",
        "future_follow_up_allowed": True,
        "missing_information": [],
        "verification_status": "verified",
        "follow_up_required": False,
        "call_summary": "Mock mode: verified hiring result.",
        "call_transcript": [],
    }
