"""
SQLite persistence (stdlib only). Two things are stored:

  - the profile: identity, insurance and family contacts;
  - one `bookings` row per submitted request: where it is in the workflow, the
    proposal the user was asked to approve, and how it ended.

There is no login. A "user" is a UUID the browser generates once and keeps in
localStorage (static/app.js, getUserId()), sent with every request. That keeps
a profile across visits on one browser; it is not multi-device identity.

The signcall workflow server keeps runs in memory only, so a cancellation sends
the booking's stored `result` (clinic contact, interpreter, slot) back to it.
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

DB_PATH = "data/app.db"


def get_conn():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS profiles (
            user_id         TEXT PRIMARY KEY,
            name            TEXT,
            phone           TEXT,
            age             INTEGER,
            dob             TEXT,
            address         TEXT,
            zipcode         TEXT,
            insurance_name  TEXT,
            insurance_id    TEXT,
            family_json     TEXT NOT NULL DEFAULT '[]',
            created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bookings (
            run_id             TEXT PRIMARY KEY,
            user_id            TEXT,
            status             TEXT NOT NULL DEFAULT 'running',
            proposal_json      TEXT,
            result_json        TEXT,
            error              TEXT,
            reason             TEXT,
            cancellation_json  TEXT,
            created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def save_profile(user_id: str, profile: dict):
    conn = get_conn()
    conn.execute("""
        INSERT INTO profiles
            (user_id, name, phone, age, dob, address, zipcode, insurance_name, insurance_id, family_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            name=excluded.name, phone=excluded.phone, age=excluded.age, dob=excluded.dob, address=excluded.address,
            zipcode=excluded.zipcode, insurance_name=excluded.insurance_name,
            insurance_id=excluded.insurance_id,
            family_json=excluded.family_json, updated_at=CURRENT_TIMESTAMP
    """, (
        user_id,
        profile.get("name"), profile.get("phone"), profile.get("age"), profile.get("dob"), profile.get("address"),
        profile.get("zipcode"), profile.get("insurance_name"), profile.get("insurance_id"),
        json.dumps(profile.get("family", [])),
    ))
    conn.commit()
    conn.close()


def get_profile(user_id: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d["family"] = json.loads(d.pop("family_json") or "[]")
    return d


# --- bookings ---------------------------------------------------------------
#
# status: running -> awaiting_confirmation -> running -> succeeded | declined | failed
#         succeeded -> cancelling -> cancelled | cancel_failed (user-initiated only)
#
# Workflow notifications can arrive before /submit-booking has recorded who
# the run belongs to, so every write is an upsert on run_id that never rolls a
# run backwards.

@contextmanager
def _transaction():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def register_booking(run_id: str, user_id: str):
    """Links a run to the browser that submitted it. Idempotent."""
    with _transaction() as conn:
        conn.execute("""
            INSERT INTO bookings (run_id, user_id) VALUES (?, ?)
            ON CONFLICT(run_id) DO UPDATE SET user_id=excluded.user_id, updated_at=CURRENT_TIMESTAMP
        """, (run_id, user_id))


def record_proposal(run_id: str, proposal: dict):
    """The workflow is asking the user to approve `proposal`. Ignored if the
    run has already ended, so a late duplicate can't reopen it."""
    with _transaction() as conn:
        conn.execute("""
            INSERT INTO bookings (run_id, status, proposal_json)
            VALUES (?, 'awaiting_confirmation', ?)
            ON CONFLICT(run_id) DO UPDATE SET
                status='awaiting_confirmation', proposal_json=excluded.proposal_json,
                updated_at=CURRENT_TIMESTAMP
            WHERE bookings.status IN ('running', 'awaiting_confirmation')
        """, (run_id, json.dumps(proposal)))


def record_outcome(run_id: str, status: str, result=None, error=None, reason=None):
    """How the run ended: succeeded, declined or failed."""
    with _transaction() as conn:
        conn.execute("""
            INSERT INTO bookings (run_id, status, result_json, error, reason)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET
                status=excluded.status, result_json=excluded.result_json,
                error=excluded.error, reason=excluded.reason, updated_at=CURRENT_TIMESTAMP
        """, (run_id, status, json.dumps(result) if result is not None else None, error, reason))


def resolve_confirmation(run_id: str, approved: bool):
    """The user answered. Only moves a run that is still awaiting an answer."""
    with _transaction() as conn:
        conn.execute("""
            UPDATE bookings SET status=?, updated_at=CURRENT_TIMESTAMP
            WHERE run_id=? AND status='awaiting_confirmation'
        """, ("running" if approved else "declined", run_id))


def record_cancelling(run_id: str):
    """The user asked to cancel; the workflow is placing the cancel calls now.
    Only a succeeded booking, or one whose earlier cancel failed, can move."""
    with _transaction() as conn:
        conn.execute("""
            UPDATE bookings SET status='cancelling', updated_at=CURRENT_TIMESTAMP
            WHERE run_id=? AND status IN ('succeeded', 'cancel_failed')
        """, (run_id,))


def record_cancellation(run_id: str, status: str, cancellation=None, error=None):
    """How the cancellation ended: cancelled or cancel_failed."""
    with _transaction() as conn:
        conn.execute("""
            UPDATE bookings SET status=?, cancellation_json=?, error=?, updated_at=CURRENT_TIMESTAMP
            WHERE run_id=? AND status='cancelling'
        """, (status, json.dumps(cancellation) if cancellation is not None else None, error, run_id))


def _decode_booking(row) -> dict:
    booking = dict(row)
    proposal, result = booking.pop("proposal_json"), booking.pop("result_json")
    cancellation = booking.pop("cancellation_json")
    booking["proposal"] = json.loads(proposal) if proposal else None
    booking["result"] = json.loads(result) if result else None
    booking["cancellation"] = json.loads(cancellation) if cancellation else None
    return booking


def get_booking(run_id: str):
    conn = get_conn()
    row = conn.execute("SELECT * FROM bookings WHERE run_id = ?", (run_id,)).fetchone()
    conn.close()
    return _decode_booking(row) if row else None


def list_upcoming(user_id: str, now: "datetime | None" = None) -> list[dict]:
    """This browser's bookings that are still on the books ('succeeded', or
    'cancel_failed' because the cancel did not go through) and start in the
    future, soonest first."""
    now = now or datetime.now()
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM bookings WHERE user_id = ? AND status IN ('succeeded', 'cancel_failed')",
        (user_id,),
    ).fetchall()
    conn.close()

    upcoming = []
    for row in rows:
        booking = _decode_booking(row)
        slot = (booking["result"] or {}).get("appointment_slot") or {}
        try:
            starts = datetime.fromisoformat(f"{slot['date']}T{slot['time']}")
        except (KeyError, ValueError):
            continue  # no readable slot: nothing to sort or show it by
        if starts >= now:
            upcoming.append((starts, booking))
    upcoming.sort(key=lambda pair: pair[0])
    return [booking for _, booking in upcoming]
