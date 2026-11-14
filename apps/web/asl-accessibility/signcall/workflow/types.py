"""
Shared types for the workflow.

`UserInput` is what a run is built on. It comes from workflow/user_input.py,
which validates a JSON object against schemas/user_input.schema.json; that
schema is the authoritative input contract.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class AppointmentType(str, Enum):
    """The clinic categories a user can ask for. Each maps to a search phrase
    in workflow/clinic_lookup.py."""

    PHYSICAL_THERAPY = "physical_therapy"
    EYES = "eyes"
    ENT = "ent"
    DENTAL = "dental"
    MENTAL = "mental"
    GENERAL = "general"


@dataclass
class TimeWindow:
    start: datetime
    end: datetime


@dataclass
class Insurance:
    provider_name: str
    policy_number: str


@dataclass
class FamilyInterpreter:
    """A registered family member who signs. They are phoned one at a time, in
    list order, after a clinic and its matched slots exist."""

    name: str
    relation: str
    phone: str
    # "YYYY-MM-DD HH:MM" slot keys they said they can cover.
    coverable_slots: list[str] = field(default_factory=list)
    notes: str | None = None  # concerns they raised on the call


@dataclass
class UserInput:
    """The parsed, validated user input. See schemas/user_input.schema.json."""

    name: str
    date_of_birth: str                # YYYY-MM-DD, as given
    age: int                          # as given; deliberately not re-derived from date_of_birth
    phone_number: str                 # US E.164; where the confirmation text goes
    zipcode: str                      # 5-digit US ZIP; the clinic search origin
    appointment_type: AppointmentType
    insurance: Insurance
    # One window per "friday 2PM"-style entry, expanded to the hour it covers.
    free_windows: list[TimeWindow]
    has_interpreter: bool             # True: the user arranged their own; nobody is called for them
    family: list[FamilyInterpreter] = field(default_factory=list)

    def patient_summary(self) -> str:
        """What the booking call may tell the clinic. The clinic search calls
        never share any of this."""
        return (
            f"patient name {self.name}, date of birth {self.date_of_birth}, "
            f"age {self.age}, phone {self.phone_number}, insurance "
            f"{self.insurance.provider_name}, policy number "
            f"{self.insurance.policy_number}"
        )


@dataclass
class ClinicCandidate:
    """One clinic from workflow/clinic_lookup.py. The first four fields are the
    record defined by schemas/clinic_record.schema.json; the rest is runtime
    state filled in by the search calls."""

    name: str
    phone: str
    zipcode: str
    clinic_type: str
    distance_miles: float | None = None  # None when the ZIP isn't in the centroid table
    source: str = "apify_google_maps"  # "apify_google_maps" | "injected"
    accepts_insurance: bool | None = None
    offered_slots: list[ClinicSlot] = field(default_factory=list)
    # What the clinic said is needed to book or attend (a referral, ID, forms).
    requirements: list[str] = field(default_factory=list)
    notes: str | None = None
    address: str | None = None  # street address, when the source has one

    def location_description(self) -> str:
        """Where the appointment is, for an interpreter or family member: the
        street address if known, otherwise name and ZIP."""
        return self.address if self.address else f"{self.name}, ZIP {self.zipcode}"


@dataclass
class InterpreterCandidate:
    """One freelance interpreter, before and after the batch search contacts
    them. Real ones come from workflow/interpreter_lookup.py; tests inject
    their own."""

    name: str
    phone: str
    expertise: list[str] = field(default_factory=list)  # surfaced to the user, never used to filter
    source: str = "il_directory"  # "il_directory" | "injected"
    # Filled in from the call itself; never assumed beforehand.
    rate_per_hour: float | None = None
    minimum_hours: float | None = None
    # "YYYY-MM-DD HH:MM" slot keys they said they can cover.
    coverable_slots: list[str] = field(default_factory=list)
    notes: str | None = None  # concerns they raised on the call

    def total_cost(self) -> float | None:
        if self.rate_per_hour is None or self.minimum_hours is None:
            return None
        return self.rate_per_hour * self.minimum_hours


@dataclass
class ClinicSlot:
    date: str   # ISO date, e.g. "2026-09-24"
    time: str   # 24-hour "14:00"

    def key(self) -> str:
        """The exact string form everyone is asked about and answers with.
        Family and freelance matching are exact-string membership tests
        against this."""
        return f"{self.date} {self.time}"


@dataclass
class AppointmentResult:
    """The outcome of a successful run. It is stored by the frontend and sent
    back unchanged to cancel the booking later, so it carries everything
    appointment.cancel_appointment() needs."""

    appointment: dict
    interpreter: dict | None
    family_tier_result: str  # "locked_in" | "no_overlap" | "not_registered" | "not_applicable"
    interpreter_source: str  # "family" | "freelance" | "user_arranged"
    clinic_contact: dict = field(default_factory=dict)  # {name, phone, zipcode, address}
    appointment_slot: dict = field(default_factory=dict)  # {date, time}
    evidence: list[str] = field(default_factory=list)
    # What the clinic said is required (a referral, ID, forms). Never blocks a booking.
    requirements: list[str] = field(default_factory=list)
    # Other concerns raised on any call, each prefixed with who said it.
    notes: list[str] = field(default_factory=list)


def clean_strings(raw: object) -> list[str]:
    """The non-blank strings in a list a call returned, ignoring anything malformed."""
    if not isinstance(raw, list):
        return []
    return [item.strip() for item in raw if isinstance(item, str) and item.strip()]


def append_note(current: "str | None", new: object) -> "str | None":
    """Appends a note a call returned, ignoring blanks and non-strings."""
    if not isinstance(new, str) or not new.strip():
        return current
    return f"{current}; {new.strip()}" if current else new.strip()


def distance_sort_key(distance_miles: float | None) -> tuple[bool, float]:
    """Sorts unknown distances last instead of raising on None."""
    return (distance_miles is None, distance_miles if distance_miles is not None else 0.0)
