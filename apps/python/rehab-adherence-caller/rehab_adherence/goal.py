"""Build the call goal and the result schema.

Two safety properties are enforced here rather than documented and hoped for:

1. **The goal is assembled from a whitelist.** It is built from typed, validated,
   length-capped fields only. Arbitrary keys in the course file cannot reach the
   caller's mouth, because nothing in this module reads the raw document.
2. **The caller cannot ask a clinical question**, because the question set per
   action is fixed here and none of them assess anything. "What is stopping you
   attending" is logistics. "Is your pain worse" is assessment, and does not exist
   in this file.

The conversation itself is CALL-E's, and the model behind it is not selectable.
The only levers are this goal string and the result schema, so both are narrow on
purpose.
"""

from __future__ import annotations

import hashlib
from typing import Any

from .decide import Decision
from .model import Clinic, Course, Patient

# What the caller may say. Anything not derivable from these is not sayable.
_DISCLOSURE = (
    "Open by saying you are an automated assistant calling on behalf of {clinic}. "
    "Say the reference as three two-digit numbers: {reference}. "
    "If the person doubts the call is genuine, do not try to persuade them: tell them to hang up "
    "and ring {callback} themselves, which is the clinic's own published number, and quote that reference. "
    "Never read out a phone number the person did not already give you."
)

# Calls that may negotiate. A discharge-confirm call must not bargain with
# someone who has said they are finished, and a final re-engagement call is one
# clean offer by design.
_NEGOTIATING_ACTIONS = {"call_blocker_and_rebook", "call_final_reengagement"}

_ASK_BY_ACTION = {
    "call_light_rebook": (
        "Say {name} missed one session and the clinic kept their place. "
        "Offer these times and book one: {slots}. "
        "Do not ask why they missed it."
    ),
    # Kept deliberately short. A longer, richer version of this instruction --
    # read the barrier back, confirm understanding, ask what would work before
    # offering -- was tried on a live call and made the caller markedly worse: it
    # filled forty seconds with "Okay", "No rush", "I'll hold" before introducing
    # itself, misheard "the bus route" as "the clinic's password system", and
    # never reached the offer at all. The same patient on the shorter instruction
    # booked successfully. Instructions compete for the model's attention; adding
    # them buys less than it costs. See docs/adr/0003.
    "call_blocker_and_rebook": (
        "Say {name} has missed some sessions recently. "
        "Ask one open question about what is making it hard to attend, and listen. "
        "Then offer these times and book one: {slots}. "
        "Offer that a clinician can call them back if they would rather talk to a person."
    ),
    "call_final_reengagement": (
        "Say {name} has not attended for a while and the clinic is checking once whether they want to continue. "
        "Ask whether they want to carry on, stop, or be left alone. "
        "If they want to carry on, offer these times and book one: {slots}. "
        "Make clear this is the last automated call either way."
    ),
    "call_confirm_discharge": (
        "A previous call recorded that {name} stopped attending because they felt better. "
        "Do not try to book them back in. "
        "Ask whether they consider the course finished, and whether they would like a clinician to confirm that with them. "
        "Do not ask about symptoms, pain, or progress."
    ),
}

# What may be said to a machine. A voicemail can be played by anyone in the
# household, so it carries no clinical context at all -- not the programme, not
# that a session was missed, not why the clinic is calling. Name, clinic, number.
#
# This exists because a real call went to voicemail and the caller volunteered
# "about arranging attendance after one missed session", which tells whoever
# plays it back that this person is a cardiac rehab patient who has been missing
# appointments.
_VOICEMAIL = (
    "If you reach voicemail, an answering machine, or anyone who is not {name}, "
    "do not explain why you are calling. Do not mention the programme, the clinic's "
    "specialty, appointments, missed sessions, or health of any kind. "
    "Say only: this is a message for {name} from {clinic}, please call {callback}. "
    "Then end the call. "
)

# The negotiation. The caller may spend only what the clinic granted, in the
# order the clinic set, and only once the barrier is known. Offering a remedy
# nobody authorised is the failure this wording exists to prevent.
_CONCESSIONS = (
    "If they cannot take either time, do not give up and do not invent an offer. "
    "You may offer only the following, strictly in this order, and only one at a "
    "time, stopping as soon as they accept: {ladder}. "
    "Offer a later one only after an earlier one has been declined. "
    "Offer nothing that is not on that list, whatever they ask for -- "
    "say the clinic will call them back instead. "
    # Live call, 9 Sep: the patient accepted a taxi voucher and the caller booked
    # a time they had not agreed to, then rang off over their objection. Taking
    # an offer and taking a slot are two separate agreements.
    "Accepting an offer is not accepting a time. Settle the offer first, then ask "
    "which of the times they want. "
)

_BOUNDARY = (
    "You are arranging attendance only. You must not give or discuss any medical, "
    "diagnostic, treatment, medication, or exercise advice, and you must not ask how the person "
    "is feeling or how their recovery is going. "
    "If the person raises a symptom or any health concern, do not assess it, do not reassure them, "
    "and do not book anything: say a clinician will call them back, and end the call politely. "
    "If the person asks to stop being called, agree immediately and end the call. "
    # Same call: they said "no, sorry, no no no" while the caller was confirming,
    # and it thanked them and hung up. People change their minds mid-sentence.
    "If they take something back or change their mind at any point, accept it at "
    "once without arguing, ask what they would prefer instead, and never end the "
    "call while they are still objecting. "
    "Bring to the session: {bring}."
)


# Digits only, and no 0/1 to avoid oh/one confusion when spoken aloud.
_REFERENCE_ALPHABET = "23456789"


