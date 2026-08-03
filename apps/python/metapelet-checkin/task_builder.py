"""Build CALL-E task text from MetaPelet persona files."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PERSONA_PATH = (
    REPO_ROOT
    / "skills"
    / "metapelet-elder-checkin"
    / "references"
    / "persona.en.txt"
)
PROFILE_PATH = (
    REPO_ROOT
    / "skills"
    / "metapelet-elder-checkin"
    / "references"
    / "profile-demo.en.txt"
)
RESULT_SCHEMA_PATH = (
    REPO_ROOT
    / "skills"
    / "metapelet-elder-checkin"
    / "references"
    / "result-schema.json"
)

E164_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")
LOCALE_PATTERN = re.compile(r"^[a-z]{2,3}(?:-[A-Z]{2})?$")
REGION_PATTERN = re.compile(r"^[A-Z]{2}$")
LANGUAGE_PATTERN = re.compile(r"^(?:en|ru|he)$")
PHONE_LIKE_PATTERN = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")

LANGUAGE_LINES = {
    "ru": "Conversation language on the call: Russian only.",
    "he": "Conversation language on the call: Hebrew only.",
    "en": "Conversation language on the call: English only.",
}


def validate_request(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("request must be a JSON object")

    workflow_id = str(raw.get("workflow_id", "")).strip()
    if len(workflow_id) < 3 or len(workflow_id) > 64:
        raise ValueError("workflow_id must be 3-64 characters")

    phone = str(raw.get("phone", "")).strip()
    if not E164_PATTERN.fullmatch(phone):
        raise ValueError("phone must use E.164 format, for example +12025550123")

    region = str(raw.get("region", "")).strip()
    if not REGION_PATTERN.fullmatch(region):
        raise ValueError("region must be a two-letter ISO country code, for example US")

    locale = str(raw.get("locale", "")).strip()
    if not LOCALE_PATTERN.fullmatch(locale):
        raise ValueError("locale must look like en-US or he-IL")

    language = str(raw.get("language", "en")).strip().lower()
    if not LANGUAGE_PATTERN.fullmatch(language):
        raise ValueError("language must be one of: en, ru, he")

    user_name = str(raw.get("user_name", "")).strip()
    if not user_name:
        raise ValueError("user_name is required")

    if raw.get("recipient_consented") is not True:
        raise ValueError("recipient_consented must be true")

    max_minutes = int(raw.get("max_minutes", 5))
    if not 1 <= max_minutes <= 15:
        raise ValueError("max_minutes must be between 1 and 15")

    age = raw.get("age")
    if age is not None and not isinstance(age, int):
        raise ValueError("age must be an integer or null")

    return {
        "workflow_id": workflow_id,
        "phone": phone,
        "region": region,
        "locale": locale,
        "language": language,
        "user_name": user_name,
        "recipient_consented": True,
        "max_minutes": max_minutes,
        "age": age,
        "include_demo_profile": bool(raw.get("include_demo_profile")),
    }


def mask_phone(phone: str) -> str:
    if len(phone) <= 6:
        return "***"
    return f"{phone[:3]}{'*' * max(4, len(phone) - 6)}{phone[-3:]}"


def redact_phone_literals(text: str, phone: str) -> str:
    masked = mask_phone(phone)
    text = text.replace(phone, masked)
    digits_only = "".join(c for c in phone if c.isdigit())
    if digits_only:
        text = PHONE_LIKE_PATTERN.sub("[phone-redacted]", text)
    return text


def opening_instruction(request: dict) -> str:
    name = request.get("user_name") or "friend"
    lang = (request.get("language") or "en").lower()
    language_line = LANGUAGE_LINES.get(lang, LANGUAGE_LINES["en"])
    return (
        f'Required opening (spoken in the conversation language): greet {name} warmly, '
        "identify yourself as their voice companion (not a clinician, not a hidden human friend), "
        "ask how they are today and whether it is a good time for a short chat. "
        f"{language_line} Do not say 'automatic call' or similar cold phrasing."
    )


def load_result_schema() -> dict:
    return json.loads(RESULT_SCHEMA_PATH.read_text(encoding="utf-8"))


def build_persona_block(request: dict) -> str:
    persona = PERSONA_PATH.read_text(encoding="utf-8")
    user_name = request.get("user_name") or "friend"
    age = request.get("age")
    lang = (request.get("language") or "en").lower()
    age_line = f"Age (if known): {age}." if age else ""
    language_line = LANGUAGE_LINES.get(lang, LANGUAGE_LINES["en"])
    persona = persona.replace("{user_name}", user_name)
    persona = persona.replace("{age_line}", age_line)
    persona = persona.replace("{language_line}", language_line)
    profile = ""
    if request.get("include_demo_profile"):
        profile = "\n\nOptional profile notes:\n" + PROFILE_PATH.read_text(encoding="utf-8")
    return persona + profile


def build_recipients(request: dict) -> list[dict]:
    return [
        {
            "phones": [request["phone"]],
            "region": request["region"],
            "locale": request["locale"],
        }
    ]


def build_task(request: dict, *, dial_phone: str | None = None) -> str:
    phone = dial_phone or request["phone"]
    max_minutes = int(request.get("max_minutes", 5))
    persona = build_persona_block(request)
    lang = (request.get("language") or "en").lower()
    close_question = (
        "At the end, gently ask (in the conversation language) whether they would like "
        "a similar friendly call again next week."
    )
    opening = opening_instruction(request)

    disclosure_rules = f"""CALL-E disclosure (required — say this first, warmly and naturally):
