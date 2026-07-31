from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class PolicyError(ValueError):
    """Raised when a call plan fails a safety preflight."""


REQUIRED_FIELDS = {
    "purpose",
    "phone",
    "recipient_source",
    "consent_basis",
    "ai_disclosure",
    "timezone",
    "allowed_window",
    "max_attempts",
    "recording",
    "retention_days",
    "region",
}

REJECTION_COOLDOWN_HOURS = 24

ALLOWED_RECIPIENT_SOURCES = {"self", "explicit_opt_in", "existing_customer_request"}
ALLOWED_CONSENT_BASES = {"self_test", "written_opt_in", "requested_callback"}
SUPPORTED_REGION_LANGUAGES = {
    "US": {"en"},
    "SG": {"en"},
    "MY": {"en"},
    "IN": {"en", "hi"},
    "AE": {"en", "ar"},
    "AU": {"en"},
    "CA": {"en"},
    "GB": {"en"},
    "VN": {"vi"},
    "DE": {"en", "de"},
    "JP": {"ja"},
    "FR": {"fr"},
    "MX": {"es"},
    "BR": {"pt"},
    "ID": {"en"},
    "PH": {"en"},
    "KE": {"en"},
}
E164 = re.compile(r"^\+[1-9]\d{7,14}$")
SECRET_TERMS = re.compile(
    r"\b(password|passcode|one[- ]?time code|otp|seed phrase|private key|"
    r"credit card|cvv|social security|bank login)\b",
    re.IGNORECASE,
)


def load_plan(path: str | Path) -> dict[str, Any]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise PolicyError("plan must be a JSON object")
    return data


