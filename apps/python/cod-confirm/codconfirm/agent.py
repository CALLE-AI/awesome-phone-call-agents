"""Place one confirmation call through CALL-E and report what came back."""
from __future__ import annotations

import logging
import random
import uuid
from dataclasses import dataclass, field

from codconfirm import phones
from codconfirm.config import Settings
from codconfirm.orders import Order
from codconfirm.schema import RESULT_SCHEMA, build_task

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CallOutcome:
    """What a call attempt produced, and how much of it can be trusted.

    A missing result is not one thing. It matters enormously whether the call
    definitely did not happen or whether nobody knows, and it matters whether
    the answer came from the person the order belongs to.
    """

    result: dict | None = None

    definitely_not_placed: bool = False
    """The request was refused before anything was dialled. Safe to retry."""

    ambiguous: bool = False
    """A timeout or a dropped connection. The call may or may not have gone
    out, so redialling risks calling somebody twice."""

    advisory_only: bool = False
    """The answer is real but did not come from the order's own number, so it
    may be read but must never decide anything on its own."""

    reason: str = ""
    transcript: list[str] = field(default_factory=list)
    summary: str = ""

    @property
    def decisive(self) -> bool:
        return self.result is not None and not self.advisory_only


def transcript_of(call: dict) -> list[str]:
    """Flatten a call into readable lines, with any number masked.

    Kept for an order a human has to finish: somebody picking one up should
    be able to read what was said rather than ring the customer again from
    nothing.
    """
    lines: list[str] = []
    for recipient in call.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            for turn in attempt.get("transcript_turns") or []:
                who = turn.get("speaker", "?")
                said = str(turn.get("text", ""))
                lines.append(f"{turn.get('offset_seconds', 0):>3}s {who}: {said}")
    return lines


def new_run_id() -> str:
    """A token identifying one sweep.

    It goes into the idempotency key so a network retry inside a sweep is
    still deduplicated, while a deliberate later sweep is a new call. Keying
    only on the order and its attempt count looks right and is not: reset the
    order book and the key repeats, and CALL-E answers 201 Created with the
    original call, so a replay is indistinguishable from a fresh dial.
    """
    return uuid.uuid4().hex[:8]


def place_call(order: Order, settings: Settings, phone: str | None = None,
               run_id: str = "") -> CallOutcome:
    """Call the customer and report what came back.

    `phone` overrides the number on the order, which is how a live demo dials
    one handset instead of the placeholder numbers in the sample book. An
    overridden call is marked advisory: whoever answered, it was not the
    customer this order belongs to, so it can be read but cannot confirm or
    cancel anything.
    """
    from calle import CalleClient  # imported lazily so dry runs need no SDK
    from calle.errors import CalleAPIError, CalleConnectionError, CalleTimeoutError

    intended = phone or order.phone
    try:
        destination = phones.authorise(intended)
    except phones.UnsafeNumber as exc:
        return CallOutcome(definitely_not_placed=True, reason=str(exc))

    redirected = phones.normalise(order.phone) != destination

    client = CalleClient(api_key=settings.api_key)
    try:
        call = client.calls.create_and_wait(
            task=build_task(order, settings.store_name, settings.currency),
            recipient={"phone": destination},
            result_schema=RESULT_SCHEMA,
            metadata={"order_id": order.id},
            idempotency_key=f"{order.id}-{order.attempts + 1}-{run_id or new_run_id()}",
            timeout_seconds=settings.call_timeout_seconds,
        )
    except (CalleTimeoutError, CalleConnectionError) as exc:
        # Nobody knows whether that call went out. Redialling could ring a
        # customer twice, so this is escalated rather than retried.
        return CallOutcome(
            ambiguous=True,
            reason=f"Call to {phones.mask(destination)} was left in doubt: {exc}",
        )
    except CalleAPIError as exc:
        return CallOutcome(
            definitely_not_placed=True,
            reason=f"Call to {phones.mask(destination)} refused: {exc}",
        )
    finally:
        client.close()

    log.info("  call %s: %s", call.get("id"), call.get("status"))
    status = call.get("status")
    if status != "completed":
        return CallOutcome(
            definitely_not_placed=True,
            reason=f"Call ended as {status}.",
        )

    if not dialled_as_intended(call, destination):
        return CallOutcome(
            ambiguous=True,
            reason="The call reported a different destination than the one requested.",
        )

    result = call.get("structured_result") or None
    if result is None:
        return CallOutcome(definitely_not_placed=True, reason="No result was returned.")

    return CallOutcome(
        result=result,
        advisory_only=redirected,
        reason=("Answered on a redirected number, so the answer is advisory."
                if redirected else ""),
        transcript=transcript_of(call),
        summary=call.get("summary") or "",
    )


def dialled_as_intended(call: dict, destination: str) -> bool:
    """Check the call CALL-E ran is the one that was asked for.

    An idempotent replay returns an earlier call, which may have gone to a
    different number entirely. Applying its answer to this order would be
    deciding on evidence from somebody else's conversation.
    """
    seen: list[str] = []
    for recipient in call.get("recipients") or []:
        for value in recipient.get("phones") or []:
            seen.append(value)
        if recipient.get("phone"):
            seen.append(recipient["phone"])

    if not seen:
        return True  # nothing reported, nothing to contradict

    try:
        return any(phones.normalise(value) == destination for value in seen)
    except phones.UnsafeNumber:
        return False


def simulate_call(order: Order, seed: int | None = None) -> CallOutcome:
    """A stand-in for `place_call`, used whenever `--live` is absent.

    It exists so the whole pipeline can be exercised without spending call
    credit. The weights are rough field numbers for cash on delivery: most
    people confirm, a fifth never pick up, a few cancel.
    """
    rng = random.Random(seed if seed is not None else order.id)
    roll = rng.random()

    if roll < 0.20:
        return CallOutcome(result={
            "reached_customer": "no", "confirmed": "unclear",
            "address_correct": "unclear"})
    if roll < 0.32:
        return CallOutcome(result={
            "reached_customer": "yes", "confirmed": "no",
            "address_correct": "unclear",
            "decline_reason": "ordered by mistake"})
    if roll < 0.45:
        return CallOutcome(result={
            "reached_customer": "yes", "confirmed": "yes",
            "address_correct": "no",
            "confirmation_quote": "yes I still want it",
            "corrected_address": order.address.replace("House", "Flat 3B, House"),
            "preferred_time": "after 6pm"})
    return CallOutcome(result={
        "reached_customer": "yes", "confirmed": "yes",
        "address_correct": "yes",
        "confirmation_quote": rng.choice(
            ["yes please send it", "that is right, I want it",
             "yes I am waiting for it"]),
        "preferred_time": rng.choice(["morning", "after 6pm", "any time"])})
