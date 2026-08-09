"""Typed models used between Salesforce and QuoteWake selection logic."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
import re


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


class CallPlanDecision(str, Enum):
    """Result of asking CALL-E to plan a selected follow-up."""

    PLAN_READY = "PLAN_READY"
    PLAN_INCOMPLETE = "PLAN_INCOMPLETE"
    PLAN_ERROR = "PLAN_ERROR"


class SimulationOutcome(str, Enum):
    """Supported deterministic outcomes for the local CALL-E substitute."""

    INTERESTED = "interested"
    NOT_INTERESTED = "not_interested"
    CALL_BACK_LATER = "call_back_later"
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    INVALID_NUMBER = "invalid_number"
    ERROR = "error"


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
    last_follow_up_at: datetime | None
    last_follow_up_result: str | None
    money: Money | None = None


@dataclass(frozen=True)
class ContactTarget:
    """A primary Opportunity Contact Role contact and its selected phone."""

    contact_id: str
    name: str
    phone: str | None
    do_not_call: bool


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
class CallPlanRequest:
    """Stable input passed from the QuoteWake domain to CALL-E planning."""

    quote_id: str
    opportunity_id: str
    contact_id: str
    phone: str
    goal: str
    user_input: str
    language: str
    region: str


@dataclass(frozen=True)
class CallPlanResult:
    """Redacted subset of a CALL-E plan response safe for local reporting."""

    quote_id: str
    decision: CallPlanDecision
    ready_to_run: bool
    plan_id: str | None = None
    confirm_summary: str | None = None
    clarifying_questions: tuple[str, ...] = ()
    error: str | None = None


@dataclass(frozen=True)
class CallResult:
    """Stable structured outcome shared by CALL-E adapters and persistence."""

    quote_id: str
    simulation_id: str
    provider_status: str
    outcome: str
    interest_level: str
    preferred_date: date | None
    summary: str
    next_action: str
    next_follow_up_at: datetime | None
    simulation_timestamp: datetime | None = None
    simulated: bool = True