- Do NOT use a stiff formal greeting.
- Do NOT say "automatic call" or similar.
- Follow this opening instruction:
"{opening}\""""

    return f"""Call {phone} now for a short warm companionship check-in (about {max_minutes} minutes, then wrap up politely).

You are placing this call on behalf of an authorized family member or caregiver who confirmed the recipient agreed to this friendly check-in. This is NOT a medical call.

{disclosure_rules}

After the opening, continue in MetaPelet style below. You are MetaPelet, a voice companion service — warm, not a clinician, not a human pretending to be a personal friend. Do not hide that this is a voice assistant after the opening.

Phone-channel adjustments to the persona text:
- Skip any separate "first message" block — you already used the required opening above.
- The persona may mention not revealing automation; ignore that for phone channel after your opening identifies the voice assistant.

Follow this persona and boundaries (with those adjustments):

{persona}

Call behavior:
- Speak naturally, slowly, one question at a time.
- Stay non-medical; no medication or doctor reminders.

{close_question}

After the call, fill the structured result: mood (short text), topics (2-5 items), wants_repeat_call (yes/no/unknown).
"""


def idempotency_key(request: dict, task: str, result_schema: dict) -> str:
    fingerprint = {
        "version": 1,
        "workflow_id": request["workflow_id"],
        "phone": request["phone"],
        "region": request["region"],
        "locale": request["locale"],
        "language": request.get("language"),
        "user_name": request.get("user_name"),
        "max_minutes": int(request.get("max_minutes", 5)),
        "include_demo_profile": bool(request.get("include_demo_profile")),
        "age": request.get("age"),
        "task_digest": hashlib.sha256(task.encode("utf-8")).hexdigest(),
        "schema_digest": hashlib.sha256(
            json.dumps(result_schema, sort_keys=True).encode("utf-8")
        ).hexdigest(),
    }
    digest = hashlib.sha256(
        json.dumps(fingerprint, sort_keys=True).encode("utf-8")
    ).hexdigest()[:24]
    return f"metapelet-{request['workflow_id']}-{digest}"


def preview_plan(request: dict) -> dict:
    masked = mask_phone(request["phone"])
    task = build_task(request, dial_phone=masked)
    task_preview = redact_phone_literals(task, request["phone"])
    if len(task_preview) > 1200:
        task_preview = task_preview[:1200] + "\n...[truncated for preview]"
    return {
        "mode": "preview",
        "creates_phone_call": False,
        "masked_phone": masked,
        "region": request["region"],
        "locale": request["locale"],
        "language": request.get("language", "en"),
        "user_name": request.get("user_name"),
        "idempotency_preview": idempotency_key(request, task, load_result_schema()),
        "task_preview": task_preview,
        "result_schema": load_result_schema(),
    }
