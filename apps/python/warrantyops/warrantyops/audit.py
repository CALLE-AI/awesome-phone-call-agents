"""The append-only, hash-chained audit record of every attempt transition.

The attempt ledger's mutable rows answer "what is the state of this key
right now". They are a projection. The authority is the event log: one row
per transition, each row naming the row before it by hash, so any later
mutation of history is detectable and any current state is reconstructable
by replaying the events alone.

What an event carries is deliberately minimal and deliberately typed:

* ``seq`` — monotonic sequence, assigned by the store, never by the caller;
* ``timestamp`` — ISO-8601 UTC, supplied by the store's clock;
* ``actor`` — who caused the transition (the workflow, the provider seam,
  a named reviewer, the recovery path) — never a free-text identity;
* ``idempotency_key`` — already a digest, already PII-free;
* ``from_state`` / ``to_state`` — attempt states (``None`` before creation);
* ``reason`` — a closed vocabulary of transition reasons, never prose;
* ``prior_hash`` / ``row_hash`` — the chain.

No phone number, transcript, claim text, credential or vendor payload can
appear here because none of those fields exist on an event. The negative
test plants each of them and asserts the rendered events stay clean.

The chain rule is plain: ``row_hash = sha256(seq | timestamp | actor | key |
from_state | to_state | reason | prior_hash)`` with fixed separators, so the
hash is reproducible from the row alone. Verifying the chain recomputes every
row hash and checks the links; any tamper — edit, delete, reorder, append a
fabricated row — is reported and fails the caller closed.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

#: The prior-hash carried by the first row of a chain.
GENESIS_HASH = "0" * 64

#: Fixed field separator inside the hashed row body. A pipe cannot collide
#: with the hashed values because states, actors and reasons are closed
#: vocabularies that never contain one, and keys are hex digests.
_SEP = "|"


class AuditReason:
    """The closed vocabulary of why a transition happened."""

    RESERVED = "reserved"
    CALL_ID_PERSISTED = "call_id_persisted"
    COMPLETED = "provider_returned_terminal"
    UNKNOWN = "outcome_undetermined"
    RECOVERED = "recovery_reread"
    SUPERSEDED_PROJECTION = "projection_repaired_from_events"


class AuditActor:
    """The closed vocabulary of who caused a transition."""

    WORKFLOW = "workflow"
    PROVIDER = "provider"
    REVIEWER = "reviewer"
    RECOVERY = "recovery"
    OPERATOR = "operator"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class AttemptEvent:
    """One immutable transition record."""

    seq: int
    timestamp: str
    actor: str
    idempotency_key: str
    from_state: Optional[str]
    to_state: str
    reason: str
    prior_hash: str
    row_hash: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "timestamp": self.timestamp,
            "actor": self.actor,
            "idempotency_key": self.idempotency_key,
            "from_state": self.from_state,
            "to_state": self.to_state,
            "reason": self.reason,
            "prior_hash": self.prior_hash,
            "row_hash": self.row_hash,
        }

    def hashed_body(self) -> str:
        """The canonical string this row's hash covers."""

        return _SEP.join(
            (
                str(self.seq),
                self.timestamp,
                self.actor,
                self.idempotency_key,
                self.from_state or "",
                self.to_state,
                self.reason,
                self.prior_hash,
            )
        )


