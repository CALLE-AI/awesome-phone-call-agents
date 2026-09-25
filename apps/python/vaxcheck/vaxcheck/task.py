"""Builds the CALL-E task text for one guardian call.

The task text is the actual product here. Everything CALL-E does on the line
comes from it, so it is written as an explicit, ordered script with hard
boundaries rather than a loose instruction.

Three rules shape it:

1. Disclose first. The guardian learns who is calling, on whose behalf, and why,
   before a single question is asked.
2. Confirm identity before disclosing anything about the child. A phone number on
   a school roster is not proof of who picked up.
3. Never give medical advice. The call collects reported history and a decision.
   Any clinical question goes to the school nurse or the family's own doctor.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .phone import mask


@dataclass
class Session:
    """One immunisation session a school is preparing for."""

    school_name: str
    vaccine_name: str
    session_date: str
    nurse_contact: str
    programme: str = "school immunisation programme"
    language: str = "English"
    region: str = "SG"

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Session":
        missing = [
            k
            for k in ("school_name", "vaccine_name", "session_date", "nurse_contact")
            if not str(raw.get(k, "")).strip()
        ]
        if missing:
            raise ValueError(f"session is missing required fields: {', '.join(missing)}")
        return cls(
            school_name=raw["school_name"].strip(),
            vaccine_name=raw["vaccine_name"].strip(),
            session_date=raw["session_date"].strip(),
            nurse_contact=raw["nurse_contact"].strip(),
            programme=raw.get("programme", "school immunisation programme").strip(),
            language=raw.get("language", "English").strip(),
            region=raw.get("region", "SG").strip(),
        )


@dataclass
class Student:
    student_id: str
    student_name: str
    class_name: str
    guardian_name: str
    guardian_phone: str

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "Student":
        from .phone import normalize

        missing = [
            k
            for k in (
                "student_id",
                "student_name",
                "class_name",
                "guardian_name",
                "guardian_phone",
            )
            if not str(raw.get(k, "")).strip()
        ]
        if missing:
            raise ValueError(f"student is missing required fields: {', '.join(missing)}")
        return cls(
            student_id=str(raw["student_id"]).strip(),
            student_name=raw["student_name"].strip(),
            class_name=str(raw["class_name"]).strip(),
            guardian_name=raw["guardian_name"].strip(),
            guardian_phone=normalize(raw["guardian_phone"]),
        )

    @property
    def masked_phone(self) -> str:
        return mask(self.guardian_phone)


def build_task(session: Session, student: Student) -> str:
    """Render the call script for one guardian."""
    return f"""You are calling on behalf of {session.school_name} about its {session.programme}.
This is an administrative consent and screening call. It is not medical advice.

Speak in {session.language}. Be warm, brief, and patient. Many guardians will be
at work. If they ask for more time, offer to call back rather than rushing them.

STEP 1 - DISCLOSE.
Say who you are, that you are calling on behalf of {session.school_name}, and that
the call is about the upcoming {session.vaccine_name} session on {session.session_date}.
Say that the call is recorded and summarised for the school nurse.

STEP 2 - CONFIRM IDENTITY BEFORE ANY DETAIL.
Ask whether you are speaking with {student.guardian_name}, the parent or legal
guardian of {student.student_name} in class {student.class_name}.
Do not reveal any information about the student until this is confirmed.
If the person is not the guardian, do not discuss the student at all. Ask when the
guardian can be reached, thank them, and end the call.

STEP 3 - EXPLAIN THE CHOICE.
Explain that the school offers the {session.vaccine_name} free during the session on
{session.session_date}, and that the family may instead have it done by their own
doctor. Either choice is fine. Make clear they can also decline.

STEP 4 - COLLECT, DO NOT ASSESS.
Ask, in plain language:
  a. Has {student.student_name} already had the {session.vaccine_name}?
  b. Does {student.student_name} have any allergies, and if so what happens?
  c. Is {student.student_name} unwell or feverish today?
  d. Do they consent to the school session, prefer their own doctor, or decline?

Record exactly what the guardian reports, in their own words where the schema asks
for detail. "I am not sure" is a perfectly good answer - record it as unsure rather
than pressing them or guessing. Never fill in an answer they did not give.

STEP 5 - CLOSE.
Tell them the school nurse will confirm the final list before the session, and that
they can reach the school at {session.nurse_contact}.

HARD BOUNDARIES - these override everything above.
- Give no medical advice and no opinion on whether the child should be vaccinated.
  If asked anything clinical - side effects, interactions, whether an allergy
  matters - say you cannot advise, that the school nurse or their own doctor will
  answer, and record the question so a person follows up.
- Do not diagnose, reassure, or minimise any symptom or allergy they describe.
- Do not pressure, persuade, or re-ask after a clear decision. A decline is final
  and is recorded without argument.
- Do not discuss any other student, or any family or medical matter beyond the four
  questions above.
- If the guardian is distressed, asks for a person, or the call becomes unclear,
  stop the questions, say a member of school staff will call back, and end warmly.
- If anyone asks whether you are a person, say plainly that you are an automated
  assistant calling for {session.school_name}.
"""


def display_goal(session: Session, student: Student) -> str:
    """One-line goal for previews and logs. Never contains a full phone number."""
    return (
        f"{session.school_name}: {session.vaccine_name} consent for "
        f"{student.student_name} ({student.class_name}) via {student.masked_phone}"
    )


def preflight_goal(session: Session, student: Student) -> str:
    """Compact, unambiguous goal for `plan_call`.

    `plan_call` is an LLM planner. Given a bare label like "consent for Aisha",
    it cannot tell whether the bot is *giving* consent or *collecting* it and
    asks a clarifying question instead of returning ready_to_run. This goal
    states who is called, on whose behalf, and that the bot collects the
    guardian's decision. It never contains a phone number - that travels in
    the recipient field.
    """
    return (
        f"Call {student.guardian_name}, the parent or guardian of "
        f"{student.student_name} in class {student.class_name}, on behalf of "
        f"{session.school_name}. Purpose: collect the guardian's decision about "
        f"the {session.vaccine_name} session on {session.session_date}. Ask "
        f"whether they consent to the free school session, prefer their own "
        f"doctor, or decline. Ask whether the student has already had this "
        f"vaccine, has any allergies, and is unwell today. Record the "
        f"guardian's answers exactly as given. Give no medical advice. Do not "
        f"reveal any student detail until the guardian confirms their identity."
    )


def idempotency_key(session: Session, student: Student) -> str:
    """Deterministic per student, per session.

    A retried run must never mean a second phone call to a parent, so the key is
    derived only from stable identifiers - never from a timestamp or a UUID.
    """
    slug = "".join(
        c if c.isalnum() else "-" for c in f"{session.school_name}-{session.session_date}"
    ).strip("-").lower()
    return f"vaxcheck-{slug}-{student.student_id}"
