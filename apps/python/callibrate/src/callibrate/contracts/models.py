"""The Verification Contract: what a call has to establish before software may act.

This is the boundary between an application that holds records and CALL-E, which
holds a conversation. Everything on this side of it is stated before the phone
rings: which record is in doubt, which fields the call has to settle, what
counts as evidence for each one, what the software is allowed to do afterwards
without asking a person, and what would stop the call.

Nothing here knows how a call is placed. That is deliberate. A contract is
readable, storable, diffable and testable on its own, and the same contract can
be handed to CALL-E, to the offline pilot line, or to a human caller with a
clipboard, and be judged by the same evidence rules afterwards.
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from callibrate.domain.services import FIELD_LABELS, FieldName


class TriggerType(StrEnum):
    """Why this record is in doubt. The trigger is the sentence a provider hears."""

    STALE_RECORD = "stale_record"
    USER_REPORT = "user_report"
    FAILED_REFERRAL = "failed_referral"
    MANUAL_REQUEST = "manual_request"
    SCHEDULED_REVERIFY = "scheduled_reverify"
    EXTERNAL_EVENT = "external_event"


class SubjectType(StrEnum):
    COMMUNITY_SERVICE = "community_service"
    BUSINESS_HOURS = "business_hours"
    APPOINTMENT_AVAILABILITY = "appointment_availability"
    PROVIDER_NETWORK = "provider_network"


class EscalationCondition(StrEnum):
    """Conditions that end the software's authority, whatever the call establishes."""

    SERVICE_CLOSING = "service_closing"
    ELIGIBILITY_CHANGED = "eligibility_changed"
    CONFLICTING_INFORMATION = "conflicting_information"
    AMBIGUOUS_ANSWER = "ambiguous_answer"
    WRONG_PARTY = "wrong_party"
    REACHED_CLIENT = "reached_client"
    STOP_REQUESTED = "stop_requested"
    DISTRESS = "distress"
    NO_DISCLOSURE = "no_disclosure"


DEFAULT_ESCALATIONS: tuple[EscalationCondition, ...] = tuple(EscalationCondition)


class Subject(BaseModel):
    """Who the record is about, in the words the provider would recognise."""

    model_config = ConfigDict(extra="forbid")
    type: SubjectType = SubjectType.COMMUNITY_SERVICE
    name: str = Field(min_length=1, max_length=300)
    organization: str = Field(default="", max_length=300)
    record_id: str = Field(min_length=1, max_length=120)


class Trigger(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: TriggerType
    message: str = Field(default="", max_length=1000)
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def is_urgent(self) -> bool:
        return self.type in {TriggerType.FAILED_REFERRAL, TriggerType.USER_REPORT}


class EvidenceRequirements(BaseModel):
    """What the transcript has to contain before a claim counts as established.

    These are requirements on the *record of the call*, not on the caller's own
    account of it. `corroborate_against_transcript` is the one that matters: with
    it on, a caller that reports a confirmed readback still has to have one in
    the transcript.
    """

    model_config = ConfigDict(extra="forbid")
    explicit_statement: bool = True
    readback_required: bool = True
    confirmation_required: bool = True
    corroborate_against_transcript: bool = True
    minimum_confidence: float = Field(default=0.9, ge=0, le=1)


class UpdatePolicy(BaseModel):
    """What the software may do with an established claim, before any call happens."""

    model_config = ConfigDict(extra="forbid")
    auto_apply_fields: list[FieldName] = Field(
        default_factory=lambda: [
            "name",
            "description",
            "schedule",
            "phone",
            "fees",
            "application_process",
            "alert",
            "address",
        ],
        max_length=10,
    )
    never_auto_apply_fields: list[FieldName] = Field(
        default_factory=lambda: ["status", "eligibility"], max_length=10
    )
    allow_deletion: bool = False

    @model_validator(mode="after")
    def fields_cannot_be_both(self) -> Self:
        overlap = set(self.auto_apply_fields) & set(self.never_auto_apply_fields)
        if overlap:
            raise ValueError(f"a field cannot be both auto-apply and never-auto-apply: {sorted(overlap)}")
        return self


class EscalationPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    escalate_if: list[EscalationCondition] = Field(
        default_factory=lambda: list(DEFAULT_ESCALATIONS), max_length=20
    )
    suppress_on_stop_request: bool = True


class CallConstraints(BaseModel):
    """The envelope the call has to happen inside, or not happen at all."""

    model_config = ConfigDict(extra="forbid")
    language: str = Field(default="English", max_length=60)
    region: str = Field(default="US", pattern=r"^[A-Z]{2}$")
    timezone: str = Field(default="America/New_York", min_length=1, max_length=100)
    disclosure_required: bool = True
    recording_allowed: bool = False
    max_attempts: int = Field(default=2, ge=1, le=5)
    max_duration_seconds: int = Field(default=420, ge=60, le=1800)


class VerificationContract(BaseModel):
    """One record, one reason to doubt it, and the terms the call is judged by."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=120)
    subject: Subject
    authoritative_phone: str = Field(pattern=r"^\+[1-9]\d{7,14}$")

    current_record: dict[str, str] = Field(default_factory=dict)
    fields_to_verify: list[FieldName] = Field(min_length=1, max_length=10)

    trigger: Trigger
    evidence_requirements: EvidenceRequirements = Field(default_factory=EvidenceRequirements)
    update_policy: UpdatePolicy = Field(default_factory=UpdatePolicy)
    escalation_policy: EscalationPolicy = Field(default_factory=EscalationPolicy)
    call_constraints: CallConstraints = Field(default_factory=CallConstraints)

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @model_validator(mode="after")
    def fields_are_distinct(self) -> Self:
        if len(set(self.fields_to_verify)) != len(self.fields_to_verify):
            raise ValueError("fields_to_verify cannot contain duplicates")
        return self

    def may_auto_apply(self, field: str) -> bool:
        return (
            field in self.update_policy.auto_apply_fields
            and field not in self.update_policy.never_auto_apply_fields
        )

    def escalates_on(self, condition: EscalationCondition) -> bool:
        return condition in self.escalation_policy.escalate_if

    def field_label(self, field: str) -> str:
        return FIELD_LABELS.get(field, field.replace("_", " "))

    def known_value(self, field: str) -> str:
        return self.current_record.get(field, "")

    def summary(self) -> str:
        """One line for a queue card and for the audit payload."""
        fields = ", ".join(self.field_label(field) for field in self.fields_to_verify)
        return f"{self.subject.name}: establish {fields} ({self.trigger.type.value})"

    def to_payload(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
