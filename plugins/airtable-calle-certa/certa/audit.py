"""Append-only, hash-chained audit log.

Every regulator that permits this kind of calling asks for the same artefact.
The RBI's Guidelines on Digital Lending require consent that is explicit and
"having audit trail"; FCRA and GDPR both expect a lender to be able to show,
afterwards, who was contacted and on what authority. So the log is not
diagnostics -- it is the evidence the whole workflow rests on.

Each record carries the hash of the record before it:

    hash_n = sha256(prev_hash_n | canonical_json(record_n without its hash))

Mutating any field of any record, removing a record from the middle, or
reordering records all break the chain at that point and `verify_chain()`
reports the sequence number where it broke.

What this does NOT protect against, stated plainly because a claim of
tamper-proofing that overreaches is worse than none:

  * Truncation of the tail. Deleting whole records from the end leaves a
    shorter but internally valid chain. Detecting that needs the head hash
    anchored somewhere the writer cannot reach -- an append-only object store,
    a witness service, or a countersignature. `head()` returns the value to
    anchor; this module does not anchor it for you.
  * An attacker with write access and the code can rebuild the whole file.
    The chain makes tampering evident to someone who kept an earlier head, not
    impossible.
  * Concurrent writers in *separate processes*. Appends are serialised by an
    in-process lock, which is what the runner's thread pool needs. Two
    processes appending to one log would interleave and break the chain, so a
    log has one writing process.

Numbers are masked before they reach the log, and consent tokens are stored as
a short prefix only: enough to correlate, not enough to replay.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

GENESIS = "0" * 64

# Long enough to correlate a record with a run, far too short to reconstruct
# the token and reuse it as consent.
TOKEN_PREFIX_LEN = 12


class AuditError(Exception):
    """The log could not be read, or a record could not be written."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _canonical(payload: dict[str, Any]) -> str:
    """Stable serialisation, so a hash depends on content and not on key order."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_hash(prev_hash: str, record: dict[str, Any]) -> str:
    body = {k: v for k, v in record.items() if k != "hash"}
    return hashlib.sha256(
        f"{prev_hash}\x1f{_canonical(body)}".encode("utf-8")
    ).hexdigest()


@dataclass(frozen=True, slots=True)
class ChainStatus:
    ok: bool
    records: int
    head: str
    broken_at: int | None = None
    reason: str = ""

    def __str__(self) -> str:
        if self.ok:
            return f"chain intact: {self.records} records, head {self.head[:12]}"
        return f"chain BROKEN at seq {self.broken_at}: {self.reason}"


class AuditLog:
    """A JSONL file, one record per line, each chained to the last.

    Writes are append-only and flushed to the OS before the call that they
    record is allowed to proceed, so a crash cannot leave a placed call with no
    record of the authority for it.
    """

    def __init__(self, path: str | os.PathLike[str], *, fsync: bool = True) -> None:
        """`fsync` defaults to on, because a record must be durable before the
        call it authorises is allowed to ring. Turning it off is for tests that
        are not exercising durability; a deployment should leave it alone."""
        self.path = Path(path)
        self.fsync = fsync
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Dispatch is concurrent, so deriving the next seq and prev_hash must be
        # atomic with the write that consumes them. Without this, two threads
        # read the same head and both claim the same sequence number, which
        # breaks the chain the log exists to guarantee.
        self._lock = threading.Lock()
        self._head: str | None = None
        self._seq: int | None = None

    # -- reading -------------------------------------------------------

    def records(self) -> Iterator[dict[str, Any]]:
        if not self.path.exists():
            return
        with self.path.open("r", encoding="utf-8") as handle:
            for lineno, line in enumerate(handle, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError as exc:
                    raise AuditError(
                        f"{self.path}:{lineno}: record is not valid JSON"
                    ) from exc

    def head(self) -> str:
        """Hash of the last record. Anchor this externally to detect truncation."""
        last = GENESIS
        for record in self.records():
            last = record.get("hash", "")
        return last or GENESIS

    def count(self) -> int:
        return sum(1 for _ in self.records())

    # -- writing -------------------------------------------------------

    def append(
        self,
        event: str,
        *,
        request_id: str = "",
        masked_number: str = "",
        number_source: str = "",
        call_id: str = "",
        consent_token: str = "",
        detail: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Append one record and return it.

        `masked_number` is expected to be already masked; this method does not
        mask for you, because a helper that silently accepts a raw number is a
        helper that will one day be handed one.
        """
        if masked_number and any(ch.isdigit() for ch in masked_number[2:-4]):
            raise AuditError(
                "refusing to log what looks like an unmasked number; "
                "pass types.mask(...) output"
            )

        with self._lock:
            if self._head is None or self._seq is None:
                self._seq = 0
                self._head = GENESIS
                for existing in self.records():
                    self._head = existing.get("hash", self._head)
                    self._seq += 1
            prev = self._head
            seq = self._seq
            record = self._write(event, prev, seq, request_id, masked_number,
                                 number_source, call_id, consent_token, detail)
            self._head = record["hash"]
            self._seq = seq + 1
        return record

    def _write(
        self,
        event: str,
        prev: str,
        seq: int,
        request_id: str,
        masked_number: str,
        number_source: str,
        call_id: str,
        consent_token: str,
        detail: dict[str, Any] | None,
    ) -> dict[str, Any]:
        record: dict[str, Any] = {
            "seq": seq,
            "ts": _now(),
            "event": event,
            "request_id": request_id,
            "masked_number": masked_number,
            "number_source": number_source,
            "call_id": call_id,
            "consent_token_prefix": (consent_token or "")[:TOKEN_PREFIX_LEN],
            "detail": detail or {},
            "prev_hash": prev,
        }
        record["hash"] = compute_hash(prev, record)

        line = _canonical(record) + "\n"
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(line)
            handle.flush()
            if self.fsync:
                os.fsync(handle.fileno())
        return record

    # -- verification --------------------------------------------------

    def verify_chain(self) -> ChainStatus:
        prev = GENESIS
        seq = 0
        for record in self.records():
            expected_seq = seq
            if record.get("seq") != expected_seq:
                return ChainStatus(
                    ok=False,
                    records=seq,
                    head=prev,
                    broken_at=record.get("seq"),
                    reason=(
                        f"sequence is {record.get('seq')}, expected "
                        f"{expected_seq}: a record was removed or reordered"
                    ),
                )
            if record.get("prev_hash") != prev:
                return ChainStatus(
                    ok=False,
                    records=seq,
                    head=prev,
                    broken_at=expected_seq,
                    reason="prev_hash does not match the previous record",
                )
            recomputed = compute_hash(prev, record)
            if recomputed != record.get("hash"):
                return ChainStatus(
                    ok=False,
                    records=seq,
                    head=prev,
                    broken_at=expected_seq,
                    reason="record content does not match its hash: it was edited",
                )
            prev = record["hash"]
            seq += 1
        return ChainStatus(ok=True, records=seq, head=prev)
