"""Human review between the call and any mutation of the source record.

Nothing this application learns on a call is written back without a human
decision. The review packet is what the human sees; the decision record is
what the write-back demands. The decision carries the packet's
``review_id`` *and* its ``packet_sha256``, so an approval can be replayed
onto neither a different outcome than the one reviewed nor a different
packet body than the one the reviewer saw.

The decision vocabulary is an enum, not a boolean: the human may **approve**
(write), **refuse** (do not write, the answer is not to be trusted or is
out of scope), or **return to digital** (do not write; the question belongs
to an ordinary route after all). Only ``APPROVE`` can ever authorize a
write; the other two are recorded safe non-writes.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any

from .authorization import mask_e164
from .outcome import WorkflowOutcome
from .packet import derive_packet


class ReviewDecision(str, Enum):
    """What the human decided. Only APPROVE authorizes a write."""

    APPROVE = "APPROVE"
    REFUSE = "REFUSE"
    RETURN_TO_DIGITAL = "RETURN_TO_DIGITAL"


class ReviewRefusal(str, Enum):
    """Why a decision does not authorize a write-back."""

    NOT_APPROVED = "NOT_APPROVED"
    MISSING_REVIEWER = "MISSING_REVIEWER"
    NOT_TIMEZONE_AWARE = "NOT_TIMEZONE_AWARE"
    NOT_BOUND_TO_PACKET = "NOT_BOUND_TO_PACKET"
    #: No host-derived operator identity was recorded with the decision. A
    #: decision that names no principal cannot be audited, so it refuses.
    OPERATOR_MISSING = "OPERATOR_MISSING"
    #: The decision was recorded against a different packet body than the one
    #: being written. A stale approval is not an approval.
    PACKET_HASH_MISMATCH = "PACKET_HASH_MISMATCH"


@dataclass(frozen=True)
class ReviewPacket:
    """What the reviewer sees: outcome, evidence, identifier state. Masked.

    Evidence quotes are included because they are the grounds for the fields.
    The full transcript is deliberately not reproduced here; it stays with the
    provider artifacts and the reviewer's own tooling. ``packet_sha256`` is
    the digest of the typed three-surface packet
    (:mod:`warrantyops.packet`); decisions bind to it.
    """

    review_id: str
    terminal_state: str
    transport_state: str
    recipient_masked: str
    business: dict[str, Any]
    identifier: dict[str, Any] | None
    packet_sha256: str
    validation_errors: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "review_id": self.review_id,
            "terminal_state": self.terminal_state,
            "transport_state": self.transport_state,
            "recipient": self.recipient_masked,
            "business": self.business,
            "identifier": self.identifier,
            "packet_sha256": self.packet_sha256,
            "validation_errors": list(self.validation_errors),
        }


@dataclass(frozen=True)
class ReviewRecord:
    """One human's call on one packet, with the principal who made it.

    ``reviewer`` is the name a human reads; ``operator_id`` is the
    host-derived identity a machine audits (an account or workstation
    identifier, supplied by the caller — never guessed or defaulted here).
    A record with neither a reviewer nor an operator refuses; a record whose
    ``packet_sha256`` does not match the packet refuses as stale.
    """

    decision: ReviewDecision
    reviewer: str
    decided_at: datetime
    review_id: str
    packet_sha256: str
    operator_id: str = ""
    comment: str = ""


def prepare_review(outcome: WorkflowOutcome, recipient_e164: str) -> ReviewPacket:
    """Build the review packet and the identities the decision must carry."""

    body: dict[str, Any] = {
        "terminal_state": outcome.terminal_state.value,
        "transport": outcome.transport.to_dict(),
        "business": outcome.business.to_dict(),
        "identifier": outcome.identifier.to_dict() if outcome.identifier else None,
    }
    digest = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:32]
    packet = derive_packet(outcome)
    return ReviewPacket(
        review_id=digest,
        terminal_state=outcome.terminal_state.value,
        transport_state=outcome.transport.state.value,
        recipient_masked=mask_e164(recipient_e164),
        business=outcome.business.to_dict(),
        identifier=body["identifier"],
        packet_sha256=packet.packet_sha256,
        validation_errors=outcome.validation_errors,
    )


def review_refusals(packet: ReviewPacket, decision: ReviewRecord) -> tuple[ReviewRefusal, ...]:
    """Every named reason this decision does not authorize a write-back.

    ``REFUSE`` and ``RETURN_TO_DIGITAL`` are legitimate decisions — they
    simply do not authorize a write, which is ``NOT_APPROVED`` in write-back
    terms. Everything else that can invalidate an approval is named
    separately: a missing principal, a naive timestamp, a decision bound to
    another packet's id, or one bound to another packet's *body*.
    """

    refusals: list[ReviewRefusal] = []
    if decision.decision is not ReviewDecision.APPROVE:
        refusals.append(ReviewRefusal.NOT_APPROVED)
    if not decision.reviewer.strip():
        refusals.append(ReviewRefusal.MISSING_REVIEWER)
    if not decision.operator_id.strip():
        refusals.append(ReviewRefusal.OPERATOR_MISSING)
    if decision.decided_at.tzinfo is None:
        refusals.append(ReviewRefusal.NOT_TIMEZONE_AWARE)
    if decision.review_id != packet.review_id:
        refusals.append(ReviewRefusal.NOT_BOUND_TO_PACKET)
    if decision.packet_sha256 != packet.packet_sha256:
        refusals.append(ReviewRefusal.PACKET_HASH_MISMATCH)
    return tuple(refusals)
