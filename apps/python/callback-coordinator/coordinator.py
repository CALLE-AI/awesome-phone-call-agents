"""Callback Coordinator core engine.
A consent-first, fail-closed triage engine for callback requests. It takes a
callback intake (a web "request a callback" submission or a missed-call log
entry), gates it against quiet hours and do-not-call flags, places one CALL-E
call to learn *why* the person needs a callback, classifies the outcome into a
fail-closed disposition, routes it to a team, and returns a masked ticket.
This module is deliberately free of any network or SDK import so every decision
here can be unit-tested with canned results. Only ``client.py`` wires this engine
to the real ``calle`` SDK.
"""
from __future__ import annotations
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, available_timezones
# E.164: + followed by 1-9 then 7-14 more digits = 8-15 digits total,
# first digit after + must not be 0 (prevents +0...).
E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,119}$")
LOCALE_PATTERN = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
TIME_PATTERN = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
# Legacy contiguous pattern (still used as fallback)
PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)\+?\\d{7,15}(?!\w)")
PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)\+?\d{7,15}(?!\w)")
# Formatted phone patterns – catches (202) 555-0123, 202-555-0123, 202.555.0123,
# 202 555 0123, +1 (202) 555-0123, +44 20 7123 4567, etc.
PHONE_CANDIDATE_RE = re.compile(r"\+?\(?\d[\d\s\-\.\(\)]{5,}\d")
DATE_RE = re.compile(r"^\d{4}[-/]\d{2}[-/]\d{2}$")
TRUSTED_API_HOST = "api.heycall-e.com"
TRUSTED_BASE_URL = f"https://{TRUSTED_API_HOST}"
VALID_SOURCES = ("web_form", "missed_call")
VALID_REASONS = (
    "billing",
    "sales",
    "technical_support",
    "service_coordination",
    "declined",
    "other",
    "unknown",
)
ACTIONABLE_REASONS = {"billing", "sales", "technical_support", "service_coordination"}
DEFAULT_ROUTING_RULES: tuple[dict, ...] = (
    {"category": "billing", "team": "Billing Team", "action": "Queue for a billing specialist callback."},
    {"category": "sales", "team": "Sales Team", "action": "Queue for a sales follow-up callback."},
    {"category": "technical_support", "team": "Technical Support", "action": "Queue for a technical support callback."},
    {"category": "service_coordination", "team": "Service Scheduling", "action": "Queue for service scheduling callback."},
)
VALID_RIGHT_PERSON = {"yes", "no", "unknown"}
VALID_CONSENT = {"yes", "no", "unknown"}
VALID_URGENT = {"yes", "no", "unknown"}
VALID_VOICEMAIL = {"yes", "no", "unknown"}
@dataclass(frozen=True)
class RoutingRule:
    category: str
    team: str
    action: str
@dataclass(frozen=True)
class CallbackIntake:
    workflow_id: str
    phone: str
    source: str
    business_display_name: str
    request_reason_hint: str
    timezone: str
    locale: str
    consent: bool = False
    do_not_call: bool = False
    quiet_hours: tuple[str, str] = ("20:00", "08:00")
    routing_rules: tuple[RoutingRule, ...] = field(
        default_factory=lambda: tuple(RoutingRule(**r) for r in DEFAULT_ROUTING_RULES)
    )
# --------------------------------------------------------------------------- #
# Trusted origin validation
# --------------------------------------------------------------------------- #
def validate_trusted_base_url(url: str) -> str:
    if not isinstance(url, str) or not url.strip():
        raise ValueError(f"base_url must be {TRUSTED_BASE_URL}")
    raw = url.strip()
    parsed = urlparse(raw)
    if parsed.scheme.lower() != "https":
        raise ValueError(f"base_url must use https and be {TRUSTED_BASE_URL}; got {url}")
    if parsed.username or parsed.password:
        raise ValueError(f"base_url must not contain credentials; only {TRUSTED_BASE_URL} is allowed")
    host = (parsed.hostname or "").lower()
    if host != TRUSTED_API_HOST:
        raise ValueError(f"base_url host must be {TRUSTED_API_HOST}; got {host or parsed.netloc}")
    if parsed.port is not None and parsed.port != 443:
        raise ValueError(f"base_url must not use custom port; only {TRUSTED_BASE_URL} is allowed")
    return raw.rstrip("/")
# --------------------------------------------------------------------------- #
# Parsing and validation
# --------------------------------------------------------------------------- #
def _clean_text(value, field, *, minimum, maximum) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = " ".join(value.split())
    if not minimum <= len(cleaned) <= maximum:
        raise ValueError(f"{field} must contain {minimum}-{maximum} characters")
    return cleaned
