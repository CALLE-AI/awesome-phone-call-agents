"""Durable, crash-safe case ledger backing ``webhook.CaseStore``.

``CaseStore`` on its own is a pure in-memory dict -- correct, but a case
record (and, worse, the fact that a call was already placed for it) simply
disappears if the process restarts. That's not acceptable for a fraud-
verification case: it must survive a crash between "call placed" and
"disposition resolved," and a restarted process must never re-dial a case
it already handled just because its memory was wiped.

``CaseLedger`` is an append-only JSONL event log (``create`` / ``update``
per ``case_id``). On startup, ``replay()`` reconstructs the exact state
``CaseStore`` held before an unclean shutdown. A crash mid-write can leave
the *final* line truncated (a half-written JSON object) -- ``replay()``
treats that as an expected write-ahead-log artifact and skips it, not as
a fatal error; a corrupt line anywhere *other* than the last one is a real
bug and still raises.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path


class CorruptLedgerEntry(ValueError):
    pass


class CaseLedger:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: str, case_id: str, record: dict) -> None:
        line = json.dumps({"event": event, "case_id": case_id, "record": record}, ensure_ascii=False)
        with self._lock:
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(line + "\n")
                f.flush()
                os.fsync(f.fileno())

    def replay(self) -> dict[str, dict]:
        """Reconstruct current case state (case_id -> record) from the log."""
        state: dict[str, dict] = {}
        if not self.path.exists():
            return state

        with open(self.path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        last_index = len(lines) - 1
        for i, raw_line in enumerate(lines):
            line = raw_line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as exc:
                if i == last_index:
                    break  # truncated final line from a mid-write crash: expected, not fatal
                raise CorruptLedgerEntry(f"ledger line {i} is corrupt and not the final line: {line!r}") from exc

            case_id = entry["case_id"]
            if entry["event"] == "create":
                state[case_id] = dict(entry["record"])
            elif entry["event"] == "update":
                state.setdefault(case_id, {}).update(entry["record"])
        return state