def validate_plan(plan: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    missing = sorted(REQUIRED_FIELDS - plan.keys())
    if missing:
        errors.append("missing fields: " + ", ".join(missing))
        return errors

    if not isinstance(plan["purpose"], str) or len(plan["purpose"].strip()) < 15:
        errors.append("purpose must clearly describe the call in at least 15 characters")
    elif SECRET_TERMS.search(plan["purpose"]):
        errors.append("purpose must not request credentials, financial data, or secrets")

    if not isinstance(plan["phone"], str) or not E164.fullmatch(plan["phone"]):
        errors.append("phone must be a valid E.164 number")

    if plan["recipient_source"] not in ALLOWED_RECIPIENT_SOURCES:
        errors.append("recipient_source is not consent-based")
    if plan["consent_basis"] not in ALLOWED_CONSENT_BASES:
        errors.append("consent_basis is not accepted")

    disclosure = str(plan["ai_disclosure"]).lower()
    if "ai" not in disclosure and "automated" not in disclosure:
        errors.append("ai_disclosure must identify the caller as AI or automated")

    window = plan["allowed_window"]
    if not (
        isinstance(window, dict)
        and isinstance(window.get("start_hour"), int)
        and isinstance(window.get("end_hour"), int)
        and 8 <= window["start_hour"] < window["end_hour"] <= 20
    ):
        errors.append("allowed_window must be between 08:00 and 20:00 local time")

    if not isinstance(plan["timezone"], str):
        errors.append("timezone must be an IANA timezone such as Asia/Seoul")
    else:
        try:
            ZoneInfo(plan["timezone"])
        except (ZoneInfoNotFoundError, ValueError):
            errors.append("timezone must be a valid IANA timezone such as Asia/Seoul")

    region = plan["region"]
    locale = str(plan.get("locale", "en-US"))
    language = locale.split("-", 1)[0].lower()
    if region not in SUPPORTED_REGION_LANGUAGES:
        errors.append("recipient region is not currently supported by CALL-E")
    elif language not in SUPPORTED_REGION_LANGUAGES[region]:
        errors.append("recipient language is not supported for this CALL-E region")

    if not isinstance(plan["max_attempts"], int) or not 1 <= plan["max_attempts"] <= 2:
        errors.append("max_attempts must be 1 or 2")

    if not isinstance(plan["recording"], bool):
        errors.append("recording must be explicitly true or false")
    if plan["recording"] and not plan.get("recording_consent"):
        errors.append("recording requires explicit recording_consent")

    if not isinstance(plan["retention_days"], int) or not 0 <= plan["retention_days"] <= 30:
        errors.append("retention_days must be between 0 and 30")

    return errors


def validate_dispatch_window(
    plan: dict[str, Any], *, now: datetime | None = None
) -> list[str]:
    """Enforce the recipient's local calling window immediately before dispatch."""
    try:
        recipient_tz = ZoneInfo(str(plan["timezone"]))
        window = plan["allowed_window"]
        start = int(window["start_hour"])
        end = int(window["end_hour"])
    except (KeyError, TypeError, ValueError, ZoneInfoNotFoundError):
        return ["cannot evaluate recipient local calling window"]

    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return ["dispatch time must include a timezone"]
    local_now = current.astimezone(recipient_tz)
    if not start <= local_now.hour < end:
        return [
            "recipient local time is outside allowed_window "
            f"({start:02d}:00-{end:02d}:00 {plan['timezone']})"
        ]
    return []


def validate_attempt_limit(
    plan: dict[str, Any], history: list[dict[str, Any]]
) -> list[str]:
    """Count durable dispatch reservations, not only completed calls."""
    fingerprint = _phone_fingerprint(str(plan.get("phone", "")))
    if any(
        event.get("phone_fingerprint") == fingerprint
        and event.get("state") in {"dispatching", "reconciliation_required"}
        for event in history
    ):
        return ["an earlier dispatch is unresolved; reconcile it before retrying"]
    attempts = sum(
        1
        for event in history
        if event.get("phone_fingerprint") == fingerprint
        and event.get("event") == "dispatch_reserved"
    )
    if attempts >= int(plan.get("max_attempts", 0)):
        return [f"max_attempts reached ({attempts})"]
    return []


def _phone_fingerprint(phone: str) -> str:
    return hashlib.sha256(phone.encode("utf-8")).hexdigest()[:12]


def validate_rejection_cooldown(
    plan: dict[str, Any],
    history: list[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> list[str]:
    """Block dispatch for 24 hours after this recipient rejects a call."""
    current = now or datetime.now(timezone.utc)
    fingerprint = _phone_fingerprint(str(plan.get("phone", "")))
    errors: list[str] = []

    for event in history:
        if event.get("phone_fingerprint") != fingerprint:
            continue
        if event.get("outcome") != "rejected":
            continue
        try:
            rejected_at = datetime.fromisoformat(str(event["occurred_at"]))
        except (KeyError, TypeError, ValueError):
            errors.append("call history contains an invalid rejection timestamp")
            continue
        if rejected_at.tzinfo is None:
            errors.append("rejection timestamp must include a timezone")
            continue
        retry_at = rejected_at.astimezone(timezone.utc) + timedelta(
            hours=REJECTION_COOLDOWN_HOURS
        )
        if current < retry_at:
            errors.append(
                "recipient rejected a call within the last 24 hours; "
                f"do not retry before {retry_at.isoformat()}"
            )
    return errors


def record_outcome(
    phone: str,
    outcome: str,
    *,
    occurred_at: datetime | None = None,
) -> dict[str, str]:
    if outcome not in {"completed", "rejected", "no_answer", "failed"}:
        raise PolicyError("unsupported call outcome")
    timestamp = occurred_at or datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        raise PolicyError("outcome timestamp must include a timezone")
    return {
        "phone_fingerprint": _phone_fingerprint(phone),
        "outcome": outcome,
        "occurred_at": timestamp.astimezone(timezone.utc).isoformat(),
    }


def build_manifest(plan: dict[str, Any]) -> dict[str, Any]:
    errors = validate_plan(plan)
    if errors:
        raise PolicyError("; ".join(errors))
    canonical = {
        key: value
        for key, value in plan.items()
        if key not in {"phone", "notes", "recording_consent"}
    }
    canonical["phone_fingerprint"] = _phone_fingerprint(plan["phone"])
    canonical["generated_at"] = datetime.now(timezone.utc).isoformat()
    canonical["policy_version"] = "consent-gate/0.1"
    canonical["rejection_cooldown_hours"] = REJECTION_COOLDOWN_HOURS
    canonical["approved_for_dispatch"] = False
    return canonical
