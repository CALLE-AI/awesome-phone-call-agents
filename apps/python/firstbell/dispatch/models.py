"""The vocabulary the dispatcher works in.

The important idea here is that a phone call has **three** terminal outcomes, not two.
CALL-E can return a call whose status is `completed` while `structured_result` is null,
which means somebody answered, a conversation happened, and the schema still could not be
filled. Code that branches on status alone records that as contacted, and a person who
needed a callback never gets one.

So `Resolution` has RESOLVED, FAILED and UNDETERMINED, and nothing in this package is
allowed to collapse the third into either of the other two.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Resolution(str, Enum):
    RESOLVED = "resolved"          # schema-valid answer came back
    FAILED = "failed"              # the call did not happen, or was refused
    UNDETERMINED = "undetermined"  # the call happened and produced no usable answer
    SKIPPED = "skipped"            # never dispatched: cancelled, or blocked by a gate

    @property
    def needs_a_human(self) -> bool:
        return self in (Resolution.UNDETERMINED, Resolution.FAILED)


# Error codes where retrying the identical request is reasonable. Everything outside this
# set is treated as permanent, because retrying an `invalid_phone` just burns budget.
RETRYABLE_ERRORS = frozenset({
    "rate_limit_exceeded",
    "provider_unavailable",
    "internal_error",
})

# Error codes that mean this work item can never succeed as submitted.
PERMANENT_ERRORS = frozenset({
    "invalid_phone",
    "invalid_recipient",
    "no_recipients",
    "unsupported_region",
    "unsupported_language",
    "recipient_blocked",
    "policy_violation",
    "result_schema_invalid",
    "recipient_result_schema_invalid",
    "invalid_request",
})

# Anything here should stop the whole run rather than the item: continuing wastes money
# or cannot possibly work.
FATAL_ERRORS = frozenset({
    "insufficient_balance",
    "unauthorized",
    "forbidden",
})


@dataclass(frozen=True)
class WorkItem:
    """One unit of phone work: one person to reach, however many numbers they have."""

    id: str
    phones: tuple[str, ...]
    locale: str | None = None
    region: str | None = None
    context: dict[str, Any] = field(default_factory=dict)
    consented: bool = True

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("WorkItem needs an id; it is the idempotency anchor.")
        if not self.phones:
            raise ValueError(f"WorkItem {self.id} has no phone numbers.")

    def recipient(self) -> dict[str, Any]:
        """The CALL-E recipient shape. `phones` is the fallback chain, in order."""
        payload: dict[str, Any] = {"phones": list(self.phones)}
        if self.locale:
            payload["locale"] = self.locale
        if self.region:
            payload["region"] = self.region
        return payload


@dataclass
class ItemResult:
    item: WorkItem
    resolution: Resolution
    call_id: str | None = None
    # The id CALL-E's own dashboard and usage page are keyed on. It is not the API's `id`,
    # and without it a receipt cannot be cross-referenced against the vendor's billing
    # record, which is the only account of a call nobody in this repository writes.
    provider_call_id: str | None = None
    structured_result: dict[str, Any] | None = None
    failure_code: str | None = None
    reason: str = ""
    attempts_made: int = 0
    numbers_tried: tuple[str, ...] = ()
    transcript: tuple[dict[str, Any], ...] = ()
    # True: this run placed the call. False: an idempotency key replayed an earlier one,
    # so no call was made and nothing was billed. None: the response carried no usable
    # created_at, so we do not know, and saying "placed" would be a guess.
    placed_by_this_run: bool | None = None

    @property
    def masked_numbers(self) -> tuple[str, ...]:
        """Never log a real number. The repo's PR checklist requires masking."""
        return tuple(mask(n) for n in self.numbers_tried)


def mask(phone: str) -> str:
    if len(phone) <= 5:
        return "*" * len(phone)
    return f"{phone[:3]}{'*' * (len(phone) - 5)}{phone[-2:]}"


# Seven digits, because that is shorter than any diallable number and longer than anything
# this app wants to keep: a SIP code is three, an HTTP status is three, and "E.164" is
# three. Separators are allowed inside the run so that a number written 04 1234 5678 or
# (04) 1234-5678 is still caught.
_LONG_DIGIT_RUN = re.compile(r"\+?\d[\d\s().\-]{5,}\d")


def redact(text: str) -> str:
    """Mask any phone-shaped digit run in text this app did not write.

    `mask` is applied to numbers on the way out. This is the same rule applied to numbers
    on the way in, which is the direction that leaked: CALL-E's `invalid_phone` message
    quotes the number it rejected, and storing that message unchanged put a real number in
    stdout and in a receipt.

    It is deliberately blunt. A long digit run in a vendor error message or an exception is
    masked whether or not it is a phone number, so a timestamp inside one loses its digits
    too. That costs a little readability in a line nobody reads unless something broke, and
    it buys a rule with no exceptions to get wrong. The `code` beside it is a fixed
    vocabulary and is never touched, so the useful half survives.
    """
    def hide(match: re.Match[str]) -> str:
        digits = re.sub(r"[^\d+]", "", match.group())
        return mask(digits) if len(re.sub(r"\D", "", digits)) >= 7 else match.group()

    return _LONG_DIGIT_RUN.sub(hide, text)


@dataclass
class DispatchReport:
    results: list[ItemResult] = field(default_factory=list)
    cancelled: bool = False
    cancelled_after: int = 0
    not_recallable: list[str] = field(default_factory=list)
    fatal_error: str | None = None

    def by(self, resolution: Resolution) -> list[ItemResult]:
        return [r for r in self.results if r.resolution is resolution]

    @property
    def needs_human(self) -> list[ItemResult]:
        return [r for r in self.results if r.resolution.needs_a_human]

    def counts(self) -> dict[str, int]:
        out = {r.value: 0 for r in Resolution}
        for result in self.results:
            out[result.resolution.value] += 1
        return out

    def summary(self) -> str:
        c = self.counts()
        parts = [
            f"{c['resolved']} resolved",
            f"{c['undetermined']} undetermined",
            f"{c['failed']} failed",
            f"{c['skipped']} skipped",
        ]
        line = ", ".join(parts)
        if self.cancelled:
            line += (f" | cancelled after {self.cancelled_after} dispatched"
                     f", {len(self.not_recallable)} already in flight and not recallable")
        if self.fatal_error:
            line += f" | run stopped: {self.fatal_error}"
        return line
