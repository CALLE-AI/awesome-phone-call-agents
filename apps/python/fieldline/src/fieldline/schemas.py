"""Trip plans and the JSON Schemas FieldLine sends to CALL-E.

The schemas below ride on `result_schema` in `POST /v1/calls`, so the
CALL-E platform extracts a machine-readable outcome from each live
conversation. Live generated results require independent human review.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
import re
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
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        raise TripPlanError("Cannot read trip plan YAML.") from exc
    if not isinstance(data, dict):
        raise TripPlanError(f"Trip plan must be a YAML mapping: {p}")
    try:
        w = data["worker"]
        t = data["trip"]
        if not isinstance(w, dict) or not isinstance(t, dict):
            raise TripPlanError("Worker and trip must be mappings.")
        if not isinstance(t.get("checkins"), list):
            raise TripPlanError("Check-ins must be a list of HH:MM times.")
        if not isinstance(data.get("escalation"), list):
            raise TripPlanError("Escalation must be a list of contacts.")
        plan = TripPlan(
            label=str(t["label"]),
            site=str(t["site"]),
            vehicle=str(t.get("vehicle", "")),
            date=str(t["date"]),
            start=str(t["start"]),
            end=str(t["end"]),
            checkins=[str(c) for c in t["checkins"]],
            grace_minutes=t.get("grace_minutes", 15),
            retry_after_minutes=t.get("retry_after_minutes", 5),
            max_retries=t.get("max_retries", 1),
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
    except (TypeError, ValueError, AttributeError) as exc:
        raise TripPlanError("Trip plan has invalid field types.") from exc
    _validate(plan)
    return plan


def _parse_date(value: str) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise TripPlanError("Trip date must be a valid YYYY-MM-DD date.")
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise TripPlanError("Trip date must be a valid YYYY-MM-DD date.") from exc


def _parse_time(value: str) -> datetime:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{2}:[0-9]{2}", value):
        raise TripPlanError("Trip times must be valid HH:MM times.")
    try:
        return datetime.strptime(value, "%H:%M")
    except ValueError as exc:
        raise TripPlanError("Trip times must be valid HH:MM times.") from exc


def _validate(plan: TripPlan) -> None:
    _parse_date(plan.date)
    start, end = _parse_time(plan.start), _parse_time(plan.end)
    if start >= end:
        raise TripPlanError("Trip start must be before end on the same day; cross-midnight plans are unsupported.")
    if not isinstance(plan.checkins, list) or not plan.checkins:
        raise TripPlanError("Trip plan needs at least one check-in time.")
    checkins = [_parse_time(value) for value in plan.checkins]
    if any(not start <= value <= end for value in checkins):
        raise TripPlanError("Every check-in must be within the trip start/end window.")
    if any(left >= right for left, right in zip(checkins, checkins[1:])):
        raise TripPlanError("Check-ins must be strictly increasing with no duplicates.")
    for name, minimum, maximum in (
        ("grace_minutes", 0, 1440),
        ("retry_after_minutes", 1, 1440),
        ("max_retries", 0, 10),
    ):
        value = getattr(plan, name)
        if type(value) is not int or not minimum <= value <= maximum:
            raise TripPlanError(f"{name} must be an integer from {minimum} to {maximum}.")
    if not plan.escalation:
        raise TripPlanError("Trip plan needs at least one escalation contact.")
    if len(plan.duress_phrase.split()) < 3:
        raise TripPlanError("Duress phrase must be at least 3 words (avoid accidental triggers).")
    for phone in [plan.worker.phone, *[c.phone for c in plan.escalation]]:
        if not isinstance(phone, str) or not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone):
            raise TripPlanError("Phone numbers must be ASCII E.164: + followed by 8 to 15 digits, with a nonzero country code.")


def validate_live_window(plan: TripPlan, now: datetime | None = None, single: bool = False) -> None:
    """Fail closed on stale or cross-midnight live plans, using local wall time.

    Start may run before the trip begins, but never catches up missed check-ins.
    A single immediate call must be inside the dated trip window. Each subsequent
    live dial must also be checked by the engine; validation is not a reservation.
    An aware injected clock is interpreted in its supplied local timezone.
    """
    _validate(plan)
    now = now if now is not None else datetime.now()
    if now.date() != _parse_date(plan.date).date():
        raise TripPlanError("Live calls require today's trip date; stale and future plans are refused.")
    local_now = now.replace(tzinfo=None)
    start = datetime.combine(now.date(), _parse_time(plan.start).time())
    end = datetime.combine(now.date(), _parse_time(plan.end).time())
    if single:
        if not start <= local_now <= end:
            raise TripPlanError("An immediate live call must be within the trip start/end window.")
    else:
        first = datetime.combine(now.date(), _parse_time(plan.checkins[0]).time())
        if local_now > first:
            raise TripPlanError("The first check-in has already passed; live catch-up calls are refused.")


def scrub_text(text: str) -> str:
    """Mask phone-shaped digit sequences, including common formatted numbers.

    Preserve ISO dates, which often occur in timelines and report filenames.
    This display scrubber is conservative and is not a general secret sanitizer.
    """
    def replace(match: re.Match[str]) -> str:
        value = match.group(0)
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            return value
        phone = match.group("phone")
        digits = re.sub(r"[^0-9]", "", phone)
        masked = mask_phone(("+" if phone.startswith("+") else "") + digits)
        return masked + (" ext •••" if match.group("extension") else "")

    return re.sub(
        r"\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b|"
        r"(?<![\w])(?P<phone>\+?\(?[0-9](?:[ \t().-]*[0-9]){6,}\)?)"
        r"(?P<extension>[ \t]*(?:extension|ext\.?|x|#|;ext=)[ \t]*[0-9]+)?"
        r"(?![\w])",
        replace,
        text,
        flags=re.IGNORECASE,
    )


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
