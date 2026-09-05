from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from typing import NamedTuple

from . import db
from .window import due_date


class SeedRow(NamedTuple):
    first_name: str
    surname: str
    dob: str
    phone_suffix: str
    consent_to_call: bool
    days_since_seen: int
    appointment_type: str
    medication_changed: bool
    followup_booked: bool


PATIENTS = [
    SeedRow("Margaret", "Ellery", "1941-03-17", "001", True, 3, "Leg ulcer dressing", False, False),
    SeedRow("Alan", "Prewitt", "1938-11-02", "002", True, 3, "Medication review", True, False),
    SeedRow("Joyce", "Hanbury", "1944-06-28", "003", True, 3, "Chest infection", True, False),
    SeedRow("Derek", "Nunnerley", "1936-01-09", "004", True, 3, "Blood pressure review", True, False),
    SeedRow("Sylvia", "Bracewell", "1949-09-21", "005", True, 3, "Post-discharge review", True, False),
    SeedRow("Kenneth", "Foxwell", "1943-04-30", "006", False, 3, "Diabetes review", True, False),
    SeedRow("Doreen", "Ashby", "1940-12-14", "007", False, 3, "Knee pain", False, False),
    SeedRow("Trevor", "Linscott", "1947-07-05", "008", True, 1, "Chest infection", True, False),
    SeedRow("Iris", "Wadlow", "1939-02-23", "009", True, 2, "Medication review", True, False),
    SeedRow("Bernard", "Coleridge", "1945-10-11", "010", True, 4, "Blood pressure review", False, False),
    SeedRow("Pauline", "Mottram", "1942-08-08", "011", True, 6, "Leg ulcer dressing", False, True),
    SeedRow("Stanley", "Ruddock", "1937-05-19", "012", True, 10, "Post-discharge review", False, True),
]


def phone_e164(suffix: str) -> str:
    return f"+447700900{suffix}"


def seed(conn: sqlite3.Connection, today: date | None = None) -> None:
    today = today or date.today()
    stamp = db.now_iso()
    for row in PATIENTS:
        cursor = conn.execute(
            """
            INSERT INTO patient
                (first_name, surname, dob, phone_e164, consent_to_call, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                row.first_name,
                row.surname,
                row.dob,
                phone_e164(row.phone_suffix),
                int(row.consent_to_call),
                stamp,
            ),
        )
        conn.execute(
            """
            INSERT INTO appointment
                (patient_id, seen_on, appointment_type, medication_changed, followup_booked)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                cursor.lastrowid,
                (today - timedelta(days=row.days_since_seen)).isoformat(),
                row.appointment_type,
                int(row.medication_changed),
                int(row.followup_booked),
            ),
        )
    conn.commit()


def due_today(conn: sqlite3.Connection, today: date | None = None) -> list[int]:
    today = today or date.today()
    rows = conn.execute("SELECT id, seen_on FROM appointment ORDER BY id").fetchall()
    return [row["id"] for row in rows if due_date(row["seen_on"]) == today]
