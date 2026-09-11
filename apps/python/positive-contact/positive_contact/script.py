"""The call plan: what CALL-E is asked to say, and what it is asked to bring back.

Two things live here.

1. The task text, rendered per locale from a template with named slots. It discloses who
   is calling, that the call is automated and may be recorded, before anything else.
2. The recipient result schema sent to CALL-E, plus a stricter local validator that runs
   after the call.

The transmitted schema deliberately differs from `ARCHITECTURE.md` section 9 in two ways,
both recorded in `docs/adapter-notes.md`: `additionalProperties: false` is stated
explicitly, and `maxLength` is dropped because it is not in the CALL-E supported schema
subset. The length bound is enforced by the local validator instead, so an over-long field
becomes a review item rather than a rejected call.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from .models import (
    Acknowledged,
    ContactType,
    Event,
    NeedsAssistance,
    SpokeWith,
    SupportCategory,
    SupportUrgency,
    YesNoUnknown,
)

TASK_VERSION = "pc-task-v1"
SCHEMA_VERSION = "pc-recipient-result-v1"

NOTES_FOR_HUMAN_MAX_LENGTH = 280
CALLBACK_WINDOW_MAX_LENGTH = 80
PREFERRED_LANGUAGE_MAX_LENGTH = 20

# Reserved recipient response field names from the CALL-E contract. A custom result field
# may never use one of these.
RESERVED_RESULT_FIELDS = frozenset(
    {"summary", "status", "transcript", "call_id", "id", "started_at", "completed_at", "phones"}
)


class ScriptError(ValueError):
    """Raised when a call plan cannot be rendered safely."""


RECIPIENT_RESULT_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["contact_type", "acknowledged", "needs_assistance"],
    "properties": {
        "contact_type": {
            "type": "string",
            "enum": [item.value for item in ContactType],
            "description": (
                "Use live_person when a human answered and spoke with you. Use voicemail "
                "when an answering machine, voicemail greeting, or automated message "
                "answered, even if you left the notice. Use no_answer when nobody picked "
                "up, busy for a busy signal, wrong_number when the person says this is "
                "not the right household, refused when they decline to continue, "
                "language_barrier when they cannot understand the language of the call, "
                "and unknown when the evidence does not support any of the others."
            ),
        },
        "acknowledged": {
            "type": "string",
            "enum": [item.value for item in Acknowledged],
            "description": (
                "Use yes only when a live human said in their own words that they heard "
                "and understood the shutoff notice. A voicemail message you left is never "
                "yes. Use no when they said they did not hear or understand it. Use "
                "unknown when no human answered or the answer was unclear."
            ),
        },
        "spoke_with": {
            "type": "string",
            "enum": [item.value for item in SpokeWith],
            "description": (
                "Who you actually spoke with: the named customer, another household "
                "member, a caregiver, someone else, or unknown."
            ),
        },
        "needs_assistance": {
            "type": "string",
            "enum": [item.value for item in NeedsAssistance],
            "description": (
                "Use medical_question if the person asked anything about medical "
                "equipment, health, or what to do medically. Use resource_center_info "
                "when they asked about the Community Resource Center, transport when they "
                "asked about getting there, callback_requested when they asked a person to "
                "call back, none when they needed nothing, other for anything else, and "
                "unknown when no human answered."
            ),
        },
        "callback_window": {
            "type": "string",
            "description": (
                "When the person asked to be called back, in their own words, for example "
                f"'tomorrow morning'. At most {CALLBACK_WINDOW_MAX_LENGTH} characters. "
                "Leave empty when no callback was requested."
            ),
        },
        "preferred_language": {
            "type": "string",
            "description": (
                "The language the person asked to be contacted in, if they named one. At "
                f"most {PREFERRED_LANGUAGE_MAX_LENGTH} characters. Leave empty otherwise."
            ),
        },
        "notify_alternate_contact": {
            "type": "string",
            "enum": [item.value for item in YesNoUnknown],
            "description": (
                "Use yes when the person asked that another contact also be notified, no "
                "when they said not to, and unknown when it did not come up."
            ),
        },
        "notes_for_human": {
            "type": "string",
            "description": (
                "One short note for the utility team, at most "
                f"{NOTES_FOR_HUMAN_MAX_LENGTH} characters. Do not include any phone "
                "number, account number, or email address. Do not record any medical "
                "detail, condition, device, or diagnosis."
            ),
        },
        "support_category": {
            "type": "string",
            "enum": [item.value for item in SupportCategory],
            "description": (
                "If needs_assistance is medical_question, record only the broad routing "
                "category the caller selected. Never ask for or record a medicine name, "
                "dose, prescription number, diagnosis, condition, or equipment model. "
                "Use unknown when the caller did not select a category."
            ),
        },
        "support_urgency": {
            "type": "string",
            "enum": [item.value for item in SupportUrgency],
            "description": (
                "Record only now, today, before_outage, or unknown. Do not collect a "
                "clinical reason for the timing."
            ),
        },
        "provider_contact_consent": {
            "type": "string",
            "enum": [item.value for item in YesNoUnknown],
            "description": (
                "Use yes only when the caller clearly gives permission for the utility "
                "team to contact an approved pharmacy or equipment supplier about "
                "general outage-support availability."
            ),
        },
        "emergency_risk": {
            "type": "string",
            "enum": [item.value for item in YesNoUnknown],
            "description": (
                "Use yes when the caller says they are in immediate danger or having a "
                "medical emergency, no when they clearly say they are not, and unknown "
                "when it was not established."
            ),
        },
    },
}

ENUM_FIELDS: dict[str, frozenset[str]] = {
    "contact_type": frozenset(item.value for item in ContactType),
    "acknowledged": frozenset(item.value for item in Acknowledged),
    "spoke_with": frozenset(item.value for item in SpokeWith),
    "needs_assistance": frozenset(item.value for item in NeedsAssistance),
    "notify_alternate_contact": frozenset(item.value for item in YesNoUnknown),
    "support_category": frozenset(item.value for item in SupportCategory),
    "support_urgency": frozenset(item.value for item in SupportUrgency),
    "provider_contact_consent": frozenset(item.value for item in YesNoUnknown),
    "emergency_risk": frozenset(item.value for item in YesNoUnknown),
}

LENGTH_LIMITS: dict[str, int] = {
    "callback_window": CALLBACK_WINDOW_MAX_LENGTH,
    "preferred_language": PREFERRED_LANGUAGE_MAX_LENGTH,
    "notes_for_human": NOTES_FOR_HUMAN_MAX_LENGTH,
}

REQUIRED_FIELDS = ("contact_type", "acknowledged", "needs_assistance")


TASK_TEMPLATES: dict[str, str] = {
    "en-US": """This is an automated safety notification from {utility_name} about a possible Public Safety Power Shutoff. This call may be recorded. Am I speaking with {first_name} or someone in the household?

