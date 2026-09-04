"""The line between what is free and what rings a phone.

CALL-E has no sandbox. ``test-api.heycall-e.com`` is a staging mirror that
dials real numbers and wants its own key, and there is no test flag on
``POST /v1/calls``. So the only thing standing between a test suite and
somebody's telephone is where the code draws this line, and how hard it is to
cross by accident.

**Dry** operations are free and place no call: ``plan_call``, listing goals,
validating a schema. **Wet** operations place a call and cost five credits
each. Every operation that talks to CALL-E records itself here, and a wet one
additionally requires an authorisation that has to be constructed deliberately.

The pattern comes from the CALL-E repository itself. Its most instructive test
asserts on *which operations were invoked* rather than on what they returned,
because whether a call was placed is the only thing that separates "resumed"
from "dialled again". This module is what makes that assertion possible here::

    ledger.assert_nothing_was_spent()

A comment saying "this does not place a call" is a hope. A ledger that fails a
test is a guarantee.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum

__all__ = [
    "CREDITS_PER_CALL",
    "Operation",
    "SpendLedger",
    "WetOperationRefusedError",
    "Wetness",
]

#: What one placed call costs. Derived from the published rate of $0.05 per
#: billable call and the 100-credits-per-dollar conversion in the hackathon
#: prize table. Both are labelled early-stage and not final by CALL-E.
CREDITS_PER_CALL = 5


class Wetness(StrEnum):
    DRY = "dry"
    """Free. Places no call. Safe to run in a loop, in CI, on a laptop."""

    WET = "wet"
    """Places a call. Costs credits. Rings a telephone that belongs to
    somebody."""


class WetOperationRefusedError(RuntimeError):
    """A call was attempted without the authorisation to place it."""


@dataclass(frozen=True, slots=True)
class Operation:
    """One thing REDLINE asked CALL-E to do."""

    name: str
    wetness: Wetness
    detail: str = ""

    @property
    def credits(self) -> int:
        return CREDITS_PER_CALL if self.wetness is Wetness.WET else 0


@dataclass
class SpendLedger:
    """Everything asked of CALL-E during one run, and what it cost.

    Mutable on purpose: it accumulates as the run proceeds, and the report
    prints it so a reader knows what a number cost to produce.
    """

    operations: list[Operation] = field(default_factory=list)

    #: Hard ceiling on placed calls. Zero means the run cannot place any, which
    #: is the default everywhere except a live run that asked for a budget.
    call_budget: int = 0

    def record_dry(self, name: str, detail: str = "") -> Operation:
        operation = Operation(name=name, wetness=Wetness.DRY, detail=detail)
        self.operations.append(operation)
        return operation

    def record_wet(self, name: str, detail: str = "") -> Operation:
        """Record a placed call, refusing if the budget does not allow it.

        Checked here rather than at the call site so that a new code path
        cannot forget: there is one place that increments the wet count, and it
        is this one.
        """
        if self.calls_placed >= self.call_budget:
            raise WetOperationRefusedError(
                f"{name} would place call number {self.calls_placed + 1}, but "
                f"this run is budgeted for {self.call_budget}. "
                "Raise --budget, or use the default offline transport."
            )
        operation = Operation(name=name, wetness=Wetness.WET, detail=detail)
        self.operations.append(operation)
        return operation

    # --- Reading -----------------------------------------------------------

    @property
    def calls_placed(self) -> int:
        return sum(1 for op in self.operations if op.wetness is Wetness.WET)

    @property
    def dry_operations(self) -> int:
        return sum(1 for op in self.operations if op.wetness is Wetness.DRY)

    @property
    def credits_spent(self) -> int:
        return self.calls_placed * CREDITS_PER_CALL

    @property
    def names(self) -> tuple[str, ...]:
        """Every operation name, in order. What a test asserts on."""
        return tuple(op.name for op in self.operations)

    def wet_names(self) -> tuple[str, ...]:
        return tuple(op.name for op in self.operations if op.wetness is Wetness.WET)

    def assert_nothing_was_spent(self) -> None:
        """Raise if this run placed a call. For tests and for `--dry` paths."""
        if self.calls_placed:
            raise AssertionError(
                f"expected no calls, but {self.calls_placed} were placed: "
                f"{', '.join(self.wet_names())}"
            )

    def summary_line(self) -> str:
        if not self.operations:
            return "no CALL-E operations"
        parts = [f"{self.dry_operations} free"]
        if self.calls_placed:
            parts.append(f"{self.calls_placed} call(s), {self.credits_spent} credits")
        else:
            parts.append("0 calls, 0 credits")
        return " - ".join(parts)


def total_credits(operations: Sequence[Operation]) -> int:
    return sum(op.credits for op in operations)
