"""Domain types and the closed vocabularies.

Every enum here is a closed set. Downstream code branches on these and never on
a raw provider field, so an unrecognised provider value can only ever become a
fail-closed default rather than a plausible-looking success.

State names are taken verbatim from docs/STATE_MACHINE.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum


class Workflow(str, Enum):
    CONTACT_CHECK = "contact_check"
    PATTERN_FOLLOWUP = "pattern_followup"


# --------------------------------------------------------------------------
# Contact-check machine (docs/STATE_MACHINE.md §1.1)
# --------------------------------------------------------------------------


class ContactCheckState(str, Enum):
    CC_PENDING = "CC_PENDING"
    CC_READY = "CC_READY"
    CC_IN_FLIGHT = "CC_IN_FLIGHT"
    CC_UNVERIFIED = "CC_UNVERIFIED"
    CC_VERIFIED = "CC_VERIFIED"
    CC_WRONG_PERSON = "CC_WRONG_PERSON"
    CC_NUMBER_NOT_WORKING = "CC_NUMBER_NOT_WORKING"
    CC_NO_LONGER_A_CONTACT = "CC_NO_LONGER_A_CONTACT"
    CC_UPDATE_REQUESTED = "CC_UPDATE_REQUESTED"
    CC_UNREACHED = "CC_UNREACHED"
    CC_NEEDS_HUMAN = "CC_NEEDS_HUMAN"
    CC_NOT_CALLED = "CC_NOT_CALLED"


CONTACT_CHECK_TERMINAL = frozenset(
    {
        ContactCheckState.CC_VERIFIED,
        ContactCheckState.CC_WRONG_PERSON,
        ContactCheckState.CC_NUMBER_NOT_WORKING,
        ContactCheckState.CC_NO_LONGER_A_CONTACT,
        ContactCheckState.CC_UPDATE_REQUESTED,
        ContactCheckState.CC_UNREACHED,
        ContactCheckState.CC_NOT_CALLED,
    }
)

#: States a contact-check dial may be reached from. Nothing else can dial.
CONTACT_CHECK_DIALLABLE = frozenset({ContactCheckState.CC_READY})


# --------------------------------------------------------------------------
# Pattern follow-up machine (docs/STATE_MACHINE.md §2.1)
# --------------------------------------------------------------------------


class PatternState(str, Enum):
    PF_TRIGGERED = "PF_TRIGGERED"
    PF_SCREENING = "PF_SCREENING"
    PF_CASCADE_READY = "PF_CASCADE_READY"
    PF_CALL_IN_FLIGHT = "PF_CALL_IN_FLIGHT"
    PF_CALL_UNVERIFIED = "PF_CALL_UNVERIFIED"
    PF_CASCADE_ADVANCE = "PF_CASCADE_ADVANCE"
    PF_REASON_GIVEN = "PF_REASON_GIVEN"
    PF_SUPPORT_REQUESTED = "PF_SUPPORT_REQUESTED"
    PF_URGENT_HUMAN = "PF_URGENT_HUMAN"
    PF_UNREACHED = "PF_UNREACHED"
    PF_NOT_CALLED = "PF_NOT_CALLED"
    PF_NEEDS_HUMAN = "PF_NEEDS_HUMAN"


PATTERN_TERMINAL = frozenset(
    {
        PatternState.PF_REASON_GIVEN,
        PatternState.PF_SUPPORT_REQUESTED,
        PatternState.PF_UNREACHED,
        PatternState.PF_NOT_CALLED,
    }
)

#: PF_URGENT_HUMAN is deliberately NOT terminal and not auto-closable: only a
#: named member of staff closes it, and closing is an audited action.
PATTERN_DIALLABLE = frozenset({PatternState.PF_CASCADE_READY})


# --------------------------------------------------------------------------
# Call attempts (docs/production-workflows.md vocabulary, kept separate from
# case state so "the call is unknown" is never confused with "the case is")
# --------------------------------------------------------------------------


class AttemptState(str, Enum):
    RESERVED = "reserved"
    SUBMISSION_UNKNOWN = "submission_unknown"
    ACCEPTED = "accepted"
    TERMINAL_UNVERIFIED = "terminal_unverified"
    TERMINAL_VERIFIED = "terminal_verified"
    NEEDS_HUMAN = "needs_human"


#: An attempt in any of these blocks a new dial for the same case (guard 6).
IN_FLIGHT_ATTEMPTS = frozenset(
    {AttemptState.RESERVED, AttemptState.SUBMISSION_UNKNOWN, AttemptState.ACCEPTED}
)


class Disposition(str, Enum):
    """The ten dispositions from the fail-closed reference. One is actionable."""

    CONFIRMED = "confirmed"
    REVIEW_REQUIRED = "review_required"
    RESULT_INVALID = "result_invalid"
    FAILED = "failed"
    CANCELED = "canceled"
    OUTCOME_UNKNOWN = "outcome_unknown"
    NEEDS_HUMAN = "needs_human"
    OUTSIDE_CALLING_WINDOW = "outside_calling_window"
    SUPPRESSED = "suppressed"
    RETRY_POLICY_BLOCKED = "retry_policy_blocked"


# --------------------------------------------------------------------------
# Decisions not to call (docs/STATE_MACHINE.md §4)
# --------------------------------------------------------------------------


class NoCallReason(str, Enum):
    PUPIL_VULNERABLE = "PUPIL_VULNERABLE"
    REASON_NOW_RECORDED = "REASON_NOW_RECORDED"
    OPEN_CASE_EXISTS = "OPEN_CASE_EXISTS"
    OUTSIDE_CALLING_WINDOW = "OUTSIDE_CALLING_WINDOW"
    NON_SCHOOL_DAY = "NON_SCHOOL_DAY"
    CALL_IN_PROGRESS = "CALL_IN_PROGRESS"
    IDEMPOTENCY_KEY_USED = "IDEMPOTENCY_KEY_USED"
    ATTEMPT_BUDGET_SPENT = "ATTEMPT_BUDGET_SPENT"
    INVALID_DESTINATION = "INVALID_DESTINATION"
    LANGUAGE_NOT_SUPPORTED = "LANGUAGE_NOT_SUPPORTED"
    NO_FIRST_DAY_PROCESS = "NO_FIRST_DAY_PROCESS"
    DRY_RUN = "DRY_RUN"
    AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION"


#: A hold re-arms on the next cycle; a terminal reason does not.
HOLD_REASONS = frozenset(
    {
        NoCallReason.OUTSIDE_CALLING_WINDOW,
        NoCallReason.NON_SCHOOL_DAY,
        NoCallReason.CALL_IN_PROGRESS,
        NoCallReason.DRY_RUN,
        NoCallReason.AWAITING_CONFIRMATION,
    }
)

NO_CALL_TEXT = {
    NoCallReason.PUPIL_VULNERABLE: "Not calling: pupil flagged vulnerable - staff task created",
    NoCallReason.REASON_NOW_RECORDED: "Not calling: a reason was recorded since the trigger",
    NoCallReason.OPEN_CASE_EXISTS: "Not calling: an open staff case already exists for this pupil",
    NoCallReason.OUTSIDE_CALLING_WINDOW: "Not calling: outside the school's calling window",
    NoCallReason.NON_SCHOOL_DAY: "Not calling: today is not a school day",
    NoCallReason.CALL_IN_PROGRESS: "Not calling: a call is already in progress for this case",
    NoCallReason.IDEMPOTENCY_KEY_USED: "Not calling: this idempotency key is already reserved",
    NoCallReason.ATTEMPT_BUDGET_SPENT: "Not calling: the attempt budget is spent",
    NoCallReason.INVALID_DESTINATION: "Not calling: the stored number is not valid E.164",
    NoCallReason.LANGUAGE_NOT_SUPPORTED: (
        "Not calling: contact needs a language the UK line does not support - staff task created"
    ),
    NoCallReason.NO_FIRST_DAY_PROCESS: (
        "Not calling: no first-day process is configured, so pattern follow-up is disabled"
    ),
    NoCallReason.DRY_RUN: "Not calling: dry run, REACHABLE_LIVE_CALLS is not set",
    NoCallReason.AWAITING_CONFIRMATION: "Not calling: awaiting a per-call confirmation",
}


# --------------------------------------------------------------------------
# Register
# --------------------------------------------------------------------------


class ContactHealth(str, Enum):
    """What the office needs to know about one contact, at a glance.

    Written by BOTH workflows: the termly check sets it, and a failed pattern
    call overwrites it immediately rather than waiting for next term. That
    write-back is the loop.
    """

    NOT_CHECKED = "not_checked"
    VERIFIED = "verified"
    WRONG_PERSON = "wrong_person"
    NUMBER_NOT_WORKING = "number_not_working"
    NO_LONGER_A_CONTACT = "no_longer_a_contact"
    UPDATE_REQUESTED = "update_requested"
    UNREACHED = "unreached"
    INVALID_NUMBER = "invalid_number"
    LANGUAGE_UNSUPPORTED = "language_unsupported"


#: Health values that mean this contact should not be relied on in an emergency.
FLAGGED_HEALTH = frozenset(
    {
        ContactHealth.WRONG_PERSON,
        ContactHealth.NUMBER_NOT_WORKING,
        ContactHealth.NO_LONGER_A_CONTACT,
        ContactHealth.INVALID_NUMBER,
        ContactHealth.LANGUAGE_UNSUPPORTED,
    }
)

HEALTH_TEXT = {
    ContactHealth.NOT_CHECKED: "Not checked this term",
    ContactHealth.VERIFIED: "Verified",
    ContactHealth.WRONG_PERSON: "Wrong person answered",
    ContactHealth.NUMBER_NOT_WORKING: "Number not working",
    ContactHealth.NO_LONGER_A_CONTACT: "No longer willing to be a contact",
    ContactHealth.UPDATE_REQUESTED: "Wants their details updated",
    ContactHealth.UNREACHED: "Could not be reached",
    ContactHealth.INVALID_NUMBER: "Stored number is not valid E.164",
    ContactHealth.LANGUAGE_UNSUPPORTED: "Needs a language the UK line cannot serve",
}


class SessionSlot(str, Enum):
    AM = "AM"
    PM = "PM"


class DayType(str, Enum):
    SCHOOL_DAY = "SCHOOL_DAY"
    HOLIDAY = "HOLIDAY"
    WEEKEND = "WEEKEND"
    INSET = "INSET"


#: Code N: "Reason for absence not yet established" (DfE July 2026, p96).
UNEXPLAINED_CODE = "N"

#: After 5 school days an unresolved code N must be amended to code O.
CODE_N_DEADLINE_SCHOOL_DAYS = 5


# --------------------------------------------------------------------------
# Records
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Pupil:
    pupil_id: str
    first_name: str
    last_name: str
    year_group: str = ""
    form_group: str = ""
    vulnerable: bool = False
    notes_for_staff: str = ""


@dataclass(frozen=True)
class Contact:
    contact_id: str
    pupil_id: str
    contact_order: int
    contact_name: str
    phone_e164: str
    relationship: str = ""
    language: str = "English"
    is_emergency_contact: bool = True
    do_not_call: bool = False


@dataclass(frozen=True)
class RegisterSession:
    """One pupil, one date, one statutory session."""

    pupil_id: str
    session_date: date
    slot: SessionSlot
    code: str
    reason_recorded: str = ""

    @property
    def unexplained(self) -> bool:
        return self.code.strip().upper() == UNEXPLAINED_CODE and not self.reason_recorded.strip()

    @property
    def sort_key(self) -> tuple[date, int]:
        return (self.session_date, 0 if self.slot is SessionSlot.AM else 1)


@dataclass(frozen=True)
class CalendarDay:
    day: date
    day_type: DayType
    note: str = ""

    @property
    def is_school_day(self) -> bool:
        return self.day_type is DayType.SCHOOL_DAY


@dataclass(frozen=True)
class School:
    school_name: str
    timezone: str
    call_window_start: str
    call_window_end: str
    first_day_process_description: str = ""
    attendance_officer_name: str = ""
    dsl_name: str = ""

    @property
    def has_first_day_process(self) -> bool:
        return bool(self.first_day_process_description.strip())


@dataclass(frozen=True)
class Trigger:
    """A run of consecutive unexplained sessions for one pupil."""

    pupil_id: str
    trigger_date: date
    sessions: tuple[RegisterSession, ...]

    @property
    def session_labels(self) -> str:
        return ", ".join(f"{s.session_date.isoformat()} {s.slot.value}" for s in self.sessions)


@dataclass
class StaffTask:
    task_id: str
    pupil_id: str
    kind: str
    detail: str
    contact_id: str = ""
    urgent: bool = False
    handled: bool = False


@dataclass
class Dataset:
    """Everything one import produced. Passed to pure functions."""

    school: School | None = None
    pupils: dict[str, Pupil] = field(default_factory=dict)
    contacts: list[Contact] = field(default_factory=list)
    sessions: list[RegisterSession] = field(default_factory=list)
    calendar: dict[date, CalendarDay] = field(default_factory=dict)

    def contacts_for(self, pupil_id: str) -> list[Contact]:
        """Callable contacts, in the school's own listed order.

        The office knows who to try first; Reachable does not second-guess it.
        """
        rows = [
            c
            for c in self.contacts
            if c.pupil_id == pupil_id and c.is_emergency_contact and not c.do_not_call
        ]
        return sorted(rows, key=lambda c: (c.contact_order, c.contact_id))