def parse_intake(raw: dict) -> CallbackIntake:
    if not isinstance(raw, dict):
        raise ValueError("intake must be a JSON object")
    workflow_id = _clean_text(raw.get("workflow_id"), "workflow_id", minimum=3, maximum=120)
    if not SAFE_ID_PATTERN.fullmatch(workflow_id):
        raise ValueError("workflow_id may contain only letters, numbers, dot, underscore, colon, or hyphen")
    phone = _clean_text(raw.get("phone"), "phone", minimum=9, maximum=16)
    if not E164_PATTERN.fullmatch(phone):
        raise ValueError("phone must use E.164 format, for example +12025550123 and must not start with +0")
    source = raw.get("source")
    if source not in VALID_SOURCES:
        raise ValueError("source must be one of: web_form, missed_call")
    timezone_name = _clean_text(raw.get("timezone", "UTC"), "timezone", minimum=3, maximum=64)
    if timezone_name not in available_timezones() or (
        "/" not in timezone_name and timezone_name != "UTC"
    ):
        raise ValueError("timezone must be a valid IANA timezone name")
    locale = _clean_text(raw.get("locale", "en-US"), "locale", minimum=2, maximum=16)
    if not LOCALE_PATTERN.fullmatch(locale):
        raise ValueError("locale must look like en-US or ko-KR")
    if "consent" not in raw:
        raise ValueError("consent is required; intake must record explicit consent for this callback (boolean true)")
    consent_val = raw.get("consent")
    if not isinstance(consent_val, bool):
        raise ValueError("consent must be a boolean true, recording explicit consent for this callback")
    if consent_val is not True:
        raise ValueError("consent must be true; intake must record that the recipient explicitly requested this callback")
    do_not_call = raw.get("do_not_call", False)
    if not isinstance(do_not_call, bool):
        raise ValueError("do_not_call must be a boolean")
    quiet = raw.get("quiet_hours", {"start": "20:00", "end": "08:00"})
    if not isinstance(quiet, dict):
        raise ValueError("quiet_hours must be an object with start and end")
    start = _clean_text(quiet.get("start", "20:00"), "quiet_hours.start", minimum=5, maximum=5)
    end = _clean_text(quiet.get("end", "08:00"), "quiet_hours.end", minimum=5, maximum=5)
    if not TIME_PATTERN.fullmatch(start) or not TIME_PATTERN.fullmatch(end):
        raise ValueError("quiet_hours.start/end must use HH:MM 24-hour format")
    if start == end:
        raise ValueError("quiet_hours.start must differ from quiet_hours.end")
    raw_rules = raw.get("routing_rules")
    routing_rules = tuple(RoutingRule(**r) for r in DEFAULT_ROUTING_RULES)
    if raw_rules is not None:
        if not isinstance(raw_rules, list) or not raw_rules:
            raise ValueError("routing_rules must be a non-empty list")
        parsed: list[RoutingRule] = []
        seen: set[str] = set()
        for index, item in enumerate(raw_rules):
            if not isinstance(item, dict):
                raise ValueError(f"routing_rules[{index}] must be an object")
            category = _clean_text(item.get("category"), f"routing_rules[{index}].category", minimum=3, maximum=40)
            if category not in VALID_REASONS:
                raise ValueError(f"routing_rules[{index}].category must be one of {', '.join(VALID_REASONS)}")
            if category in seen:
                raise ValueError(f"routing_rules[{index}].category is duplicated")
            seen.add(category)
            parsed.append(
                RoutingRule(
                    category=category,
                    team=_clean_text(item.get("team"), f"routing_rules[{index}].team", minimum=2, maximum=60),
                    action=_clean_text(item.get("action"), f"routing_rules[{index}].action", minimum=5, maximum=160),
                )
            )
        routing_rules = tuple(parsed)
    return CallbackIntake(
        workflow_id=workflow_id,
        phone=phone,
        source=source,
        business_display_name=_clean_text(
            raw.get("business_display_name"), "business_display_name", minimum=2, maximum=80
        ),
        request_reason_hint=_clean_text(
            raw.get("request_reason_hint", ""), "request_reason_hint", minimum=0, maximum=200
        ),
        timezone=timezone_name,
        locale=locale,
        consent=consent_val,
        do_not_call=do_not_call,
        quiet_hours=(start, end),
        routing_rules=routing_rules,
    )
def load_intake(path) -> CallbackIntake:
    with path.expanduser().open(encoding="utf-8") as handle:
        return parse_intake(json.load(handle))