Power at {service_address_short} may be turned off starting {window_start_local} to reduce wildfire risk, and could stay off until {window_end_local}. Because this account is enrolled in the Medical Baseline program, we are calling to make sure you have received this notice. Can you confirm that you heard it?

Do you need information about the Community Resource Center at {crc_location}, or would you like a callback from our customer support team?

We will never ask for payment or account information on this call. Thank you.

How to handle this call:
- Say the disclosure above first, before anything else. Never skip it.
- If voicemail or an answering machine answers: leave the notice, do not ask questions, and set contact_type to voicemail. A message you leave is never an acknowledgement.
- You may answer only these: repeat the notice, the Community Resource Center location and hours ({crc_hours}), take a callback request, note a preferred language, and note whether an alternate contact should also be notified.
- If you are asked anything about medical equipment, health, prescriptions, or what to do medically: Give no medical advice and no reassurance. Set needs_assistance to medical_question.
- Ask whether the person is in immediate danger or having a medical emergency. If yes, tell them to call 911 or their local emergency number now, set emergency_risk to yes, say a team member will also review the request, and end politely. Do not continue supplier questions.
- If there is no stated immediate danger, ask only which broad support route fits: prescription access, powered equipment, or another critical supply; ask whether help is needed now, today, or before the outage; and ask permission for the utility team to contact an approved pharmacy or equipment supplier about general availability. Never ask for a medicine name, dose, prescription number, diagnosis, condition, or equipment model.
- Explain that permission does not place an order, reserve equipment, guarantee availability, or replace emergency or medical care. A utility operator reviews every request before any supplier is called.
- Never discuss account status, billing, payment, or credit. Never ask for an account number, a card number, a date of birth, or any identifying detail beyond confirming you are speaking with someone in the household. Never offer to change the outage timing.
- If the person cannot understand the language of this call: set contact_type to language_barrier and end politely. Do not attempt another language.
- If the person says this is the wrong number: set contact_type to wrong_number and end politely.
- Do not record any medical condition, device, diagnosis, or medication in any field.""",
}


def supported_locales() -> frozenset[str]:
    return frozenset(TASK_TEMPLATES)


def _local(moment: datetime, tz_name: str) -> str:
    """Render a timestamp the way it would be spoken, in the contact's own timezone."""
    local = moment.astimezone(ZoneInfo(tz_name))
    hour_24 = local.hour
    hour_12 = hour_24 % 12 or 12
    meridiem = "AM" if hour_24 < 12 else "PM"
    zone = local.strftime("%Z")
    return (
        f"{local.strftime('%A')} {local.strftime('%B')} {local.day} "
        f"at {hour_12}:{local.strftime('%M')} {meridiem} {zone}"
    )