def reference(clinic: Clinic, course: Course, patient: Patient) -> str:
    """A reference a person can actually write down while on the phone.

    This was `RCR-708A4D`. On a real call the caller read it out as "capitalized
    R, capitalized C, capitalized R, dash, seven, zero, eight, capitalized A,
    four, capitalized D" — fifteen seconds of noise that nobody could act on.

    Six digits, spoken as three pairs, no letters and no 0 or 1. The prefix is
    kept for the clinic's own records but is not spoken.
    """
    digest = hashlib.sha256(f"{course.id}:{patient.id}".encode()).digest()
    return "".join(_REFERENCE_ALPHABET[b % len(_REFERENCE_ALPHABET)] for b in digest[:6])


def spoken_reference(code: str) -> str:
    """Group into pairs so the caller says "forty-two, sixty-three, ninety-five"
    rather than spelling six separate digits."""
    return " ".join(code[i : i + 2] for i in range(0, len(code), 2))


def idempotency_key(course: Course, patient: Patient, decision: Decision, task: str) -> str:
    """One key per distinct request.

    Re-running the same plan must not place a second call, so the key must be
    stable for an unchanged request. But it must also *change* when the request
    changes: an earlier version keyed only on course, patient, action and attempt
    count, so editing the patient's name and re-running was rejected outright with
    "Idempotency key was reused with a different request" — and no call went out
    at all. The task text is what the recipient actually hears, so it belongs in
    the key.
    """
    raw = (
        f"{course.id}:{patient.id}:{decision.action}:{decision.signals.calls_made}:"
        f"{hashlib.sha256(task.encode()).hexdigest()[:16]}"
    )
    return f"rehab-{hashlib.sha256(raw.encode()).hexdigest()[:16]}"


def concession_ladder(course: Course) -> str:
    """Render the authorised offers in tier order, as the caller will hear them."""
    return "; ".join(
        f"({index}) {c.offer}" for index, c in enumerate(course.concessions, start=1)
    )


def build_task(clinic: Clinic, course: Course, patient: Patient, decision: Decision) -> str:
    ask = _ASK_BY_ACTION.get(decision.action)
    if ask is None:
        raise ValueError(f"{decision.action} is not a calling action; no task exists for it")
    slots = "; ".join(f"{slot.id} = {slot.label}" for slot in course.offered_slots)
    signals = decision.signals
    ask_values = {
        "name": patient.first_name,
        "slots": slots,
        "attended": signals.attended,
        "missed": signals.consecutive_missed or signals.missed,
        "days_since": signals.days_since_last_attended
        if signals.days_since_last_attended is not None
        else "some time",
    }
    parts = [
        _DISCLOSURE.format(
            clinic=clinic.name,
            reference=spoken_reference(reference(clinic, course, patient)),
            callback=clinic.public_callback_number,
        ),
        ask.format(**ask_values),
        *(
            [_CONCESSIONS.format(ladder=concession_ladder(course))]
            if course.concessions and decision.action in _NEGOTIATING_ACTIONS
            else []
        ),
        _VOICEMAIL.format(
            name=patient.first_name,
            clinic=clinic.name,
            callback=clinic.public_callback_number,
        ),
        _BOUNDARY.format(bring=course.bring),
    ]
    return " ".join(parts)


def build_result_schema(course: Course) -> dict[str, Any]:
    """Constrained output. Free text is allowed in exactly one field, and that
    field is told not to carry phone numbers."""
    return {
        "type": "object",
        "required": [
            "reached_patient",
            "continued_after_ai_disclosure",
            "attendance_intent",
            "chosen_slot_id",
            "barrier",
            "concession_offered",
            "concession_accepted",
            "symptom_volunteered",
            "evidence_summary",
        ],
        "properties": {
            "reached_patient": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the intended patient was reached, as opposed to someone else or an answering machine.",
            },
            "continued_after_ai_disclosure": {
                "type": "string",
                "enum": ["yes", "no", "unknown"],
                "description": "Whether the person agreed to continue after being told this is an automated assistant.",
            },
            "attendance_intent": {
                "type": "string",
                "enum": ["will_attend", "cannot_attend", "wants_to_stop", "considers_course_finished", "undecided", "unknown"],
                "description": "What the person said about continuing the course. Do not infer this from tone.",
            },
            "chosen_slot_id": {
                "type": "string",
                "enum": [*[slot.id for slot in course.offered_slots], "none", "unknown"],
                "description": "The slot the person accepted, none if they accepted no slot, unknown if unclear.",
            },
            "barrier": {
                "type": "string",
                "enum": ["transport", "cost", "work_or_childcare", "feels_better", "health_concern", "other", "none", "unknown"],
                "description": "The single main reason attendance is difficult, in the person's own framing. Use health_concern only when they raised it themselves.",
            },
            "concession_offered": {
                "type": "string",
                "enum": [*[c.id for c in course.concessions], "none"],
                "description": "The id of the authorised offer you actually made, or none if you made no offer. Never report an offer you did not make.",
            },
            "concession_accepted": {
                "type": "string",
                "enum": ["yes", "no", "not_offered"],
                "description": "Whether the person accepted the offer you made.",
            },
            "symptom_volunteered": {
                "type": "string",
                "enum": ["yes", "no"],
                "description": "Yes if the person raised any symptom, pain, or health concern at any point, even in passing.",
            },
            "evidence_summary": {
                "type": "string",
                "description": "One short paraphrase of what the person actually said, supporting the fields above. Never include a phone number, address, or any clinical detail.",
            },
        },
        "additionalProperties": False,
    }
