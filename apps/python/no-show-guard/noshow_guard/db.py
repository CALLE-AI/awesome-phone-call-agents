"""SQLite persistence for appointments and call outcomes.

Uses the standard-library :mod:`sqlite3` module (no ORM dependency) with a
``row_factory`` so results come back as dictionaries. Two tables are kept:

``appointments``
    The master list of upcoming appointments (imported from CSV and enriched
    with call outcomes).

``calls``
    One row per outbound call attempt, including the CALL-E ``call_id`` and
    the parsed structured result.

Helper functions here are minimal and focused; orchestration lives in the
application / CLI layer.
"""

from __future__ import annotations

import csv
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator, Optional

from .config import Settings

# Column names expected in the appointments CSV.
CSV_REQUIRED = {"name", "phone", "appointment_datetime", "service"}
# Output outcomes tracked in reports (order matters for the summary).
OUTCOMES = ["confirmed", "rescheduled", "cancelled", "no_answer"]


class Database:
    """Wraps a SQLite database connection with a row factory."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._setup()

    # ------------------------------------------------------------------
    # Connection + schema
    # ------------------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        Path(self.path).parent.mkdir(parents=True, exist_ok=True) if Path(self.path).parent != Path("") else None
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        return conn

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        """Yield a connection as a context manager (auto commit/close)."""
        con = self._connect()
        try:
            yield con
            con.commit()
        finally:
            con.close()

    def _setup(self) -> None:
        with self.conn() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS appointments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    appointment_datetime TEXT NOT NULL,
                    service TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    outcome TEXT,
                    new_datetime TEXT,
                    cancel_reason TEXT,
                    retries INTEGER NOT NULL DEFAULT 0,
                    last_call_at TEXT,
                    call_id TEXT,
                    created_at TEXT NOT NULL,
                    token TEXT
                )
                """
            )
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS calls (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    appointment_id INTEGER NOT NULL,
                    call_id TEXT,
                    attempt INTEGER NOT NULL DEFAULT 1,
                    outcome TEXT NOT NULL,
                    status TEXT,
                    new_datetime TEXT,
                    cancel_reason TEXT,
                    called_at TEXT NOT NULL,
                    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
                )
                """
            )

    # ------------------------------------------------------------------
    # Appointments
    # ------------------------------------------------------------------
    def import_csv(self, csv_path: str) -> int:
        """Load appointments from a CSV, skipping rows that already exist.

        Rows are de-duplicated by ``phone + appointment_datetime``.

        Args:
            csv_path: Path to the appointments CSV.

        Returns:
            The number of newly inserted rows.
        """
        path = Path(csv_path)
        if not path.exists():
            raise FileNotFoundError(f"CSV not found: {path}")

        inserted = 0
        with self.conn() as con:
            existing = {
                (r["phone"], r["appointment_datetime"])
                for r in con.execute("SELECT phone, appointment_datetime FROM appointments")
            }
            with path.open("r", encoding="utf-8-sig") as fh:
                reader = csv.DictReader(fh)
                missing = CSV_REQUIRED - set(reader.fieldnames or [])
                if missing:
                    raise ValueError(f"CSV missing required columns: {sorted(missing)}")
                for row in reader:
                    phone = row["phone"].strip()
                    dt = row["appointment_datetime"].strip()
                    if not phone or not dt:
                        continue
                    if (phone, dt) in existing:
                        continue
                    con.execute(
                        """
                        INSERT INTO appointments
                            (name, phone, appointment_datetime, service, created_at)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            row["name"].strip(),
                            phone,
                            dt,
                            row["service"].strip(),
                            datetime.utcnow().isoformat(timespec="seconds"),
                        ),
                    )
                    existing.add((phone, dt))
                    inserted += 1
        return inserted

    def list_appointments(self, status: Optional[str] = None) -> list[sqlite3.Row]:
        """Return all appointments, optionally filtered by status."""
        with self.conn() as con:
            if status:
                return list(
                    con.execute(
                        "SELECT * FROM appointments WHERE status = ? ORDER BY appointment_datetime",
                        (status,),
                    )
                )
            return list(con.execute("SELECT * FROM appointments ORDER BY appointment_datetime"))

    def get_appointment(self, appointment_id: int) -> Optional[sqlite3.Row]:
        """Return a single appointment by id (or ``None``)."""
        with self.conn() as con:
            row = con.execute(
                "SELECT * FROM appointments WHERE id = ?", (appointment_id,)
            ).fetchone()
            return row

    def mark_pending(self, appointment_id: int) -> None:
        """Set an appointment back to its 'pending' waiting-for-call state."""
        with self.conn() as con:
            con.execute(
                "UPDATE appointments SET status='pending' WHERE id=?",
                (appointment_id,),
            )

    # ------------------------------------------------------------------
    # Call recording
    # ------------------------------------------------------------------
    def record_call(
        self,
        appointment_id: int,
        outcome: str,
        *,
        call_id: str = "",
        status: str = "",
        attempt: int = 1,
        new_datetime: Optional[str] = None,
        cancel_reason: Optional[str] = None,
        adjacent: bool = False,
    ) -> None:
        """Persist a call outcome and update the parent appointment.

        Args:
            appointment_id: The appointment being called.
            outcome: One of the :data:`OUTCOMES`.
            call_id: CALL-E call identifier.
            status: Raw CALL-E call status.
            attempt: Which retry attempt this was (1-based).
            new_datetime: New requested date/time if the customer rescheduled.
            cancel_reason: Reason for cancellation, if provided.
            adjacent: If True, do not bump the appointment's retry counter
                (used when the caller already incremented retries).
        """
        with self.conn() as con:
            con.execute(
                """
                INSERT INTO calls
                    (appointment_id, call_id, attempt, outcome, status,
                     new_datetime, cancel_reason, called_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    appointment_id,
                    call_id,
                    attempt,
                    outcome,
                    status,
                    new_datetime,
                    cancel_reason,
                    datetime.utcnow().isoformat(timespec="seconds"),
                ),
            )

            if outcome == "confirmed":
                new_status = "confirmed"
            elif outcome == "rescheduled":
                new_status = "rescheduled"
            elif outcome == "cancelled":
                new_status = "cancelled"
            elif outcome == "no_answer":
                new_status = "call_failed" if not self._below_max_retries(appointment_id) else "pending_retry"
            else:  # unknown
                new_status = "unknown"

            if not adjacent:
                con.execute(
                    """
                    UPDATE appointments SET
                        status = ?,
                        outcome = ?,
                        new_datetime = ?,
                        cancel_reason = ?,
                        call_id = ?,
                        last_call_at = ?
                    WHERE id = ?
                    """,
                    (
                        new_status,
                        outcome,
                        new_datetime,
                        cancel_reason,
                        call_id,
                        datetime.utcnow().isoformat(timespec="seconds"),
                        appointment_id,
                    ),
                )

    def _below_max_retries(self, appointment_id: int, settings: Optional[Settings] = None) -> bool:
        settings = settings or Settings()
        with self.conn() as con:
            row = con.execute(
                "SELECT retries FROM appointments WHERE id = ?", (appointment_id,)
            ).fetchone()
            return bool(row) and row["retries"] < settings.max_retries

    def should_retry(self, appointment_id: int, settings: Optional[Settings] = None) -> bool:
        """Return True if a ``no_answer`` appointment should be retried.

        Retry eligibility: the appointment is still 'pending_retry', it has
        made fewer than ``max_retries`` calls, and ``retry_hours_apart`` hours
        have elapsed since ``last_call_at``.
        """
        settings = settings or Settings()
        with self.conn() as con:
            row = con.execute(
                "SELECT * FROM appointments WHERE id = ?", (appointment_id,)
            ).fetchone()
            if not row or row["status"] != "pending_retry":
                return False
            if row["retries"] >= settings.max_retries:
                return False
            last = row["last_call_at"]
            if not last:
                return True
            try:
                last_dt = datetime.fromisoformat(last)
            except ValueError:
                return True
            elapsed = datetime.utcnow() - last_dt
            return elapsed.total_seconds() >= settings.retry_hours_apart * 3600

    def record_retry_attempt(self, appointment_id: int) -> int:
        """Increment the retry counter for an appointment.

        Returns:
            The new (1-based) attempt number.
        """
        with self.conn() as con:
            con.execute(
                "UPDATE appointments SET retries = retries + 1 WHERE id = ?",
                (appointment_id,),
            )
            row = con.execute(
                "SELECT retries FROM appointments WHERE id = ?", (appointment_id,)
            ).fetchone()
            attempt = int(row["retries"]) + 1 if row else 1
            return attempt

    def summary_counts(self) -> tuple[int, int, int, int, int]:
        """Return aggregate call counts ``(t, confirmed, resched, cancelled, noanswer)``.

        ``t`` is the total number of call attempts.
        """
        with self.conn() as con:
            total = con.execute("SELECT COUNT(*) FROM calls").fetchone()[0]
            counts = {}
            for outcome in OUTCOMES:
                counts[outcome] = con.execute(
                    "SELECT COUNT(*) FROM calls WHERE outcome = ?", (outcome,)
                ).fetchone()[0]
        return (total, counts["confirmed"], counts["rescheduled"], counts["cancelled"], counts["no_answer"])
