"""Build CALL-E task text from MetaPelet persona files (submission snapshot)."""

from __future__ import annotations

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PERSONA_PATH = (
    REPO_ROOT
    / "skills"
    / "metapelet-elder-checkin"
    / "references"
    / "persona.ru.txt"
)
PROFILE_PATH = (
    REPO_ROOT
    / "skills"
    / "metapelet-elder-checkin"
    / "references"
    / "profile-demo.ru.txt"
)
RESULT_SCHEMA_PATH = (
    REPO_ROOT
    / "skills"
    / "metapelet-elder-checkin"
    / "references"
    / "result-schema.json"
)

LANGUAGE_LINES = {
    "ru": "Язык разговора: русский. Говори только по-русски.",
    "he": "שפת השיחה: עברית. דברי רק בעברית.",
    "en": "Conversation language: English. Speak only in English.",
}

OPENING_LINES = {
    "ru": (
        "Привет, {name}! Это твоя голосовая помощница. "
        "Как ты сегодня? Если тебе удобно, давай немного поболтаем."
    ),
    "he": (
        "היי, {name}! זו העוזרת הקולית שלך. "
        "איך את היום? אם נוח לך, בואי נשוחח קצת."
    ),
    "en": (
        "Hi, {name}! This is your voice companion. "
        "How are you today? If it's a good time, let's chat for a bit."
    ),
}


def opening_line(request: dict) -> str:
    name = request.get("user_name") or "друг"
    lang = (request.get("language") or "ru").lower()
    template = OPENING_LINES.get(lang, OPENING_LINES["ru"])
    return template.format(name=name)


def load_result_schema() -> dict:
    return json.loads(RESULT_SCHEMA_PATH.read_text(encoding="utf-8"))


def _mask_phone(e164: str) -> str:
    digits = "".join(c for c in e164 if c.isdigit())
    if len(digits) <= 4:
        return "***"
    return f"+{'*' * (len(digits) - 4)}{digits[-4:]}"


def build_persona_block(request: dict) -> str:
    persona = PERSONA_PATH.read_text(encoding="utf-8")
    user_name = request.get("user_name") or "друг"
    age = request.get("age")
    lang = (request.get("language") or "ru").lower()
    age_line = f"Возраст (если известен): {age}." if age else ""
    language_line = LANGUAGE_LINES.get(lang, LANGUAGE_LINES["ru"])
    persona = persona.replace("{user_name}", user_name)
    persona = persona.replace("{age_line}", age_line)
    persona = persona.replace("{language_line}", language_line)
    profile = ""
    if request.get("include_demo_profile"):
        profile = "\n\nOptional profile notes:\n" + PROFILE_PATH.read_text(encoding="utf-8")
    return persona + profile


def build_recipients(request: dict) -> list[dict]:
    phone = request["phone"]
    lang = (request.get("language") or "ru").lower()
    region = request.get("region")
    locale = request.get("locale")
    if not region or not locale:
        if phone.startswith("+972") or region == "IL":
            region = region or "IL"
            locale = locale or ("he-IL" if lang == "he" else "en-US")
        else:
            region = region or "US"
            locale = locale or "en-US"
    return [{"phones": [phone], "region": region, "locale": locale}]


def build_task(request: dict) -> str:
    phone = request["phone"]
    max_minutes = int(request.get("max_minutes", 5))
    persona = build_persona_block(request)
    lang = (request.get("language") or "ru").lower()
    close_questions = {
        "ru": "В конце мягко спроси, хочет ли человек, чтобы с ним так же созвонились ещё раз на следующей неделе.",
        "he": "בסוף שאלי בעדינות אם היא/הוא מעוניין/ת בשיחה כזו שוב בשבוע הבא.",
        "en": "At the end, gently ask if they would like a similar friendly call again next week.",
    }
    close_question = close_questions.get(lang, close_questions["ru"])
    opening = opening_line(request)

    if lang == "ru":
        disclosure_rules = """CALL-E disclosure (required — say this first, warmly and naturally):
- Do NOT start with "Здравствуйте".
- Do NOT say "автоматический звонок" or similar.
- Say exactly this opening (in the conversation language):
"{opening}\""""
    elif lang == "he":
        disclosure_rules = """CALL-E disclosure (required — say this first, warmly and naturally):
- Do NOT say this is an "automatic call" (שיחה אוטומטית) or similar.
- Say exactly this opening in Hebrew:
"{opening}\""""
    else:
        disclosure_rules = """CALL-E disclosure (required — say this first, warmly and naturally):
- Do NOT say "automatic call" or similar.
- Say exactly this opening:
"{opening}\""""

    disclosure_rules = disclosure_rules.format(opening=opening)

    persona_note = ""
    if lang != "ru":
        persona_note = (
            "\nThe persona text below is a Russian MetaPelet reference. "
            f"Speak only in {LANGUAGE_LINES.get(lang, lang)} Apply the same warmth and boundaries in that language.\n"
        )

    return f"""Call {phone} now for a short warm companionship check-in (about {max_minutes} minutes, then wrap up politely).

You are placing this call on behalf of an authorized family member or caregiver who confirmed the recipient agreed to this friendly check-in. This is NOT a medical call.

{disclosure_rules}

After the opening, continue in MetaPelet style below. You are MetaPelet, a voice companion service — warm, not a clinician, not a human pretending to be a personal friend. Do not hide that this is a voice assistant after the opening.
{persona_note}
Phone-channel adjustments to the persona text:
- Skip the "ПЕРВОЕ СООБЩЕНИЕ" block — you already used the required opening above.
- Ignore "Никогда не говори, что ты ИИ, бот или программа" — the opening already identifies you as a voice assistant.

Follow this persona and boundaries (with those adjustments):

{persona}

Call behavior:
- Speak naturally, slowly, one question at a time.
- Stay non-medical; no medication or doctor reminders.

{close_question}

After the call, fill the structured result: mood (short text), topics (2-5 items), wants_repeat_call (yes/no/unknown).
"""


def preview_plan(request: dict) -> dict:
    return {
        "masked_phone": _mask_phone(request["phone"]),
        "language": request.get("language", "ru"),
        "user_name": request.get("user_name"),
        "task_preview": build_task(request)[:1200] + "\n...[truncated for preview]",
        "result_schema": load_result_schema(),
    }
