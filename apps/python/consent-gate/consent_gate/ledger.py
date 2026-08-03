from __future__ import annotations

import fcntl
import json
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

from .policy import PolicyError, _phone_fingerprint


class DurableLedger:
    """A locked, atomically replaced JSON ledger for live dispatch state."""

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.lock_path = self.path.with_suffix(self.path.suffix + ".lock")

    @contextmanager
    def locked_events(self) -> Iterator[list[dict[str, Any]]]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock_path.open("a+", encoding="utf-8") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            events = self.load()
            yield events
            self._write(events)

    def load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise PolicyError("durable state ledger is unreadable") from exc
        if not isinstance(data, list):
            raise PolicyError("durable state ledger must be a JSON array")
        return data

    def _write(self, events: list[dict[str, Any]]) -> None:
        handle, temporary = tempfile.mkstemp(
            prefix=self.path.name + ".", dir=self.path.parent
        )
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(events, stream, indent=2, sort_keys=True)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def reservation(
        phone: str,
        *,
        request_payload: dict[str, Any],
        request_sha256: str,
        idempotency_key: str,
        provider_namespace: str,
    ) -> dict[str, Any]:
        return {
            "event": "dispatch_reserved",
            "reservation_id": str(uuid4()),
            "phone_fingerprint": _phone_fingerprint(phone),
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "state": "dispatching",
            "request_payload": request_payload,
            "request_sha256": request_sha256,
            "idempotency_key": idempotency_key,
            "provider_namespace": provider_namespace,
        }
