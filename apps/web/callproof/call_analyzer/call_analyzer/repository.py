from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


class Repository:
    def __init__(self, database_path: str):
        self.database_path = database_path
        Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS analyses (
                  analysis_id TEXT PRIMARY KEY,
                  request_id TEXT NOT NULL UNIQUE,
                  call_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  request_json TEXT NOT NULL,
                  result_json TEXT,
                  error TEXT,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS analysis_events (
                  event_id TEXT PRIMARY KEY,
                  analysis_id TEXT NOT NULL,
                  event_type TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                """
            )

    def create_or_find(self, request: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        now = _now()
        analysis_id = str(uuid4())
        request_id = request["request_id"]
        with self._connect() as connection:
            try:
                connection.execute(
                    """INSERT INTO analyses
                       (analysis_id, request_id, call_id, status, request_json, created_at, updated_at)
                       VALUES (?, ?, ?, 'received', ?, ?, ?)""",
                    (analysis_id, request_id, request["call_id"], json.dumps(request), now, now),
                )
                self._event(connection, analysis_id, "status_changed", {"from": None, "to": "received"})
                row = connection.execute(
                    "SELECT * FROM analyses WHERE analysis_id = ?", (analysis_id,)
                ).fetchone()
                return dict(row), True
            except sqlite3.IntegrityError:
                row = connection.execute(
                    "SELECT * FROM analyses WHERE request_id = ?", (request_id,)
                ).fetchone()
                return dict(row), False

    def get(self, analysis_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM analyses WHERE analysis_id = ?", (analysis_id,)
            ).fetchone()
            return dict(row) if row else None

    def transition(self, analysis_id: str, expected: str, target: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                """UPDATE analyses SET status = ?, updated_at = ?
                   WHERE analysis_id = ? AND status = ?""",
                (target, _now(), analysis_id, expected),
            )
            if cursor.rowcount != 1:
                return False
            self._event(connection, analysis_id, "status_changed", {"from": expected, "to": target})
            return True

    def complete(self, analysis_id: str, result: dict[str, Any]) -> None:
        with self._connect() as connection:
            cursor = connection.execute(
                """UPDATE analyses SET status = 'completed', result_json = ?, updated_at = ?
                   WHERE analysis_id = ? AND status = 'analyzing'""",
                (json.dumps(result), _now(), analysis_id),
            )
            if cursor.rowcount != 1:
                return
            self._event(connection, analysis_id, "status_changed", {"from": "analyzing", "to": "completed"})

    def fail(self, analysis_id: str, error: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE analyses SET status = 'failed', error = ?, updated_at = ? WHERE analysis_id = ?",
                (error, _now(), analysis_id),
            )
            self._event(connection, analysis_id, "processing_failed", {"error": error})

    def record_webhook(self, analysis_id: str, delivered: bool, detail: str) -> None:
        with self._connect() as connection:
            self._event(
                connection,
                analysis_id,
                "webhook_delivered" if delivered else "webhook_failed",
                {"detail": detail},
            )

    def events(self, analysis_id: str) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM analysis_events WHERE analysis_id = ? ORDER BY created_at", (analysis_id,)
            ).fetchall()
            return [dict(row) for row in rows]

    def _event(
        self, connection: sqlite3.Connection, analysis_id: str, event_type: str, payload: dict[str, Any]
    ) -> None:
        connection.execute(
            """INSERT INTO analysis_events
               (event_id, analysis_id, event_type, payload_json, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (str(uuid4()), analysis_id, event_type, json.dumps(payload), _now()),
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
