"""Local state per ticket so a live run can be resumed and never repeated.

One ticket maps to at most one CALL-E call task. The idempotency key sent to
CALL-E is derived from the ticket, and the returned call id is written to
disk before polling starts, so a crash between "call created" and "result
read" resumes with ``status`` instead of dialing the vendor again.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class TicketStore:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, ticket_id: str) -> Path:
        return self.root / f"{ticket_id}.json"

    def load(self, ticket_id: str) -> dict[str, Any] | None:
        path = self.path(ticket_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, ticket_id: str, record: dict[str, Any]) -> None:
        record["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        path = self.path(ticket_id)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(path)
