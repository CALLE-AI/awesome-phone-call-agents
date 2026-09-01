"""Data models for Table Rescue."""
from dataclasses import dataclass
from enum import Enum


class ReservationStatus(str, Enum):
    PENDING_CONFIRM = "PENDING_CONFIRM"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"
    RESCHEDULED = "RESCHEDULED"
    NO_ANSWER = "NO_ANSWER"
    RECOVERED = "RECOVERED"


class WaitlistStatus(str, Enum):
    WAITING = "WAITING"
    OFFERED = "OFFERED"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    NO_ANSWER = "NO_ANSWER"
    EXHAUSTED = "EXHAUSTED"


class CallStatus(str, Enum):
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"
    RESCHEDULED = "RESCHEDULED"
    NO_ANSWER = "NO_ANSWER"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    ERROR = "ERROR"
    SKIPPED_NO_CONSENT = "SKIPPED_NO_CONSENT"
    SKIPPED_DUPLICATE = "SKIPPED_DUPLICATE"
    SKIPPED_OUT_OF_WINDOW = "SKIPPED_OUT_OF_WINDOW"
    CANCELLED_BY_OPERATOR = "CANCELLED_BY_OPERATOR"


@dataclass
class Reservation:
    booking_id: str
    name: str
    phone: str
    party_size: int
    slot: str
    consent: bool
    status: ReservationStatus = ReservationStatus.PENDING_CONFIRM

    @classmethod
    def from_line(cls, line: dict) -> "Reservation":
        return cls(
            booking_id=line["booking_id"],
            name=line["name"],
            phone=line["phone"],
            party_size=int(line["party_size"]),
            slot=line["slot"],
            consent=bool(line["consent"]),
            status=ReservationStatus(line.get("status", "PENDING_CONFIRM")),
        )

    def to_line(self) -> dict:
        return {
            "booking_id": self.booking_id,
            "name": self.name,
            "phone": self.phone,
            "party_size": self.party_size,
            "slot": self.slot,
            "consent": self.consent,
            "status": self.status.value,
        }


@dataclass
class WaitlistEntry:
    entry_id: str
    name: str
    phone: str
    party_size: int
    window_start: str
    window_end: str
    priority: int
    consent: bool
    status: WaitlistStatus = WaitlistStatus.WAITING

    @classmethod
    def from_line(cls, line: dict) -> "WaitlistEntry":
        return cls(
            entry_id=line["entry_id"],
            name=line["name"],
            phone=line["phone"],
            party_size=int(line["party_size"]),
            window_start=line["window_start"],
            window_end=line["window_end"],
            priority=int(line["priority"]),
            consent=bool(line["consent"]),
            status=WaitlistStatus(line.get("status", "WAITING")),
        )

    def to_line(self) -> dict:
        return {
            "entry_id": self.entry_id,
            "name": self.name,
            "phone": self.phone,
            "party_size": self.party_size,
            "window_start": self.window_start,
            "window_end": self.window_end,
            "priority": self.priority,
            "consent": self.consent,
            "status": self.status.value,
        }


@dataclass
class CallOutcome:
    run_id: str
    target_id: str
    status: CallStatus
    new_slot: str | None = None
    notes: str | None = None
    transcript_ref: str | None = None
    call_cost_id: str | None = None

    @classmethod
    def from_payload(cls, run_id: str, target_id: str, payload: dict) -> "CallOutcome":
        return cls(
            run_id=run_id,
            target_id=target_id,
            status=CallStatus(payload["status"]),
            new_slot=payload.get("new_slot"),
            notes=payload.get("notes"),
            transcript_ref=payload.get("transcript_ref"),
            call_cost_id=payload.get("call_cost_id"),
        )
