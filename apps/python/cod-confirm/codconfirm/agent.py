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
                said = phones.scrub(str(turn.get("text", "")))
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
        # Refused here, by us, before anything reached the network. This is
        # the one failure that is genuinely "no call happened".
        return CallOutcome(definitely_not_placed=True, reason=phones.scrub(str(exc)))

    redirected = phones.normalise(order.phone) != destination
    masked = phones.mask(destination)

    client = CalleClient(api_key=settings.api_key)
    try:
        # Creating and waiting are split on purpose. Only a failure while
        # creating can mean the call never happened; once CALL-E has the
        # request, every later failure leaves a telephone that may have rung.
        try:
            created = client.calls.create(
                task=build_task(order, settings.store_name, settings.currency),
                recipient={"phone": destination},
                result_schema=RESULT_SCHEMA,
                metadata={"order_id": order.id},
                idempotency_key=(
                    f"{order.id}-{order.attempts + 1}-{run_id or new_run_id()}"
                ),
            )
        except CalleAPIError as exc:
            if rejected_before_dialling(exc):
                return CallOutcome(
                    definitely_not_placed=True,
                    reason=f"Call to {masked} refused before dialling: "
                           f"{phones.scrub(str(exc))}",
                )
            return CallOutcome(
                ambiguous=True,
                reason=f"Call to {masked} may or may not have been placed: "
                       f"{phones.scrub(str(exc))}",
            )
        except (CalleTimeoutError, CalleConnectionError) as exc:
            # The request may have arrived and created a call we never saw.
            return CallOutcome(
                ambiguous=True,
                reason=f"Call to {masked} was left in doubt: {phones.scrub(str(exc))}",
            )

        call_id = str(created.get("id") or "")
        if not call_id:
            return CallOutcome(
                ambiguous=True,
                reason=f"CALL-E accepted the request for {masked} but reported "
                       "no call id, so what happened to it is unknown.",
            )

        try:
            call = client.calls.wait_for_result(
                call_id, timeout_seconds=settings.call_timeout_seconds
            )
        except Exception as exc:  # noqa: BLE001 - the call exists either way
            return CallOutcome(
                ambiguous=True,
                reason=f"Call {call_id} to {masked} was left in doubt: "
                       f"{phones.scrub(str(exc))}",
            )
    finally:
        client.close()

    log.info("  call %s: %s", call.get("id"), call.get("status"))
    status = call.get("status")
    if status != "completed":
        # Not completed is not the same as not dialled. The phone may have
        # rung; nothing here can tell. Ambiguous, so a person reconciles it.
        return CallOutcome(
            ambiguous=True,
            reason=f"Call {call_id} ended as {status}, which does not say "
                   "whether the phone rang.",
        )

    reported = destination_check(call, destination)
    if reported == "mismatch":
        # An idempotent replay can hand back an entirely different call.
        return CallOutcome(
            ambiguous=True,
            reason=f"Call {call_id} reported a different destination than the "
                   "one requested.",
        )

    result = call.get("structured_result") or None
    if result is None:
        return CallOutcome(
            ambiguous=True,
            reason=f"Call {call_id} completed but returned no result.",
        )

    # An answer may only confirm or cancel an order when the platform said,
    # in so many words, that it reached the number this order belongs to.
    # Anything less is readable and decides nothing.
    if reported == "unreported":
        advisory_reason = (
            f"Call {call_id} reported no destination, so it cannot be shown "
            "to have reached this customer."
        )
    elif redirected:
        advisory_reason = "Answered on a redirected number, so the answer is advisory."
    else:
        advisory_reason = ""

    return CallOutcome(
        result=result,
        advisory_only=bool(advisory_reason),
        reason=advisory_reason,
        transcript=transcript_of(call),
        summary=phones.scrub(call.get("summary") or ""),
    )


# Statuses that mean CALL-E turned the request down outright. Everything
# else, including a timeout or a conflict, could have left a call behind.
REJECTED_STATUSES = frozenset({400, 401, 402, 403, 404, 405, 415, 422, 429})


def rejected_before_dialling(exc) -> bool:
    """Whether this error means the request never became a call.

    Only a plain refusal of the request counts. A 408 may have been
    processed after the client gave up, and a 409 usually means a call
    already exists under this key, so neither is a safe "nothing happened".
    """
    return getattr(exc, "status_code", None) in REJECTED_STATUSES


def destination_check(call: dict, destination: str) -> str:
    """Whether the call CALL-E ran is provably the one that was asked for.

    Returns "match", "mismatch", or "unreported".

    An idempotent replay returns an earlier call, which may have gone to a
    different number entirely, so a match has to be shown rather than
    assumed. Silence is not agreement: a call that reports no destination
    has not been shown to have reached anybody in particular, and its answer
    is treated as advisory rather than allowed to decide an order.
    """
    seen: list[str] = []
    for recipient in call.get("recipients") or []:
        for value in recipient.get("phones") or []:
            seen.append(value)
        if recipient.get("phone"):
            seen.append(recipient["phone"])

    if not seen:
        return "unreported"

    for value in seen:
        try:
            if phones.normalise(value) == destination:
                return "match"
        except phones.UnsafeNumber:
            continue
    return "mismatch"


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
