"""Natural-language CALL-E tasks for the two NoShowZero calls.

Both tasks: disclose that the agent is an AI assistant, speak the patient's language, never share
appointment details with anyone but the patient, never give medical advice, and never ask for
payment or insurance details. The patient's own phone number is never put into a task.
"""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

LANGUAGE_NAMES = {
    "en-US": "English", "es-US": "Spanish", "es-MX": "Spanish", "vi-VN": "Vietnamese",
    "zh-CN": "Mandarin Chinese", "ko-KR": "Korean", "fr-FR": "French",
}


def parse_time(value: str) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError(f"appointment time {value!r} must include a UTC offset")
    return dt


def local_slot(when: str, timezone: str) -> tuple[str, str]:
    """('4:30 PM', 'Friday, September 11') in the clinic's own timezone."""
    local = parse_time(when).astimezone(ZoneInfo(timezone))
    return local.strftime("%I:%M %p").lstrip("0"), f"{local.strftime('%A, %B')} {local.day}"


def language_name(code: str | None) -> str:
    return LANGUAGE_NAMES.get(code or "en-US", code or "English")


_RULES = """RULES
- Sound natural, not scripted.
- Never give medical advice. If the patient has a medical question, say the clinic team will call them back.
- Do not ask for payment, insurance, or any other sensitive details."""


def build_reminder_task(clinic: dict, appointment: dict) -> str:
    """One reminder call: confirm the appointment, or capture a reschedule preference."""
    name = appointment["patient_name"]
    first = name.split()[0]
    clinic_name = clinic["name"]
    callback = clinic.get("callback_number") or "the clinic"
    time_str, date_str = local_slot(appointment["appointment_at"], clinic["timezone"])
    service = appointment["service_type"]
    language = language_name(appointment.get("language"))

    return f"""Call {first} to remind them about their upcoming appointment at {clinic_name} and confirm they can make it.

WHO YOU ARE
You are Ava, the virtual receptionist for {clinic_name}. Say you are the clinic's virtual assistant in your
first sentence. If asked whether you are an AI, say yes. Speak {language} for the whole call.

THE APPOINTMENT
- Patient: {name}
- Service: {service}
- When: {time_str} on {date_str}
- Clinic phone number for questions: {callback}

HOW THE CALL GOES
1. Confirm you are speaking with {first}. If someone else answers, do not share any appointment details:
   ask them to have {first} call {clinic_name} at {callback}, thank them, and end the call.
2. Remind {first} of the {service} appointment at {time_str} on {date_str} and ask if they can still make it.
3. If they can: thank them warmly, ask them to arrive about ten minutes early, and end the call.
4. If they cannot make it: be warm and non-judgmental. Ask which days and times would work better and
   repeat the preference back. Tell them this slot will be released and the front desk will call to
   confirm a new time. Do not promise a specific new slot.
5. If you reach voicemail: leave one short message that {clinic_name} called about their appointment on
   {date_str} and to call {callback} to confirm or reschedule. Do not mention the service. Then hang up.

{_RULES}
- Keep the call under 90 seconds."""


def build_offer_task(clinic: dict, entry: dict, slot_at: str, service_type: str) -> str:
    """One waitlist call: offer a slot that was just released."""
    name = entry["patient_name"]
    first = name.split()[0]
    clinic_name = clinic["name"]
    callback = clinic.get("callback_number") or "the clinic"
    time_str, date_str = local_slot(slot_at, clinic["timezone"])
    language = language_name(entry.get("language"))

    return f"""Call {first}, who is on the {clinic_name} waitlist, and offer them an appointment slot that just opened.

WHO YOU ARE
You are Ava, the virtual receptionist for {clinic_name}. Say you are the clinic's virtual assistant in your
first sentence. If asked whether you are an AI, say yes. Speak {language} for the whole call.

THE OFFER
- Patient: {name}
- Service they are waiting for: {service_type}
- Open slot: {time_str} on {date_str}
- Clinic phone number for questions: {callback}

HOW THE CALL GOES
1. Confirm you are speaking with {first}. If someone else answers, ask them to have {first} call
   {clinic_name} at {callback}, and end the call.
2. Share the news: a {service_type} appointment just opened at {time_str} on {date_str}. Ask if they would
   like to take it.
3. If yes: confirm it is booked for {time_str} on {date_str} and thank them. Do not promise a text or email.
4. If no: thank them and tell them they stay on the waitlist for the next opening, unless they ask to be
   removed, in which case confirm that you will take them off.
5. If you reach voicemail: leave a short message that a slot opened up and to call {callback}, then hang up.

{_RULES}
- Keep the call under 60 seconds and never pressure the patient."""
