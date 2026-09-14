"""Fail-closed classification of a CALL-E (or mock) terminal payload."""

from __future__ import annotations

from typing import Any

from .phone import mask_phone
from .schema import CAN_ATTEND, DISPOSITIONS
from .task import idempotency_key

LOW_CONFIDENCE = 0.6


def _confidence_score(payload: dict[str, Any]) -> float | None:
    raw = payload.get("completion_confidence")
    if isinstance(raw, dict) and isinstance(raw.get("score"), (int, float)):
        return float(raw["score"])
    if isinstance(raw, (int, float)):
        return float(raw)
    return None


def classify(intake: dict[str, Any], payload: dict[str, Any], *, mode: str) -> dict[str, Any]:
    """Turn a CALL-E-shaped result into the app's public JSON.

    Ambiguity, schema drift, and low confidence become needs_human. A yes is
    never inferred from a missing field.
    """
    phone_masked = mask_phone(intake["phone"])
    base = {
        "mode": mode,
        "creates_phone_call": mode == "live",
        "request_id": intake["request_id"],
        "idempotency_key": idempotency_key(intake),
        "phone_masked": phone_masked,
        "appointment_starts_at": intake["appointment"]["starts_at"],
        "call_id": payload.get("id") or payload.get("call_id"),
        "status": payload.get("status"),
        "task_completed": payload.get("task_completed"),
        "completion_confidence": payload.get("completion_confidence"),
        "can_attend": "unknown",
        "confirmed_time": "",
        "requested_time": "",
        "disposition": "needs_human",
        "evidence": [],
        "needs_human": True,
        "notes": "",
    }

    if payload.get("status") != "completed" or payload.get("task_completed") is not True:
        base["notes"] = "Call did not complete successfully; routed to a human."
        return base

    recipients = payload.get("recipients") or []
    if not isinstance(recipients, list) or len(recipients) != 1:
        base["notes"] = "Expected exactly one recipient result."
        return base

    structured = recipients[0].get("structured_result") if isinstance(recipients[0], dict) else None
    if not isinstance(structured, dict):
        structured = payload.get("structured_result")
    if not isinstance(structured, dict):
        base["notes"] = "Missing structured_result."
        return base

    can_attend = structured.get("can_attend")
    disposition = structured.get("disposition")
    confirmed_time = structured.get("confirmed_time") or ""
    requested_time = structured.get("requested_time") or ""
    if can_attend not in CAN_ATTEND or disposition not in DISPOSITIONS:
        base["notes"] = "structured_result used an unbound enum value."
        return base
    if not isinstance(confirmed_time, str) or not isinstance(requested_time, str):
        base["notes"] = "Time fields must be strings."
        return base

    score = _confidence_score(payload)
    if score is not None and score < LOW_CONFIDENCE:
        base["notes"] = "Completion confidence below fail-closed threshold."
        base["can_attend"] = can_attend
        base["confirmed_time"] = confirmed_time
        base["requested_time"] = requested_time
        base["disposition"] = "needs_human"
        base["evidence"] = list(payload.get("evidence") or [])
        return base

    if disposition == "confirmed" and can_attend != "yes":
        base["notes"] = "confirmed disposition requires can_attend=yes."
        return base
    if disposition == "confirmed" and not confirmed_time:
        base["notes"] = "confirmed disposition requires confirmed_time."
        return base

    needs_human = disposition in {"needs_human", "voicemail", "no_answer", "wrong_number"}
    if can_attend == "unknown" and disposition not in {"voicemail", "no_answer", "wrong_number"}:
        needs_human = True
        disposition = "needs_human"

    evidence = list(payload.get("evidence") or [])
    base.update(
        {
            "can_attend": can_attend,
            "confirmed_time": confirmed_time,
            "requested_time": requested_time,
            "disposition": disposition,
            "evidence": evidence,
            "needs_human": needs_human or disposition == "reschedule_requested",
            "notes": "",
        }
    )
    if disposition == "reschedule_requested":
        base["notes"] = "Recipient asked to move the slot. A human must rebook."
        base["needs_human"] = True
    return base
