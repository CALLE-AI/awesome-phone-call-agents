from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, Mapping, Sequence, get_args
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

Severity = Literal["sev1", "sev2", "sev3"]

E164 = re.compile(r"^\+[1-9]\d{7,14}$")

REQUIRED_INCIDENT_FIELDS = ("id", "title", "severity", "service", "summary", "ladder")
REQUIRED_CONTACT_FIELDS = ("id", "name", "phone", "timezone")
SEVERITIES = get_args(Severity)
SPOKEN_LIMITS = {"title": 200, "summary": 600, "service": 80, "id": 80, "runbook_url": 200}


class IncidentError(ValueError):
    pass


@dataclass(frozen=True)
class Contact:
    id: str
    name: str
    phone: str
    timezone: str


@dataclass(frozen=True)
class Shift:
    scope: str
    contact: Contact
    starts_at: datetime | None
    ends_at: datetime | None

    def covers(self, moment: datetime) -> bool:
        if self.starts_at is not None and moment < self.starts_at:
            return False
        return self.ends_at is None or moment < self.ends_at


@dataclass(frozen=True)
class Policy:
    min_confidence: float = 0.7
    accepted_confidence_labels: tuple[str, ...] = ("medium", "high")
    max_eta_minutes: int = 120
    per_call_timeout_seconds: float = 180.0
    poll_interval_seconds: float = 3.0
    ladder_timeout_seconds: float = 900.0


@dataclass(frozen=True)
class Incident:
    id: str
    title: str
    severity: Severity
    service: str
    summary: str
    runbook_url: str
    ladder: tuple[str, ...]
    timezone: str
    policy: Policy


@dataclass(frozen=True)
class Rung:
    scope: str
    contact: Contact


def require(raw: Mapping[str, Any], fields: Sequence[str], where: str) -> None:
    missing = [field for field in fields if not raw.get(field)]
    if missing:
        raise IncidentError(f"{where} is missing required fields: {', '.join(missing)}")


def clean_text(raw: Any, where: str, limit: int) -> str:
    text = " ".join(str(raw).split())
    if not text:
        raise IncidentError(f"{where} must not be empty")
    if len(text) > limit:
        raise IncidentError(f"{where} must be at most {limit} characters, got {len(text)}")
    return text


def validate_e164(raw: Any, where: str) -> str:
    if not isinstance(raw, str) or not E164.fullmatch(raw):
        raise IncidentError(
            f"{where} must be an E.164 phone number such as +15550100123, got {raw!r}. "
            "Ringdown does not reformat or guess a country code."
        )
    return raw


def mask_phone(phone: str) -> str:
    if len(phone) < 5:
        return "*" * len(phone)
    return phone[:2] + "*" * (len(phone) - 4) + phone[-2:]


def first_name(contact: Contact) -> str:
    return contact.name.split()[0].lower()


def validate_runbook_url(raw: Any) -> str:
    if not str(raw or "").split():
        return ""
    text = clean_text(raw, "the runbook_url", SPOKEN_LIMITS["runbook_url"])
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or " " in text:
        raise IncidentError(f"the runbook_url must be an http or https URL, got {text!r}")
    return text


def validate_timezone(raw: Any, where: str) -> str:
    if not isinstance(raw, str) or not raw:
        raise IncidentError(f"{where} must be an IANA timezone such as America/New_York")
    try:
        ZoneInfo(raw)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise IncidentError(f"{where} is not a known IANA timezone: {raw!r}") from exc
    return raw


def read_json(path: Path, what: str) -> dict[str, Any]:
    try:
        loaded = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise IncidentError(f"no {what} file at {path}") from exc
    except json.JSONDecodeError as exc:
        raise IncidentError(f"the {what} file at {path} is not valid JSON: {exc}") from exc
    if not isinstance(loaded, dict):
        raise IncidentError(f"the {what} file at {path} must hold a JSON object")
    return loaded


def _parse_moment(raw: Any, where: str) -> datetime | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise IncidentError(f"{where} must be an ISO 8601 timestamp, got {raw!r}")
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise IncidentError(f"{where} is not an ISO 8601 timestamp: {raw!r}") from exc
    if moment.tzinfo is None:
        raise IncidentError(
            f"{where} has no UTC offset. Ringdown does not assume the host timezone."
        )
    return moment


def parse_policy(raw: Any) -> Policy:
    if raw is None:
        return Policy()
    if not isinstance(raw, dict):
        raise IncidentError("policy must be a JSON object")
    unknown = set(raw) - set(Policy.__dataclass_fields__)
    if unknown:
        raise IncidentError(f"unknown policy fields: {', '.join(sorted(unknown))}")
    labels = raw.get("accepted_confidence_labels", Policy.accepted_confidence_labels)
    if not isinstance(labels, (list, tuple)) or not labels:
        raise IncidentError("accepted_confidence_labels must be a non-empty list")
    for name, value in raw.items():
        if name == "accepted_confidence_labels":
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise IncidentError(f"{name} must be a number, got {value!r}")
    policy = Policy(**{**raw, "accepted_confidence_labels": tuple(str(x).lower() for x in labels)})
    if not 0.0 <= policy.min_confidence <= 1.0:
        raise IncidentError(f"min_confidence must be between 0 and 1, got {policy.min_confidence}")
    if policy.max_eta_minutes < 1:
        raise IncidentError("max_eta_minutes must be at least 1")
    if policy.per_call_timeout_seconds <= 0:
        raise IncidentError("per_call_timeout_seconds must be positive")
    if policy.poll_interval_seconds <= 0:
        raise IncidentError("poll_interval_seconds must be positive")
    if policy.per_call_timeout_seconds > policy.ladder_timeout_seconds:
        raise IncidentError(
            "per_call_timeout_seconds cannot exceed ladder_timeout_seconds: "
            f"{policy.per_call_timeout_seconds} > {policy.ladder_timeout_seconds}"
        )
    return policy


