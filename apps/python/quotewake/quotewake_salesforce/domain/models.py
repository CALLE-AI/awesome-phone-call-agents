"""Typed models used between Salesforce and QuoteWake selection logic."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum


class SelectionDecision(str, Enum):
    """The action QuoteWake would take for a quote."""

    READY = "READY"
    SKIP = "SKIP"


class SelectionReason(str, Enum):
    """Machine-readable reasons for a selection decision."""

    READY = "READY"
    DISABLED = "DISABLED"
    INVALID_FOLLOW_UP_STATUS = "INVALID_FOLLOW_UP_STATUS"
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


@dataclass(frozen=True)
class QuoteCandidate:
    """The Salesforce quote data required for selection."""

    quote_id: str
    quote_name: str
    quote_status: str | None
    amount: Decimal | None
    currency_code: str | None
    expiration_date: date | None
    opportunity_id: str
    opportunity_name: str | None
    opportunity_is_closed: bool
    enabled: bool
    follow_up_status: str | None
    next_follow_up_at: datetime | None
    attempt_count: int
    last_follow_up_at: datetime | None
    last_follow_up_result: str | None


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

