"""The CALL-E side of Trip Rescue: the actual phone call that tells a
traveler their flight was disrupted and walks them through real rebooking
options pulled live from Duffel.

Uses the calle-ai server SDK (`pip install calle-ai`, imported as `calle`),
the same package and call shape used elsewhere in this repo (see
apps/python/metapelet-checkin and apps/python/sentinelcall-anc-followup):
`CalleClient(api_key=...).calls.create_and_wait(task=..., recipients=...,
result_schema=..., recipient_result_schema=..., idempotency_key=...)`.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from trip_rescue.models import Booking, DisruptionEvent, RebookingOption
from trip_rescue.schemas import REBOOKING_CALL_RESULT_SCHEMA

_OPTION_LABELS = ["option_1", "option_2", "option_3"]


@dataclass(frozen=True)
class CallOutcome:
    reachable: bool
    decision: str  # one of DECISION_VALUES in schemas.py
    traveler_notes: str
    call_id: str | None


class TripRescueCaller:
    """Dry-run by default. Pass an api_key (or set CALLE_API_KEY) and
    dry_run=False to place a real call.
    """

    def __init__(self, *, api_key: str | None = None, dry_run: bool | None = None) -> None:
        self.api_key = api_key or os.environ.get("CALLE_API_KEY")
        self.dry_run = dry_run if dry_run is not None else os.environ.get("DRY_RUN", "true").lower() != "false"
        if not self.dry_run and not self.api_key:
            raise ValueError("CALLE_API_KEY is required when dry_run=False.")
        self._client = None
        if not self.dry_run:
            from calle import CalleClient  # imported lazily so dry-run needs no CALL-E SDK

            self._client = CalleClient(api_key=self.api_key)

    def close(self) -> None:
        if self._client is not None:
            self._client.close()

    def __enter__(self) -> "TripRescueCaller":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def call_traveler_with_options(
        self,
        *,
        booking: Booking,
        disruption: DisruptionEvent,
        options: list[RebookingOption],
    ) -> CallOutcome:
        """Place the rebooking call and return the traveler's decision."""
        if not options:
            return CallOutcome(reachable=False, decision="declined_all", traveler_notes="No rebooking options available.", call_id=None)

        if self.dry_run:
            # Deterministic dry-run outcome: traveler picks the first
            # (soonest) option. Real behavior is exercised in live mode and
            # in tests via a fake CALL-E client, not this branch.
            return CallOutcome(
                reachable=True,
                decision="accepted_option_1",
                traveler_notes="(dry run - no real call placed)",
                call_id=None,
            )

        task = _build_task(booking=booking, disruption=disruption, options=options)
        idempotency_key = f"trip-rescue:{booking.order_id}:{disruption.detected_at}"

        assert self._client is not None
        call = self._client.calls.create_and_wait(
            task=task,
            recipient={"phone": booking.passenger_phone, "region": "US", "locale": "en-US"},
            result_schema=REBOOKING_CALL_RESULT_SCHEMA,
            metadata={"order_id": booking.order_id, "disruption_reason": disruption.reason},
            idempotency_key=idempotency_key,
        )

        structured = call.get("structured_result") or {}
        return CallOutcome(
            reachable=bool(structured.get("reachable", False)),
            decision=structured.get("decision", "declined_all"),
            traveler_notes=structured.get("traveler_notes", ""),
            call_id=call.get("id"),
        )


def _build_task(*, booking: Booking, disruption: DisruptionEvent, options: list[RebookingOption]) -> str:
    lines = [
        f"You are calling {booking.passenger_name} because their flight "
        f"{booking.origin} to {booking.destination}, originally departing "
        f"{booking.departing_at}, has been {disruption.reason.replace('_', ' ')}. "
        "Identify yourself clearly as an automated assistant calling on behalf of "
        "their airline about this specific disruption. Be brief, calm, and clear -- "
        "this is likely an unwelcome surprise for them.",
        "Offer the following rebooking options, in order, and ask which one they'd "
        "like, or whether none of them work:",
    ]
    for label, option in zip(_OPTION_LABELS, options):
        fee_note = (
            f"an additional {option.change_fee_amount} {option.change_fee_currency}"
            if float(option.change_fee_amount) > 0
            else "no additional charge"
        )
        lines.append(f"- {label}: departing {option.departing_at}, {fee_note}, new total {option.new_total_amount} {option.new_total_currency}.")
    lines.append(
        "If they choose one, confirm it back to them clearly before ending the call. "
        "If none of the options work for them, or they'd rather speak to a person, "
        "say a human agent will follow up and end the call politely. Do not invent "
        "any option, price, or time beyond what was given to you above."
    )
    return "\n".join(lines)
