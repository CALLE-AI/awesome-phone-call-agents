"""Turn a spoken answer into a financial record, or refuse to.

This is the only place a call becomes money owed on a date. A model that is
confident and wrong is the expensive failure here, so every condition must hold
locally before a promise exists: the right person, a stated amount, a readable
future date inside the horizon, an amount the invoice can actually carry, and
enough completion confidence. Anything else is handed to a human with a named
reason rather than rounded up into a promise.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Any

from kept.calls.port import PlacedCall, task_digest
from kept.calls.schema import NOT_STATED
from kept.config import Policy
from kept.models import CallOutcome, CallTarget, Dispute, Promise, SpokenAnswer, redact_phone_like
from kept.money import AmountParseError, parse_amount_to_minor


@dataclass(frozen=True, slots=True)
class CallBinding:
    """What CALL-E was asked to do, so its answer can be proved to be that call's.

    The task is held as a digest because that is what the ledger records, and a
    recovered call is rebuilt from the ledger. Every field is required of the
    result; nothing absent is assumed to match.
    """

    call_id: str
    phone: str
    metadata: dict[str, str]
    task_digest: str


class CaptureVerdict(str, Enum):
    PROMISE_RECORDED = "promise_recorded"
    DISPUTE_RECORDED = "dispute_recorded"
    NO_RECORD = "no_record"


class RejectionReason(str, Enum):
    RESULT_NOT_BOUND = "result_not_bound"
    CALL_NOT_COMPLETED = "call_not_completed"
    MISSING_STRUCTURED_RESULT = "missing_structured_result"
    MALFORMED_RESULT = "malformed_result"
    WRONG_PARTY = "wrong_party"
    NO_COMMITMENT = "no_commitment"
    UNREADABLE_AMOUNT = "unreadable_amount"
    UNREADABLE_DATE = "unreadable_date"
    DATE_IN_PAST = "date_in_past"
    DATE_BEYOND_HORIZON = "date_beyond_horizon"
    LOW_CONFIDENCE = "low_confidence"


@dataclass(frozen=True, slots=True)
class CaptureResult:
    verdict: CaptureVerdict
    answer: SpokenAnswer | None = None
    promise: Promise | None = None
    dispute: Dispute | None = None
    rejection: RejectionReason | None = None
    spoken_amount_minor: int | None = None

    @property
    def was_clamped(self) -> bool:
        if self.promise is None or self.spoken_amount_minor is None:
            return False
        return self.spoken_amount_minor != self.promise.amount_minor


class PromiseCapture:
    def __init__(self, *, policy: Policy) -> None:
        self._policy = policy

    def capture(
        self,
        placed: PlacedCall,
        target: CallTarget,
        now: datetime,
        binding: CallBinding,
    ) -> CaptureResult:
        if _binding_mismatch(placed, binding) is not None:
            return _rejected(RejectionReason.RESULT_NOT_BOUND)
        if not placed.is_terminal_success:
            return _rejected(RejectionReason.CALL_NOT_COMPLETED)
        if placed.structured_result is None:
            return _rejected(RejectionReason.MISSING_STRUCTURED_RESULT)
        try:
            answer = _read_answer(placed.structured_result)
        except (KeyError, TypeError, ValueError):
            return _rejected(RejectionReason.MALFORMED_RESULT)
        if _is_dispute(answer):
            if answer.right_party_reached != "yes":
                return _rejected(RejectionReason.WRONG_PARTY, answer)
            return _dispute(answer, placed, target, now)
        return self._capture_promise(answer, placed, target, now)

    def _capture_promise(
        self, answer: SpokenAnswer, placed: PlacedCall, target: CallTarget, now: datetime
    ) -> CaptureResult:
        rejection = self._reject_reason(answer, placed.confidence, now.date())
        if rejection is not None:
            return _rejected(rejection, answer)
        spoken_minor = parse_amount_to_minor(str(answer.promised_amount))
        promise = Promise(
            id=f"prm_{target.invoice.id}_{placed.call_id}",
            invoice_id=target.invoice.id,
            customer_id=target.customer.id,
            call_id=placed.call_id,
            amount_minor=min(spoken_minor, target.outstanding_minor),
            due_date=date.fromisoformat(str(answer.promised_date)),
            method=answer.payment_method or "unknown",
            captured_at=now,
            confidence=placed.confidence,
            evidence=answer.evidence_quote,
        )
        return CaptureResult(
            verdict=CaptureVerdict.PROMISE_RECORDED,
            answer=answer,
            promise=promise,
            spoken_amount_minor=spoken_minor,
        )

    def _reject_reason(
        self, answer: SpokenAnswer, confidence: float, today: date
    ) -> RejectionReason | None:
        if answer.outcome is not CallOutcome.PROMISE_TO_PAY or answer.promise_made != "yes":
            return RejectionReason.NO_COMMITMENT
        if answer.right_party_reached != "yes":
            return RejectionReason.WRONG_PARTY
        if confidence < self._policy.min_confidence_to_record:
            return RejectionReason.LOW_CONFIDENCE
        return self._reject_terms(answer, today)

    def _reject_terms(self, answer: SpokenAnswer, today: date) -> RejectionReason | None:
        try:
            amount = parse_amount_to_minor(str(answer.promised_amount))
        except AmountParseError:
            return RejectionReason.UNREADABLE_AMOUNT
        if amount <= 0:
            return RejectionReason.UNREADABLE_AMOUNT
        try:
            promised = date.fromisoformat(str(answer.promised_date))
        except (TypeError, ValueError):
            return RejectionReason.UNREADABLE_DATE
        if promised < today:
            return RejectionReason.DATE_IN_PAST
        if promised > today + timedelta(days=self._policy.max_promise_horizon_days):
            return RejectionReason.DATE_BEYOND_HORIZON
        return None


def _read_answer(result: dict[str, Any]) -> SpokenAnswer:
    return SpokenAnswer(
        outcome=CallOutcome(result["outcome"]),
        right_party_reached=str(result["right_party_reached"]),
        promise_made=str(result["promise_made"]),
        promised_amount=_optional_text(result["promised_amount"]),
        promised_date=_optional_text(result["promised_date"]),
        payment_method=_optional_text(result["payment_method"]),
        dispute_raised=str(result["dispute_raised"]),
        dispute_reason=_optional_masked(result["dispute_reason"]),
        evidence_quote=redact_phone_like(str(result["evidence_quote"])),
    )


def _binding_mismatch(placed: PlacedCall, binding: CallBinding) -> str | None:
    """Name the first thing about this result that is not the call we placed.

    A structured result is only allowed to settle the invoice it was raised for.
    CALL-E echoes the task, the recipients and the metadata on every call, so
    each is required here and compared with what was sent. A result that omits
    any of them is refused rather than trusted.
    """
    if placed.call_id != binding.call_id:
        return "call_id"
    if not placed.task or task_digest(placed.task) != binding.task_digest:
        return "task"
    if placed.phones != (binding.phone,):
        return "recipient"
    for key, expected in binding.metadata.items():
        if placed.metadata.get(key) != expected:
            return f"metadata.{key}"
    return None


_ABSENT = {NOT_STATED, "", "none", "null", "n/a"}


def _optional_text(value: Any) -> str | None:
    """Normalise CALL-E's sentinel for an unanswered field to a real absence."""
    if value is None:
        return None
    text = str(value).strip()
    return None if text.lower() in _ABSENT else text


def _optional_masked(value: Any) -> str | None:
    text = _optional_text(value)
    return None if text is None else redact_phone_like(text)


def _is_dispute(answer: SpokenAnswer) -> bool:
    return answer.dispute_raised == "yes" or answer.outcome is CallOutcome.DISPUTE


def _dispute(answer: SpokenAnswer, placed: PlacedCall, target: CallTarget, now: datetime) -> CaptureResult:
    dispute = Dispute(
        invoice_id=target.invoice.id,
        customer_id=target.customer.id,
        call_id=placed.call_id,
        reason=answer.dispute_reason or answer.evidence_quote or "Reason not stated.",
        raised_at=now,
    )
    return CaptureResult(verdict=CaptureVerdict.DISPUTE_RECORDED, answer=answer, dispute=dispute)


def _rejected(reason: RejectionReason, answer: SpokenAnswer | None = None) -> CaptureResult:
    return CaptureResult(verdict=CaptureVerdict.NO_RECORD, answer=answer, rejection=reason)
