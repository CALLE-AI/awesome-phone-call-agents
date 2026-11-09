"""
Everything that talks to a clinic:

  search_clinics()  Step 2: call nearby clinics one at a time, nearest first,
                    until one accepts the patient's insurance and offers a
                    slot they can attend.
  book_slot()       Step 5: the real booking, placed only after the user
                    approves the proposal.
  cancel_booking()  Undoes a booking: when every interpreter then declines, or
                    when the user cancels later.

What each call may say about the patient differs on purpose. The search calls
ask only whether the clinic accepts insurance and share the user's free times;
most of the clinics called are never used, so none gets a name. Only the
booking call gives the chosen clinic the patient's name, date of birth, age,
phone and insurance details. The clinic is booked before any freelance
interpreter is asked to commit, because a patient booking is normally free to
cancel and an interpreter engagement is not.
"""

from ..calle.run import CallPurpose, call_and_wait

from . import calendar
from .types import (
    ClinicCandidate,
    ClinicSlot,
    UserInput,
    append_note,
    clean_strings,
    distance_sort_key,
)

# The most clinics a search will phone before giving up.
MAX_CLINICS_CALLED = 10

_REQUIREMENTS_FIELD = {
    "type": "array",
    "items": {"type": "string"},
    "description": (
        "Anything the clinic says is required to book or attend, for example "
        "a referral, photo ID, forms or a deposit. Empty if none."
    ),
}

_NOTES_FIELD = {
    "type": "string",
    "description": "Any other concern or condition the clinic raised. Empty if none.",
}

CLINIC_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "accepts_insurance": {"type": "boolean"},
        "available_slots": {
            "type": "array",
            "description": "Open appointment times inside the patient's free windows.",
            "items": {
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "YYYY-MM-DD"},
                    "time": {"type": "string", "description": "24-hour HH:MM, e.g. 14:30"},
                },
            },
        },
        "requirements": _REQUIREMENTS_FIELD,
        "additional_notes": _NOTES_FIELD,
    },
}

CLINIC_BOOK_SCHEMA = {
    "type": "object",
    "properties": {
        "booked": {"type": "boolean"},
        "confirmed_date": {
            "type": "string",
            "description": (
                "YYYY-MM-DD. Only set when booked=true, and must be the exact "
                "date that was asked for -- never a different date the clinic "
                "offered instead."
            ),
        },
        "confirmed_time": {
            "type": "string",
            "description": (
                "24-hour HH:MM. Only set when booked=true, and must be the "
                "exact time that was asked for -- never a different time the "
                "clinic offered instead."
            ),
        },
        "confirmed_by": {"type": "string"},
        "booking_reference": {"type": "string"},
        "blocked_reason": {
            "type": "string",
            "description": (
                "If the clinic would not book the exact requested date and "
                "time -- including because it offered a DIFFERENT date or "
                "time instead -- why. Empty if it booked the exact slot asked for."
            ),
        },
        "requirements": _REQUIREMENTS_FIELD,
        "additional_notes": _NOTES_FIELD,
    },
}

CLINIC_CANCEL_SCHEMA = {
    "type": "object",
    "properties": {
        "cancelled": {"type": "boolean"},
        "additional_notes": _NOTES_FIELD,
    },
}


def ask_insurance_then_slots(
    clinic: ClinicCandidate, user: UserInput, batch_position: int | None = None
) -> ClinicCandidate:
    """One call per clinic. The task asks about insurance first and only asks
    about slots if the answer is yes, so the branch happens inside the
    conversation. Shares the insurance provider (if asked) and the user's free
    times, nothing else. Fills in and returns `clinic`."""
    task = (
        "Start by saying: 'I am an AI agent calling on behalf of a deaf or hard of hearing "
        "person. Please help accommodate their needs as best you can.' "
        "Ask whether the clinic accepts the patient's insurance. If they ask "
        f"which insurance it is, say {user.insurance.provider_name}. If they ask "
        "for any other patient details, say those will be provided when the "
        "appointment is booked. "
        "If they do NOT accept it, thank them and end the call without asking "
        "anything else. "
        "Only if they DO accept it, say the patient is free at these times: "
        f"{calendar.describe_windows(user.free_windows)}. Ask whether the clinic "
        "can see them at any of those times. If it can, get the specific open "
        "appointment times inside those windows and return each one as a date "
        "(YYYY-MM-DD) and a time (24-hour HH:MM). If it cannot, thank them and "
        "end the call. "
        "This call is an availability check ONLY: do not book, reserve or hold "
        "any appointment, even if the clinic offers to. If they offer, say "
        "someone will call back to book once the patient has confirmed. "
        "Also record anything the clinic says is required to book or attend "
        "(for example a referral, photo ID, forms or a deposit) and any other "
        "concern they raise. Do not treat these as a reason to end the call."
    )

    result = call_and_wait(
        task, clinic.phone, CLINIC_SEARCH_SCHEMA,
        batch_position=batch_position, purpose=CallPurpose.CLINIC_SEARCH,
    )
    if not result.task_completed:
        # No answer or voicemail. accepts_insurance stays None so this can be
        # told apart from a clinic that said no.
        return clinic
    clinic.accepts_insurance = bool(result.structured_result.get("accepts_insurance", False))
    clinic.requirements = clean_strings(result.structured_result.get("requirements"))
    clinic.notes = append_note(clinic.notes, result.structured_result.get("additional_notes"))
    if not clinic.accepts_insurance:
        return clinic
    raw_slots = result.structured_result.get("available_slots") or []
    clinic.offered_slots = [
        ClinicSlot(date=s["date"], time=s["time"])
        for s in raw_slots
        if isinstance(s, dict) and "date" in s and "time" in s
    ]
    return clinic


