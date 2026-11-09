"""
The orchestrator. `run_interpreter_mesh(user, approve=...)` runs the call
sequence that books a clinic appointment together with an ASL interpreter:

    STEP 1  validated user input   (no calls; see user_input.py)
    STEP 2  find and match a clinic (one at a time, nearest first, insurance-gated)
    STEP 3  line up an interpreter  (the user's own, a family member, or a freelancer)
    STEP 4  ask the user            (nothing is booked until they say yes)
    STEP 5  book, confirm, notify   (clinic first, then the interpreter's binding
                                     confirm, then confirmation texts)

Clinics and freelance interpreters are found by the workflow itself; both can
also be injected, which is how the tests run without a network.

The order is what keeps the fee-bearing commitment last. Nothing binding
happens before the user approves. After that the clinic is booked first (a
patient booking is normally free to cancel) and only then is the interpreter
asked to commit. A family member's earlier "yes" was given for a slot that
wasn't booked yet, so they get the same binding confirm; if they decline, the
next family member is tried, then freelancers for that one slot. If nobody
confirms, the clinic booking is cancelled.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import NoReturn

from ..calle.run import reset_call_routing

from . import calendar, clinic_call, clinic_lookup, family_call, interpreter_lookup, interpreter_matching, reminders
from .confirmation import ApprovalFn, BookingDeclined, BookingProposal, NoMatchFound
from .types import (
    AppointmentResult,
    ClinicCandidate,
    ClinicSlot,
    FamilyInterpreter,
    InterpreterCandidate,
    UserInput,
    append_note,
    clean_strings,
)


@dataclass
class _Arrangement:
    """The interpreter side of the plan, settled before anything is booked."""

    slot: ClinicSlot
    source: str  # "user_arranged" | "family" | "freelance"
    family_tier_result: str
    evidence: list[str]
    family_member: FamilyInterpreter | None = None
    # Family only: the members after `family_member`, who were never asked
    # (the search stopped at the first yes) and are the fallback if it declines.
    remaining_family: list[FamilyInterpreter] = field(default_factory=list)
    # Freelance only: the cheapest match first, then anyone else in that batch
    # who named the same slot, as fallbacks if the first declines.
    freelancers: list[InterpreterCandidate] = field(default_factory=list)
    # Family only: the caller-supplied candidate pool (tests) or None, carried
    # unresolved so the family-confirm fallback searches the same pool.
    freelance_pool: list[InterpreterCandidate] | None = None

    def person(self) -> "FamilyInterpreter | InterpreterCandidate | None":
        """Who the agent will contact for the interpreter, if anyone."""
        if self.family_member is not None:
            return self.family_member
        return self.freelancers[0] if self.freelancers else None


def run_interpreter_mesh(
    user: UserInput,
    clinics: list[ClinicCandidate] | None = None,
    candidates: list[InterpreterCandidate] | None = None,
    *,
    approve: ApprovalFn,
) -> AppointmentResult:
    """Runs the full sequence. `approve` is asked once, with a BookingProposal,
    after a clinic and an interpreter are lined up; nothing is booked unless it
    returns True (otherwise BookingDeclined is raised). NoMatchFound is raised
    when no clinic or interpreter says yes.

    `clinics` and `candidates` default to None, meaning "go find them"; tests
    pass explicit lists instead."""
    # Real-mode line assignments must not leak between runs in one process.
    reset_call_routing()

    # --- STEP 2: find and match a clinic ----------------------------------
    if clinics is None:
        clinics = clinic_lookup.find_clinics(
            user.zipcode, user.appointment_type, limit=clinic_call.MAX_CLINICS_CALLED
        )
    if not clinics:
        raise NoMatchFound(
            f"We couldn't find any {user.appointment_type.value.replace('_', ' ')} "
            f"clinics near {user.zipcode}."
        )
    clinic, matched = clinic_call.search_clinics(clinics, user)
    if clinic is None:
        raise NoMatchFound(
            "No clinic we called had a time that fits your schedule and insurance."
        )

    # --- STEP 3: line up an interpreter -----------------------------------
    arrangement = _arrange_interpreter(user, clinic, matched, candidates)

    # --- STEP 4: ask the user ---------------------------------------------
    if not approve(_build_proposal(clinic, arrangement)):
        raise BookingDeclined("The user declined the proposed appointment.")

    # --- STEP 5: book, confirm, notify ------------------------------------
    return _book_and_confirm(user, clinic, arrangement)


def describe_goal(user: UserInput) -> str:
    """Plain-language statement of what a submitted request will do and what
    each kind of call shares. Returned by POST /runs as `plan`. The search
    breadth is read from the same constants the search uses, so this text
    can't drift from the behavior."""
    provider = user.insurance.provider_name
    text = (
        f"Book a {user.appointment_type.value.replace('_', ' ')} appointment "
        f"near {user.zipcode} and secure an ASL interpreter for it. To do "
        f"that I'll phone nearby clinics (up to {clinic_call.MAX_CLINICS_CALLED}, one at a time, nearest "
        f"first, stopping at the first that accepts your insurance and has a "
        f"time you're free). On those calls I'll say the "
        f"patient is deaf or hard of hearing, share your insurance provider "
        f"({provider}) if asked, and share the times you're free "
        f"({calendar.describe_windows(user.free_windows)}). "
    )
    if not user.has_interpreter:
        family_step = "your family list one at a time, then " if user.family else ""
        family_told = " Family members are also told your name." if user.family else ""
        batch_size = interpreter_matching.DEFAULT_BATCH_SIZE
        batch_phrase = "one at a time" if batch_size == 1 else f"{batch_size} at a time"
        text += (
            f"Then I'll phone {family_step}freelance interpreters "
            f"{batch_phrase}, telling them the matched appointment times."
            f"{family_told} "
        )
    text += (
        f"Before I book anything I'll show you the clinic, the time and the "
        f"interpreter and ask you to approve; if you say no, nothing is "
        f"booked. If you say yes, I'll call the clinic back to book"
        f"{'' if user.has_interpreter else ', then confirm the interpreter'}. "
        f"On that booking call only, I'll give the clinic your name, date of "
        f"birth, age, phone number and insurance details ({provider}, policy "
        f"{user.insurance.policy_number}) so they can put the appointment in "
        f"their book. If a clinic says something is required for the "
        f"appointment, such as a referral, I'll tell you before you decide."
    )
    return text


