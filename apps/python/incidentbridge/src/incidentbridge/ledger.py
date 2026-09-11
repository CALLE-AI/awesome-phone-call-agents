"""Durable reservation preventing accidental duplicate phone calls."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS call_reservations (
    idempotency_key TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    call_id TEXT,
    detail TEXT,
    updated_at TEXT NOT NULL
)
"""


class ReservationLedger:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as connection:
            connection.execute(SCHEMA)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    @staticmethod
    def now() -> str:
        return datetime.now(UTC).isoformat()

    def claim(self, key: str) -> bool:
        try:
            with self.connect() as connection:
                connection.execute(
                    "INSERT INTO call_reservations VALUES (?, ?, ?, ?, ?)",
                    (key, "reserved", None, None, self.now()),
                )
        except sqlite3.IntegrityError:
            return False
        return True

    def mark_accepted(self, key: str, call_id: str) -> None:
        self.update(key, "accepted", call_id, None)

    def mark_completed(self, key: str, call_id: str) -> None:
        self.update(key, "completed", call_id, None)

    def mark_unknown(self, key: str, call_id: str | None, detail: str) -> None:
        self.update(key, "outcome_unknown", call_id, detail[:120])

    def update(self, key: str, state: str, call_id: str | None, detail: str | None) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE call_reservations SET state=?, call_id=?, detail=?, updated_at=? "
                "WHERE idempotency_key=?",
                (state, call_id, detail, self.now(), key),
            )
            if cursor.rowcount != 1:
                raise RuntimeError("call reservation does not exist")

    def get(self, key: str) -> tuple[str, str | None, str | None] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT state, call_id, detail FROM call_reservations WHERE idempotency_key=?",
                (key,),
            ).fetchone()
        return row