def render_task_text(
    event: Event,
    *,
    first_name: str,
    service_address_short: str,
    locale: str,
    tz_name: str,
) -> str:
    """Render the exact words CALL-E is asked to work from.

    Raises for an unsupported locale rather than falling back to English. Calling in a
    language the customer did not ask for is not a safe default; preflight routes those
    contacts to a bilingual human callback instead.
    """
    template = TASK_TEMPLATES.get(locale)
    if template is None:
        raise ScriptError(
            f"no approved call script for locale {locale!r}; "
            "this contact must be routed to a bilingual human callback"
        )
    crc = event.crc_info or {}
    return template.format(
        utility_name=event.utility_name,
        first_name=first_name,
        service_address_short=service_address_short,
        window_start_local=_local(event.window_start, tz_name),
        window_end_local=_local(event.window_end, tz_name),
        crc_location=crc.get("location", "the location listed on our website"),
        crc_hours=crc.get("hours", "posted at the center"),
    )


class ResultValidationError(ValueError):
    """Raised when a returned recipient result does not satisfy the strict local rules."""


def validate_recipient_result(payload: object) -> dict:
    """Strict local validation of what CALL-E returned for one recipient.

    Stricter than the transmitted schema on purpose: it enforces the length bounds the
    wire schema cannot carry, and it rejects unexpected keys outright. Anything that fails
    here routes the intent to `NEEDS_HUMAN` rather than being coerced into an outcome.
    """
    if payload is None:
        raise ResultValidationError("recipient result is null; CALL-E extracted no valid result")
    if not isinstance(payload, dict):
        raise ResultValidationError(
            f"recipient result must be an object, got {type(payload).__name__}"
        )

    allowed = set(RECIPIENT_RESULT_SCHEMA["properties"])
    unexpected = sorted(set(payload) - allowed)
    if unexpected:
        raise ResultValidationError(f"unexpected key(s) in recipient result: {', '.join(unexpected)}")

    reserved = sorted(set(payload) & RESERVED_RESULT_FIELDS)
    if reserved:
        raise ResultValidationError(
            f"recipient result uses reserved CALL-E field name(s): {', '.join(reserved)}"
        )

    missing = [field for field in REQUIRED_FIELDS if field not in payload]
    if missing:
        raise ResultValidationError(f"missing required field(s): {', '.join(missing)}")

    for name, value in payload.items():
        if not isinstance(value, str):
            raise ResultValidationError(
                f"field {name!r} must be a string, got {type(value).__name__}"
            )
        if name in ENUM_FIELDS and value not in ENUM_FIELDS[name]:
            raise ResultValidationError(
                f"field {name!r} has value {value!r}, which is not one of: "
                f"{', '.join(sorted(ENUM_FIELDS[name]))}"
            )
        limit = LENGTH_LIMITS.get(name)
        if limit is not None and len(value) > limit:
            raise ResultValidationError(
                f"field {name!r} is {len(value)} characters, over the {limit} character limit"
            )
    return dict(payload)
