"""
Gemini calls, kept server-side so the API key never reaches browser JS.

- extract_card_fields(): reads an ID or insurance card photo and returns profile fields.
- parse_booking_transcript(): turns the confirmed sign or typed transcript into
  structured availability, resolving relative days ("Tuesday") against today's date.

Uses the `google-genai` SDK. Both prompts ask for strict JSON and tell the
model to leave a field empty rather than guess.
"""
import json
import os
import time

from google import genai
from google.genai import errors, types

_client = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
    return _client


# A "-latest" alias because pinned versions get retired for new keys (404).
# Set GEMINI_MODEL to pin one.
MODEL_NAME = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
# Tried only when MODEL_NAME stays overloaded (see _generate).
FALLBACK_MODEL_NAME = "gemini-flash-lite-latest"


def _generate(contents):
    """One generate_content call. On 429 or 503 each model is tried twice, then
    the fallback model. Any other error (bad key, retired model) is raised at once."""
    client = _get_client()
    last_error = None
    for model in dict.fromkeys([MODEL_NAME, FALLBACK_MODEL_NAME]):
        for attempt in (1, 2):
            try:
                return client.models.generate_content(model=model, contents=contents)
            except (errors.ServerError, errors.ClientError) as exc:
                if getattr(exc, "code", None) not in (429, 503):
                    raise
                last_error = exc
                if attempt == 1:
                    time.sleep(1.5)
    raise last_error


def _strip_code_fence(text: str) -> str:
    """Gemini often wraps JSON in a ```json fence even when told not to."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.lower().startswith("json"):
            text = text[4:]
    return text.strip()


CARD_PROMPT = """This image is a government ID card or a health insurance card.
Extract whichever of the following fields are visible on THIS card. Return
STRICT JSON only, no prose before or after it, matching this schema exactly:

{
  "name": "",
  "age": null,
  "dob": "",
  "address": "",
  "insurance_name": "",
  "insurance_id": ""
}

Rules:
- "dob" must be in YYYY-MM-DD format if a date of birth is visible, else "".
- "age" is an integer only if an age (not DOB) is directly printed on the card, else null.
- Leave any field not visible on this specific card as "" (or null for age) --
  never guess, invent, or infer a value that is not actually printed on the card.
- Output only the JSON object, nothing else.
"""


def extract_card_fields(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    response = _generate([
        CARD_PROMPT,
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
    ])
    return json.loads(_strip_code_fence(response.text))


BOOKING_PROMPT_TEMPLATE = """You are parsing a transcript of ASL-to-text (or typed)
input from a deaf/hard-of-hearing user booking a medical appointment.

Today's date is {today_iso} ({today_weekday}).

Transcript: "{transcript}"

The user may reference a day of the week (resolve it to the NEXT occurrence of
that day on or after today -- if they say a day that IS today, use today's
date) and one or more specific clock times (not ranges -- e.g. "3", "4:30",
"2pm" are single timestamps, not time spans). Return STRICT JSON only, no
prose before or after it, matching this schema exactly:

{{
  "availability": [
    {{"day": "Tuesday", "date": "YYYY-MM-DD", "time": "HH:MM"}}
  ],
  "clinic_type_hint": "physical_therapy" | "eyes" | "mental" | "general" | "ent" | "dental" | null,
  "wants_interpreter": true | false | null
}}

- "time" must be 24-hour HH:MM.
- clinic_type_hint: physical_therapy = physio/rehab/PT; mental = psychiatrist,
  counselor, mental health; general = family/primary care doctor; ent = ear,
  nose, throat; eyes = optometrist/eye doctor; dental = dentist. If the
  wording fits more than one (e.g. just "therapy"), use null.
- If no day is mentioned at all, use today's date for every timestamp.
- If a field can't be determined from the transcript, use null (or an empty
  list for availability) -- never guess.
- Output only the JSON object, nothing else.
"""


def parse_booking_transcript(transcript: str, today_iso: str, today_weekday: str) -> dict:
    prompt = BOOKING_PROMPT_TEMPLATE.format(
        transcript=transcript, today_iso=today_iso, today_weekday=today_weekday,
    )
    response = _generate(prompt)
    return json.loads(_strip_code_fence(response.text))