# --- Step 3 ----------------------------------------------------------------

def _arrange_interpreter(
    user: UserInput,
    clinic: ClinicCandidate,
    matched: list[ClinicSlot],
    candidates: list[InterpreterCandidate] | None,
) -> _Arrangement:
    """Settles who will interpret, and for which matched slot, without
    committing anyone."""
    if user.has_interpreter:
        # Nothing is collected about the user's own interpreter, so nobody is
        # called or texted for them, and with several matched slots one is
        # picked at random.
        return _Arrangement(
            slot=random.choice(matched),
            source="user_arranged",
            family_tier_result="not_applicable",
            evidence=[
                f"User arranged their own interpreter; no contact details on "
                f"file, so none was called or texted. Slot chosen at random "
                f"from {len(matched)} matched slot(s)."
            ],
        )

    if user.family:
        member, slot = family_call.call_family_in_order(user.family, matched, user, clinic)
        if member is not None:
            return _Arrangement(
                slot=slot,
                source="family",
                family_tier_result="locked_in",
                family_member=member,
                # Matched by identity: two entries could share every field.
                remaining_family=user.family[
                    next(i for i, m in enumerate(user.family) if m is member) + 1 :
                ],
                freelance_pool=candidates,
                evidence=[
                    f"Family member {member.name} ({member.relation}) locked "
                    f"in for {slot.date} {slot.time} (list order, stopped there)."
                ],
            )

    return _arrange_freelancer(user, clinic, matched, candidates)


def _resolve_freelance_pool(
    clinic: ClinicCandidate, candidates: list[InterpreterCandidate] | None
) -> list[InterpreterCandidate]:
    """The interpreters to ask: the caller's list if given (tests), otherwise a
    live lookup. Only Illinois has a live source; elsewhere the pool is empty
    and the run ends with "no interpreter found" rather than inventing one.
    A live pool is capped at MAX_INTERPRETER_BATCHES batches to bound the
    number of calls. Shared by the first freelance search and the family
    fallback, so both draw on the same pool."""
    if candidates is None:
        if interpreter_lookup.is_illinois_zip(clinic.zipcode):
            limit = interpreter_matching.MAX_INTERPRETER_BATCHES * interpreter_matching.DEFAULT_BATCH_SIZE
            candidates = interpreter_lookup.find_interpreters_il(clinic.zipcode)[:limit]
        else:
            candidates = []
    return candidates


