from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class LedgerError(RuntimeError):
    """Raised when a durable workflow transition violates the state machine."""


@dataclass(frozen=True, slots=True)
class LedgerRecord:
    intent_key: str
    case_id: str
    checkpoint_id: str
    preview_digest: str
    recipient_masked: str
    state: str
    provider_call_id: str | None
    disposition: str | None
    reason_codes: tuple[str, ...]
    result: dict[str, Any] | None
    created_at: str
    updated_at: str
    provider_diagnostic: str | None = None


class CallLedger:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        return connection

    def _initialize(self) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS call_intents (
                    intent_key TEXT PRIMARY KEY,
                    case_id TEXT NOT NULL,
                    checkpoint_id TEXT NOT NULL,
                    preview_digest TEXT NOT NULL,
                    recipient_masked TEXT NOT NULL,
                    state TEXT NOT NULL,
                    provider_call_id TEXT,
                    disposition TEXT,
                    reason_codes_json TEXT NOT NULL DEFAULT '[]',
                    result_json TEXT,
                    provider_diagnostic TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(call_intents)")
            }
            if "provider_diagnostic" not in columns:
                connection.execute(
                    "ALTER TABLE call_intents ADD COLUMN provider_diagnostic TEXT"
                )

    def reserve(
        self,
        *,
        intent_key: str,
        case_id: str,
        checkpoint_id: str,
        preview_digest: str,
        recipient_masked: str,
    ) -> tuple[LedgerRecord, bool]:
        now = _now()
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                "SELECT * FROM call_intents WHERE intent_key = ?", (intent_key,)
            ).fetchone()
            if existing is not None:
                return _record(existing), False
            connection.execute(
                """
                INSERT INTO call_intents (
                    intent_key, case_id, checkpoint_id, preview_digest,
                    recipient_masked, state, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'RESERVED', ?, ?)
                """,
                (
                    intent_key,
                    case_id,
                    checkpoint_id,
                    preview_digest,
                    recipient_masked,
                    now,
                    now,
                ),
            )
            row = connection.execute(
                "SELECT * FROM call_intents WHERE intent_key = ?", (intent_key,)
            ).fetchone()
            if row is None:  # pragma: no cover - SQLite invariant
                raise LedgerError("Reservation disappeared before commit")
            return _record(row), True

    def get(self, intent_key: str) -> LedgerRecord | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT * FROM call_intents WHERE intent_key = ?", (intent_key,)
            ).fetchone()
        return _record(row) if row is not None else None

    def mark_accepted(self, intent_key: str, call_id: str) -> LedgerRecord:
        return self._transition(
            intent_key,
            expected=("RESERVED",),
            state="ACCEPTED",
            provider_call_id=call_id,
        )

    def mark_submission_unknown(
        self, intent_key: str, reason_code: str, *, call_id: str | None = None
    ) -> LedgerRecord:
        return self._transition(
            intent_key,
            expected=("RESERVED",),
            state="SUBMISSION_UNKNOWN",
            provider_call_id=call_id,
            disposition="NEEDS_HUMAN_RECONCILIATION",
            reason_codes=(reason_code,),
        )

    def mark_read_pending(self, intent_key: str, reason_code: str) -> LedgerRecord:
        """Preserve an accepted call for later GET-only reconciliation."""
        return self._transition(
            intent_key,
            expected=("ACCEPTED",),
            state="ACCEPTED",
            disposition="CALL_IN_PROGRESS",
            reason_codes=(reason_code,),
        )

    def mark_rejected(
        self, intent_key: str, reason_code: str, *, provider_diagnostic: str | None = None
    ) -> LedgerRecord:
        return self._transition(
            intent_key,
            expected=("RESERVED",),
            state="REJECTED_BEFORE_START",
            disposition="NOT_CALLED",
            reason_codes=(reason_code,),
            provider_diagnostic=provider_diagnostic,
        )

    def mark_terminal(
        self,
        intent_key: str,
        *,
        disposition: str,
        reason_codes: tuple[str, ...],
        result: dict[str, Any] | None,
        state: str = "TERMINAL_VERIFIED",
    ) -> LedgerRecord:
        return self._transition(
            intent_key,
            expected=("ACCEPTED",),
            state=state,
            disposition=disposition,
            reason_codes=reason_codes,
            result=result,
        )

    def _transition(
        self,
        intent_key: str,
        *,
        expected: tuple[str, ...],
        state: str,
        provider_call_id: str | None = None,
        disposition: str | None = None,
        reason_codes: tuple[str, ...] = (),
        result: dict[str, Any] | None = None,
        provider_diagnostic: str | None = None,
    ) -> LedgerRecord:
        now = _now()
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM call_intents WHERE intent_key = ?", (intent_key,)
            ).fetchone()
            if row is None:
                raise LedgerError("Cannot transition an unknown call intent")
            if row["state"] not in expected:
                raise LedgerError(
                    f"Refusing transition from {row['state']} to {state}; expected {expected}"
                )
            connection.execute(
                """
                UPDATE call_intents
                SET state = ?,
                    provider_call_id = COALESCE(?, provider_call_id),
                    disposition = ?,
                    reason_codes_json = ?,
                    result_json = ?,
                    provider_diagnostic = ?,
                    updated_at = ?
                WHERE intent_key = ?
                """,
                (
                    state,
                    provider_call_id,
                    disposition,
                    json.dumps(list(reason_codes), separators=(",", ":")),
                    json.dumps(result, sort_keys=True, separators=(",", ":"))
                    if result is not None
                    else None,
                    provider_diagnostic,
                    now,
                    intent_key,
                ),
            )
            updated = connection.execute(
                "SELECT * FROM call_intents WHERE intent_key = ?", (intent_key,)
            ).fetchone()
            if updated is None:  # pragma: no cover - SQLite invariant
                raise LedgerError("Transitioned record disappeared")
            return _record(updated)


def _record(row: sqlite3.Row) -> LedgerRecord:
    result_raw = row["result_json"]
    result = json.loads(result_raw) if result_raw else None
    reasons = tuple(json.loads(row["reason_codes_json"]))
    return LedgerRecord(
        intent_key=row["intent_key"],
        case_id=row["case_id"],
        checkpoint_id=row["checkpoint_id"],
        preview_digest=row["preview_digest"],
        recipient_masked=row["recipient_masked"],
        state=row["state"],
        provider_call_id=row["provider_call_id"],
        disposition=row["disposition"],
        reason_codes=reasons,
        result=result,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        provider_diagnostic=row["provider_diagnostic"],
    )


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
