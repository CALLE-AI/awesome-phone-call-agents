"""
Step 3A: the family tier.

The user's registered family members are phoned one at a time, in list order,
after a clinic and its matched slots exist. Each is asked which of those
slots they can cover; the first who can is locked in and nobody further is
called. Family is reached by phone only.

After the clinic is booked, `confirm_family_member()` places the binding ask
(the earlier "yes" was to a slot not yet booked). If the user cancels later,
`release_family_member()` tells whoever was confirmed that it is off.
"""

from ..calle.run import CallPurpose, call_and_wait

from .types import ClinicCandidate, ClinicSlot, FamilyInterpreter, UserInput, append_note

_NOTES_FIELD = {
    "type": "string",
    "description": "Any concern or condition they raised. Empty if none.",
}

FAMILY_SLOT_SCHEMA = {
    "type": "object",
    "properties": {
        "coverable_slots": {
            "type": "array",
            "items": {"type": "string", "description": "YYYY-MM-DD HH:MM"},
        },
        "additional_notes": _NOTES_FIELD,
    },
}

FAMILY_CONFIRM_SCHEMA = {
    "type": "object",
    "properties": {"confirmed": {"type": "boolean"}, "additional_notes": _NOTES_FIELD},
}

FAMILY_RELEASE_SCHEMA = {"type": "object", "properties": {"additional_notes": _NOTES_FIELD}}


def call_family_in_order(
    family: list[FamilyInterpreter],
    matched_slots: list[ClinicSlot],
    user: UserInput,
    clinic: ClinicCandidate,
) -> "tuple[FamilyInterpreter | None, ClinicSlot | None]":
    """The first member who can cover a matched slot, with the first matched
    slot they named (in the clinic's own order); (None, None) if nobody can.
    Family is told the clinic's name and location: they already know who the
    patient is, and need the location to judge whether they can make it."""
    if not matched_slots:
        return None, None
    slot_keys = [s.key() for s in matched_slots]
    for position, member in enumerate(family):
        task = (
            f"Start by saying you are an AI agent calling on behalf of {user.name}, "
            f"who is deaf or hard of hearing, and ask if you are speaking with "
            f"{member.name}. Ask whether they "
            f"are free to interpret at any of these specific appointment "
            f"times: {', '.join(slot_keys)}, at {clinic.name} "
            f"({clinic.location_description()}). Return every one of those "
            f"times they can cover, each written back exactly as given "
            f"(YYYY-MM-DD HH:MM). If they can't cover any of them, return an "
            f"empty list."
        )

        result = call_and_wait(
            task, member.phone, FAMILY_SLOT_SCHEMA,
            batch_position=position, purpose=CallPurpose.FAMILY_AVAILABILITY,
        )
        if not result.task_completed:
            continue  # no answer: try the next member
        member.notes = append_note(member.notes, result.structured_result.get("additional_notes"))
        raw = result.structured_result.get("coverable_slots") or []
        member.coverable_slots = [s for s in raw if isinstance(s, str)]
        for slot in matched_slots:
            if slot.key() in member.coverable_slots:
                return member, slot
    return None, None


def confirm_family_member(
    member: FamilyInterpreter, slot: ClinicSlot, user: UserInput, clinic: ClinicCandidate
) -> bool:
    """The binding ask, made after the clinic is booked: a live yes/no for the
    exact slot. Works for the member locked in during the search and for one
    further down the list who was never reached, so the wording doesn't assume
    an earlier call. Includes the location, since this call tells them whether
    they need to show up."""
    task = (
        f"Start by saying you are an AI agent calling on behalf of {user.name}. "
        f"Tell {member.name} that {user.name}'s appointment has been booked "
        f"for {slot.date} {slot.time} at {clinic.name} "
        f"({clinic.location_description()}), and ask whether they can "
        f"interpret at that time. Get a clear yes or no."
    )
    result = call_and_wait(
        task, member.phone, FAMILY_CONFIRM_SCHEMA, purpose=CallPurpose.FAMILY_CONFIRM,
    )
    member.notes = append_note(member.notes, result.structured_result.get("additional_notes"))
    return bool(result.structured_result.get("confirmed", False))


def release_family_member(
    member: FamilyInterpreter,
    patient_name: str,
    clinic: ClinicCandidate,
    slot: ClinicSlot,
    reason: str,
) -> None:
    """Tells a confirmed family member the appointment is off. There is
    nothing to decide, only to be told, so nothing is returned."""
    task = (
        f"Start by saying you are an AI agent calling on behalf of {patient_name}. "
        f"Tell {member.name} that {patient_name}'s appointment for "
        f"{slot.date} {slot.time} at {clinic.name} ({clinic.location_description()}) "
        f"has been cancelled: {reason}. They do not need to interpret for it."
    )
    call_and_wait(
        task, member.phone, FAMILY_RELEASE_SCHEMA, purpose=CallPurpose.FAMILY_RELEASE,
    )
