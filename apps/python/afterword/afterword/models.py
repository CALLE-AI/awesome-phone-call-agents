"""Core data types for Afterword.

Nothing in this module decides anything. `capture.py` owns every grade and
`conflict.py` owns every dispute. The sensitive fields on `Estate` are here on
purpose: the family typed them into a probate form, the console holds them, and
`disclosure.py` exists to prove the agent never speaks them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum


class Grade(str, Enum):
    """What one call to one institution established.

    None of these says an account was closed. Closing is a human act performed
    out of band, after the family has posted the documents.
    """

    REQUIREMENTS_CAPTURED = "REQUIREMENTS_CAPTURED"
    PARTIAL = "PARTIAL"
    DISPUTED = "DISPUTED"
    REFERRED = "REFERRED"
    UNREACHED = "UNREACHED"


#: Grades that put a requirement into the pack without a person re-reading the
#: call first. A dispute is deliberately not one of them.
PACKABLE_GRADES = frozenset({Grade.REQUIREMENTS_CAPTURED})


class Reached(str, Enum):
    """Who or what the call actually got to."""

    AGENT = "agent"
    IVR_DEAD_END = "ivr_dead_end"
    VOICEMAIL = "voicemail"
    NO_ANSWER = "no_answer"
    QUEUE_ABANDONED = "queue_abandoned"
    UNKNOWN = "unknown"


class Ternary(str, Enum):
    """Three-valued answer. `UNKNOWN` is a real answer, never a silent no."""

    YES = "yes"
    NO = "no"
    UNKNOWN = "unknown"


class DirectDebits(str, Enum):
    """What the institution said happens to standing payments in the meantime.

    This is the question families get wrong answers to most often, because the
    answer differs between two agents at the same institution.
    """

    CONTINUE = "continue"
    CANCELLED_ON_NOTIFICATION = "cancelled_on_notification"
    FROZEN = "frozen"
    EXECUTOR_MUST_INSTRUCT = "executor_must_instruct"
    UNKNOWN = "unknown"


class InstitutionKind(str, Enum):
    """Only used for grouping the pack. It changes no rule."""

    BANK = "bank"
    PENSION = "pension"
    INSURER = "insurer"
    UTILITY = "utility"
    MOBILE = "mobile"
    COUNCIL = "council"
    SUBSCRIPTION = "subscription"


@dataclass(frozen=True)
class Estate:
    """The estate on whose behalf the calls are made.

    `deceased_name`, `executor_name` and `reference` are the entire disclosure
    budget. Every other field on this record is here so that `disclosure.py`
    can prove it was not spoken.
    """

    estate_id: str
    deceased_name: str
    executor_name: str
    reference: str
    executor_relationship: str = ""
    date_of_birth: date | None = None
    cause_of_death: str = ""
    estimated_balance: str = ""
    notes: str = ""

    @property
    def disclosable(self) -> tuple[str, ...]:
        """The only three things about this estate that may be said aloud."""
        return (self.deceased_name, self.executor_name, self.reference)

    @property
    def withheld(self) -> tuple[str, ...]:
        """Values held for the family that must never reach a phone line."""
        held = [self.cause_of_death, self.estimated_balance, self.notes]
        if self.date_of_birth is not None:
            held.extend(
                (
                    self.date_of_birth.isoformat(),
                    self.date_of_birth.strftime("%d/%m/%Y"),
                    self.date_of_birth.strftime("%d %B %Y"),
                )
            )
        return tuple(value for value in held if value.strip())


@dataclass(frozen=True)
class Requirement:
    """What one institution says the family must do.

    "Next step" in the design note is the pair of `direct_debits_action` and
    `reference_opened`: what happens to the money in the meantime, and the
    handle the family quotes when they post the documents.
    """

    department: str = ""
    documents_needed: tuple[str, ...] = ()
    certified_copy_accepted: Ternary = Ternary.UNKNOWN
    direct_debits_action: DirectDebits = DirectDebits.UNKNOWN
    reference_opened: str = ""

    @property
    def missing(self) -> tuple[str, ...]:
        """Named gaps. `reference_opened` is not one: many institutions open a
        case only once the paperwork arrives, and a family cannot chase a
        reference that does not exist yet."""
        gaps: list[str] = []
        if not self.department.strip():
            gaps.append("department")
        if not self.documents_needed:
            gaps.append("documents_needed")
        if self.certified_copy_accepted is Ternary.UNKNOWN:
            gaps.append("certified_copy_accepted")
        if self.direct_debits_action is DirectDebits.UNKNOWN:
            gaps.append("direct_debits_action")
        return tuple(gaps)

    @property
    def complete(self) -> bool:
        return not self.missing

    @property
    def empty(self) -> bool:
        """Nothing was said. Distinct from complete: a blank record belongs in
        no pack, whereas a partial one is worth showing to the family."""
        return self == Requirement()


@dataclass(frozen=True)
class RecordedPolicy:
    """What the institution publishes, transcribed by a human at enrolment.

    Afterword never treats this as the truth. It is one of the two sides of a
    dispute, and `source` is what makes the dispute answerable.
    """

    department: str
    documents_needed: tuple[str, ...]
    certified_copy_accepted: Ternary
    direct_debits_action: DirectDebits
    source: str

    def as_requirement(self) -> Requirement:
        return Requirement(
            department=self.department,
            documents_needed=self.documents_needed,
            certified_copy_accepted=self.certified_copy_accepted,
            direct_debits_action=self.direct_debits_action,
        )


@dataclass(frozen=True)
class Institution:
    """One organisation that has to be told."""

    institution_id: str
    name: str
    kind: InstitutionKind
    phone_e164: str
    language: str = "English"
    recorded_policy: RecordedPolicy | None = None

    def masked_phone(self) -> str:
        """Never print a full number in a preview, a log or a pack."""
        return f"{self.phone_e164[:4]}{'*' * 6}{self.phone_e164[-3:]}"


@dataclass(frozen=True)
class PriorCall:
    """A requirement captured on an earlier call to the same institution.

    Kept so that two calls disagreeing with each other is detectable at all.
    Without it, the second answer silently overwrites the first.
    """

    call_id: str
    captured_on: date
    requirement: Requirement


@dataclass(frozen=True)
class Conflict:
    """Two answers to the same question, both recorded, neither preferred.

    There is deliberately no winner field. Choosing one in code is how a family
    posts an original death certificate that then goes missing.
    """

    field_name: str
    stated: str
    stated_source: str
    counter: str
    counter_source: str
    quote: str = ""

    @property
    def reason(self) -> str:
        return f"conflict_{self.field_name}"


@dataclass(frozen=True)
class TranscriptTurn:
    """One turn as returned by CALL-E in `transcript_turns`."""

    offset_seconds: float
    speaker: str
    text: str


@dataclass(frozen=True)
class Observations:
    """What the call reported. Extracted by the model, never graded by it.

    Every field here is something somebody said. None of them is a conclusion
    about whether the institution has been notified.
    """

    reached: Reached = Reached.UNKNOWN
    department_named: str = ""
    documents_named: tuple[str, ...] = ()
    certified_copy_accepted: Ternary = Ternary.UNKNOWN
    direct_debits_action: DirectDebits = DirectDebits.UNKNOWN
    reference_opened: str = ""
    executor_only: Ternary = Ternary.UNKNOWN
    notification_accepted_by_phone: Ternary = Ternary.UNKNOWN
    evidence_quotes: tuple[str, ...] = ()
    turns: tuple[TranscriptTurn, ...] = ()

    def as_requirement(self) -> Requirement:
        """The stated requirement, exactly as reported. No inference."""
        return Requirement(
            department=self.department_named,
            documents_needed=self.documents_named,
            certified_copy_accepted=self.certified_copy_accepted,
            direct_debits_action=self.direct_debits_action,
            reference_opened=self.reference_opened,
        )


@dataclass(frozen=True)
class CaptureResult:
    """The output for one institution. A record of what was said, never an act."""

    estate_id: str
    institution_id: str
    run_id: str
    captured_at: datetime
    grade: Grade
    reasons: tuple[str, ...]
    requirement: Requirement | None = None
    conflicts: tuple[Conflict, ...] = ()
    evidence_quotes: tuple[str, ...] = ()
    call_id: str | None = None
    binding: bool = False

    @property
    def goes_in_pack(self) -> bool:
        """Whether this requirement is quotable without a person re-reading it."""
        return self.grade in PACKABLE_GRADES

    @property
    def closes_account(self) -> bool:
        """Afterword never closes an account. Kept explicit so it cannot drift."""
        return False

    @property
    def accepts_terms(self) -> bool:
        """Afterword never agrees anything on the family's behalf."""
        return False

    @property
    def needs_executor(self) -> bool:
        return self.grade is Grade.REFERRED


@dataclass(frozen=True)
class Pack:
    """The consolidated answer across every institution.

    A pack is a reading aid, not a decision. It counts and groups; it resolves
    nothing that `capture.py` left open.
    """

    estate: Estate
    results: tuple[CaptureResult, ...] = field(default_factory=tuple)

    @property
    def by_grade(self) -> dict[Grade, tuple[CaptureResult, ...]]:
        grouped: dict[Grade, list[CaptureResult]] = {g: [] for g in Grade}
        for result in self.results:
            grouped[result.grade].append(result)
        return {grade: tuple(items) for grade, items in grouped.items()}

    @property
    def disputes(self) -> tuple[Conflict, ...]:
        return tuple(c for result in self.results for c in result.conflicts)

    @property
    def outstanding(self) -> tuple[CaptureResult, ...]:
        """Everything a person still has to pick up. Most of the pack, usually."""
        return tuple(r for r in self.results if not r.goes_in_pack)
