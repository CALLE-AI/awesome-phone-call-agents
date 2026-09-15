"""Mocked bargaining matrix — pure deterministic core (no I/O, no network).

Worksheet contract: parallel arrays of call_ids (uint32), target_margins,
current_offers, aggression (0 soft → 5 hard), and state
(active | graceful_exit | closed). Tonight the arrays are plain Python; the
zero-copy Arrow path is a documented stretch, not a claim.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum

MAX_AGGRESSION = 5
AMBIENT_AGGRESSION_CAP = 2
UINT32_MAX = 2**32 - 1

OPT_OUT_TRUTHY = frozenset({"yes", "y", "true", "1", "opted out"})


def normalize_opt_out(value: str) -> str:
    """Normalize an opt-out answer: strip whitespace, then . ! punctuation."""
    return value.strip().strip("!.").strip().lower()


ANNOYANCE_SIGNALS = frozenset(
    {
        "stop calling",
        "do not call",
        "don't call",
        "remove me",
        "take me off",
        "opt out",
        "opt-out",
        "not interested",
        "leave me alone",
    }
)


class LeadState(StrEnum):
    """Lifecycle of one matrix row. Terminal states never transition out."""

    ACTIVE = "active"
    GRACEFUL_EXIT = "graceful_exit"
    CLOSED = "closed"


@dataclass(frozen=True)
class LeadRow:
    """One candidate lead. Immutable; transitions return new rows."""

    call_id: int
    target_margin: float
    current_offer: float
    aggression: int = 0
    state: LeadState = LeadState.ACTIVE

    def __post_init__(self) -> None:
        if isinstance(self.call_id, bool):
            raise ValueError(f"call_id must be an int, got bool: {self.call_id}")
        if not 0 <= self.call_id <= UINT32_MAX:
            raise ValueError(f"call_id out of uint32 range: {self.call_id}")
        if not 0 <= self.aggression <= MAX_AGGRESSION:
            raise ValueError(f"aggression out of 0..5 range: {self.aggression}")
        if not isinstance(self.state, LeadState):
            raise ValueError(f"state must be a LeadState, got: {self.state!r}")
        for name, value in (
            ("target_margin", self.target_margin),
            ("current_offer", self.current_offer),
        ):
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError(f"{name} must be a number, got: {value!r}")
            if not math.isfinite(float(value)):
                raise ValueError(f"{name} must be finite, got: {value!r}")
            if float(value) < 0:
                raise ValueError(f"{name} must be non-negative, got: {value!r}")


@dataclass(frozen=True)
class Matrix:
    """The hivemind view: one row per candidate lead."""

    rows: tuple[LeadRow, ...]

    def __post_init__(self) -> None:
        seen: set[int] = set()
        for row in self.rows:
            if row.call_id in seen:
                raise ValueError(f"duplicate call_id: {row.call_id}")
            seen.add(row.call_id)

    def by_id(self, call_id: int) -> LeadRow:
        """Fetch a row by call_id or raise ValueError on unknown ids."""
        for row in self.rows:
            if row.call_id == call_id:
                return row
        raise ValueError(f"unknown call_id: {call_id}")


def seed_matrix(count: int = 3, target_margin: float = 0.30) -> Matrix:
    """Build a fresh all-active matrix. Deterministic; no randomness."""
    if count < 1:
        raise ValueError("matrix needs at least one row")
    rows = tuple(
        LeadRow(call_id=index, target_margin=target_margin, current_offer=0.0)
        for index in range(count)
    )
    return Matrix(rows=rows)


def annoyance_detected(transcript: str, opt_out: str = "no") -> bool:
    """True when the lead opted out or the transcript carries a signal."""
    if normalize_opt_out(opt_out) in OPT_OUT_TRUTHY:
        return True
    lowered = transcript.lower()
    return any(signal in lowered for signal in ANNOYANCE_SIGNALS)


def apply_result(
    matrix: Matrix,
    call_id: int,
    *,
    interested: str,
    opt_out: str = "no",
    transcript: str = "",
    offer: float | None = None,
) -> Matrix:
    """Fold one call result into the matrix. Pure; returns a new matrix.

    Rules: opt-out/annoyance → graceful_exit immediately (no redial);
    interested=yes → closed, recording the offer as-is (no margin-vs-target
    gating; that comparison is roadmap, not a close rule); anything ambiguous
    stays active with aggression raised +1 capped at 2. Terminal rows locked.
    """
    current = matrix.by_id(call_id)
    if current.state != LeadState.ACTIVE:
        return matrix
    if annoyance_detected(transcript, opt_out):
        updated = LeadRow(
            call_id=current.call_id,
            target_margin=current.target_margin,
            current_offer=current.current_offer,
            aggression=current.aggression,
            state=LeadState.GRACEFUL_EXIT,
        )
    elif interested.strip().lower() == "yes":
        updated = LeadRow(
            call_id=current.call_id,
            target_margin=current.target_margin,
            current_offer=current.current_offer if offer is None else offer,
            aggression=current.aggression,
            state=LeadState.CLOSED,
        )
    else:
        updated = LeadRow(
            call_id=current.call_id,
            target_margin=current.target_margin,
            current_offer=current.current_offer if offer is None else offer,
            aggression=min(current.aggression + 1, AMBIENT_AGGRESSION_CAP),
            state=LeadState.ACTIVE,
        )
    rows = tuple(updated if row.call_id == call_id else row for row in matrix.rows)
    return Matrix(rows=rows)