def search_clinics(
    clinics: list[ClinicCandidate],
    user: UserInput,
    max_clinics: int = MAX_CLINICS_CALLED,
) -> "tuple[ClinicCandidate | None, list[ClinicSlot]]":
    """Calls up to `max_clinics`, nearest first, one at a time, and stops at
    the first that accepts insurance and offers a slot the user can attend.
    Satisficing: the nearest clinic that works wins, even if a farther one
    would have offered a better time. Returns (None, []) if none match."""
    shortlist = sorted(clinics, key=lambda c: distance_sort_key(c.distance_miles))[:max_clinics]
    for position, clinic in enumerate(shortlist):
        ask_insurance_then_slots(clinic, user, batch_position=position)
        if not clinic.accepts_insurance:
            continue
        slots = calendar.matched_slots(clinic.offered_slots, user.free_windows)
        if slots:
            return clinic, slots
    return None, []


def book_slot(clinic: ClinicCandidate, slot: ClinicSlot, user: UserInput) -> dict:
    """Books the approved slot. The only clinic call that identifies the
    patient. A different date or time offered on the call is refused, not
    accepted as a substitute: everyone downstream is told exactly the slot the
    user approved."""
    informed = (
        f"When we checked availability, the clinic said these are required for "
        f"the appointment: {'; '.join(clinic.requirements)}. The patient has "
        f"been told about them and wants to proceed, so book the appointment "
        f"even though they are still outstanding, if the clinic allows it. "
        if clinic.requirements
        else ""
    )
    task = (
        "Start by saying: 'I am an AI agent calling on behalf of a deaf or hard of hearing "
        "person. We called earlier to check availability, and we would like to "
        "book the appointment.' "
        f"Book the {slot.date} {slot.time} appointment -- and ONLY that "
        f"exact date and time, no other. "
        "Give them the patient's details when they ask for them: "
        f"{user.patient_summary()}. "
        f"{informed}"
        f"If {slot.date} {slot.time} is not available, or the clinic offers "
        f"any OTHER date or time instead, do NOT accept, hold, or book that "
        f"alternative under any circumstances. Treat this exactly like a "
        f"refusal to book at all: thank them, end the call, and put the "
        f"reason in blocked_reason -- if they offered a different date or "
        f"time, say so there and name it, so the patient can decide for "
        f"themselves whether to take it. "
        "Only if they can book that exact date and time: confirm the "
        "booking is actually made, return the date and time they confirmed "
        "as confirmed_date (YYYY-MM-DD) and confirmed_time (24-hour HH:MM) "
        "-- these must match what was asked for -- get the name of whoever "
        "confirmed it and a booking reference if they have one, and list "
        "anything the clinic says is still outstanding."
    )
    result = call_and_wait(
        task, clinic.phone, CLINIC_BOOK_SCHEMA, purpose=CallPurpose.CLINIC_BOOK
    )
    _require_booked(result, slot)
    return result.structured_result


def _require_booked(result, slot: ClinicSlot) -> None:
    """Raises unless the clinic really booked the exact slot the user approved.
    A failed, unanswered or declined call is not a booking, and neither is a
    booking the clinic reports for a different date or time. The clinic is
    booked before any interpreter commits, so a failure leaves nothing of ours
    to undo."""
    structured = result.structured_result
    booked = bool(result.task_completed and structured.get("booked"))
    confirmed_date = structured.get("confirmed_date")
    confirmed_time = structured.get("confirmed_time")
    mismatched = booked and (
        (isinstance(confirmed_date, str) and confirmed_date != slot.date)
        or (isinstance(confirmed_time, str) and confirmed_time != slot.time)
    )
    if booked and not mismatched:
        return

    slot_description = f"{slot.date} {slot.time}"
    if mismatched:
        detail = (
            f"REJECTED: the clinic reported booking "
            f"{confirmed_date or slot.date} {confirmed_time or slot.time} "
            f"instead -- only the exact requested time may be accepted, so "
            f"this is treated as not booked. No interpreter was confirmed. "
            f"If the clinic's own system was already updated during the "
            f"call, call them directly to make sure nothing is on their "
            f"books for the wrong day."
        )
    else:
        detail = "Nothing was booked and no interpreter was confirmed, so nothing needs cancelling."
    reason = structured.get("blocked_reason")
    clinic_said = f" The clinic said: {reason.strip()}." if isinstance(reason, str) and reason.strip() else ""
    still_needed = clean_strings(structured.get("requirements"))
    needed = f" Still required before they will book: {'; '.join(still_needed)}." if still_needed else ""
    raise RuntimeError(
        f"Clinic booking for {slot_description} did not succeed "
        f"(task_completed={result.task_completed}, "
        f"booked={structured.get('booked')!r}).{clinic_said}{needed} {detail}"
    )


def cancel_booking(
    clinic: ClinicCandidate,
    slot: ClinicSlot,
    patient_name: str,
    booking_reference: str | None = None,
) -> bool:
    """Cancels a booking made by book_slot(). Returns whether the clinic
    confirmed, so the caller can tell the user if it didn't. Takes only the
    patient's name rather than a UserInput, because a user-initiated
    cancellation can run long after the original run's objects are gone."""
    reference = f", booking reference {booking_reference}" if booking_reference else ""
    task = (
        "Start by saying: 'I am an AI agent calling on behalf of a deaf or hard of hearing "
        "person. We booked an appointment with you earlier and need to cancel "
        "it.' "
        f"Cancel the {slot.date} {slot.time} appointment for {patient_name}{reference}. "
        "Confirm it is actually cancelled."
    )
    result = call_and_wait(
        task, clinic.phone, CLINIC_CANCEL_SCHEMA, purpose=CallPurpose.CLINIC_CANCEL
    )
    return bool(result.task_completed and result.structured_result.get("cancelled"))