def _arrange_freelancer(
    user: UserInput,
    clinic: ClinicCandidate,
    matched: list[ClinicSlot],
    candidates: list[InterpreterCandidate] | None,
) -> _Arrangement:
    """The batch search stops at the first batch with a match. Its cheapest
    match is proposed; the others in that batch who named the same slot are
    kept as fallbacks for the final confirmation."""
    candidates = _resolve_freelance_pool(clinic, candidates)
    if not candidates:
        raise NoMatchFound(f"We couldn't find an interpreter near {clinic.zipcode}.")

    ranked = interpreter_matching.search_freelancers_in_batches(
        candidates, matched, clinic, batch_size=interpreter_matching.DEFAULT_BATCH_SIZE
    )
    if not ranked:
        raise NoMatchFound("No interpreter we called could cover that time.")

    slot = interpreter_matching.slot_for_candidate(ranked[0], matched)
    if slot is None:
        raise RuntimeError(
            f"{ranked[0].name} matched the batch but named none of the matched "
            f"slots -- refusing to guess a time."
        )
    fallbacks = [c for c in ranked[1:] if slot.key() in c.coverable_slots]
    return _Arrangement(
        slot=slot,
        source="freelance",
        family_tier_result="no_overlap" if user.family else "not_registered",
        evidence=[],
        freelancers=[ranked[0], *fallbacks],
    )


# --- Step 4 ----------------------------------------------------------------

def _freelancer_detail(candidate: InterpreterCandidate) -> dict:
    return {
        "tier": "freelance",
        "name": candidate.name,
        "phone": candidate.phone,  # kept for cancel_appointment()
        "rate_per_hour": candidate.rate_per_hour,
        "minimum_hours": candidate.minimum_hours,
        "total_estimate": candidate.total_cost(),
        "expertise": candidate.expertise,
        "source": candidate.source,
    }


def _interpreter_detail(arrangement: _Arrangement) -> dict:
    if arrangement.source == "user_arranged":
        return {"tier": "user_arranged"}
    if arrangement.source == "family":
        member = arrangement.family_member
        return {
            "tier": "family", "name": member.name, "relation": member.relation,
            "phone": member.phone,
        }
    return _freelancer_detail(arrangement.freelancers[0])


def _notes(clinic: ClinicCandidate, person, booking: dict | None = None) -> list[str]:
    """Concerns raised on the calls so far, each prefixed with who said it."""
    entries = [(clinic.name, clinic.notes)]
    if booking is not None:
        entries.append(
            (f"{clinic.name} (booking call)", append_note(None, booking.get("additional_notes")))
        )
    if person is not None:
        entries.append((person.name, person.notes))
    return [f"{who}: {text}" for who, text in entries if text]


def _build_proposal(clinic: ClinicCandidate, arrangement: _Arrangement) -> BookingProposal:
    return BookingProposal(
        clinic_name=clinic.name,
        clinic_zipcode=clinic.zipcode,
        clinic_distance_miles=clinic.distance_miles,
        clinic_address=clinic.address,
        date=arrangement.slot.date,
        time=arrangement.slot.time,
        interpreter=_interpreter_detail(arrangement),
        alternates=[_freelancer_detail(c) for c in arrangement.freelancers[1:]],
        requirements=list(clinic.requirements),
        notes=_notes(clinic, arrangement.person()),
    )


# --- Step 5 ----------------------------------------------------------------

