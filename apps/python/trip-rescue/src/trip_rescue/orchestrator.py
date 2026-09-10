"""Wires the two sides together: given a disruption, ask Duffel what's
possible, ask the traveler by phone what they want, then make it real on
Duffel. This is the module the demo and the tests both drive.

The decision of *what happens next* is made here, in plain code, from the
closed decision vocabulary CALL-E returns (schemas.py) -- never inferred
from a transcript. Same principle KinCall documents elsewhere in this repo:
the voice model reports what happened, this layer decides what happens next.
"""

from __future__ import annotations

import logging

from trip_rescue.calle_client import CallOutcome, TripRescueCaller
from trip_rescue.duffel_client import DuffelClient
from trip_rescue.models import Booking, DisruptionEvent, RebookingOutcome
from trip_rescue.store import RunStore

logger = logging.getLogger("trip_rescue.orchestrator")

_DECISION_TO_INDEX = {
    "accepted_option_1": 0,
    "accepted_option_2": 1,
    "accepted_option_3": 2,
}


def handle_disruption(
    booking: Booking,
    disruption: DisruptionEvent,
    *,
    duffel: DuffelClient,
    caller: TripRescueCaller,
    new_departure_date: str,
    store: RunStore | None = None,
) -> RebookingOutcome:
    """Run the full Trip Rescue flow for one disrupted booking.

    1. Ask Duffel for real rebooking options on the given date.
    2. Call the traveler and present up to 3 of them.
    3. If they accept one, confirm it on Duffel and return the new booking.
    4. If they decline, or can't be reached, or ask for a human, return that
       outcome without touching the order -- no silent, unconfirmed change
       is ever made.

    ``store`` is optional (see ``store.py``): when given, the disruption is
    recorded *before* the call is placed and the outcome is recorded once it
    resolves, so a crash mid-call still leaves a row proving a call was
    attempted -- addressing the "no persistence layer" limitation called out
    in the README. Omitting it (the default) reproduces the exact prior
    behavior, so existing callers and tests are unaffected.
    """
    options = duffel.find_rebooking_options(booking, new_departure_date=new_departure_date)[:3]
    logger.info("order=%s found %d rebooking option(s) for %s", booking.order_id, len(options), new_departure_date)

    if not options:
        outcome = RebookingOutcome(
            order_id=booking.order_id,
            call_id=None,
            traveler_reachable=False,
            chosen_option=None,
            confirmed=False,
            new_departing_at=None,
            new_booking_reference=None,
            transcript_summary="No rebooking options were available from Duffel for the requested date.",
            options_offered=[],
        )
        if store is not None:
            store.record_outcome(disruption, outcome)
        return outcome

    if store is not None:
        store.record_disruption(booking, disruption)

    call_outcome: CallOutcome = caller.call_traveler_with_options(booking=booking, disruption=disruption, options=options)
    logger.info(
        "order=%s call_id=%s reachable=%s decision=%s",
        booking.order_id,
        call_outcome.call_id,
        call_outcome.reachable,
        call_outcome.decision,
    )

    index = _DECISION_TO_INDEX.get(call_outcome.decision)
    if not call_outcome.reachable or index is None or index >= len(options):
        outcome = RebookingOutcome(
            order_id=booking.order_id,
            call_id=call_outcome.call_id,
            traveler_reachable=call_outcome.reachable,
            chosen_option=None,
            confirmed=False,
            new_departing_at=None,
            new_booking_reference=None,
            transcript_summary=call_outcome.traveler_notes or call_outcome.decision,
            options_offered=options,
        )
        if store is not None:
            store.record_outcome(disruption, outcome)
        return outcome

    chosen = options[index]
    updated_booking = duffel.confirm_rebooking(chosen)
    logger.info("order=%s confirmed rebooking to %s (ref=%s)", booking.order_id, updated_booking.departing_at, updated_booking.booking_reference)

    outcome = RebookingOutcome(
        order_id=booking.order_id,
        call_id=call_outcome.call_id,
        traveler_reachable=True,
        chosen_option=chosen,
        confirmed=True,
        new_departing_at=updated_booking.departing_at,
        new_booking_reference=updated_booking.booking_reference,
        transcript_summary=call_outcome.traveler_notes,
        options_offered=options,
    )
    if store is not None:
        store.record_outcome(disruption, outcome)
    return outcome
