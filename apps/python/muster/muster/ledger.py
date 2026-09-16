"""A tamper-evident record of attestations.

A scheme that can rewrite its own history cannot use it as evidence. Each entry
carries the hash of the one before it, so removing or editing an attestation
after the fact breaks the chain at that point and every point after it.

This is an integrity check, not a security system. It proves the record has not
been edited in place; it does not prove who wrote it.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field

from .models import Attestation

GENESIS = "0" * 64


def digest(previous: str, attestation: Attestation) -> str:
    body = json.dumps(
        {
            "previous": previous,
            "subject_id": attestation.subject_id,
            "run_id": attestation.run_id,
            "graded_at": attestation.graded_at.isoformat(),
            "grade": attestation.grade.value,
            "reasons": list(attestation.reasons),
            "nonce_ok": attestation.nonce_ok,
            "challenges": [attestation.challenges_passed, attestation.challenges_asked],
            "coaching_suspected": attestation.coaching_suspected,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Entry:
    attestation: Attestation
    previous: str
    this: str


@dataclass
class Ledger:
    """An append-only chain, one per subject."""

    entries: list[Entry] = field(default_factory=list)

    @property
    def head(self) -> str:
        return self.entries[-1].this if self.entries else GENESIS

    def append(self, attestation: Attestation) -> Entry:
        entry = Entry(attestation, self.head, digest(self.head, attestation))
        self.entries.append(entry)
        return entry

    def verify(self) -> tuple[bool, int | None]:
        """Return (intact, index_of_first_broken_entry)."""
        previous = GENESIS
        for index, entry in enumerate(self.entries):
            if entry.previous != previous or entry.this != digest(previous, entry.attestation):
                return False, index
            previous = entry.this
        return True, None