def _book_and_confirm(
    user: UserInput, clinic: ClinicCandidate, arrangement: _Arrangement
) -> AppointmentResult:
    """Books the clinic (the first call that gives it the patient's details),
    has the interpreter confirm for real, then texts the user and whoever was
    secured. The booking call raises if it didn't actually book, and at that
    point nothing fee-bearing exists yet. Adding the booking to the user's
    calendar is not implemented."""
    slot = arrangement.slot
    booking = clinic_call.book_slot(clinic, slot, user)

    if arrangement.source == "freelance":
        interpreter = _confirm_freelancer(user, clinic, slot, booking, arrangement.freelancers)
        interpreter_detail = {**_freelancer_detail(interpreter), "confirmed": True}
        arrangement.evidence.append(
            f"{interpreter.name} confirmed for {slot.date} {slot.time} at "
            f"${interpreter.rate_per_hour}/hr."
        )
        source = "freelance"
    elif arrangement.source == "family":
        interpreter, source = _confirm_family(user, clinic, slot, booking, arrangement)
        if source == "family":
            interpreter_detail = {
                "tier": "family", "name": interpreter.name,
                "relation": interpreter.relation, "phone": interpreter.phone,
                "confirmed": True,
            }
            arrangement.evidence.append(
                f"{interpreter.name} ({interpreter.relation}) confirmed for "
                f"{slot.date} {slot.time}."
            )
        else:
            # Every family member declined; a freelancer covered the booked slot.
            interpreter_detail = {**_freelancer_detail(interpreter), "confirmed": True}
            arrangement.evidence.append(
                f"No family member could confirm {slot.date} {slot.time}; "
                f"{interpreter.name} (freelance) confirmed instead at "
                f"${interpreter.rate_per_hour}/hr."
            )
    else:
        interpreter = arrangement.family_member  # None when the user arranged their own
        interpreter_detail = _interpreter_detail(arrangement)
        source = arrangement.source

    distance = (
        f"{clinic.distance_miles} mi" if clinic.distance_miles is not None else "distance unknown"
    )
    evidence = [
        f"Clinic {clinic.name} [{clinic.clinic_type}] ({clinic.zipcode}, "
        f"{distance}, source={clinic.source}) matched and booked for "
        f"{slot.date} {slot.time}.",
        *arrangement.evidence,
    ]
    requirements = list(
        dict.fromkeys([*clinic.requirements, *clean_strings(booking.get("requirements"))])
    )
    evidence.extend(_send_confirmations(user, clinic, slot, interpreter, requirements))
    return AppointmentResult(
        appointment=booking,
        interpreter=interpreter_detail,
        family_tier_result=arrangement.family_tier_result,
        interpreter_source=source,
        clinic_contact={
            "name": clinic.name, "phone": clinic.phone,
            "zipcode": clinic.zipcode, "address": clinic.address,
        },
        appointment_slot={"date": slot.date, "time": slot.time},
        evidence=evidence,
        requirements=requirements,
        notes=_notes(clinic, interpreter, booking),
    )


def _cancel_and_raise(
    user: UserInput, clinic: ClinicCandidate, slot: ClinicSlot, booking: dict, reason: str
) -> NoReturn:
    """Nobody confirmed, so the booking made on the strength of an earlier
    non-binding "yes" is undone. If the clinic won't cancel, the error tells
    the user which booking to undo themselves."""
    reference = booking.get("booking_reference")
    if clinic_call.cancel_booking(clinic, slot, user.name, reference):
        outcome = f"The booking at {clinic.name} was cancelled."
    else:
        outcome = (
            f"The booking at {clinic.name} ({clinic.phone}) could NOT be "
            f"cancelled automatically -- please call them to cancel it "
            f"(reference: {reference or 'none given'})."
        )
    raise RuntimeError(f"{reason} {outcome}")


def _confirm_freelancer(
    user: UserInput,
    clinic: ClinicCandidate,
    slot: ClinicSlot,
    booking: dict,
    freelancers: list[InterpreterCandidate],
) -> InterpreterCandidate:
    """The binding ask, after the clinic is booked. The first freelancer to say
    yes gets the engagement; if none does, the clinic booking is cancelled so
    no appointment is left without an interpreter."""
    for candidate in freelancers:
        if interpreter_matching.confirm_interpreter(candidate, slot, clinic, user):
            return candidate
    _cancel_and_raise(
        user, clinic, slot, booking,
        f"Every interpreter who could cover {slot.date} {slot.time} declined "
        f"the final confirmation.",
    )


def _confirm_family(
    user: UserInput,
    clinic: ClinicCandidate,
    slot: ClinicSlot,
    booking: dict,
    arrangement: _Arrangement,
) -> "tuple[FamilyInterpreter | InterpreterCandidate, str]":
    """The binding ask for a family arrangement, after the clinic is booked.
    The locked-in member is called back to confirm for real; if they decline,
    the next unreached member is asked directly. If the whole list declines,
    freelancers are searched for this one booked slot. Returns who confirmed
    and "family" or "freelance"; cancels the clinic booking and raises if
    nobody does."""
    for member in (arrangement.family_member, *arrangement.remaining_family):
        if family_call.confirm_family_member(member, slot, user, clinic):
            return member, "family"

    # Resolved only now: most runs never reach this fallback.
    freelance_pool = _resolve_freelance_pool(clinic, arrangement.freelance_pool)
    ranked = interpreter_matching.search_freelancers_in_batches(
        freelance_pool, [slot], clinic, batch_size=interpreter_matching.DEFAULT_BATCH_SIZE
    )
    for candidate in ranked:
        if interpreter_matching.confirm_interpreter(candidate, slot, clinic, user):
            return candidate, "freelance"

    _cancel_and_raise(
        user, clinic, slot, booking,
        f"Every family member and freelance interpreter who could cover "
        f"{slot.date} {slot.time} declined the final confirmation.",
    )


