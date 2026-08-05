"""Small SQLite audit store for FreshChain cases and call attempts."""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL UNIQUE,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS call_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  mode TEXT NOT NULL,
  provider_call_id TEXT,
  provider_status TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(case_id) REFERENCES cases(id)
);
"""
PHONE_LIKE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")


def public_value(value: Any) -> Any:
    if isinstance(value, str):
        return PHONE_LIKE.sub("[phone-masked]", value)
    if isinstance(value, list):
        return [public_value(item) for item in value]
    if isinstance(value, dict):
        return {key: public_value(item) for key, item in value.items()}
    return value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def create_case(self, request: dict[str, Any]) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO cases
                  (workflow_id, request_json, status, created_at, updated_at)
                VALUES (?, ?, 'ready', ?, ?)
                """,
                (
                    request["workflow_id"],
                    json.dumps(request, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            case_id = cursor.lastrowid
        return self.get_case(case_id)

    def get_case(self, case_id: int) -> dict[str, Any]:
        return public_value(self.get_case_private(case_id))

    def get_case_private(self, case_id: int) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM cases WHERE id = ?", (case_id,)
            ).fetchone()
        if row is None:
            raise KeyError(case_id)
        result = dict(row)
        result["request"] = json.loads(result.pop("request_json"))
        return result

    def list_cases(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM cases ORDER BY id DESC"
            ).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["request"] = public_value(json.loads(item.pop("request_json")))
            results.append(public_value(item))
        return results

    def claim_live_execution(self, case_id: int) -> bool:
        now = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                """
                UPDATE cases
                SET status = 'calling', decision = NULL,
                    decision_reason = NULL, updated_at = ?
                WHERE id = ? AND status NOT IN ('calling', 'outcome_unknown')
                """,
                (now, case_id),
            )
        return cursor.rowcount == 1

    def claim_cli_live_execution(self, request: dict[str, Any]) -> int | None:
        now = utc_now()
        rendered = json.dumps(request, ensure_ascii=False)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT id, status FROM cases WHERE workflow_id = ?",
                (request["workflow_id"],),
            ).fetchone()
            if row is None:
                cursor = connection.execute(
                    """
                    INSERT INTO cases
                      (workflow_id, request_json, status, created_at, updated_at)
                    VALUES (?, ?, 'calling', ?, ?)
                    """,
                    (request["workflow_id"], rendered, now, now),
                )
                return int(cursor.lastrowid)
            if row["status"] in {"calling", "outcome_unknown"}:
                return None
            connection.execute(
                """
                UPDATE cases
                SET request_json = ?, status = 'calling', decision = NULL,
                    decision_reason = NULL, updated_at = ?
                WHERE id = ?
                """,
                (rendered, now, row["id"]),
            )
            return int(row["id"])

    def record_call_accepted(self, case_id: int, call_id: str) -> int:
        now = utc_now()
        payload = {
            "mode": "execute",
            "creates_phone_call": True,
            "call_id": call_id,
            "status": "accepted",
            "decision": {
                "route": "escalate",
                "reason": "CALL-E accepted the call; terminal result is pending.",
            },
        }
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO call_attempts
                  (case_id, mode, provider_call_id, provider_status, result_json, created_at)
                VALUES (?, 'live', ?, 'accepted', ?, ?)
                """,
                (case_id, call_id, json.dumps(payload), now),
            )
        return int(cursor.lastrowid)

    def complete_live_attempt(
        self, case_id: int, attempt_id: int, payload: dict[str, Any]
    ) -> dict[str, Any]:
        decision = payload["decision"]
        now = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE call_attempts
                SET provider_status = ?, result_json = ?
                WHERE id = ? AND case_id = ?
                """,
                (
                    payload.get("status"),
                    json.dumps(payload, ensure_ascii=False),
                    attempt_id,
                    case_id,
                ),
            )
            connection.execute(
                """
                UPDATE cases
                SET status = 'resolved', decision = ?,
                    decision_reason = ?, updated_at = ?
                WHERE id = ?
                """,
                (decision["route"], decision["reason"], now, case_id),
            )
        return self.get_attempt(attempt_id)

    def record_live_ambiguity(
        self,
        case_id: int,
        attempt_id: int | None,
        call_id: str | None,
        detail: str,
    ) -> None:
        now = utc_now()
        payload = {
            "mode": "execute",
            "creates_phone_call": call_id is not None,
            "call_id": call_id,
            "status": "outcome_unknown",
            "error": detail,
            "decision": {
                "route": "escalate",
                "reason": "CALL-E outcome is unknown; reconcile before retrying.",
            },
        }
        with self.connect() as connection:
            if attempt_id is None:
                connection.execute(
                    """
                    INSERT INTO call_attempts
                      (case_id, mode, provider_call_id, provider_status, result_json, created_at)
                    VALUES (?, 'live', ?, 'outcome_unknown', ?, ?)
                    """,
                    (case_id, call_id, json.dumps(payload), now),
                )
            else:
                connection.execute(
                    """
                    UPDATE call_attempts
                    SET provider_status = 'outcome_unknown', result_json = ?
                    WHERE id = ? AND case_id = ?
                    """,
                    (json.dumps(payload), attempt_id, case_id),
                )
            connection.execute(
                """
                UPDATE cases
                SET status = 'outcome_unknown', decision = 'escalate',
                    decision_reason = ?, updated_at = ?
                WHERE id = ?
                """,
                (payload["decision"]["reason"], now, case_id),
            )

    def record_simulation_attempt(
        self, case_id: int, payload: dict[str, Any]
    ) -> dict[str, Any]:
        now = utc_now()
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO call_attempts
                  (case_id, mode, provider_call_id, provider_status, result_json, created_at)
                VALUES (?, 'simulation', ?, ?, ?, ?)
                """,
                (
                    case_id,
                    payload.get("call_id"),
                    payload.get("status"),
                    json.dumps(payload, ensure_ascii=False),
                    now,
                ),
            )
            attempt_id = cursor.lastrowid
        return self.get_attempt(attempt_id)

    def get_attempt(self, attempt_id: int) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM call_attempts WHERE id = ?", (attempt_id,)
            ).fetchone()
        if row is None:
            raise KeyError(attempt_id)
        result = dict(row)
        result["result"] = public_value(json.loads(result.pop("result_json")))
        return public_value(result)

    def list_attempts(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM call_attempts ORDER BY id DESC"
            ).fetchall()
        results = []
        for row in rows:
            item = dict(row)
            item["result"] = public_value(json.loads(item.pop("result_json")))
            results.append(public_value(item))
        return results