def compute_row_hash(
    seq: int,
    timestamp: str,
    actor: str,
    idempotency_key: str,
    from_state: Optional[str],
    to_state: str,
    reason: str,
    prior_hash: str,
) -> str:
    body = _SEP.join(
        (
            str(seq),
            timestamp,
            actor,
            idempotency_key,
            from_state or "",
            to_state,
            reason,
            prior_hash,
        )
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def build_event(
    *,
    timestamp: str,
    actor: str,
    idempotency_key: str,
    from_state: Optional[str],
    to_state: str,
    reason: str,
    prior_hash: str,
    seq: int,
) -> AttemptEvent:
    """Construct one event with its hash computed from its own body."""

    row_hash = compute_row_hash(
        seq, timestamp, actor, idempotency_key, from_state, to_state, reason, prior_hash
    )
    return AttemptEvent(
        seq=seq,
        timestamp=timestamp,
        actor=actor,
        idempotency_key=idempotency_key,
        from_state=from_state,
        to_state=to_state,
        reason=reason,
        prior_hash=prior_hash,
        row_hash=row_hash,
    )


class EventChain:
    """The in-memory chain: append, inspect, verify, replay.

    Shared by the in-memory ledger (tests and fake-provider demos) and
    wrapped by the SQLite ledger inside its transactions. Appends are
    serialized by the caller; the sequence is assigned here so callers can
    never choose their own place in history.
    """

    def __init__(self) -> None:
        self._events: list[AttemptEvent] = []

    def append(
        self,
        *,
        actor: str,
        idempotency_key: str,
        from_state: Optional[str],
        to_state: str,
        reason: str,
        timestamp: Optional[str] = None,
    ) -> AttemptEvent:
        prior = self._events[-1].row_hash if self._events else GENESIS_HASH
        event = build_event(
            seq=len(self._events) + 1,
            timestamp=timestamp or _utc_now(),
            actor=actor,
            idempotency_key=idempotency_key,
            from_state=from_state,
            to_state=to_state,
            reason=reason,
            prior_hash=prior,
        )
        self._events.append(event)
        return event

    def events(self) -> tuple[AttemptEvent, ...]:
        return tuple(self._events)

    def for_key(self, idempotency_key: str) -> tuple[AttemptEvent, ...]:
        return tuple(e for e in self._events if e.idempotency_key == idempotency_key)

    def head(self) -> str:
        """The chain head: the last row's hash, or the genesis hash."""

        return self._events[-1].row_hash if self._events else GENESIS_HASH

    def head_for_key(self, idempotency_key: str) -> Optional[str]:
        """The head of the last event recorded for one attempt, if any."""

        events = self.for_key(idempotency_key)
        return events[-1].row_hash if events else None


def verify_chain(events: Sequence[AttemptEvent]) -> list[str]:
    """Every way this chain's history has been tampered with. Empty = intact.

    Recomputes each row hash from its body, checks each row links to the
    one before it, and checks the sequence numbers are strictly increasing
    from 1. An edited row fails its own hash; a deleted row breaks a link;
    a reordered run breaks both; a fabricated row cannot produce a
    consistent hash chain without rewriting every row after it.
    """

    problems: list[str] = []
    prior = GENESIS_HASH
    expected_seq = 1
    for event in events:
        if event.seq != expected_seq:
            problems.append(
                f"seq {event.seq} breaks the monotonic sequence (expected "
                f"{expected_seq})"
            )
        recomputed = compute_row_hash(
            event.seq,
            event.timestamp,
            event.actor,
            event.idempotency_key,
            event.from_state,
            event.to_state,
            event.reason,
            event.prior_hash,
        )
        if recomputed != event.row_hash:
            problems.append(f"seq {event.seq}: row hash does not match its body")
        if event.prior_hash != prior:
            problems.append(
                f"seq {event.seq}: links to {event.prior_hash[:12]}… but the "
                f"previous row is {prior[:12]}…"
            )
        prior = event.row_hash
        expected_seq += 1
    return problems


def replay_states(events: Iterable[AttemptEvent]) -> dict[str, str]:
    """Reconstruct the per-key attempt states from the events alone.

    This is the proof that the ledger's mutable rows are a projection: the
    states they hold are all derivable from the append-only record. The
    request fingerprint is deliberately not reconstructed — it is an input
    fact recorded at reservation time, not a transition.
    """

    states: dict[str, str] = {}
    for event in events:
        states[event.idempotency_key] = event.to_state
    return states
