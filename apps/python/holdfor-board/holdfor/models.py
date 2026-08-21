from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class Feeling(StrEnum):
    BETTER = "better"
    SAME = "same"
    WORSE = "worse"
    UNSURE = "unsure"


class MedicationOk(StrEnum):
    YES = "yes"
    NO = "no"
    UNSURE = "unsure"
    NOT_ASKED = "not_asked"


class WantsSeen(StrEnum):
    YES = "yes"
    NO = "no"
    UNSURE = "unsure"


class CallKind(StrEnum):
    CHECKIN = "checkin"
    REBOOKING = "rebooking"


class CallState(StrEnum):
    RESERVED = "reserved"
    SUBMISSION_UNKNOWN = "submission_unknown"
    ACCEPTED = "accepted"
    TERMINAL_VERIFIED = "terminal_verified"
    NEEDS_HUMAN = "needs_human"


class ReviewStatus(StrEnum):
    NEEDS_REVIEW = "needs_review"
    AUTO_CLOSED = "auto_closed"
    RELEASED = "released"
    CLOSED = "closed"
    RANG_MANUALLY = "rang_manually"
    RECEPTION_DECLINED = "reception_declined"
    NOT_REACHED = "not_reached"
    DECLINED = "declined"


class AppointmentMode(StrEnum):
    IN_PERSON = "in_person"
    PHONE = "phone"


class TimeOfDay(StrEnum):
    MORNING = "morning"
    AFTERNOON = "afternoon"
    ANY = "any"


@dataclass(frozen=True)
class Turn:
    index: int
    speaker: str
    text: str


@dataclass(frozen=True)
class CallRequest:
    to_e164: str
    task_text: str
    result_schema: dict
    idempotency_key: str


@dataclass(frozen=True)
class CallResult:
    state: CallState
    transcript: list[Turn]
    structured: dict | None
    outcome: str | None = None


class SubmissionUnknown(Exception):
    """Raised by `place` when the provider cannot say whether a call was accepted.

    A client timeout, a dropped connection, a response that arrived unreadable:
    all of them say what the client observed, not that no call went out. A
    provider raises this instead of a plain error so that the caller is forced to
    tell the two apart, because the safe response to each is opposite.

    Carry no provider text into the message. The string reaches a log, and a
    truncated HTTP error can have a token in it.
    """


class CallProvider(Protocol):
    def place(self, req: CallRequest) -> str:
        """Submit one call and return the provider's run id.

        Raise `SubmissionUnknown` rather than returning, if acceptance is unknown.
        """
        ...

    def poll(self, run_id: str) -> CallResult: ...


@dataclass(frozen=True)
class CheckinScope:
    first_name: str
    phone_e164: str


@dataclass(frozen=True)
class RebookingScope:
    first_name: str
    surname: str
    dob: str
    phone_e164: str


@dataclass(frozen=True)
class Patient:
    id: int
    first_name: str
    surname: str
    dob: str
    phone_e164: str
    consent_to_call: bool
    created_at: str

    def checkin_scope(self) -> CheckinScope:
        return CheckinScope(first_name=self.first_name, phone_e164=self.phone_e164)

    def rebooking_scope(self) -> RebookingScope:
        return RebookingScope(
            first_name=self.first_name,
            surname=self.surname,
            dob=self.dob,
            phone_e164=self.phone_e164,
        )


@dataclass(frozen=True)
class Appointment:
    id: int
    patient_id: int
    seen_on: str
    appointment_type: str
    medication_changed: bool
    followup_booked: bool


@dataclass(frozen=True)
class Extraction:
    feeling: Feeling | None
    medication_ok: MedicationOk | None
    wants_seen: WantsSeen | None
    carried_words_text: str | None
    carried_words_turn: int | None
    stop_condition: bool
    stop_reason: str | None
