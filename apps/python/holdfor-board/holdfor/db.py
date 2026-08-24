from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .models import Appointment, Patient

SCHEMA = Path(__file__).with_name("schema.sql")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_path() -> str:
    return os.environ.get("HOLDFOR_DB", "holdfor.db")


def connect(path: str | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(path or default_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# Columns added to a table that already exists. `CREATE TABLE IF NOT EXISTS` does
# nothing to a database that has the table already, so a new column has to be added by
# name — and `init` runs on every start, over ledgers that hold real calls, so each one
# has to be safe to attempt twice.
ADDED_COLUMNS = (("review_item", "answers_from", "TEXT"),)


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    for table, column, kind in ADDED_COLUMNS:
        if column in columns(conn, table):
            continue
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {kind}")
    conn.commit()


def columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def patient(conn: sqlite3.Connection, patient_id: int) -> Patient | None:
    row = conn.execute("SELECT * FROM patient WHERE id = ?", (patient_id,)).fetchone()
    return _patient(row) if row else None


def appointment(conn: sqlite3.Connection, appointment_id: int) -> Appointment | None:
    row = conn.execute(
        "SELECT * FROM appointment WHERE id = ?", (appointment_id,)
    ).fetchone()
    return _appointment(row) if row else None


def _patient(row: sqlite3.Row) -> Patient:
    return Patient(
        id=row["id"],
        first_name=row["first_name"],
        surname=row["surname"],
        dob=row["dob"],
        phone_e164=row["phone_e164"],
        consent_to_call=bool(row["consent_to_call"]),
        created_at=row["created_at"],
    )


def _appointment(row: sqlite3.Row) -> Appointment:
    return Appointment(
        id=row["id"],
        patient_id=row["patient_id"],
        seen_on=row["seen_on"],
        appointment_type=row["appointment_type"],
        medication_changed=bool(row["medication_changed"]),
        followup_booked=bool(row["followup_booked"]),
    )
