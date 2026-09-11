"""Domain types. Frozen, self-validating, free of I/O and of CALL-E concepts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from enum import Enum


class CallCycle(str, Enum):
    """Which conversation an account has earned, based on promise history."""

    FIRST_CONTACT = "first_contact"
    REMINDER = "reminder"
    BROKEN_PROMISE = "broken_promise"
    FINAL_NOTICE = "final_notice"


class CallOutcome(str, Enum):
    """Outcome vocabulary the voice agent is constrained to."""

    PROMISE_TO_PAY = "promise_to_pay"
    ALREADY_PAID = "already_paid"
    DISPUTE = "dispute"
    REFUSED = "refused"
    WRONG_NUMBER = "wrong_number"
    VOICEMAIL = "voicemail"
    NO_ANSWER = "no_answer"
    CALLBACK_REQUESTED = "callback_requested"
    UNCLEAR = "unclear"


class PromiseStatus(str, Enum):
    OPEN = "open"
    KEPT = "kept"
    PARTIAL = "partial"
    BROKEN = "broken"
    SUPERSEDED = "superseded"


class SuppressionReason(str, Enum):
    """Why an overdue invoice was not dialled. Every skipped call names one."""

    NO_PHONE = "no_phone"
    DO_NOT_CALL = "do_not_call"
    NOT_AUTHORIZED = "recipient_not_authorized"
    DISPUTE_OPEN = "dispute_open"
    PROMISE_OPEN = "promise_open"
    ALREADY_SETTLED = "already_settled"
    NOT_YET_DUE = "not_yet_due"
    QUIET_HOURS = "quiet_hours"
    CONTACT_FREQUENCY_EXCEEDED = "contact_frequency_exceeded"
    CALL_BUDGET_EXHAUSTED = "call_budget_exhausted"


@dataclass(frozen=True, slots=True)
class Customer:
    id: str
    name: str
    phones: tuple[str, ...]
    region: str
    locale: str
    timezone: str
    do_not_call: bool = False

    def __post_init__(self) -> None:
        if not self.id or not self.name:
            raise ValueError("Customer needs an id and a name.")
        for phone in self.phones:
            if not is_e164(phone):
                raise ValueError(
                    f"Phone {mask_phone(phone)} is not E.164: expected + followed by "
                    "7 to 15 digits and nothing else."
                )

    @property
    def primary_phone(self) -> str | None:
        return self.phones[0] if self.phones else None


@dataclass(frozen=True, slots=True)
class Invoice:
    id: str
    customer_id: str
    currency: str
    amount_minor: int
    due_date: date

    def __post_init__(self) -> None:
        if self.amount_minor <= 0:
            raise ValueError(f"Invoice {self.id} must have a positive amount.")
        if len(self.currency) != 3:
            raise ValueError(f"Invoice {self.id} needs a 3-letter currency code.")


@dataclass(frozen=True, slots=True)
class Payment:
    id: str
    customer_id: str
    amount_minor: int
    value_date: date
    reference: str = ""

    def __post_init__(self) -> None:
        if self.amount_minor <= 0:
            raise ValueError(f"Payment {self.id} must have a positive amount.")


@dataclass(frozen=True, slots=True)
class Promise:
    """A dated commitment captured on a call and validated locally.

    A Promise only exists once the spoken answer has passed every check in
    `capture`, so its presence is itself evidence that the call was conclusive.
    """

    id: str
    invoice_id: str
    customer_id: str
    call_id: str
    amount_minor: int
    due_date: date
    method: str
    captured_at: datetime
    confidence: float
    evidence: str

    def __post_init__(self) -> None:
        if self.amount_minor <= 0:
            raise ValueError(f"Promise {self.id} must have a positive amount.")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"Promise {self.id} has an out-of-range confidence.")


@dataclass(frozen=True, slots=True)
class Dispute:
    invoice_id: str
    customer_id: str
    call_id: str
    reason: str
    raised_at: datetime


@dataclass(frozen=True, slots=True)
class Allocation:
    """One payment applied to one invoice. Never overlaps another allocation."""

    payment_id: str
    invoice_id: str
    amount_minor: int
    value_date: date


@dataclass(frozen=True, slots=True)
class ContactEvent:
    """One placed call, replayed from the ledger to enforce contact frequency."""

    invoice_id: str
    customer_id: str
    call_id: str
    cycle: CallCycle
    occurred_at: datetime
    outcome: CallOutcome | None


@dataclass(frozen=True, slots=True)
class CallTarget:
    invoice: Invoice
    customer: Customer
    cycle: CallCycle
    outstanding_minor: int
    broken_promise_count: int
    last_broken_promise: Promise | None = None


@dataclass(frozen=True, slots=True)
class Suppression:
    invoice_id: str
    customer_id: str
    reason: SuppressionReason
    detail: str = ""


@dataclass(frozen=True, slots=True)
class CallPlan:
    targets: tuple[CallTarget, ...] = ()
    suppressions: tuple[Suppression, ...] = ()

    @property
    def calls_required(self) -> int:
        return len(self.targets)


@dataclass(frozen=True, slots=True)
class SpokenAnswer:
    """The validated projection of one CALL-E structured result."""

    outcome: CallOutcome
    right_party_reached: str
    promise_made: str
    promised_amount: str | None
    promised_date: str | None
    payment_method: str | None
    dispute_raised: str
    dispute_reason: str | None
    evidence_quote: str


def mask_phone(phone: str) -> str:
    """Reduce a number to its last two digits for logs, reports and summaries."""
    digits = [character for character in phone if character.isdigit()]
    if len(digits) < 2:
        return "***"
    return f"***{''.join(digits[-2:])}"


_E164 = re.compile(r"\+[1-9]\d{6,14}")


def is_e164(phone: str) -> bool:
    """True only for a dialable international number in strict E.164 form.

    A leading + is not validation. Spaces, dashes, extensions and a missing
    country code all reach the provider as a destination it may still try to
    route, so the format is pinned here rather than at the API boundary.
    """
    return bool(_E164.fullmatch(phone))


_PHONE_LIKE = re.compile(r"\+?\d[\d\s().-]{5,18}\d")


def redact_phone_like(text: str) -> str:
    """Mask anything in provider-derived text that could be a phone number.

    Transcript quotes and provider failure messages are free text nobody here
    wrote, so a number can arrive inside one and be persisted or rendered.
    Grouped amounts and ISO dates survive untouched because neither reaches
    nine digits without a comma between them.
    """
    return _PHONE_LIKE.sub(_mask_if_phone_like, text)


def _mask_if_phone_like(match: re.Match[str]) -> str:
    token = match.group(0)
    digits = sum(1 for character in token if character.isdigit())
    shortest = 7 if token.startswith("+") else 9
    return mask_phone(token) if shortest <= digits <= 15 else token
