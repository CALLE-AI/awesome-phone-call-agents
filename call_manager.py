import hashlib
from datetime import datetime


def generate_idempotency_key(business: dict) -> str:
    raw_value = (
        f"{business.get('name', '')}|"
        f"{business.get('phone', '')}|"
        f"{business.get('location', '')}"
    )

    return hashlib.sha256(
        raw_value.encode("utf-8")
    ).hexdigest()


def create_call_record(business: dict) -> dict:
    return {
        "business_name": business.get("name"),
        "masked_phone": mask_phone_for_record(
            business.get("phone", "")
        ),
        "idempotency_key": generate_idempotency_key(business),
        "status": "prepared",
        "attempt": 0,
        "outcome": None,
        "created_at": datetime.now().isoformat()
    }


def mark_call_started(call_record: dict) -> dict:
    call_record["status"] = "in_progress"
    call_record["attempt"] += 1
    return call_record


def mark_call_completed(call_record: dict) -> dict:
    call_record["status"] = "completed"
    call_record["outcome"] = "result_received"
    return call_record


def mark_outcome_unknown(call_record: dict) -> dict:
    call_record["status"] = "outcome_unknown"
    call_record["outcome"] = (
        "Call may have completed but final status "
        "could not be confirmed."
    )
    return call_record


def should_retry_call(call_record: dict) -> tuple[bool, str]:
    status = call_record.get("status")
    attempts = call_record.get("attempt", 0)

    if status == "completed":
        return False, "Call already completed."

    if status == "outcome_unknown":
        return False, (
            "Do not automatically retry an ambiguous call outcome."
        )

    if attempts >= 2:
        return False, "Maximum call attempts reached."

    return True, "Call is eligible for retry."


def mask_phone_for_record(phone: str) -> str:
    if not phone:
        return "Unknown"

    if len(phone) <= 4:
        return "****"

    return f"{phone[:3]}******{phone[-2:]}"