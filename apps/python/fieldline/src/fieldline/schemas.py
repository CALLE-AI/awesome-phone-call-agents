"""Trip plans and the JSON Schemas FieldLine sends to CALL-E.

The schemas below ride on `result_schema` in `POST /v1/calls`, so the
CALL-E platform extracts a machine-readable outcome from each live
conversation. FieldLine's protocol decisions consume only these fields.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

# --- Result schema for a worker check-in call -------------------------
CHECKIN_RESULT_SCHEMA: dict = {
    "type": "object",
    "required": ["checkin_status", "duress_phrase_detected"],
    "properties": {
        "checkin_status": {
            "type": "string",
            "enum": ["safe", "needs_assistance", "emergency", "unclear"],
            "description": "The worker's safety status as stated on the call.",
        },
        "duress_phrase_detected": {
            "type": "boolean",
            "description": (
                "True if the worker said the configured duress phrase "
                "verbatim at any point during the call."
            ),
        },
        "current_location": {
            "type": "string",
            "description": "Location as stated by the worker, if any.",
        },
        "plan_change": {
            "type": "string",
            "description": "Any change to the filed trip plan, if mentioned.",
        },
        "notes": {"type": "string"},
    },
}

# --- Result schema for an escalation-ladder call ----------------------
ESCALATION_RESULT_SCHEMA: dict = {
    "type": "object",
    "required": ["contact_reached"],
    "properties": {
        "contact_reached": {
            "type": "boolean",
            "description": "True if the intended contact was reached and understood the situation.",
        },
        "heard_from_worker_since_checkin": {
            "type": "boolean",
            "description": "True if the contact reports contact with the worker after the missed check-in.",
        },
        "last_contact_time": {
            "type": "string",
            "description": "When the contact last heard from the worker, as stated.",
        },
        "will_check_in_person": {
            "type": "boolean",
            "description": "True if the contact will physically check the site/route.",
        },
        "assuming_coordination": {
            "type": "boolean",
            "description": "True if the contact explicitly takes over incident coordination.",
        },
        "notes": {"type": "string"},
    },
}


@dataclass(frozen=True)
class Worker:
    name: str
    role: str
    phone: str  # E.164
    locale: str = "en-US"


@dataclass(frozen=True)
class Contact:
    name: str
    relation: str
    phone: str  # E.164


@dataclass(frozen=True)
class TripPlan:
    label: str
    site: str
    date: str  # YYYY-MM-DD
    start: str  # HH:MM local
    end: str  # HH:MM local
    checkins: list[str]  # HH:MM labels
    worker: Worker
    escalation: list[Contact]
    duress_phrase: str
    vehicle: str = ""
    grace_minutes: int = 15
    retry_after_minutes: int = 5
    max_retries: int = 1
    emergency_note: str = ""
    extra: dict = field(default_factory=dict)


class TripPlanError(ValueError):
    """Raised when a trip plan file is invalid."""


def load_trip_plan(path: str | Path) -> TripPlan:
    p = Path(path)
    if not p.is_file():
        raise TripPlanError(f"Trip plan not found: {p}")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise TripPlanError(f"Trip plan must be a YAML mapping: {p}")
    try:
        w = data["worker"]
        t = data["trip"]
        plan = TripPlan(
            label=str(t["label"]),
            site=str(t["site"]),
            vehicle=str(t.get("vehicle", "")),
            date=str(t["date"]),
            start=str(t["start"]),
            end=str(t["end"]),
            checkins=[str(c) for c in t["checkins"]],
            grace_minutes=int(t.get("grace_minutes", 15)),
            retry_after_minutes=int(t.get("retry_after_minutes", 5)),
            max_retries=int(t.get("max_retries", 1)),
            worker=Worker(
                name=str(w["name"]),
                role=str(w.get("role", "field worker")),
                phone=str(w["phone"]),
                locale=str(w.get("locale", "en-US")),
            ),
            duress_phrase=str(data["duress_phrase"]),
            escalation=[
                Contact(name=str(c["name"]), relation=str(c.get("relation", "contact")), phone=str(c["phone"]))
                for c in data["escalation"]
            ],
            emergency_note=str(data.get("emergency_note", "")),
        )
    except KeyError as exc:
        raise TripPlanError(f"Trip plan missing required field: {exc}") from exc
    _validate(plan)
    return plan


def _validate(plan: TripPlan) -> None:
    if not plan.checkins:
        raise TripPlanError("Trip plan needs at least one check-in time.")
    if not plan.escalation:
        raise TripPlanError("Trip plan needs at least one escalation contact.")
    if len(plan.duress_phrase.split()) < 3:
        raise TripPlanError("Duress phrase must be at least 3 words (avoid accidental triggers).")
    for phone in [plan.worker.phone, *[c.phone for c in plan.escalation]]:
        if not phone.startswith("+") or not phone[1:].isdigit() or len(phone) < 8:
            raise TripPlanError(f"Phone numbers must be E.164 (e.g. +15555550100), got: {mask_phone(phone)}")


def mask_phone(phone: str) -> str:
    """Mask a phone number for display/logs: +15555550100 -> +1•••0100."""
    if len(phone) < 6:
        return "•••"
    return f"{phone[:2]}•••{phone[-4:]}"


def add_minutes(hhmm: str, minutes: int) -> str:
    """'18:00' + 5 -> '18:05' (wraps at midnight)."""
    h, m = (int(x) for x in hhmm.split(":"))
    total = (h * 60 + m + minutes) % (24 * 60)
    return f"{total // 60:02d}:{total % 60:02d}"
