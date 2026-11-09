"""
Step 3B: asking freelance interpreters, and the binding confirm.

A satisficing batch search, not a global optimization. Candidates are asked in
batches of DEFAULT_BATCH_SIZE whether they can cover any of the matched clinic
slots, and for their hourly rate. The search stops at the first batch with a
match, and the cheapest match in that batch is the one proposed. "Cheapest"
is only ever compared within a batch, so two runs against the same pool can
book different people; that is the trade for a bounded number of calls.

`confirm_interpreter()` is the single binding ask. It happens last, after the
user approved and the clinic slot is booked.

What each call shares differs on purpose. The availability ask gives the
clinic's name and location (needed to judge travel) but never the patient's
identity, since most of a batch is never hired. The confirm call goes only to
whoever is about to be hired, so it adds the patient's name and phone.

Batch members are dialled one after another by default; every member is still
asked, and the choice waits for all of them. A CALL-E account without a
dedicated outbound number runs one call at a time, so dialling at once would
only stagger them anyway. With a dedicated number, set
SIGNCALL_FREELANCE_PARALLEL_BATCH=1 to dial a batch simultaneously.
"""

import os
from concurrent.futures import ThreadPoolExecutor

from ..calle.run import CallPurpose, call_and_wait

from .types import ClinicCandidate, ClinicSlot, InterpreterCandidate, UserInput, append_note

_NOTES_FIELD = {
    "type": "string",
    "description": "Any concern or condition they raised. Empty if none.",
}

# Interpreters asked together per batch.
DEFAULT_BATCH_SIZE = 2

# Batches asked before giving up, which caps the freelance search at
# MAX_INTERPRETER_BATCHES * DEFAULT_BATCH_SIZE calls.
MAX_INTERPRETER_BATCHES = 3

# Whether a batch is dialled at once (True) or one after another (False).
PARALLEL_BATCH_CALLS = os.environ.get("SIGNCALL_FREELANCE_PARALLEL_BATCH") == "1"

INTERPRETER_AVAILABILITY_SCHEMA = {
    "type": "object",
    "properties": {
        "coverable_slots": {"type": "array", "items": {"type": "string"}},
        "rate_per_hour": {"type": "number"},
        "minimum_hours": {"type": "number"},
        "additional_notes": _NOTES_FIELD,
    },
}

INTERPRETER_CONFIRM_SCHEMA = {
    "type": "object",
    "properties": {"confirmed": {"type": "boolean"}, "additional_notes": _NOTES_FIELD},
}


def _ask_availability_and_rate(
    candidate: InterpreterCandidate,
    slot_keys: list[str],
    clinic: ClinicCandidate,
    batch_position: int | None = None,
) -> bool:
    """One non-binding availability check (no hold). Records what the
    interpreter said on the candidate and returns whether they count as a
    match for this batch."""
    task = (
        f"Start by saying you are an AI agent calling on behalf of a deaf or hard of hearing person. Ask this ASL interpreter whether they're available for any of "
        f"these appointment times: {', '.join(slot_keys)}, to interpret at "
        f"{clinic.name} ({clinic.location_description()}). Return every one "
        f"of those times they can cover, each written back exactly as given "
        f"(YYYY-MM-DD HH:MM). If they can cover any of them, also get their "
        f"hourly rate and their minimum billable hours for the visit. This "
        f"is an availability check only -- do not book or place a hold."
    )

    result = call_and_wait(
        task, candidate.phone, INTERPRETER_AVAILABILITY_SCHEMA,
        batch_position=batch_position, purpose=CallPurpose.INTERPRETER_AVAILABILITY,
    )
    if not result.task_completed:
        return False
    candidate.notes = append_note(candidate.notes, result.structured_result.get("additional_notes"))
    raw = result.structured_result.get("coverable_slots") or []
    coverable = [s for s in raw if isinstance(s, str) and s in slot_keys]
    if not coverable:
        return False
    candidate.rate_per_hour = result.structured_result.get("rate_per_hour")
    candidate.minimum_hours = result.structured_result.get("minimum_hours")
    # Keep the exact slots they named, so they are only ever booked for one of those.
    candidate.coverable_slots = coverable
    # Available but no rate is not a match: rates are what the batch compares,
    # and the confirm call would otherwise read "$None/hr" to a real person.
    return candidate.rate_per_hour is not None


