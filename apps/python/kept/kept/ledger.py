"""Append-only, hash-chained audit log. The only writer of durable state.

Collections work gets audited, and the question asked is always "on what basis
did you call this customer?". Every decision, including every decision *not* to
call, is written here in the order it was made and cannot be edited afterwards
without breaking the chain.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

GENESIS_HASH = "0" * 64


class LedgerIntegrityError(RuntimeError):
    """Raised when the recorded chain does not match its contents."""


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    seq: int
    at: str
    type: str
    payload: dict[str, Any]
    prev: str
    hash: str

    def recompute_hash(self) -> str:
        return _digest(seq=self.seq, at=self.at, type=self.type, payload=self.payload, prev=self.prev)


class Ledger:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        existing = self.read()
        self._tail: LedgerEntry | None = existing[-1] if existing else None

    @property
    def path(self) -> Path:
        return self._path

    def append(self, *, event_type: str, payload: dict[str, Any], at: datetime) -> LedgerEntry:
        previous = self._tail
        entry = _build_entry(
            seq=previous.seq + 1 if previous else 1,
            at=at.isoformat(),
            event_type=event_type,
            payload=payload,
            prev=previous.hash if previous else GENESIS_HASH,
        )
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(asdict(entry), sort_keys=True, separators=(",", ":")) + "\n")
        self._tail = entry
        return entry

    def read(self) -> list[LedgerEntry]:
        if not self._path.exists():
            return []
        return list(self._parse_lines())

    def of_type(self, event_type: str) -> Iterator[dict[str, Any]]:
        for entry in self.read():
            if entry.type == event_type:
                yield entry.payload

    def verify(self) -> None:
        expected_prev = GENESIS_HASH
        for index, entry in enumerate(self.read(), start=1):
            if entry.seq != index or entry.prev != expected_prev:
                raise LedgerIntegrityError(f"Ledger entry {entry.seq} is out of order.")
            if entry.hash != entry.recompute_hash():
                raise LedgerIntegrityError(f"Ledger entry {entry.seq} was modified after writing.")
            expected_prev = entry.hash

    def _parse_lines(self) -> Iterator[LedgerEntry]:
        for number, line in enumerate(self._path.read_text(encoding="utf-8").splitlines(), start=1):
            if not line.strip():
                continue
            try:
                yield LedgerEntry(**json.loads(line))
            except (TypeError, ValueError) as exc:
                raise LedgerIntegrityError(f"Ledger line {number} is not a valid entry.") from exc


def _build_entry(
    *, seq: int, at: str, event_type: str, payload: dict[str, Any], prev: str
) -> LedgerEntry:
    digest = _digest(seq=seq, at=at, type=event_type, payload=payload, prev=prev)
    return LedgerEntry(seq=seq, at=at, type=event_type, payload=payload, prev=prev, hash=digest)


def _digest(*, seq: int, at: str, type: str, payload: dict[str, Any], prev: str) -> str:
    body = json.dumps(
        {"seq": seq, "at": at, "type": type, "payload": payload, "prev": prev},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(body.encode("utf-8")).hexdigest()
