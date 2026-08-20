from __future__ import annotations

import sqlite3

import pytest

from holdfor import db
from holdfor.seed import PATIENTS

TABLES = {"patient", "appointment", "call_attempt", "review_item", "release"}


def test_five_tables_exist(conn):
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    assert TABLES <= {row["name"] for row in rows}


def test_twelve_patients_with_ofcom_reserved_numbers(conn):
    rows = conn.execute("SELECT phone_e164, consent_to_call FROM patient").fetchall()
    assert len(rows) == 12 == len(PATIENTS)
    assert all(row["phone_e164"].startswith("+447700900") for row in rows)
    assert all(len(row["phone_e164"]) == 13 for row in rows)


def test_at_least_two_patients_withhold_consent(conn):
    refusers = conn.execute(
        "SELECT COUNT(*) AS n FROM patient WHERE consent_to_call = 0"
    ).fetchone()["n"]
    assert refusers >= 2


def test_at_least_four_appointments_changed_medication(conn):
    changed = conn.execute(
        "SELECT COUNT(*) AS n FROM appointment WHERE medication_changed = 1"
    ).fetchone()["n"]
    assert changed >= 4


def test_some_appointments_are_due_today_and_some_are_not(conn, today):
    from holdfor.seed import due_today

    due = due_today(conn, today=today)
    total = conn.execute("SELECT COUNT(*) AS n FROM appointment").fetchone()["n"]
    assert 0 < len(due) < total


def test_idempotency_key_is_unique_in_the_schema_not_just_the_code(conn):
    stamp = db.now_iso()
    values = (1, "checkin", "checkin:1", "reserved", stamp, stamp)
    columns = (
        "appointment_id, kind, idempotency_key, state, created_at, updated_at"
    )
    conn.execute(f"INSERT INTO call_attempt ({columns}) VALUES (?, ?, ?, ?, ?, ?)", values)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(f"INSERT INTO call_attempt ({columns}) VALUES (?, ?, ?, ?, ?, ?)", values)