def rank_by_rate(matches: list[InterpreterCandidate]) -> list[InterpreterCandidate]:
    """Cheapest hourly rate first. Every candidate here already has a rate;
    ties keep the caller's order."""
    return sorted(matches, key=lambda c: c.rate_per_hour)


def _ask_batch(
    batch: list[InterpreterCandidate], slot_keys: list[str], clinic: ClinicCandidate
) -> list[bool]:
    """Asks every member of one batch and returns their answers in batch
    order. An earlier yes never skips a later member: the cheapest-of-the-batch
    choice needs all answers first."""
    if PARALLEL_BATCH_CALLS:
        with ThreadPoolExecutor(max_workers=len(batch)) as pool:
            return list(
                pool.map(
                    lambda item: _ask_availability_and_rate(
                        item[1], slot_keys, clinic, batch_position=item[0]
                    ),
                    enumerate(batch),
                )
            )
    return [
        _ask_availability_and_rate(candidate, slot_keys, clinic, batch_position=position)
        for position, candidate in enumerate(batch)
    ]


def search_freelancers_in_batches(
    candidates: list[InterpreterCandidate],
    matched_slots: list[ClinicSlot],
    clinic: ClinicCandidate,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> list[InterpreterCandidate]:
    """Asks candidates `batch_size` at a time against the matched slots. The
    first batch with at least one match ends the search; its matches come back
    cheapest first. An exception on any call ends the search with that
    exception."""
    if not matched_slots:
        return []
    slot_keys = [s.key() for s in matched_slots]
    for start in range(0, len(candidates), batch_size):
        batch = candidates[start : start + batch_size]
        answers = _ask_batch(batch, slot_keys, clinic)
        matches = [candidate for candidate, matched in zip(batch, answers) if matched]
        if matches:
            return rank_by_rate(matches)
    return []


def slot_for_candidate(
    candidate: InterpreterCandidate, matched_slots: list[ClinicSlot]
) -> "ClinicSlot | None":
    """The first matched slot the candidate named. Deriving the slot from the
    candidate keeps a cheaper interpreter who can only do Monday from being
    booked for Thursday."""
    for slot in matched_slots:
        if slot.key() in candidate.coverable_slots:
            return slot
    return None


def confirm_interpreter(
    candidate: InterpreterCandidate, slot: ClinicSlot, clinic: ClinicCandidate, user: UserInput
) -> bool:
    """The one moment an interpreter is asked to commit: a live yes/no on the
    exact slot and price, made after the user approved and the clinic is
    booked. Only the person about to be hired is called, so this is where they
    learn where the appointment is and who they are interpreting for."""
    task = (
        f"Start by saying you are an AI agent calling on behalf of {user.name}. "
        f"Call this interpreter back and confirm: can they do "
        f"{slot.date} {slot.time} at ${candidate.rate_per_hour}/hr, "
        f"{candidate.minimum_hours}hr minimum, interpreting for "
        f"{user.name} (phone {user.phone_number}) at {clinic.name}, "
        f"{clinic.location_description()}? Get a clear yes or no."
    )
    result = call_and_wait(
        task, candidate.phone, INTERPRETER_CONFIRM_SCHEMA,
        purpose=CallPurpose.INTERPRETER_CONFIRM,
    )
    candidate.notes = append_note(candidate.notes, result.structured_result.get("additional_notes"))
    return bool(result.structured_result.get("confirmed", False))


def send_release(candidate: InterpreterCandidate, reason: str) -> None:
    """Tells a confirmed freelancer the appointment is off. Always a single
    standalone call, hence batch_position=0."""
    task = (
        f"Start by saying you are an AI agent calling on behalf of a deaf or hard "
        f"of hearing person. Call this interpreter and let them know the "
        f"appointment was cancelled: {reason}."
    )
    call_and_wait(
        task, candidate.phone, {"type": "object"},
        batch_position=0, purpose=CallPurpose.INTERPRETER_RELEASE,
    )