def mask_phone(phone: str) -> str:
    if len(phone) <= 6:
        return "*" * len(phone)
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"
# --------------------------------------------------------------------------- #
# Gates
# --------------------------------------------------------------------------- #
def _to_minutes(hhmm: str) -> int:
    hour, minute = hhmm.split(":")
    return int(hour) * 60 + int(minute)
def _in_quiet_hours(now_minutes: int, start_hhmm: str, end_hhmm: str) -> bool:
    start = _to_minutes(start_hhmm)
    end = _to_minutes(end_hhmm)
    if start == end:
        return False
    if start < end:
        return start <= now_minutes < end
    return now_minutes >= start or now_minutes < end
def attempt_gate(intake: CallbackIntake, now: datetime) -> tuple[bool, str | None]:
    if not intake.consent:
        return False, "consent_not_recorded"
    if intake.do_not_call:
        return False, "do_not_call"
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    local = now.astimezone(ZoneInfo(intake.timezone))
    current_minutes = local.hour * 60 + local.minute
    start, end = intake.quiet_hours
    if _in_quiet_hours(current_minutes, start, end):
        return False, "quiet_hours"
    return True, None
# --------------------------------------------------------------------------- #
# CALL-E task, schema, and arguments
# --------------------------------------------------------------------------- #
def build_task(intake: CallbackIntake) -> str:
    reason_context = (
        f"The person previously reached out by web form with this note: {intake.request_reason_hint}."
        if intake.request_reason_hint
        else "This callback follows a missed-call or callback request."
    )
    categories = ", ".join(ACTIONABLE_REASONS)
    return (
        f"Place one callback triage call on behalf of {intake.business_display_name}. "
        f"{reason_context} "
        "At the start, identify yourself as an AI calling assistant and disclose you are AI. "
        "Say the recipient requested a callback and ask whether this is the intended recipient and whether they want to continue. "
        "If either answer is no, do not ask anything else, record the answer and end the call. "
        "If they want to continue, ask in plain language why they are calling back and classify the reason as exactly one of: "
        f"{categories}, declined, or other. "
        "Ask whether this is urgent. "
        "Ask whether a voicemail is acceptable if the human callback is missed. "
        "Do not request sensitive personal, medical, legal, or financial information. "
        "Do not book, cancel, purchase, promise, or modify any service. Do not attempt to schedule a time now – you are only triaging and routing, not booking. "
        "Do not state phone numbers or other personal data in your summary."
    )
def build_result_schema() -> dict:
    return {
        "type": "object",
        "required": [
            "right_person",
            "consent_after_ai_disclosure",
            "contact_reason",
            "urgent",
            "voicemail_allowed",
            "evidence_summary",
        ],
        "properties": {
            "right_person": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person on the line confirmed they are the intended callback recipient.",
            },
            "consent_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the recipient agreed to continue after the AI identity and callback context were disclosed.",
            },
            "contact_reason": {
                "type": "string",
                "enum": list(VALID_REASONS),
                "description": "The classified reason the recipient needs a callback.",
            },
            "urgent": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the recipient said the matter is urgent.",
            },
            "voicemail_allowed": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the recipient permits a voicemail if the future human callback is missed.",
            },
            "evidence_summary": {
                "type": "string",
                "description": "One short paraphrase supporting the extracted choices. Omit phone numbers, names, account numbers, and any sensitive information.",
            },
        },
        "additionalProperties": False,
    }
def idempotency_key(intake: CallbackIntake) -> str:
    return f"callback-triage-{intake.workflow_id}"
def build_call_arguments(intake: CallbackIntake) -> dict:
    return {
        "task": build_task(intake),
        "recipients": [{"phones": [intake.phone], "locale": intake.locale}],
        "result_schema": build_result_schema(),
        "metadata": {
            "workflow_id": intake.workflow_id,
            "workflow_type": "callback_triage",
            "source": intake.source,
        },
        "idempotency_key": idempotency_key(intake),
    }
# --------------------------------------------------------------------------- #
# Fail-closed disposition classification + binding verification
# --------------------------------------------------------------------------- #
def _confidence_ok(completed: dict) -> bool:
    confidence = completed.get("completion_confidence")
    if not isinstance(confidence, dict):
        return False
    label = confidence.get("label")
    if isinstance(label, str) and label.lower() == "high":
        return True
    score = confidence.get("score")
    if isinstance(score, (int, float)):
        return score >= 0.7
    return False
