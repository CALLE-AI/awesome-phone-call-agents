"""Deterministic, idempotent write-back of a reviewed result.

The note written back is bounded: the counterparty-stated fields, the strict
result contract version and a pointer to the evidence. Never the transcript,
never a secret, never an adjudication of the claim.

Two refusals guard the mutation:

* ``NOT_REVIEWED`` — no approved, bound human decision;
* ``SOURCE_CHANGED`` — the authoritative source version, re-read immediately
  before the mutation through the version reader, no longer matches the
  version the call was placed against. An earlier check passing is
  irrelevant; only this re-read decides.

Idempotency is semantic, not byte-identical: the note id is a digest of the
claim, the source version, the idempotency key and the note content, so
re-writing the same reviewed result yields the same note identity. Receipts
may carry different timestamps and remain the same write. Replaying the
*same* review against the same result is the idempotent case and documents
itself as a replay; a *different* review landing on the same note identity
is :attr:`WriteBackRefusal.REVIEW_CONFLICT` — two approvals of one write is
one approval too many.

Persistence in the vertical slice is a synthetic in-memory note ledger. A
real deployment supplies one adapter per system of record; the refusal and
identity logic here is identical either way.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol

from .envelope import SourceClaim
from .outcome import WorkflowOutcome
from .review import ReviewPacket, ReviewRecord, review_refusals
from .source import SourceVersionReader


class WriteBackRefusal(str, Enum):
    """Why nothing was written."""

    NO_BUSINESS_RESULT = "NO_BUSINESS_RESULT"
    NOT_REVIEWED = "NOT_REVIEWED"
    SOURCE_CHANGED = "SOURCE_CHANGED"
    #: A note already exists under this write's identity, approved by a
    #: *different* review. The same reviewed result may be re-written
    #: idempotently under the review that approved it; a second, different
    #: approval of the same identity is a conflict, not a confirmation.
    REVIEW_CONFLICT = "REVIEW_CONFLICT"


class WriteBackOutcome(str, Enum):
    """What persisted after review: the receipt, or the named non-write.

    ``RECEIPT`` means a note exists under the write's semantic identity. The
    other members mirror :class:`WriteBackRefusal` one-for-one so the state
    machine (:mod:`docs <docs/state-machine.md>`) can classify any
    write-back result without a second vocabulary drifting beside the first.
    """

    RECEIPT = "RECEIPT"
    NO_BUSINESS_RESULT = "NO_BUSINESS_RESULT"
    NOT_REVIEWED = "NOT_REVIEWED"
    SOURCE_CHANGED = "SOURCE_CHANGED"
    REVIEW_CONFLICT = "REVIEW_CONFLICT"


def write_back_outcome(result: WriteBackReceipt | WriteBackRefusal) -> WriteBackOutcome:
    """Classify any write-back result into the outcome vocabulary."""

    if isinstance(result, WriteBackReceipt):
        return WriteBackOutcome.RECEIPT
    return WriteBackOutcome(result.value)


class NoteLedger(Protocol):
    """Where written notes live. The synthetic one keeps them in memory."""

    def find(self, note_id: str) -> dict[str, Any] | None: ...

    def record(self, entry: dict[str, Any]) -> None: ...


@dataclass
class InMemoryNoteLedger:
    """A synthetic note ledger, initialized empty on every run."""

    entries: dict[str, dict[str, Any]] = field(default_factory=dict)

    def find(self, note_id: str) -> dict[str, Any] | None:
        return self.entries.get(note_id)

    def record(self, entry: dict[str, Any]) -> None:
        self.entries[entry["note_id"]] = entry


@dataclass(frozen=True)
class WriteBackReceipt:
    """What the source record now holds, and under which identity.

    ``replayed`` marks a write that found its own note already present — the
    same reviewed result, re-written under the review that approved it. The
    note id and content are identical by construction; only the flag
    distinguishes first write from replay.
    """

    note_id: str
    source_platform: str
    source_claim_id: str
    source_version: str
    written_at: str
    note: dict[str, Any]
    replayed: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "note_id": self.note_id,
            "source_platform": self.source_platform,
            "source_claim_id": self.source_claim_id,
            "source_version": self.source_version,
            "written_at": self.written_at,
            "replayed": self.replayed,
            "note": dict(self.note),
        }


def same_write(first: WriteBackReceipt, second: WriteBackReceipt) -> bool:
    """Semantic equality: same note identity and content, any timestamp.

    Legitimate timestamps differ between repeats; requiring byte-identical
    receipts would make honest retries look like duplicates.
    """

    return (
        first.note_id == second.note_id
        and first.source_version == second.source_version
        and first.note == second.note
    )


def build_note(outcome: WorkflowOutcome, evidence_pointer: str | None) -> dict[str, Any]:
    """The bounded note: stated fields, contract version, evidence pointer."""

    business = outcome.business
    return {
        "contract_version": business.contract_version,
        "claim_status": business.claim_status.value,
        "stated_reason": business.stated_reason,
        "required_correction": business.required_correction,
        "required_documents": list(business.required_documents),
        "stated_deadline": business.stated_deadline,
        "escalation_path": business.escalation_path,
        "stated_next_action": business.stated_next_action,
        "confirmed_reference": (
            business.confirmed_reference.to_dict()
            if business.confirmed_reference
            else None
        ),
        "evidence_pointer": evidence_pointer,
    }


def note_id_for(
    *,
    source_platform: str,
    source_claim_id: str,
    source_version: str,
    idempotency_key: str,
    note: dict[str, Any],
) -> str:
    """A digest of everything the write is anchored to, minus the clock.

    Two writes of the same reviewed result under the same key and source
    version collide on this id by construction; any change to the note
    content, the key or the version produces a different one.
    """

    payload = json.dumps(
        {
            "source_platform": source_platform,
            "source_claim_id": source_claim_id,
            "source_version": source_version,
            "idempotency_key": idempotency_key,
            "note": note,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def write_back(
    claim: SourceClaim,
    version_reader: SourceVersionReader,
    ledger: NoteLedger,
    packet: ReviewPacket,
    decision: ReviewRecord,
    outcome: WorkflowOutcome,
    *,
    idempotency_key: str,
    evidence_pointer: str | None = None,
    written_at: datetime | None = None,
) -> WriteBackReceipt | WriteBackRefusal:
    """Write the reviewed note, or refuse with a named reason.

    The order is fixed: business result, then review, then the source-version
    re-read, then the note identity. The version re-read happens immediately
    before the mutation — even if the pre-call check saw the same version,
    this one is the one that decides.
    """

    if not outcome.write_back_eligible:
        return WriteBackRefusal.NO_BUSINESS_RESULT

    refusals = review_refusals(packet, decision)
    if refusals:
        return WriteBackRefusal.NOT_REVIEWED

    current = version_reader.current_version(claim.source_platform, claim.source_claim_id)
    if current != claim.source_version:
        return WriteBackRefusal.SOURCE_CHANGED

    note = build_note(outcome, evidence_pointer)
    note_id = note_id_for(
        source_platform=claim.source_platform,
        source_claim_id=claim.source_claim_id,
        source_version=claim.source_version,
        idempotency_key=idempotency_key,
        note=note,
    )
    existing = ledger.find(note_id)
    if existing is not None:
        # The note identity already exists. Two possibilities, and only two:
        # the same review approving the same result again (an idempotent
        # replay — return the note untouched) or a *different* review whose
        # note happens to land on the same identity. The second is a
        # conflict, not a confirmation: two approvals of one write is one
        # approval too many, and which one the note belongs to is not
        # something this code decides.
        if existing.get("review_id") not in (None, decision.review_id):
            return WriteBackRefusal.REVIEW_CONFLICT
        return WriteBackReceipt(
            note_id=note_id,
            source_platform=claim.source_platform,
            source_claim_id=claim.source_claim_id,
            source_version=claim.source_version,
            written_at=existing["written_at"],
            note=note,
            replayed=True,
        )

    stamp = written_at or datetime.now(timezone.utc)
    ledger.record(
        {
            "note_id": note_id,
            "source_platform": claim.source_platform,
            "source_claim_id": claim.source_claim_id,
            "source_version": claim.source_version,
            "written_at": stamp.isoformat(),
            "reviewer": decision.reviewer,
            "operator_id": decision.operator_id,
            "review_decision": decision.decision.value,
            "review_id": decision.review_id,
            "note": note,
        }
    )
    return WriteBackReceipt(
        note_id=note_id,
        source_platform=claim.source_platform,
        source_claim_id=claim.source_claim_id,
        source_version=claim.source_version,
        written_at=stamp.isoformat(),
        note=note,
    )
