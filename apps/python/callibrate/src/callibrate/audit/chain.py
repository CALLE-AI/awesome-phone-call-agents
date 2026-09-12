"""The Verification Ledger: an append-only, hash-linked record of every decision.

Each event carries the hash of the one before it, so the ledger's integrity is a
property anyone can check with a loop and a hash function rather than something
they have to take on trust. The database refuses updates and deletes to the
event table outright, so the only way to alter history is to break the chain,
and breaking the chain is visible.

What a verification writes here is the whole transaction: the contract, the
CALL-E run id, the transcript, the claims and the turns they rest on, the
policy's verdict and its reason, the diff that was applied, and any human
decision that followed.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

GENESIS = "GENESIS"


def canonical_payload(payload: dict[str, Any]) -> str:
    """One byte-for-byte representation of a payload, so a hash is reproducible."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def event_hash(
    *,
    previous_hash: str,
    event_type: str,
    actor: str,
    entity_type: str,
    entity_id: str,
    canonical: str,
    created_at: str,
) -> str:
    return hashlib.sha256(
        f"{previous_hash}|{event_type}|{actor}|{entity_type}|{entity_id}|{canonical}|{created_at}".encode()
    ).hexdigest()


def verify_chain(rows: list[Any]) -> bool:
    """Recompute every link. One altered byte anywhere returns False."""
    previous = GENESIS
    for row in rows:
        if row["previous_hash"] != previous:
            return False
        expected = event_hash(
            previous_hash=previous,
            event_type=row["event_type"],
            actor=row["actor"],
            entity_type=row["entity_type"],
            entity_id=row["entity_id"],
            canonical=row["payload_json"],
            created_at=row["created_at"],
        )
        if expected != row["event_hash"]:
            return False
        previous = expected
    return True


def find_break(rows: list[Any]) -> int | None:
    """The sequence number of the first event that does not verify, if any."""
    previous = GENESIS
    for row in rows:
        expected = event_hash(
            previous_hash=previous,
            event_type=row["event_type"],
            actor=row["actor"],
            entity_type=row["entity_type"],
            entity_id=row["entity_id"],
            canonical=row["payload_json"],
            created_at=row["created_at"],
        )
        if row["previous_hash"] != previous or expected != row["event_hash"]:
            return int(row["sequence"])
        previous = expected
    return None