def verify_result_binding(
    completed: dict, intake: CallbackIntake, expected_call_id: str | None = None
) -> tuple[bool, str | None]:
    """Verify that the terminal CALL-E result belongs to the approved intake.
    Checks:
      - call identity: completed.id must equal expected_call_id when present
      - metadata: workflow_id must match intake.workflow_id
      - recipient: intake.phone must be present in completed.recipients[].phones
    Fail-closed: any mismatch or missing binding field returns False.
    """
    if not isinstance(completed, dict) or not completed:
        return False, "missing_terminal_result"
    got_id = completed.get("id")
    if expected_call_id is not None and got_id is not None:
        if not isinstance(got_id, str) or got_id != expected_call_id:
            return False, "call_id_mismatch"
    md = completed.get("metadata")
    if not isinstance(md, dict):
        return False, "metadata_missing"
    if md.get("workflow_id") != intake.workflow_id:
        return False, "workflow_id_mismatch"
    if "workflow_type" in md and md.get("workflow_type") != "callback_triage":
        return False, "workflow_type_mismatch"
    recips = completed.get("recipients")
    if not isinstance(recips, list) or len(recips) == 0:
        return False, "recipients_missing"
    found = False
    for r in recips:
        if not isinstance(r, dict):
            continue
        phones = r.get("phones")
        if isinstance(phones, list) and intake.phone in phones:
            found = True
            break
    if not found:
        return False, "recipient_phone_mismatch"
    return True, None
def classify_disposition(
    completed: dict, intake: CallbackIntake | None = None, expected_call_id: str | None = None
) -> dict:
    """Turn a CALL-E terminal result into a fail-closed disposition.
    Every outcome that does not confidently reach a 'scheduled' or 'declined'
    state is routed to a human (needs_human). This is fail-closed:
      - when intake provided: call id, metadata workflow_id, and recipient phone must match
      - status must be exactly 'completed'
      - task_completed must be True
      - structured_result must be bound to declared enums
    """
    if not isinstance(completed, dict) or not completed:
        return {"disposition": "needs_human", "needs_human": True, "reason": "missing_terminal_result"}
    # Binding verification first, when intake is available
    if intake is not None:
        ok, bind_reason = verify_result_binding(completed, intake, expected_call_id)
        if not ok:
            return {"disposition": "needs_human", "needs_human": True, "reason": f"binding_{bind_reason}"}
    status = completed.get("status")
    if status != "completed":
        if status in ("failed", "canceled"):
            return {"disposition": "needs_human", "needs_human": True, "reason": f"call_{status}"}
        return {"disposition": "needs_human", "needs_human": True, "reason": f"call_not_completed_status_{status}"}
    if completed.get("task_completed") is not True:
        return {"disposition": "needs_human", "needs_human": True, "reason": "task_not_completed"}
    sr = completed.get("structured_result")
    if not isinstance(sr, dict) or not sr:
        return {"disposition": "needs_human", "needs_human": True, "reason": "missing_structured_result"}
    right_person = sr.get("right_person")
    consent = sr.get("consent_after_ai_disclosure")
    reason = sr.get("contact_reason")
    urgent = sr.get("urgent")
    voicemail = sr.get("voicemail_allowed")
    if right_person not in VALID_RIGHT_PERSON:
        return {"disposition": "needs_human", "needs_human": True, "reason": "invalid_right_person"}
    if consent not in VALID_CONSENT:
        return {"disposition": "needs_human", "needs_human": True, "reason": "invalid_consent"}
    if reason not in VALID_REASONS:
        return {"disposition": "needs_human", "needs_human": True, "reason": "invalid_contact_reason"}
    if urgent not in VALID_URGENT:
        return {"disposition": "needs_human", "needs_human": True, "reason": "invalid_urgent"}
    if voicemail not in VALID_VOICEMAIL:
        return {"disposition": "needs_human", "needs_human": True, "reason": "invalid_voicemail"}
    if right_person == "no":
        return {"disposition": "needs_human", "needs_human": True, "reason": "wrong_person"}
    if right_person != "yes":
        return {"disposition": "needs_human", "needs_human": True, "reason": "right_person_unconfirmed"}
    if consent == "no" or reason == "declined":
        return {"disposition": "declined", "needs_human": False, "reason": "recipient_declined"}
    if consent != "yes":
        return {"disposition": "needs_human", "needs_human": True, "reason": "consent_unconfirmed"}
    if reason == "unknown" or reason == "other":
        return {"disposition": "needs_human", "needs_human": True, "reason": f"reason_{reason}"}
    if reason not in ACTIONABLE_REASONS:
        return {"disposition": "needs_human", "needs_human": True, "reason": "unrecognized_reason"}
    if not _confidence_ok(completed):
        return {"disposition": "needs_human", "needs_human": True, "reason": "low_confidence"}
    if sr.get("urgent") == "yes":
        return {"disposition": "needs_human", "needs_human": True, "reason": "urgent_fast_track"}
    return {"disposition": "scheduled", "needs_human": False, "reason": "routed"}
