"""Domain types for PositiveContact.

The application owns business state. CALL-E owns call state. Nothing in this module
collapses the two: `IntentState` is ours, `CallStatus` is theirs, and they meet only in
`adjudicate.py`.

No field in this module records a medical condition, device, diagnosis, or medication.
"Medical Baseline" is a tariff enrollment flag and nothing more. `tests/test_no_phi.py`
enforces that.
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator

# From the CALL-E OpenAPI contract, CallTaskRecipientRequest.phones.items.pattern.
# Numbers are validated against this and never repaired.
E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")

# Idempotency-Key header bound from the contract (minLength 1, maxLength 255).
IDEMPOTENCY_KEY_MAX_LENGTH = 255


class IntentState(str, Enum):
    """Business state of one authorized call intention.

    Named exactly as in ARCHITECTURE.md section 6.
    """

    RESERVED = "RESERVED"
    SUBMITTED = "SUBMITTED"
    SUBMISSION_UNKNOWN = "SUBMISSION_UNKNOWN"
    TERMINAL_UNVERIFIED = "TERMINAL_UNVERIFIED"
    ADJUDICATED = "ADJUDICATED"
    CONFIRMED = "CONFIRMED"
    UNCONFIRMED_WAITING = "UNCONFIRMED_WAITING"
    NEEDS_HUMAN = "NEEDS_HUMAN"
    FIELD_VISIT_PENDING = "FIELD_VISIT_PENDING"
    FIELD_VISIT_ISSUED = "FIELD_VISIT_ISSUED"
    CLOSED_REFUSED = "CLOSED_REFUSED"


TERMINAL_INTENT_STATES = frozenset(
    {
        IntentState.CONFIRMED,
        IntentState.FIELD_VISIT_ISSUED,
        IntentState.CLOSED_REFUSED,
    }
)
"""States from which the ladder never moves again."""


class LadderEvent(str, Enum):
    """The only things that may move an intent from one state to another."""

    CALL_ACCEPTED = "call_accepted"
    SUBMISSION_AMBIGUOUS = "submission_ambiguous"
    RECONCILED = "reconciled"
    RECONCILE_FAILED = "reconcile_failed"
    TERMINAL_OBSERVED = "terminal_observed"
    BINDING_VERIFIED = "binding_verified"
    BINDING_MISMATCH = "binding_mismatch"
    DISPOSITION_CONFIRMED = "disposition_confirmed"
    DISPOSITION_UNCONFIRMED = "disposition_unconfirmed"
    DISPOSITION_NEEDS_HUMAN = "disposition_needs_human"
    LADDER_ADVANCED = "ladder_advanced"
    LADDER_EXHAUSTED = "ladder_exhausted"
    CUTOFF_REACHED = "cutoff_reached"
    OPERATOR_CONFIRMED = "operator_confirmed"
    OPERATOR_REFUSED = "operator_refused"
    FIELD_VISIT_APPROVED = "field_visit_approved"


class LadderTarget(str, Enum):
    PRIMARY = "primary"
    ALTERNATE = "alternate"


class ContactType(str, Enum):
    """`contact_type` values in the recipient result schema (ARCHITECTURE.md section 9)."""

    LIVE_PERSON = "live_person"
    VOICEMAIL = "voicemail"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    WRONG_NUMBER = "wrong_number"
    REFUSED = "refused"
    LANGUAGE_BARRIER = "language_barrier"
    UNKNOWN = "unknown"


class Acknowledged(str, Enum):
    YES = "yes"
    NO = "no"
    UNKNOWN = "unknown"


class SpokeWith(str, Enum):
    CUSTOMER = "customer"
    HOUSEHOLD_MEMBER = "household_member"
    CAREGIVER = "caregiver"
    OTHER = "other"
    UNKNOWN = "unknown"


class NeedsAssistance(str, Enum):
    NONE = "none"
    TRANSPORT = "transport"
    RESOURCE_CENTER_INFO = "resource_center_info"
    CALLBACK_REQUESTED = "callback_requested"
    MEDICAL_QUESTION = "medical_question"
    OTHER = "other"
    UNKNOWN = "unknown"


class YesNoUnknown(str, Enum):
    YES = "yes"
    NO = "no"
    UNKNOWN = "unknown"


class SupportCategory(str, Enum):
    """Minimum coded detail needed to route a consented support request."""

    PRESCRIPTION_ACCESS = "prescription_access"
    POWERED_EQUIPMENT = "powered_equipment"
    OTHER_CRITICAL_SUPPLY = "other_critical_supply"
    UNKNOWN = "unknown"


class SupportUrgency(str, Enum):
    NOW = "now"
    TODAY = "today"
    BEFORE_OUTAGE = "before_outage"
    UNKNOWN = "unknown"


class SupportRequestState(str, Enum):
    PENDING_REVIEW = "PENDING_REVIEW"
    SUBMISSION_UNKNOWN = "SUBMISSION_UNKNOWN"
    SUBMITTED = "SUBMITTED"
    COMPLETED = "COMPLETED"
    NEEDS_HUMAN = "NEEDS_HUMAN"
    DECLINED = "DECLINED"


class SupportProvider(BaseModel):
    """An allowlisted public business contact supplied by the event operator."""

    model_config = ConfigDict(extra="forbid")

    provider_id: str
    name: str
    kind: str
    phone_e164: str
    locale: str = "en-US"
    region: str = "US"
    demo_only: bool = False

    @field_validator("phone_e164")
    @classmethod
    def _check_phone(cls, value: str) -> str:
        return validate_e164(value)


class DispositionKind(str, Enum):
    """Exactly one of these comes out of the adjudicator for a verified terminal call."""

    CONFIRMED = "CONFIRMED"
    UNCONFIRMED = "UNCONFIRMED"
    NEEDS_HUMAN = "NEEDS_HUMAN"


# Outcomes that must never be redialled automatically, whatever the ladder says.
NO_REDIAL_CONTACT_TYPES = frozenset(
    {
        ContactType.WRONG_NUMBER,
        ContactType.REFUSED,
        ContactType.LANGUAGE_BARRIER,
    }
)

# Outcomes a retry step may act on. Mirrors the `only_if` lists in the default policy.
RETRYABLE_CONTACT_TYPES = frozenset(
    {
        ContactType.NO_ANSWER,
        ContactType.BUSY,
        ContactType.VOICEMAIL,
    }
)


def derive_idempotency_key(
    event_id: str, contact_id: str, ladder_step: int, target: "LadderTarget | str"
) -> str:
    """Build the duplicate-call guard from the authorization, never from the attempt.

    The key is a pure function of what was authorized: this event, this contact, this
    ladder step, this target. Two processes racing the same step derive the same key, and
    a retry after an unknown submission reuses it rather than minting a new one.
    """
    target_value = target.value if isinstance(target, LadderTarget) else str(target)
    key = f"pc:{event_id}:{contact_id}:{ladder_step}:{target_value}"
    if len(key) > IDEMPOTENCY_KEY_MAX_LENGTH:
        raise ValueError(
            f"idempotency key for {contact_id} would be {len(key)} characters, over the "
            f"CALL-E limit of {IDEMPOTENCY_KEY_MAX_LENGTH}; shorten the event or contact id"
        )
    return key


def derive_intent_id(
    event_id: str, contact_id: str, ladder_step: int, target: "LadderTarget | str"
) -> str:
    """Deterministic intent id, so a restart re-derives the same row instead of a new one."""
    target_value = target.value if isinstance(target, LadderTarget) else str(target)
    return f"int:{event_id}:{contact_id}:{ladder_step}:{target_value}"


def validate_e164(value: str) -> str:
    """Return `value` unchanged if it is E.164, else raise. Never repairs a number."""
    if not isinstance(value, str) or not E164_RE.match(value):
        raise ValueError(
            "phone number must already be E.164 (a leading plus, country code, then digits); "
            "PositiveContact rejects malformed numbers instead of repairing them"
        )
    return value


class Event(BaseModel):
    """One PSPS event."""

    model_config = ConfigDict(extra="forbid")

    event_id: str
    utility_name: str
    window_start: datetime
    window_end: datetime
    field_visit_cutoff: datetime
    default_tz: str
    crc_info: dict[str, str] = Field(default_factory=dict)
    policy: dict = Field(default_factory=dict)
    support_providers: list[SupportProvider] = Field(default_factory=list)

    @field_validator("window_start", "window_end", "field_visit_cutoff")
    @classmethod
    def _require_tzaware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("event timestamps must carry a timezone offset")
        return value


class Contact(BaseModel):
    """One roster row. The only place a raw E.164 is allowed to live."""

    model_config = ConfigDict(extra="forbid")

    contact_id: str
    event_id: str
    first_name: str
    phone_e164: str
    alt_phone_e164: str | None = None
    locale: str
    tz: str
    service_address_short: str

    @field_validator("phone_e164")
    @classmethod
    def _check_phone(cls, value: str) -> str:
        return validate_e164(value)

    @field_validator("alt_phone_e164")
    @classmethod
    def _check_alt_phone(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return validate_e164(value)

    def phone_for(self, target: LadderTarget) -> str | None:
        if target is LadderTarget.PRIMARY:
            return self.phone_e164
        return self.alt_phone_e164


class Intent(BaseModel):
    """One authorized call intention. Persisted before anything is submitted."""

    model_config = ConfigDict(extra="forbid")

    intent_id: str
    event_id: str
    contact_id: str
    ladder_step: int
    target: LadderTarget
    idempotency_key: str
    task_version: str
    schema_version: str
    state: IntentState
    not_before: datetime
    created_at: datetime

    @field_validator("idempotency_key")
    @classmethod
    def _check_key_length(cls, value: str) -> str:
        if not 1 <= len(value) <= IDEMPOTENCY_KEY_MAX_LENGTH:
            raise ValueError(
                f"idempotency key must be 1 to {IDEMPOTENCY_KEY_MAX_LENGTH} characters "
                "to satisfy the CALL-E Idempotency-Key header contract"
            )
        return value


class Attempt(BaseModel):
    """Provider-side binding for one intent."""

    model_config = ConfigDict(extra="forbid")

    intent_id: str
    call_id: str
    submitted_at: datetime
    terminal_status: str | None = None
    raw_snapshot_redacted: dict | None = None


class EvidenceSpan(BaseModel):
    """A quoted piece of the call that a judge used to reach its verdict."""

    model_config = ConfigDict(extra="forbid")

    source: str
    turn_index: int | None = None
    offset_seconds: int | None = None
    speaker: str | None = None
    text: str


class JudgeVerdict(BaseModel):
    """One judge's independent read of a terminal call."""

    model_config = ConfigDict(extra="forbid")

    judge: str
    contact_type: ContactType
    acknowledged: Acknowledged
    reason_code: str
    evidence: list[EvidenceSpan] = Field(default_factory=list)
    note: str | None = None


