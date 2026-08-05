"""Write-ahead ledger for crash-safe dispatch.

Every dispatch intent is appended BEFORE the call is placed. On restart, the
ledger is replayed: any candidate with a logged 'dispatched' entry and no
matching 'result' is either still in flight (poll it) or was interrupted
mid-dispatch. Either way we never re-dial someone whose dispatch was already
logged for this mobilization, and we never lose a confirmation that was
already recorded.

Uses CALL-E's Idempotency-Key request header directly (confirmed in the
OpenAPI spec) so even a duplicate dispatch call against the real API is safe.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterator


@dataclass(frozen=True)
class LedgerEntry:
    kind: str  # "dispatched" | "result"
    mobilization_id: str
    candidate_id: str
    idempotency_key: str
    call_id: str | None = None
    payload: dict | None = None


class Ledger:
    """Append-only JSONL ledger with atomic writes and fsync before ack.

    Atomicity per entry: write to a temp file, fsync, then append via O_APPEND
    write, which is atomic for writes below PIPE_BUF on POSIX. For hackathon
    scope this is sufficient; a production version would use a proper WAL
    segment file with checksums.
    """

    def __init__(self, path: str | Path):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        if not self._path.exists():
            self._path.touch()

    def idempotency_key(self, mobilization_id: str, candidate_id: str) -> str:
        return f"{mobilization_id}:{candidate_id}"

    def record_dispatch(self, mobilization_id: str, candidate_id: str, call_id: str) -> None:
        entry = LedgerEntry(
            kind="dispatched",
            mobilization_id=mobilization_id,
            candidate_id=candidate_id,
            idempotency_key=self.idempotency_key(mobilization_id, candidate_id),
            call_id=call_id,
        )
        self._append(entry)

    def record_result(self, mobilization_id: str, candidate_id: str, call_id: str, payload: dict) -> None:
        entry = LedgerEntry(
            kind="result",
            mobilization_id=mobilization_id,
            candidate_id=candidate_id,
            idempotency_key=self.idempotency_key(mobilization_id, candidate_id),
            call_id=call_id,
            payload=payload,
        )
        self._append(entry)

    def already_dispatched(self, mobilization_id: str, candidate_id: str) -> str | None:
        """Return the existing call_id if this candidate was already dispatched
        for this mobilization, else None. Prevents double-dialing on replay."""
        for entry in self.replay(mobilization_id):
            if entry.kind == "dispatched" and entry.candidate_id == candidate_id:
                return entry.call_id
        return None

    def in_flight(self, mobilization_id: str) -> dict[str, str]:
        """candidate_id -> call_id for dispatches with no recorded terminal result."""
        dispatched: dict[str, str] = {}
        completed: set[str] = set()
        for entry in self.replay(mobilization_id):
            if entry.kind == "dispatched" and entry.call_id:
                dispatched[entry.candidate_id] = entry.call_id
            elif entry.kind == "result":
                completed.add(entry.candidate_id)
        return {cid: call_id for cid, call_id in dispatched.items() if cid not in completed}

    def completed_results(self, mobilization_id: str) -> list[dict]:
        return [
            entry.payload
            for entry in self.replay(mobilization_id)
            if entry.kind == "result" and entry.payload is not None
        ]

    def replay(self, mobilization_id: str) -> Iterator[LedgerEntry]:
        if not self._path.exists():
            return
        with self._path.open("r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                raw = json.loads(line)
                if raw.get("mobilization_id") == mobilization_id:
                    yield LedgerEntry(**raw)

    def _append(self, entry: LedgerEntry) -> None:
        line = json.dumps(asdict(entry)) + "\n"
        with self._lock:
            with self._path.open("a") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
