"""What a call submits to the application. Evidence, not authority.

A caller returns `CallEvidence`. That is the whole of its output and the whole
of its power: nothing downstream reads the caller's opinion about what should
happen to the record, because the caller does not have one. Claims carry the
turn ids they rest on, so every downstream verdict can be traced back to lines a
person can read.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CallOutcome(StrEnum):
    """How the call ended. CALL-E terminal statuses map onto these."""

    COMPLETED = "completed"
    NO_ANSWER = "no_answer"
    VOICEMAIL = "voicemail"
    BUSY = "busy"
    DECLINED = "declined"
    CANCELED = "canceled"
    EXPIRED = "expired"
    FAILED = "failed"
    # Outcomes the transcript establishes rather than the telephony layer.
    WRONG_PARTY = "wrong_party"
    REACHED_CLIENT = "reached_client"
    STOP_REQUESTED = "stop_requested"
    DISTRESS = "distress"
    HOSTILE = "hostile"
    AMBIGUOUS = "ambiguous"


#: Outcomes where the call reached a person and a conversation happened.
CONTACT_OUTCOMES = {
    CallOutcome.COMPLETED,
    CallOutcome.AMBIGUOUS,
    CallOutcome.WRONG_PARTY,
    CallOutcome.REACHED_CLIENT,
    CallOutcome.STOP_REQUESTED,
    CallOutcome.DISTRESS,
    CallOutcome.HOSTILE,
}

#: Outcomes that must never leave a mark on the record beyond a retry.
NO_CONTACT_OUTCOMES = {
    CallOutcome.NO_ANSWER,
    CallOutcome.VOICEMAIL,
    CallOutcome.BUSY,
    CallOutcome.DECLINED,
    CallOutcome.CANCELED,
    CallOutcome.EXPIRED,
    CallOutcome.FAILED,
}

#: Outcomes that end the call and the campaign for that organization.
SAFETY_OUTCOMES = {
    CallOutcome.STOP_REQUESTED,
    CallOutcome.REACHED_CLIENT,
    CallOutcome.DISTRESS,
    CallOutcome.HOSTILE,
    CallOutcome.WRONG_PARTY,
}


class SafetyEventKind(StrEnum):
    STOP_REQUESTED = "stop_requested"
    REACHED_CLIENT = "reached_client"
    DISTRESS = "distress"
    HOSTILE = "hostile"
    WRONG_PARTY = "wrong_party"
    NO_DISCLOSURE = "no_disclosure"


class Turn(BaseModel):
    """One line of the conversation, as it will be stored and later read."""

    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=40)
    role: str = Field(pattern=r"^(assistant|provider|seeker|system)$")
    text: str = Field(min_length=1, max_length=4000)
    offset_seconds: float | None = None

    def as_record(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "role": self.role,
            "text": self.text,
            "offset_seconds": self.offset_seconds,
        }


class Claim(BaseModel):
    """A proposed value for one field, with the turns it rests on.

    `explicit_statement`, `readback_turn_ids` and `confirmation_turn_ids` are
    filled by the deterministic transcript reader, not by the caller. A caller
    may assert whatever it likes; what survives into a Claim is what the
    transcript shows.
    """

    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=60)
    proposed_value: str | None = Field(default=None, max_length=2000)
    quote: str = Field(default="", max_length=1000)

    explicit_statement: bool = False
    removes_service: bool = False
    ambiguous: bool = False
    confidence: float = Field(default=0.0, ge=0, le=1)

    source_turn_ids: list[str] = Field(default_factory=list, max_length=20)
    readback_turn_ids: list[str] = Field(default_factory=list, max_length=20)
    confirmation_turn_ids: list[str] = Field(default_factory=list, max_length=20)

    #: Why corroboration failed, when it did. Shown to the curator verbatim.
    evidence_note: str = Field(default="", max_length=500)

    @property
    def read_back_confirmed(self) -> bool:
        return bool(self.readback_turn_ids and self.confirmation_turn_ids)

    @property
    def is_supported(self) -> bool:
        """Whether a human reading the transcript would find this claim in it."""
        return bool(self.source_turn_ids) and self.explicit_statement


class Confirmation(BaseModel):
    """A field the provider said was already correct."""

    model_config = ConfigDict(extra="forbid")
    field: str = Field(min_length=1, max_length=60)
    value: str = Field(default="", max_length=2000)
    turn_ids: list[str] = Field(default_factory=list, max_length=20)
    quote: str = Field(default="", max_length=1000)


class SafetyEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: SafetyEventKind
    detail: str = Field(default="", max_length=500)
    turn_id: str | None = None


class CallEvidence(BaseModel):
    """Everything one call submits. It authorises nothing on its own."""

    model_config = ConfigDict(extra="forbid")

    contract_id: str = Field(min_length=1, max_length=120)
    caller: str = Field(min_length=1, max_length=60)

    #: The provider's own identifier for the call. `run_id` for CALL-E.
    call_id: str = Field(default="", max_length=200)
    plan_id: str = Field(default="", max_length=200)
    provider_status: str = Field(default="", max_length=80)

    outcome: CallOutcome
    disclosure_spoken: bool = False
    recording_consent: bool = False

    transcript: list[Turn] = Field(default_factory=list, max_length=400)
    claims: list[Claim] = Field(default_factory=list, max_length=10)
    confirmations: list[Confirmation] = Field(default_factory=list, max_length=10)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=20)
    safety_events: list[SafetyEvent] = Field(default_factory=list, max_length=20)

    summary: str = Field(default="", max_length=2000)

    #: The caller's untouched structured output, kept for the ledger. Never read
    #: by policy; kept so a curator can compare what the caller said with what
    #: the transcript reader was able to establish.
    caller_result: dict[str, Any] = Field(default_factory=dict)

    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    completed_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    duration_seconds: float = Field(default=0.0, ge=0)

    @model_validator(mode="after")
    def one_claim_per_field(self) -> Self:
        fields = [claim.field for claim in self.claims]
        if len(set(fields)) != len(fields):
            raise ValueError("claims cannot contain more than one proposal per field")
        confirmed = [confirmation.field for confirmation in self.confirmations]
        if len(set(confirmed)) != len(confirmed):
            raise ValueError("confirmations cannot contain duplicates")
        overlap = set(fields) & set(confirmed)
        if overlap:
            raise ValueError(
                f"fields cannot be both unchanged and changed: {', '.join(sorted(overlap))}"
            )
        return self

    @property
    def reached_someone(self) -> bool:
        return self.outcome in CONTACT_OUTCOMES

    @property
    def covered_fields(self) -> set[str]:
        return {claim.field for claim in self.claims} | {c.field for c in self.confirmations}

    def turn(self, turn_id: str) -> Turn | None:
        return next((turn for turn in self.transcript if turn.id == turn_id), None)

    def quotes_for(self, turn_ids: list[str]) -> list[str]:
        return [turn.text for turn_id in turn_ids if (turn := self.turn(turn_id))]

    def transcript_records(self) -> list[dict[str, Any]]:
        return [turn.as_record() for turn in self.transcript]


class CallError(RuntimeError):
    """A call that could not be placed or could not be read back.

    Raised before any record is touched. The task returns to the queue and the
    record is left exactly as it was.
    """

    def __init__(self, message: str, *, retryable: bool = True, call_id: str = "") -> None:
        super().__init__(message)
        self.retryable = retryable
        self.call_id = call_id