class Disposition(BaseModel):
    """Adjudication output for one intent. Exactly one per verified terminal call."""

    model_config = ConfigDict(extra="forbid")

    intent_id: str
    contact_type: ContactType
    acknowledged: Acknowledged
    needs_assistance: NeedsAssistance
    confidence_score: float | None
    confidence_label: str | None
    judge_a: str
    judge_b: str
    judge_c: str | None
    judges_agree: bool
    disposition: DispositionKind
    reason_code: str
    evidence_spans: list[EvidenceSpan] = Field(default_factory=list)
    notes_for_human: str | None = None
    support_category: SupportCategory = SupportCategory.UNKNOWN
    support_urgency: SupportUrgency = SupportUrgency.UNKNOWN
    provider_contact_consent: YesNoUnknown = YesNoUnknown.UNKNOWN
    emergency_risk: YesNoUnknown = YesNoUnknown.UNKNOWN


class SupportRequest(BaseModel):
    """A consented handoff to an operator-selected support provider."""

    model_config = ConfigDict(extra="forbid")

    request_id: str
    event_id: str
    contact_id: str
    source_intent_id: str
    category: SupportCategory
    urgency: SupportUrgency
    consent: YesNoUnknown
    state: SupportRequestState
    created_at: datetime
    provider_id: str | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    idempotency_key: str | None = None
    call_id: str | None = None
    result: dict | None = None
    completed_at: datetime | None = None


class WorkOrder(BaseModel):
    """A field visit. Prepared by the engine, dispatched only by a person."""

    model_config = ConfigDict(extra="forbid")

    work_order_id: str
    contact_id: str
    event_id: str
    reason_code: str
    created_at: datetime
    approved_by: str | None = None
    approved_at: datetime | None = None
    exported_at: datetime | None = None


class Transition(BaseModel):
    """One append-only audit row."""

    model_config = ConfigDict(extra="forbid")

    intent_id: str
    from_state: IntentState | None
    to_state: IntentState
    reason_code: str
    evidence_refs: dict = Field(default_factory=dict)
    actor: str
    at: datetime
