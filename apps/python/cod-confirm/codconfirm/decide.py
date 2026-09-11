"""Turn one call result into one store action.

Deliberately dumb and total: every combination maps to exactly one outcome,
so a surprising answer can never leave an order in limbo.
"""
from __future__ import annotations

from dataclasses import dataclass

from codconfirm import phones
from codconfirm.agent import CallOutcome
from codconfirm.orders import CANCELLED, CONFIRMED, NEEDS_HUMAN, PENDING, Order

# An address is written onto the order and later printed on a label, so it is
# allowed more room than a note, and still not an unbounded amount.
ADDRESS_LIMIT = 200
QUOTE_LIMIT = 200


def said(result: dict, field: str, limit: int = QUOTE_LIMIT) -> str:
    """Read one field of the model's answer, cleaned and bounded.

    Everything in a result is speech that went through a model, which makes
    it untrusted text on its way into a stored record. Nothing is read out
    of a result any other way.
    """
    return phones.scrub(str(result.get(field) or "").strip(), limit=limit)


@dataclass(frozen=True)
class Decision:
    status: str
    note: str
    new_address: str | None = None
    halt: bool = False
    """Stop the whole sweep. Set when carrying on would risk a second call."""


def decide(order: Order, outcome: CallOutcome, max_attempts: int) -> Decision:
    """Map one call attempt onto the order's next status."""
    attempts = order.attempts + 1
    out_of_tries = attempts >= max_attempts

    # Nobody knows whether that call went out. Leaving the order pending
    # means a later sweep redials it, and ringing a customer twice to ask the
    # same question is the one failure this tool must not cause. So the
    # order stops here and the run stops with it.
    if outcome.ambiguous:
        return Decision(
            NEEDS_HUMAN,
            f"Uncertain whether the call was placed, so it will not be redialled. "
            f"{outcome.reason}",
            halt=True,
        )

    # An answer from a number other than the order's own. Real, readable,
    # and not evidence about this customer, so it decides nothing.
    if outcome.advisory_only:
        return Decision(
            NEEDS_HUMAN,
            f"Advisory only: {outcome.reason or 'answer came from another number.'}",
        )

    result = outcome.result
    if not result:
        # The call definitely did not happen. Safe to try again.
        note = outcome.reason or "Call failed"
        if out_of_tries:
            return Decision(NEEDS_HUMAN, f"{note} ({attempts}x), needs a human.")
        return Decision(PENDING, f"{note}, attempt {attempts}.")

    if result.get("reached_customer") != "yes":
        if out_of_tries:
            return Decision(NEEDS_HUMAN, f"No answer after {attempts} attempts.")
        return Decision(PENDING, f"No answer, attempt {attempts}.")

    confirmed = result.get("confirmed")

    if confirmed == "no":
        reason = said(result, "decline_reason") or "no reason given"
        return Decision(CANCELLED, f"Customer declined: {reason}")

    if confirmed != "yes":
        # They answered but never gave a clear yes. A human should close this,
        # retrying an ambiguous call rarely produces a clearer one.
        return Decision(NEEDS_HUMAN, "Answered but gave no clear yes or no.")

    # Evidence gate. A yes the customer never actually said is not a yes:
    # dispatching on it is how a shop ends up arguing at somebody's door.
    quote = said(result, "confirmation_quote")
    if not quote:
        return Decision(NEEDS_HUMAN, "Reported as confirmed but the customer never said so.")

    address_ok = result.get("address_correct")
    corrected = said(result, "corrected_address", limit=ADDRESS_LIMIT)
    when = said(result, "preferred_time", limit=60)
    suffix = f" Prefers delivery {when}." if when else ""

    if address_ok == "no" and corrected:
        return Decision(CONFIRMED, f'Confirmed, address corrected. Said "{quote}".{suffix}',
                        corrected)

    if address_ok == "no":
        return Decision(NEEDS_HUMAN, "Address is wrong and no correction was given.")

    if address_ok != "yes":
        return Decision(NEEDS_HUMAN, "Order confirmed but the address is unclear.")

    return Decision(CONFIRMED, f'Confirmed, address unchanged. Said "{quote}".{suffix}')
