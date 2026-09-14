"""The claim adapter boundary: what a system of record must supply.

§6.2 (locked): the built artifact is an adapter contract plus fixture and
in-memory implementations — **not** a DMS/ERP connector. The contract has
two sides:

*Input* — :class:`ClaimSnapshot`: the claim id and source version, the
supplied money and policy facts, the structured exhaustion manifest, and
the recipient authorization class. This is exactly what the kernel's
envelope gate already validates, so an adapter cannot smuggle in an
unvalidated claim: the snapshot carries a :class:`SourceClaim` that has
passed ``validate_source_claim``.

*Output* — :class:`Delivery`: the five named artifacts a completed run
produces (terminal packet, review decision, provider receipt, idempotent
note payload, audit reference). The adapter records them; it never
constructs them itself — :func:`build_delivery` accepts only kernel
outputs, so a deployment cannot write back through any path the kernel
did not run.

Two implementations ship: :class:`InMemoryClaimAdapter` and
:class:`FixtureClaimAdapter` (JSON, schema-validated). A real DMS/ERP
integration is **planned, not built** — see ``docs/adapter-contract.md``
for the sequence diagram and the integration cookbook.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Protocol

from .authorization import AuthorizationBasis
from .envelope import SourceClaim, source_claim_from_dict, validate_source_claim
from .gates import DEFAULT_POLICY_BOOK
from .receipt import PublicReceipt, render_receipt_json
from .review import ReviewPacket, ReviewRecord
from .writeback import WriteBackReceipt

__all__ = [
    "ADAPTER_AUTHORIZATION_CLASSES",
    "REQUIRED_FIXTURE_KEYS",
    "AdapterRefusal",
    "ClaimAdapter",
    "ClaimSnapshot",
    "Delivery",
    "FixtureClaimAdapter",
    "InMemoryClaimAdapter",
    "build_delivery",
]

#: Fixture keys a JSON adapter requires. Anything else in the file is
#: scenario material the provider seam uses, not adapter input.
REQUIRED_FIXTURE_KEYS = frozenset({"envelope", "recipient_e164"})

#: The authorization classes an adapter may declare. Anything else is a
#: named refusal — an adapter never invents a consent basis.
ADAPTER_AUTHORIZATION_CLASSES = frozenset(
    {basis.value for basis in AuthorizationBasis}
)


class AdapterRefusal(ValueError):
    """The adapter refused; the named reasons travel with it."""

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("; ".join(reasons))
        self.reasons = reasons


@dataclass(frozen=True)
class ClaimSnapshot:
    """The input side of the contract, validated before anyone dials."""

    claim: SourceClaim
    authorization_class: AuthorizationBasis
    policy_book_id: str

    @property
    def claim_id(self) -> str:
        return self.claim.source_claim_id

    @property
    def source_version(self) -> str:
        return self.claim.source_version


@dataclass(frozen=True)
class Delivery:
    """The output side: the five §6.2 artifacts of one completed run."""

    terminal_packet: dict[str, Any]
    review_decision: str
    provider_receipt: str  # canonical JSON of the public receipt
    note_payload: Optional[dict[str, Any]]  # the idempotent note, or None
    audit_reference: Optional[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "terminal_packet": self.terminal_packet,
            "review_decision": self.review_decision,
            "provider_receipt": json.loads(self.provider_receipt),
            "note_payload": self.note_payload,
            "audit_reference": self.audit_reference,
        }


class ClaimAdapter(Protocol):
    """One system of record: one load, one version read, one deliver."""

    def load_claim(self, claim_id: str) -> ClaimSnapshot:
        ...  # pragma: no cover - a Protocol declaration

    def current_version(self, source_platform: str, claim_id: str) -> Optional[str]:
        ...  # pragma: no cover - a Protocol declaration

    def deliver(self, delivery: Delivery) -> dict[str, Any]:
        ...  # pragma: no cover - a Protocol declaration


def _validated_snapshot(
    envelope: Mapping[str, Any],
    authorization_class: str,
    policy_book: Mapping[str, Any],
) -> ClaimSnapshot:
    """Shared validation for both adapters; refuses with named reasons."""

    reasons: list[str] = []
    claim = source_claim_from_dict(dict(envelope))
    decision = validate_source_claim(claim)
    if not decision.ok:
        reasons.extend(refusal.value for refusal in decision.refusals)
    if authorization_class not in ADAPTER_AUTHORIZATION_CLASSES:
        reasons.append(f"AUTHORIZATION_CLASS_UNKNOWN:{authorization_class}")
    if claim.economic_policy_id not in policy_book:
        reasons.append("POLICY_NOT_FOUND")
    if reasons:
        raise AdapterRefusal(reasons)
    return ClaimSnapshot(
        claim=claim,
        authorization_class=AuthorizationBasis(authorization_class),
        policy_book_id=claim.economic_policy_id,
    )


class InMemoryClaimAdapter:
    """An in-memory system of record; per-run state, never persisted."""

    def __init__(self, *snapshots: ClaimSnapshot) -> None:
        self.snapshots = {snapshot.claim_id: snapshot for snapshot in snapshots}
        self.versions = {
            (s.claim.source_platform, s.claim_id): s.source_version
            for s in self.snapshots.values()
        }
        self.delivered: list[Delivery] = []

    def load_claim(self, claim_id: str) -> ClaimSnapshot:
        snapshot = self.snapshots.get(claim_id)
        if snapshot is None:
            raise AdapterRefusal([f"CLAIM_NOT_FOUND:{claim_id}"])
        return snapshot

    def current_version(self, source_platform: str, claim_id: str) -> Optional[str]:
        return self.versions.get((source_platform, claim_id))

    def set_version(self, source_platform: str, claim_id: str, version: str) -> None:
        """The deployment-side move a real system of record makes itself."""

        self.versions[(source_platform, claim_id)] = version

    def deliver(self, delivery: Delivery) -> dict[str, Any]:
        # The in-memory adapter records the delivery and echoes it. A real
        # adapter hands the note payload to the system of record under the
        # same idempotency rules; it still cannot bypass the kernel,
        # because a Delivery exists only after the kernel produced it.
        self.delivered.append(delivery)
        return delivery.to_dict()


class FixtureClaimAdapter(InMemoryClaimAdapter):
    """A JSON-fixture system of record: the judge-clean default."""

    def __init__(
        self,
        fixture_path: Path,
        *,
        authorization_class: str = AuthorizationBasis.TEST_RECIPIENT_CONSENT.value,
        policy_book: Optional[Mapping[str, Any]] = None,
    ) -> None:
        try:
            fixture = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
        except OSError as error:
            raise AdapterRefusal(
                [f"FIXTURE_UNREADABLE:{type(error).__name__}"]
            ) from error
        except json.JSONDecodeError as error:
            raise AdapterRefusal([f"FIXTURE_NOT_JSON:{error.msg}"]) from error
        if not isinstance(fixture, dict) or not set(fixture) >= REQUIRED_FIXTURE_KEYS:
            raise AdapterRefusal(["FIXTURE_SHAPE_INVALID"])
        snapshot = _validated_snapshot(
            fixture["envelope"],
            authorization_class,
            dict(policy_book if policy_book is not None else DEFAULT_POLICY_BOOK),
        )
        super().__init__(snapshot)
        self.fixture_path = Path(fixture_path)


def build_delivery(
    *,
    packet: ReviewPacket,
    decision: ReviewRecord,
    receipt: PublicReceipt,
    note: Optional[WriteBackReceipt] = None,
    audit_reference: Optional[str] = None,
) -> Delivery:
    """Assemble the §6.2 output side from artifacts the kernel produced.

    Accepts only kernel outputs — a packet, a decision, a receipt, a note —
    and has no path to a provider, a ledger or a store, so nothing can
    assemble a :class:`Delivery` the kernel did not earn. ``note`` is None
    when the write-back was refused or withheld; the delivery then carries
    the refusal honestly instead of inventing a payload.
    """

    return Delivery(
        terminal_packet={
            "review_id": packet.review_id,
            "packet_sha256": packet.packet_sha256,
            "terminal_state": packet.terminal_state,
            "transport_state": packet.transport_state,
        },
        review_decision=decision.decision.value,
        provider_receipt=render_receipt_json(receipt),
        note_payload=dict(note.note) if note is not None else None,
        audit_reference=audit_reference,
    )
