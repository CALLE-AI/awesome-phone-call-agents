"""Core data types for Muster.

Nothing in this module decides anything. `grading.py` owns every verdict.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from enum import Enum


class Grade(str, Enum):
    """What one call established. Ordered from strongest to weakest evidence."""

    CONFIRMED_LIVE = "CONFIRMED_LIVE"
    PRESUMED_LIVE_WEAK = "PRESUMED_LIVE_WEAK"
    THIRD_PARTY_CLAIM = "THIRD_PARTY_CLAIM"
    UNPROVEN = "UNPROVEN"
    CONTRA = "CONTRA"
    NEEDS_HUMAN = "NEEDS_HUMAN"


#: The only grade that closes an attestation without a person looking at it.
AUTO_CLOSING_GRADES = frozenset({Grade.CONFIRMED_LIVE})


class Endpoint(str, Enum):
    """Who or what answered the line."""

    SUBJECT = "subject"
    THIRD_PARTY = "third_party"
    VOICEMAIL = "voicemail"
    IVR = "ivr"
    NO_ANSWER = "no_answer"
    UNKNOWN = "unknown"


class Ternary(str, Enum):
    """Three-valued answer. `UNKNOWN` is a real answer, never a silent no."""

    YES = "yes"
    NO = "no"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class KnowledgePrompt:
    """One enrolled question and its expected answer.

    `co_resident_safe` is False when a person living with the subject would
    plausibly know the answer. Those prompts still run, but they cannot on
    their own carry a CONFIRMED_LIVE.
    """

    prompt_id: str
    question: str
    expected: str
    co_resident_safe: bool = True


@dataclass(frozen=True)
class Accessibility:
    """Enrolled reasons a subject may be unable to complete the protocol.

    Any of these routes the call to a human instead of failing the subject.
    """

    hearing_impaired: bool = False
    speech_impaired: bool = False
    cognitive_impairment: bool = False
    needs_interpreter: bool = False

    @property
    def requires_human_path(self) -> bool:
        return any(
            (
                self.hearing_impaired,
                self.speech_impaired,
                self.cognitive_impairment,
                self.needs_interpreter,
            )
        )


@dataclass(frozen=True)
class Subject:
    """A person enrolled for periodic attestation.

    Enrolment is a human act performed out of band. Muster never enrols.
    """

    subject_id: str
    display_name: str
    phone_e164: str
    country_code: str
    language: str
    reference: str
    prompts: tuple[KnowledgePrompt, ...] = ()
    accessibility: Accessibility = field(default_factory=Accessibility)
    date_of_birth: date | None = None

    @property
    def co_resident_safe_prompts(self) -> tuple[KnowledgePrompt, ...]:
        return tuple(p for p in self.prompts if p.co_resident_safe)


@dataclass(frozen=True)
class Nonce:
    """A per-call freshness challenge. A recording cannot satisfy it."""

    words: tuple[str, ...]
    weekday: str

    def spoken_instruction(self) -> str:
        listed = ", ".join(self.words)
        return (
            f"say these three words back in this order: {listed}; "
            "then say what day of the week it is today; "
            "then say those same three words again in reverse order"
        )

    @property
    def reversed_words(self) -> tuple[str, ...]:
        return tuple(reversed(self.words))


@dataclass(frozen=True)
class TranscriptTurn:
    """One turn as returned by CALL-E in `transcript_turns`."""

    offset_seconds: float
    speaker: str
    text: str


@dataclass(frozen=True)
class Observations:
    """What the call reported. Extracted by the model, never graded by it.

    Every field here is an observation about the call. None of them is a
    conclusion about whether the subject is alive.
    """

    answered_by: Endpoint = Endpoint.UNKNOWN
    claimed_to_be_subject: Ternary = Ternary.UNKNOWN
    nonce_words_heard: tuple[str, ...] = ()
    nonce_words_reversed_heard: tuple[str, ...] = ()
    weekday_heard: str = ""
    prompt_answers: dict[str, str] = field(default_factory=dict)
    another_person_present: Ternary = Ternary.UNKNOWN
    subject_reported_dead: Ternary = Ternary.UNKNOWN
    wrong_number: Ternary = Ternary.UNKNOWN
    distress_or_confusion: Ternary = Ternary.UNKNOWN
    evidence_quotes: tuple[str, ...] = ()
    turns: tuple[TranscriptTurn, ...] = ()


@dataclass(frozen=True)
class Attestation:
    """The output. A record of what was established, never a bare boolean."""

    subject_id: str
    run_id: str
    graded_at: datetime
    grade: Grade
    reasons: tuple[str, ...]
    evidence_quotes: tuple[str, ...] = ()
    nonce_ok: bool | None = None
    reverse_ok: bool | None = None
    challenges_passed: int = 0
    challenges_asked: int = 0
    coaching_suspected: bool = False
    call_id: str | None = None

    @property
    def auto_closes(self) -> bool:
        return self.grade in AUTO_CLOSING_GRADES

    @property
    def stops_payment(self) -> bool:
        """Muster never stops a payment. Kept explicit so it cannot drift."""
        return False
