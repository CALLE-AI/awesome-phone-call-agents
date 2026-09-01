"""Confirm and cascade phases with safety guards."""
from dataclasses import dataclass
from datetime import datetime, time as dt_time

from .calle_client import (
    CallClient,
    CallRequest,
    build_confirm_goal,
    build_offer_goal,
)
from .models import (
    CallOutcome,
    CallStatus,
    Reservation,
    ReservationStatus,
    WaitlistEntry,
    WaitlistStatus,
)
from .stores import AuditLog


class BudgetExceededError(RuntimeError):
    """Raised before dialing when the live-call budget for a run is exhausted."""


@dataclass
class EngineConfig:
    max_calls: int = 10
    party_size_tolerance: int = 0
    no_answer_retries: int = 1
    call_window_start: dt_time = dt_time(9, 0)
    call_window_end: dt_time = dt_time(21, 0)


class CascadeEngine:
    def __init__(
        self, client: CallClient, audit: AuditLog, config: EngineConfig | None = None
    ):
        self.client = client
        self.audit = audit
        self.config = config or EngineConfig()
        self.calls_made = 0

    def _skip(self, run_id: str, target_id: str, status: CallStatus) -> CallOutcome:
        outcome = CallOutcome(run_id=run_id, target_id=target_id, status=status)
        self.audit.append(outcome)
        return outcome

    def _within_window(self, now: datetime) -> bool:
        return self.config.call_window_start <= now.time() <= self.config.call_window_end

    def _place_or_skip(
        self,
        run_id: str,
        phone: str,
        target_id: str,
        consent: bool,
        goal: str,
        now: datetime,
        allow_duplicate: bool = False,
    ) -> CallOutcome:
        if self.audit.is_cancelled():
            return self._skip(run_id, target_id, CallStatus.CANCELLED_BY_OPERATOR)
        if not consent:
            return self._skip(run_id, target_id, CallStatus.SKIPPED_NO_CONSENT)
        if not allow_duplicate and target_id in self.audit.dialed_targets():
            return self._skip(run_id, target_id, CallStatus.SKIPPED_DUPLICATE)
        if not self._within_window(now):
            return self._skip(run_id, target_id, CallStatus.SKIPPED_OUT_OF_WINDOW)
        if self.calls_made >= self.config.max_calls:
            raise BudgetExceededError(
                f"call budget of {self.config.max_calls} exhausted; stopping before dialing"
            )
        request = CallRequest(run_id=run_id, target_id=target_id, phone=phone, goal=goal)
        outcome = self.client.place_call(request)
        self.calls_made += 1
        self.audit.append(outcome)
        return outcome

    def confirm_reservation(
        self, run_id: str, reservation: Reservation, now: datetime
    ) -> CallOutcome:
        goal = build_confirm_goal(
            reservation.name, reservation.party_size, reservation.slot
        )
        outcome = self._place_or_skip(
            run_id=run_id,
            phone=reservation.phone,
            target_id=reservation.booking_id,
            consent=reservation.consent,
            goal=goal,
            now=now,
        )
        if (
            outcome.status == CallStatus.NO_ANSWER
            and self.config.no_answer_retries > 0
        ):
            outcome = self._place_or_skip(
                run_id=run_id,
                phone=reservation.phone,
                target_id=reservation.booking_id,
                consent=reservation.consent,
                goal=goal,
                now=now,
                allow_duplicate=True,
            )
        self._apply_confirm(reservation, outcome)
        return outcome

    def _apply_confirm(self, reservation: Reservation, outcome: CallOutcome) -> None:
        transitions = {
            CallStatus.CONFIRMED: ReservationStatus.CONFIRMED,
            CallStatus.CANCELLED: ReservationStatus.CANCELLED,
            CallStatus.RESCHEDULED: ReservationStatus.RESCHEDULED,
            CallStatus.NO_ANSWER: ReservationStatus.NO_ANSWER,
        }
        new_status = transitions.get(outcome.status)
        if new_status is not None:
            reservation.status = new_status
        if outcome.status == CallStatus.RESCHEDULED and outcome.new_slot:
            reservation.slot = outcome.new_slot

    def select_candidates(
        self, slot: Reservation, waitlist: list[WaitlistEntry]
    ) -> list[WaitlistEntry]:
        slot_dt = datetime.fromisoformat(slot.slot)
        candidates: list[WaitlistEntry] = []
        for entry in waitlist:
            if entry.status != WaitlistStatus.WAITING or not entry.consent:
                continue
            window_start = datetime.fromisoformat(entry.window_start)
            window_end = datetime.fromisoformat(entry.window_end)
            if not (window_start <= slot_dt <= window_end):
                continue
            gap = slot.party_size - entry.party_size
            if not (0 <= gap <= self.config.party_size_tolerance):
                continue
            candidates.append(entry)
        candidates.sort(key=lambda entry: entry.priority)
        return candidates

    def fill_slot(
        self,
        run_id: str,
        slot: Reservation,
        waitlist: list[WaitlistEntry],
        now: datetime,
    ) -> CallOutcome | None:
        """Offer a freed slot to waitlist candidates in priority order."""
        for entry in self.select_candidates(slot, waitlist):
            entry.status = WaitlistStatus.OFFERED
            goal = build_offer_goal(entry.name, entry.party_size, slot.slot)
            outcome = self._place_or_skip(
                run_id=run_id,
                phone=entry.phone,
                target_id=entry.entry_id,
                consent=entry.consent,
                goal=goal,
                now=now,
            )
            if outcome.status == CallStatus.ACCEPTED:
                entry.status = WaitlistStatus.ACCEPTED
                slot.status = ReservationStatus.RECOVERED
                return outcome
            if outcome.status == CallStatus.DECLINED:
                entry.status = WaitlistStatus.DECLINED
            elif outcome.status == CallStatus.NO_ANSWER:
                entry.status = WaitlistStatus.NO_ANSWER
            else:
                # Skip outcomes and ERROR: keep the entry on the waitlist.
                entry.status = WaitlistStatus.WAITING
        return None