def parse_incident(raw: Mapping[str, Any]) -> Incident:
    require(raw, REQUIRED_INCIDENT_FIELDS, "the incident")
    severity = str(raw["severity"]).lower()
    if severity not in SEVERITIES:
        raise IncidentError(f"severity must be one of {', '.join(SEVERITIES)}, got {severity!r}")
    ladder = raw["ladder"]
    if not isinstance(ladder, (list, tuple)) or not all(isinstance(x, str) and x for x in ladder):
        raise IncidentError("ladder must be a non-empty list of scope names")
    if len(set(ladder)) != len(ladder):
        raise IncidentError(f"the ladder repeats a scope: {', '.join(ladder)}")
    return Incident(
        id=clean_text(raw["id"], "the incident id", SPOKEN_LIMITS["id"]),
        title=clean_text(raw["title"], "the incident title", SPOKEN_LIMITS["title"]),
        severity=severity,
        service=clean_text(raw["service"], "the incident service", SPOKEN_LIMITS["service"]),
        summary=clean_text(raw["summary"], "the incident summary", SPOKEN_LIMITS["summary"]),
        runbook_url=validate_runbook_url(raw.get("runbook_url")),
        ladder=tuple(ladder),
        timezone=validate_timezone(raw.get("timezone"), "the incident timezone"),
        policy=parse_policy(raw.get("policy")),
    )


def load_incident(path: Path) -> Incident:
    return parse_incident(read_json(path, "incident"))


def parse_contact(raw: Any, where: str) -> Contact:
    if not isinstance(raw, dict):
        raise IncidentError(f"{where} must be a JSON object")
    require(raw, REQUIRED_CONTACT_FIELDS, where)
    return Contact(
        id=clean_text(raw["id"], f"{where} id", 80),
        name=clean_text(raw["name"], f"{where} name", 120),
        phone=validate_e164(raw.get("phone"), f"{where} phone"),
        timezone=validate_timezone(raw.get("timezone"), f"{where} timezone"),
    )


def load_rotation(path: Path) -> tuple[Shift, ...]:
    raw = read_json(path, "rotation")
    entries = raw.get("shifts")
    if not isinstance(entries, list) or not entries:
        raise IncidentError("the rotation file must hold a non-empty 'shifts' list")
    shifts = []
    for index, entry in enumerate(entries):
        where = f"shift {index + 1}"
        if not isinstance(entry, dict) or not entry.get("scope"):
            raise IncidentError(f"{where} needs a scope")
        starts_at = _parse_moment(entry.get("starts_at"), f"{where} starts_at")
        ends_at = _parse_moment(entry.get("ends_at"), f"{where} ends_at")
        if starts_at is not None and ends_at is not None and ends_at <= starts_at:
            raise IncidentError(f"{where} ends before it starts")
        shifts.append(
            Shift(
                scope=str(entry["scope"]),
                contact=parse_contact(entry.get("contact"), f"{where} contact"),
                starts_at=starts_at,
                ends_at=ends_at,
            )
        )
    return tuple(shifts)


def on_call_for(scope: str, shifts: Sequence[Shift], moment: datetime) -> Contact | None:
    covering = [shift for shift in shifts if shift.scope == scope and shift.covers(moment)]
    bounded = [shift for shift in covering if shift.ends_at is not None]
    return next((shift.contact for shift in bounded or covering), None)


def resolve_ladder(
    incident: Incident, shifts: Sequence[Shift], moment: datetime
) -> tuple[Rung, ...]:
    if moment.tzinfo is None:
        raise IncidentError("the resolution moment must be timezone aware")
    rungs: list[Rung] = []
    seen: set[str] = set()
    for scope in incident.ladder:
        contact = on_call_for(scope, shifts, moment)
        if contact is None or contact.id in seen:
            continue
        seen.add(contact.id)
        rungs.append(Rung(scope=scope, contact=contact))
    if not rungs:
        raise IncidentError(
            f"nobody is on call for any of: {', '.join(incident.ladder)}. "
            "Fix the rotation file. Ringdown does not dial to find out."
        )
    return tuple(rungs)


def unstaffed_scopes(incident: Incident, rungs: Sequence[Rung]) -> tuple[str, ...]:
    staffed = {rung.scope for rung in rungs}
    return tuple(scope for scope in incident.ladder if scope not in staffed)
