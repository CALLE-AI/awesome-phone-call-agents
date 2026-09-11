"""Typed models used between Salesforce and QuoteWake selection logic."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum
import re


# This is the business vocabulary exchanged with CALL-E.  Keep the ordered
# tuple for provider schemas and the set for cheap validation at that boundary.
CALL_OUTCOME_VALUES = (
    "interested",
    "call_back_later",
    "not_interested",
    "stop_quote_follow_up",
    "unknown",
    "no_answer",
    "busy",
)
CALL_OUTCOME_VOCABULARY = frozenset(CALL_OUTCOME_VALUES)
# Provider terminal states can produce this internal operational outcome.  It
# is valid after the CALL-E boundary but must never be requested from the agent.
CALL_RESULT_OUTCOME_VOCABULARY = CALL_OUTCOME_VOCABULARY | {
    "call_not_established"
}

# Keep the provider-facing interest vocabulary equally narrow.  These values
# are intentionally plain strings at the domain boundary so Salesforce writes
# do not depend on SDK-specific enum classes.
CALL_INTEREST_VALUES = ("high", "medium", "low", "unknown")
CALL_INTEREST_VOCABULARY = frozenset(CALL_INTEREST_VALUES)


class SelectionDecision(str, Enum):
    """The action QuoteWake would take for a quote."""

    READY = "READY"
    SKIP = "SKIP"


class SelectionReason(str, Enum):
    """Machine-readable reasons for a selection decision."""

    READY = "READY"
    DISABLED = "DISABLED"
    INVALID_FOLLOW_UP_STATUS = "INVALID_FOLLOW_UP_STATUS"
    NON_ACTIONABLE_FOLLOW_UP_STATUS = "NON_ACTIONABLE_FOLLOW_UP_STATUS"
    NOT_DUE = "NOT_DUE"
    MAX_ATTEMPTS = "MAX_ATTEMPTS"
    QUOTE_EXPIRED = "QUOTE_EXPIRED"
    INVALID_QUOTE_STATUS = "INVALID_QUOTE_STATUS"
    OPPORTUNITY_CLOSED = "OPPORTUNITY_CLOSED"
    NO_PRIMARY_CONTACT = "NO_PRIMARY_CONTACT"
    MULTIPLE_PRIMARY_CONTACTS = "MULTIPLE_PRIMARY_CONTACTS"
    DO_NOT_CALL = "DO_NOT_CALL"
    NO_PHONE = "NO_PHONE"
    INVALID_PHONE = "INVALID_PHONE"


class CallOutcomeKind(str, Enum):
    """Whether a provider result represents a business attempt."""

    BUSINESS = "business"
    TECHNICAL_FAILURE = "technical_failure"


@dataclass(frozen=True)
class Money:
    """An exact Salesforce monetary value and the field that supplied it."""

    value: Decimal
    currency: str
    source: str
    scale: int

    def __post_init__(self) -> None:
        if not isinstance(self.value, Decimal) or not self.value.is_finite():
            raise ValueError("Money.value must be a finite Decimal.")
        if not isinstance(self.currency, str) or not re.fullmatch(r"[A-Z]{3}", self.currency):
            raise ValueError("Money.currency must be an uppercase ISO-4217 code.")
        if not isinstance(self.source, str) or not self.source:
            raise ValueError("Money.source must identify the Salesforce field.")
        if isinstance(self.scale, bool) or not isinstance(self.scale, int) or self.scale < 0:
            raise ValueError("Money.scale must be a non-negative integer.")


@dataclass(frozen=True)
class QuoteCandidate:
    """The Salesforce quote data required for selection."""

    quote_id: str
    quote_name: str
    quote_status: str | None
    amount: Decimal | None
    currency_code: str | None
    expiration_date: date | None
    last_modified_at: datetime
    opportunity_id: str
    opportunity_name: str | None
    account_name: str | None
    opportunity_is_closed: bool
    enabled: bool
    follow_up_status: str | None
    next_follow_up_at: datetime | None
    attempt_count: int
    money: Money | None = None
    account_billing_country_code: str | None = None


@dataclass(frozen=True)
class ContactTarget:
    """A primary Opportunity Contact Role contact and its selected phone."""

    contact_id: str
    name: str
    phone: str | None
    do_not_call: bool
    call_locale: str | None = None


@dataclass(frozen=True)
class SelectionResult:
    """The result of quote and contact selection."""

    decision: SelectionDecision
    reason: SelectionReason
    quote: QuoteCandidate
    contact: ContactTarget | None = None


@dataclass(frozen=True)
class QuoteLine:
    """A concise Salesforce QuoteLineItem used as call context."""

    product_name: str
    quantity: Decimal | None
    unit_price: Decimal | None
    total_price: Decimal | None
    currency_code: str | None = None
    quantity_unit: str | None = None


@dataclass(frozen=True)
class CallRequest:
    """Stable input passed from the QuoteWake domain to CALL-E execution."""

    quote_id: str
    opportunity_id: str
    contact_id: str
    phone: str
    goal: str
    locale: str
    region: str


@dataclass(frozen=True)
class CallResult:
    """Stable structured outcome shared by CALL-E adapters and persistence."""

    quote_id: str
    call_id: str
    provider_status: str
    outcome: str
    interest_level: str
    preferred_date: date | None
    summary: str
    next_action: str
    next_follow_up_at: datetime | None
    outcome_kind: CallOutcomeKind
    occurred_at: datetime | None = None
    binding_digest: str | None = None
    provider_key: str | None = None
    bound_phone: str | None = None
    bound_task: str | None = None
    bound_schema_digest: str | None = None
    bound_metadata: tuple[tuple[str, str], ...] | None = None
    binding_verified: bool = False


@dataclass(frozen=True)
class FollowUpUpdate:
    """The four QuoteWake fields calculated from one normalized call result."""

    attempt_count: int
    follow_up_status: str
    next_follow_up_at: datetime | None

    def as_salesforce_fields(self) -> dict[str, object]:
        """Return the Quote field values for the persistence boundary."""

        def timestamp(value: datetime | None) -> str | None:
            if value is None:
                return None
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("Follow-up timestamps must be timezone-aware.")
            return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

        return {
            "Attempt_Count__c": self.attempt_count,
            "Follow_Up_Status__c": self.follow_up_status,
            "Next_Follow_Up_At__c": timestamp(self.next_follow_up_at),
        }