def route(intake: CallbackIntake, reason: str | None) -> dict:
    if not reason or reason not in ACTIONABLE_REASONS:
        return {
            "team": "General Intake (human review)",
            "action": "Route to a human coordinator; do not auto-close.",
        }
    for rule in intake.routing_rules:
        if rule.category == reason:
            return {"team": rule.team, "action": rule.action}
    return {
        "team": "General Intake (human review)",
        "action": "Route to a human coordinator; no routing rule matched.",
    }
# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def preview(intake: CallbackIntake, now: datetime) -> dict:
    attempt, gate_reason = attempt_gate(intake, now)
    arguments = build_call_arguments(intake)
    arguments["recipients"] = [{"phones": [mask_phone(intake.phone)], "locale": intake.locale}]
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "workflow_id": intake.workflow_id,
        "gate": {"attempt": attempt, "reason": gate_reason},
        "call_arguments": arguments,
    }
def redact_phone_like(value):
    if isinstance(value, str):
        def _repl_formatted(m):
            txt = m.group(0)
            digits = re.sub(r"\D", "", txt)
            stripped = txt.strip()
            if DATE_RE.fullmatch(stripped):
                return txt
            if re.fullmatch(r"\d{1,2}:\d{2}", stripped):
                return txt
            if 7 <= len(digits) <= 15:
                return "[phone-redacted]"
            return txt
        value = PHONE_CANDIDATE_RE.sub(_repl_formatted, value)
        value = PHONE_LIKE_PATTERN.sub("[phone-redacted]", value)
        return value
    if isinstance(value, list):
        return [redact_phone_like(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_phone_like(item) for key, item in value.items()}
    return value
def execute_with_client(
    intake: CallbackIntake,
    client,
    *,
    now: datetime,
    timeout_seconds: int,
    interval_seconds: float = 2.0,
) -> dict:
    attempt, gate_reason = attempt_gate(intake, now)
    if not attempt:
        return {
            "mode": "execute",
            "creates_phone_call": False,
            "workflow_id": intake.workflow_id,
            "gate": {"attempt": False, "reason": gate_reason},
            "disposition": "skipped",
            "needs_human": False,
            "reason": f"gate_{gate_reason}",
        }
    arguments = build_call_arguments(intake)
    created = client.calls.create(**arguments)
    call_id = created.get("id")
    if not isinstance(call_id, str) or not call_id:
        return {
            "mode": "execute",
            "creates_phone_call": True,
            "workflow_id": intake.workflow_id,
            "disposition": "needs_human",
            "needs_human": True,
            "reason": "create_no_id",
            "idempotency_key": idempotency_key(intake),
        }
    try:
        completed = client.calls.wait_for_result(
            call_id, timeout_seconds=timeout_seconds, interval_seconds=interval_seconds
        )
    except Exception as exc:  # noqa: BLE001
        return {
            "mode": "execute",
            "creates_phone_call": True,
            "workflow_id": intake.workflow_id,
            "disposition": "needs_human",
            "needs_human": True,
            "reason": "result_lookup_error",
            "detail": str(exc),
            "call_id": call_id,
            "idempotency_key": idempotency_key(intake),
        }
    # Binding verification + disposition classification (fail-closed)
    disposition = classify_disposition(completed, intake=intake, expected_call_id=call_id)
    sr = completed.get("structured_result") or {}
    routed = route(intake, sr.get("contact_reason"))
    return {
        "mode": "execute",
        "creates_phone_call": True,
        "workflow_id": intake.workflow_id,
        "idempotency_key": idempotency_key(intake),
        "call_id": call_id,
        "status": completed.get("status"),
        "task_completed": completed.get("task_completed"),
        "completion_confidence": completed.get("completion_confidence"),
        "disposition": disposition["disposition"],
        "needs_human": disposition["needs_human"],
        "reason": disposition["reason"],
        "contact_reason": sr.get("contact_reason"),
        "urgent": sr.get("urgent"),
        "voicemail_allowed": sr.get("voicemail_allowed"),
        "route_to": routed["team"],
        "action": routed["action"],
        "evidence_summary": redact_phone_like(sr.get("evidence_summary")),
    }
