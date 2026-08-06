"""Outcome record construction for call-outcome-reconciler.

The record embeds every upstream payload verbatim. Nothing is pruned, renamed,
or normalised, including fields this version does not recognise.

Canonical outcome and result semantics are defined upstream by CALL-E.
`schema_version` versions this record shape only; it is not a claim about
upstream semantics.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping, Sequence

SCHEMA_VERSION = 1

#: The six reconciled outcomes. Exactly one is emitted per reconciliation.
OUTCOMES: tuple[str, ...] = (
    "completed",
    "not_connected",
    "declined",
    "infrastructure_failure",
    "cancelled",
    "unresolved",
)

#: Outcomes a mapping entry is allowed to assert. `unresolved` is never mapped;
#: it is what the reconciler emits when nothing documented applies.
MAPPABLE_OUTCOMES: tuple[str, ...] = tuple(o for o in OUTCOMES if o != "unresolved")

#: Machine-readable reasons accompanying an `unresolved` outcome.
UNRESOLVED_REASONS: tuple[str, ...] = (
    "polling_budget_exhausted",
    "undocumented_code",
    "undocumented_failure_detail",
    "ambiguous_documented_code",
    "result_error_not_call_outcome",
    "inconsistent_payload",
    "plan_timeout",
    "malformed_payload",
    "no_observations",
)


def mask_phone(phone: str | None) -> str | None:
    """Mask an E.164 number for user-facing output.

    Keeps enough leading digits to correlate a call, hides the subscriber
    portion. `+15550101234` becomes `+1555010****`.
    """
    if not phone:
        return None
    keep = 8
    if len(phone) <= keep:
        return phone[:-2] + "**" if len(phone) > 2 else "*" * len(phone)
    return phone[:keep] + "*" * (len(phone) - keep)


def _parse_timestamp(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


@dataclass(frozen=True)
class Observation:
    """One status read from one surface.

    `payload` is stored exactly as received. `transport_error` records a failed
    read; a transport error never produces a semantic outcome on its own.
    """

    surface: str
    payload: Mapping[str, Any] | None
    observed_at: str
    transport_error: str | None = None

    def copy_payload(self) -> dict[str, Any] | None:
        return copy.deepcopy(dict(self.payload)) if self.payload is not None else None


@dataclass(frozen=True)
class MappingTrace:
    """Which mapping entry produced the outcome, if any."""

    matched: bool
    entry_id: str | None
    map_version: str
    surface: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "matched": self.matched,
            "entry_id": self.entry_id,
            "map_version": self.map_version,
            "surface": self.surface,
        }


@dataclass(frozen=True)
class Evidence:
    """What was observed and how the outcome was reached."""

    observed_states: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    decision: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "observed_states": list(self.observed_states),
            "notes": list(self.notes),
            "decision": list(self.decision),
        }


@dataclass(frozen=True)
class OutcomeRecord:
    """Exactly one terminal outcome for one call reference."""

    call_ref: str
    outcome: str
    reason: str | None
    mapping: MappingTrace
    evidence: Evidence
    observations: Sequence[Observation]
    recipient_phone: str | None = None
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.outcome not in OUTCOMES:
            raise ValueError(f"Unknown outcome: {self.outcome!r}")
        if self.outcome == "unresolved" and self.reason is None:
            raise ValueError("An unresolved outcome must carry a reason")

    @property
    def first_payload(self) -> dict[str, Any] | None:
        for observation in self.observations:
            if observation.payload is not None:
                return observation.copy_payload()
        return None

    @property
    def last_payload(self) -> dict[str, Any] | None:
        for observation in reversed(list(self.observations)):
            if observation.payload is not None:
                return observation.copy_payload()
        return None

    def _timing(self) -> dict[str, Any]:
        stamps = [o.observed_at for o in self.observations if o.observed_at]
        first = stamps[0] if stamps else None
        last = stamps[-1] if stamps else None
        elapsed: float | None = None
        start, end = _parse_timestamp(first or ""), _parse_timestamp(last or "")
        if start and end:
            elapsed = (end - start).total_seconds()
        return {
            "first_observed_at": first,
            "last_observed_at": last,
            "observation_count": len(self.observations),
            "elapsed_seconds": elapsed,
        }

    def to_dict(self) -> dict[str, Any]:
        """Serialise the record. `raw` is preserved verbatim."""
        return {
            "schema_version": self.schema_version,
            "call_ref": self.call_ref,
            "outcome": self.outcome,
            "reason": self.reason,
            "mapping": self.mapping.to_dict(),
            "timing": self._timing(),
            "evidence": self.evidence.to_dict(),
            "raw": {
                "first_payload": self.first_payload,
                "last_payload": self.last_payload,
            },
            "recipient": {"phone_e164_masked": mask_phone(self.recipient_phone)},
        }
