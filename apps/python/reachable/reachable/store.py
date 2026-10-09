"""SQLite storage: an append-only event log and the idempotency ledger.

Every transition is reconstructible from this database alone. A webhook can wake
the worker, but it must never be the only record that a call or a business
transition exists (docs/production-workflows.md).

Two things here are append-only and never updated in place: the ``events`` log,
and the ``ledger``. The ledger is the whole duplicate-call protection, and it
outlives the case it guards so that a redelivered result after cleanup cannot
produce a second call.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from .models import IN_FLIGHT_ATTEMPTS, AttemptState, Workflow

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Append-only. Never updated, never deleted.
CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    kind       TEXT NOT NULL,
    case_id    TEXT,
    pupil_id   TEXT,
    contact_id TEXT,
    actor      TEXT NOT NULL DEFAULT 'system',
    reason     TEXT NOT NULL DEFAULT '',
    -- Field NAMES that came back, never their values.
    fields     TEXT NOT NULL DEFAULT '[]'
);

-- The idempotency ledger. A key is reserved BEFORE dialling and never removed.
CREATE TABLE IF NOT EXISTS ledger (
    idempotency_key TEXT PRIMARY KEY,
    workflow        TEXT NOT NULL,
    case_id         TEXT NOT NULL,
    pupil_id        TEXT NOT NULL,
    contact_id      TEXT NOT NULL,
    intent_digest   TEXT NOT NULL,
    reserved_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cases (
    case_id        TEXT PRIMARY KEY,
    workflow       TEXT NOT NULL,
    pupil_id       TEXT NOT NULL,
    contact_id     TEXT NOT NULL DEFAULT '',
    state          TEXT NOT NULL,
    state_since    TEXT NOT NULL,
    trigger_date   TEXT NOT NULL DEFAULT '',
    term_id        TEXT NOT NULL DEFAULT '',
    cascade_index  INTEGER NOT NULL DEFAULT 0,
    detail         TEXT NOT NULL DEFAULT '{}',
    created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS call_attempts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id          TEXT NOT NULL,
    workflow         TEXT NOT NULL,
    pupil_id         TEXT NOT NULL,
    contact_id       TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL UNIQUE,
    destination      TEXT NOT NULL,
    state            TEXT NOT NULL,
    call_id          TEXT,
    disposition      TEXT,
    disposition_reason TEXT NOT NULL DEFAULT '',
    structured_result TEXT,
    transcript       TEXT,
    confidence_score REAL,
    confidence_label TEXT,
    failure_code     TEXT,
    task_text        TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

-- Current health of one contact. Written by BOTH workflows: this is the loop.
CREATE TABLE IF NOT EXISTS contact_health (
    contact_id   TEXT PRIMARY KEY,
    pupil_id     TEXT NOT NULL,
    status       TEXT NOT NULL,
    reason       TEXT NOT NULL DEFAULT '',
    last_checked TEXT,
    source       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS staff_tasks (
    task_id    TEXT PRIMARY KEY,
    pupil_id   TEXT NOT NULL,
    contact_id TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    urgent     INTEGER NOT NULL DEFAULT 0,
    handled    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         TEXT NOT NULL,
    case_id    TEXT NOT NULL DEFAULT '',
    pupil_id   TEXT NOT NULL DEFAULT '',
    contact_id TEXT NOT NULL DEFAULT '',
    reason     TEXT NOT NULL,
    kind       TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_cases_state ON cases(state);
CREATE INDEX IF NOT EXISTS idx_attempts_case ON call_attempts(case_id, state);
CREATE INDEX IF NOT EXISTS idx_events_case ON events(case_id, id);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def to_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False, default=str)


def from_json(raw: str | None, default: Any = None) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def intent_digest(**parts: Any) -> str:
    """A stable digest of the authorised intent, for ledger conflict detection."""
    return hashlib.sha256(to_json(parts).encode("utf-8")).hexdigest()[:32]


class LedgerConflict(RuntimeError):
    """The key is reserved for a different intent.

    Not swallowed: a collision is either a crash-and-replay, which is fine, or
    two different intents colliding, which is a bug. A person decides which.
    """


@dataclass
class Store:
    """Thin SQLite wrapper. All writes serialised; safe across threads."""

    connection: sqlite3.Connection
    _lock: threading.RLock = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self._lock is None:
            self._lock = threading.RLock()

    # ------------------------------------------------------------------ setup

    @classmethod
    def open(cls, path: str | Path) -> "Store":
        target = str(path)
        if target != ":memory:":
            parent = Path(target).parent
            if str(parent):
                parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False because the dashboard serves sync handlers in
        # a threadpool and dispatches blocking SDK calls to worker threads.
        # Serialisation is the lock below, not the connection's thread affinity.
        connection = sqlite3.connect(target, isolation_level=None, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.executescript(SCHEMA)
        return cls(connection=connection)

    def close(self) -> None:
        self.connection.close()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            return self.connection.execute(sql, tuple(params))

    def rows(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        return list(self.execute(sql, params).fetchall())

    def one(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
        return self.execute(sql, params).fetchone()

    # ------------------------------------------------------------ event log

    def record_event(
        self,
        kind: str,
        *,
        reason: str,
        case_id: str = "",
        pupil_id: str = "",
        contact_id: str = "",
        actor: str = "system",
        fields: Iterable[str] = (),
    ) -> None:
        """Append one event. Names the fields that came back, never their values."""
        self.execute(
            """
            INSERT INTO events (at, kind, case_id, pupil_id, contact_id, actor, reason, fields)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (utcnow(), kind, case_id, pupil_id, contact_id, actor, reason, to_json(sorted(fields))),
        )

    def events_for(self, case_id: str) -> list[sqlite3.Row]:
        return self.rows("SELECT * FROM events WHERE case_id = ? ORDER BY id", (case_id,))

    # -------------------------------------------------------------- ledger

    def reserve_key(
        self,
        idempotency_key: str,
        *,
        workflow: Workflow,
        case_id: str,
        pupil_id: str,
        contact_id: str,
        digest: str,
    ) -> bool:
        """Reserve a key before dialling.

        Returns True if newly reserved, False if this exact intent was already
        reserved (a safe replay). Raises :class:`LedgerConflict` if the key is
        held by a *different* intent.
        """
        with self._lock:
            existing = self.one(
                "SELECT * FROM ledger WHERE idempotency_key = ?", (idempotency_key,)
            )
            if existing is not None:
                if existing["intent_digest"] != digest:
                    raise LedgerConflict(
                        f"idempotency key {idempotency_key} is reserved for a different intent"
                    )
                return False
            self.execute(
                """
                INSERT INTO ledger
                    (idempotency_key, workflow, case_id, pupil_id, contact_id,
                     intent_digest, reserved_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    idempotency_key,
                    workflow.value,
                    case_id,
                    pupil_id,
                    contact_id,
                    digest,
                    utcnow(),
                ),
            )
            return True

    def key_reserved(self, idempotency_key: str) -> bool:
        return self.one(
            "SELECT 1 FROM ledger WHERE idempotency_key = ?", (idempotency_key,)
        ) is not None

    # ----------------------------------------------------------- attempts

    def create_attempt(
        self,
        *,
        case_id: str,
        workflow: Workflow,
        pupil_id: str,
        contact_id: str,
        idempotency_key: str,
        destination: str,
        task_text: str,
    ) -> int:
        now = utcnow()
        cursor = self.execute(
            """
            INSERT INTO call_attempts
                (case_id, workflow, pupil_id, contact_id, idempotency_key, destination,
                 state, task_text, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_id,
                workflow.value,
                pupil_id,
                contact_id,
                idempotency_key,
                destination,
                AttemptState.RESERVED.value,
                task_text,
                now,
                now,
            ),
        )
        return int(cursor.lastrowid)

    def update_attempt(self, attempt_id: int, **fields: Any) -> None:
        if not fields:
            return
        payload = {k: (v.value if hasattr(v, "value") else v) for k, v in fields.items()}
        payload["updated_at"] = utcnow()
        assignments = ", ".join(f"{name} = ?" for name in payload)
        self.execute(
            f"UPDATE call_attempts SET {assignments} WHERE id = ?",
            (*payload.values(), attempt_id),
        )

    def attempt(self, attempt_id: int) -> sqlite3.Row | None:
        return self.one("SELECT * FROM call_attempts WHERE id = ?", (attempt_id,))

    def in_flight_for(self, case_id: str) -> list[sqlite3.Row]:
        placeholders = ", ".join("?" for _ in IN_FLIGHT_ATTEMPTS)
        states = sorted(s.value for s in IN_FLIGHT_ATTEMPTS)
        return self.rows(
            f"SELECT * FROM call_attempts WHERE case_id = ? AND state IN ({placeholders})",
            (case_id, *states),
        )

    def unresolved_attempts(self) -> list[sqlite3.Row]:
        """Everything that needs reconciling after a restart. Never re-dialled."""
        states = sorted(
            s.value
            for s in (
                AttemptState.RESERVED,
                AttemptState.SUBMISSION_UNKNOWN,
                AttemptState.ACCEPTED,
                AttemptState.TERMINAL_UNVERIFIED,
            )
        )
        placeholders = ", ".join("?" for _ in states)
        return self.rows(
            f"SELECT * FROM call_attempts WHERE state IN ({placeholders}) ORDER BY id", states
        )

    def attempts_for_contact(self, case_id: str, contact_id: str) -> int:
        row = self.one(
            "SELECT COUNT(*) AS n FROM call_attempts WHERE case_id = ? AND contact_id = ?",
            (case_id, contact_id),
        )
        return int(row["n"]) if row else 0

    # -------------------------------------------------------------- cases

    def upsert_case(
        self,
        case_id: str,
        *,
        workflow: Workflow,
        pupil_id: str,
        state: str,
        contact_id: str = "",
        trigger_date: str = "",
        term_id: str = "",
        cascade_index: int = 0,
        detail: dict[str, Any] | None = None,
    ) -> None:
        now = utcnow()
        existing = self.one("SELECT case_id FROM cases WHERE case_id = ?", (case_id,))
        if existing is None:
            self.execute(
                """
                INSERT INTO cases
                    (case_id, workflow, pupil_id, contact_id, state, state_since,
                     trigger_date, term_id, cascade_index, detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    case_id,
                    workflow.value,
                    pupil_id,
                    contact_id,
                    state,
                    now,
                    trigger_date,
                    term_id,
                    cascade_index,
                    to_json(detail or {}),
                    now,
                ),
            )
            return
        self.execute(
            """
            UPDATE cases
               SET state = ?, state_since = ?, contact_id = ?, cascade_index = ?, detail = ?
             WHERE case_id = ?
            """,
            (state, now, contact_id, cascade_index, to_json(detail or {}), case_id),
        )

    def case(self, case_id: str) -> sqlite3.Row | None:
        return self.one("SELECT * FROM cases WHERE case_id = ?", (case_id,))

    def cases(self, workflow: Workflow | None = None) -> list[sqlite3.Row]:
        if workflow is None:
            return self.rows("SELECT * FROM cases ORDER BY created_at DESC, case_id")
        return self.rows(
            "SELECT * FROM cases WHERE workflow = ? ORDER BY created_at DESC, case_id",
            (workflow.value,),
        )

    def open_case_for_pupil(self, pupil_id: str, exclude: str = "") -> sqlite3.Row | None:
        from .models import PATTERN_TERMINAL

        terminal = sorted(s.value for s in PATTERN_TERMINAL)
        placeholders = ", ".join("?" for _ in terminal)
        return self.one(
            f"""
            SELECT * FROM cases
             WHERE workflow = ? AND pupil_id = ? AND case_id != ?
               AND state NOT IN ({placeholders})
             LIMIT 1
            """,
            (Workflow.PATTERN_FOLLOWUP.value, pupil_id, exclude, *terminal),
        )

    # ----------------------------------------------------- contact health

    def set_contact_health(
        self, contact_id: str, *, pupil_id: str, status: str, reason: str, source: str
    ) -> None:
        """The loop: written by the contact check AND by failed pattern calls."""
        self.execute(
            """
            INSERT INTO contact_health (contact_id, pupil_id, status, reason, last_checked, source)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(contact_id) DO UPDATE SET
                status = excluded.status,
                reason = excluded.reason,
                last_checked = excluded.last_checked,
                source = excluded.source
            """,
            (contact_id, pupil_id, status, reason, utcnow(), source),
        )

    def contact_health(self) -> list[sqlite3.Row]:
        return self.rows("SELECT * FROM contact_health ORDER BY pupil_id, contact_id")

    def health_for(self, contact_id: str) -> sqlite3.Row | None:
        return self.one("SELECT * FROM contact_health WHERE contact_id = ?", (contact_id,))

    # ------------------------------------------------------- staff tasks

    def add_task(
        self,
        task_id: str,
        *,
        pupil_id: str,
        kind: str,
        detail: str,
        contact_id: str = "",
        urgent: bool = False,
    ) -> None:
        self.execute(
            """
            INSERT INTO staff_tasks (task_id, pupil_id, contact_id, kind, detail, urgent,
                                     handled, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?)
            ON CONFLICT(task_id) DO NOTHING
            """,
            (task_id, pupil_id, contact_id, kind, detail, 1 if urgent else 0, utcnow()),
        )

    def tasks(self, *, include_handled: bool = False) -> list[sqlite3.Row]:
        if include_handled:
            return self.rows("SELECT * FROM staff_tasks ORDER BY urgent DESC, created_at DESC")
        return self.rows(
            "SELECT * FROM staff_tasks WHERE handled = 0 ORDER BY urgent DESC, created_at DESC"
        )

    def mark_task_handled(self, task_id: str) -> None:
        self.execute("UPDATE staff_tasks SET handled = 1 WHERE task_id = ?", (task_id,))

    # --------------------------------------------------------- decisions

    def record_decision(
        self,
        reason: str,
        kind: str,
        *,
        case_id: str = "",
        pupil_id: str = "",
        contact_id: str = "",
        detail: str = "",
    ) -> None:
        self.execute(
            """
            INSERT INTO decisions (at, case_id, pupil_id, contact_id, reason, kind, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (utcnow(), case_id, pupil_id, contact_id, reason, kind, detail),
        )

    def decisions(self) -> list[sqlite3.Row]:
        return self.rows("SELECT * FROM decisions ORDER BY id DESC")

    # --------------------------------------------------------- retention

    def purge_transcripts(self, older_than_iso: str) -> int:
        """Delete transcripts past retention; the outcome and disposition remain."""
        cursor = self.execute(
            "UPDATE call_attempts SET transcript = NULL "
            "WHERE transcript IS NOT NULL AND created_at < ?",
            (older_than_iso,),
        )
        return cursor.rowcount or 0