def _send_confirmations(
    user: UserInput,
    clinic: ClinicCandidate,
    slot: ClinicSlot,
    interpreter: "FamilyInterpreter | InterpreterCandidate | None",
    requirements: list[str],
) -> list[str]:
    """Texts the user and the secured interpreter (just the user when they
    brought their own). With no provider configured each send becomes an
    evidence line instead of failing a run whose appointment is booked."""
    interpreter_name = interpreter.name if interpreter else None
    recipients = [("user", user.phone_number, "You")]
    if interpreter is not None:
        recipients.append(("interpreter", interpreter.phone, interpreter.name))

    lines = []
    for label, phone, recipient_name in recipients:
        body = reminders.confirmation_text_body(
            recipient_name, clinic.name, slot, interpreter_name,
            requirements=requirements if label == "user" else None,
        )
        try:
            reminders.send_confirmation_text(phone, body)
        except NotImplementedError:
            lines.append(
                f"Confirmation text to {label} ({phone}) NOT sent: no "
                f"SMS provider wired up. Message was: {body}"
            )
        else:
            lines.append(f"Confirmation text sent to {label} ({phone}).")
    if interpreter is None:
        lines.append(
            "No interpreter notification: the user arranged their own "
            "interpreter and no contact details were collected for them."
        )
    return lines


# --- Cancellation ------------------------------------------------------------

def cancel_appointment(result: dict, patient_name: str) -> dict:
    """Cancels a booked appointment on the user's request: calls the clinic,
    then releases whoever was confirmed to interpret (nobody is called for a
    user-arranged interpreter).

    `result` is the plain dict a succeeded run's AppointmentResult serializes
    to, so this works from a stored record alone, long after the run's objects
    are gone. The clinic cancel and the interpreter release are both
    attempted whatever the other's outcome, because an interpreter who
    no-shows is worse than a clinic that still thinks the slot is taken. A
    clinic that doesn't confirm is reported, not raised, so the user knows to
    follow up."""
    contact = result.get("clinic_contact") or {}
    if not contact.get("phone"):
        raise RuntimeError(
            "This booking has no clinic contact info on file. Call the "
            "clinic directly to cancel."
        )
    clinic = ClinicCandidate(
        name=contact.get("name") or "the clinic",
        phone=contact["phone"],
        zipcode=contact.get("zipcode", ""),
        clinic_type="",
        address=contact.get("address"),
    )
    slot_dict = result.get("appointment_slot") or {}
    slot = ClinicSlot(date=slot_dict.get("date", ""), time=slot_dict.get("time", ""))
    booking_reference = (result.get("appointment") or {}).get("booking_reference")

    clinic_cancelled = clinic_call.cancel_booking(clinic, slot, patient_name, booking_reference)
    evidence = [
        f"Clinic {clinic.name} "
        + (
            "confirmed the cancellation."
            if clinic_cancelled
            else "did NOT confirm the cancellation -- call them directly to make sure."
        )
    ]

    interpreter = result.get("interpreter") or {}
    tier = interpreter.get("tier")
    interpreter_released = None
    release_reason = f"the {slot.date} {slot.time} appointment at {clinic.name} was cancelled"
    if tier == "freelance" and interpreter.get("phone"):
        candidate = InterpreterCandidate(name=interpreter.get("name", ""), phone=interpreter["phone"])
        interpreter_matching.send_release(candidate, release_reason)
        interpreter_released = True
        evidence.append(f"{candidate.name} was called and told the engagement is cancelled.")
    elif tier == "family" and interpreter.get("phone"):
        member = FamilyInterpreter(
            name=interpreter.get("name", ""), relation=interpreter.get("relation", ""),
            phone=interpreter["phone"],
        )
        family_call.release_family_member(member, patient_name, clinic, slot, release_reason)
        interpreter_released = True
        evidence.append(f"{member.name} was called and told the appointment is cancelled.")
    else:
        interpreter_released = False
        evidence.append(
            "No interpreter to release -- the user arranged their own, with "
            "no contact details on file."
            if tier == "user_arranged"
            else "No interpreter contact on file to release."
        )

    return {
        "clinic_cancelled": clinic_cancelled,
        "interpreter_released": interpreter_released,
        "evidence": evidence,
    }
