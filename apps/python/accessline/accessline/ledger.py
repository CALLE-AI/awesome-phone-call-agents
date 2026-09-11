"""Deterministic live-call budget ledger for AccessLine."""

from __future__ import annotations

from dataclasses import dataclass, field

ABSOLUTE_CEILING = 20
WORKING_TARGET = 8
FIRST_VALID_RESULT_BY_CALL = 6


class CallLedgerError(Exception):
    """Ledger rule violation."""


@dataclass
class CallLedger:
    live_call_count: int = 0
    first_valid_result_call: int | None = None
    mock_call_count: int = 0
    stop_reason: str | None = None
    _history: list[str] = field(default_factory=list)

    def record_mock_call(self, label: str = "mock") -> None:
        self.mock_call_count += 1
        self._history.append(f"mock:{label}")

    def record_live_call(self, label: str = "live") -> None:
        if self.live_call_count >= ABSOLUTE_CEILING:
            self.stop_reason = "absolute_ceiling_exceeded"
            raise CallLedgerError("live-call ceiling of 20 exceeded")
        self.live_call_count += 1
        self._history.append(f"live:{label}")
        if (
            self.first_valid_result_call is None
            and self.live_call_count > FIRST_VALID_RESULT_BY_CALL
        ):
            self.stop_reason = "first_valid_result_not_achieved_by_call_6"
            raise CallLedgerError(
                "first valid end-to-end result required by cumulative call 6"
            )

    def mark_first_valid_result(self, at_call: int | None = None) -> None:
        call_number = at_call if at_call is not None else self.live_call_count
        if call_number <= 0:
            raise CallLedgerError("valid result requires a positive live-call number")
        if call_number > FIRST_VALID_RESULT_BY_CALL:
            self.stop_reason = "first_valid_result_not_achieved_by_call_6"
            raise CallLedgerError(
                "first valid end-to-end result required by cumulative call 6"
            )
        self.first_valid_result_call = call_number

    def projected_total_within_target(self, additional_live_calls: int) -> bool:
        return (self.live_call_count + additional_live_calls) <= WORKING_TARGET

    def can_place_live_call(self) -> bool:
        return self.live_call_count < ABSOLUTE_CEILING and self.stop_reason is None

    def assert_can_record_live_call(self) -> None:
        if self.live_call_count >= ABSOLUTE_CEILING:
            self.stop_reason = "absolute_ceiling_exceeded"
            raise CallLedgerError("live-call ceiling of 20 exceeded")
        next_call = self.live_call_count + 1
        if (
            self.first_valid_result_call is None
            and next_call > FIRST_VALID_RESULT_BY_CALL
        ):
            self.stop_reason = "first_valid_result_not_achieved_by_call_6"
            raise CallLedgerError(
                "first valid end-to-end result required by cumulative call 6"
            )
