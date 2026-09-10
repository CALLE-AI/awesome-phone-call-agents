"""Lightweight SQLite persistence for the disruption -> call -> outcome
record.

Addresses the "No persistence layer" limitation called out in the README:
without this, a crash mid-call loses the fact that a call was ever placed at
all -- nothing downstream would know a traveler might already be mid-call
with an outstanding CALL-E idempotency key. This is intentionally minimal
(one table, stdlib ``sqlite3`` only, no ORM) to match the README's own
framing: "SQLite at minimum".

Usage is two calls around the risky part of ``orchestrator.handle_disruption``:

    store.record_disruption(booking, disruption)   # before placing the call
    ...
    store.record_outcome(disruption, outcome)       # after it resolves

so a row proving "a call was attempted" exists even if the process dies
between those two calls.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

from trip_rescue.models import Booking, DisruptionEvent, RebookingOutcome

_SCHEMA = """
CREATE TABLE IF NOT EXISTS disruption_runs (
    order_id TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    booking_json TEXT NOT NULL,
    outcome_json TEXT,
    call_id TEXT,
    confirmed INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (order_id, detected_at)
);
"""


class RunStore:
    """One row per disruption. ``order_id`` + ``detected_at`` is the same
    pair already used as CALL-E's idempotency key (see calle_client.py), so
    it's reused here rather than inventing a second identity for the same
    event.
    """

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = str(db_path)
        Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)
        conn = self._connect()
        try:
            conn.execute(_SCHEMA)
            conn.commit()
        finally:
            conn.close()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._db_path)

    def record_disruption(self, booking: Booking, disruption: DisruptionEvent) -> None:
        """Write the fact that a call is about to be placed, *before*
        placing it. ``INSERT OR IGNORE`` makes this safe to call again for
        the same (order_id, detected_at) pair -- a retried trigger just
        no-ops here, the same idempotency the CALL-E call itself already
        has.
        """
        conn = self._connect()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO disruption_runs "
                "(order_id, detected_at, reason, source, booking_json) VALUES (?, ?, ?, ?, ?)",
                (
                    disruption.order_id,
                    disruption.detected_at,
                    disruption.reason,
                    disruption.source,
                    json.dumps(asdict(booking)),
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def record_outcome(self, disruption: DisruptionEvent, outcome: RebookingOutcome) -> None:
        """Write the resolved outcome against the matching disruption row.
        Uses ``INSERT OR IGNORE`` first so this still works even if
        ``record_disruption`` was skipped (e.g. the no-options-available
        path, which never places a call) -- the row always ends up with a
        recorded outcome either way.
        """
        conn = self._connect()
        try:
            conn.execute(
                "INSERT OR IGNORE INTO disruption_runs "
                "(order_id, detected_at, reason, source, booking_json) VALUES (?, ?, ?, ?, ?)",
                (disruption.order_id, disruption.detected_at, disruption.reason, disruption.source, "{}"),
            )
            conn.execute(
                "UPDATE disruption_runs SET outcome_json = ?, call_id = ?, confirmed = ? "
                "WHERE order_id = ? AND detected_at = ?",
                (
                    json.dumps(asdict(outcome)),
                    outcome.call_id,
                    1 if outcome.confirmed else 0,
                    disruption.order_id,
                    disruption.detected_at,
                ),
            )
            conn.commit()
        finally:
            conn.close()

    def already_resolved(self, disruption: DisruptionEvent) -> bool:
        """True if this exact disruption (same order_id + detected_at) has a
        recorded outcome already -- lets a caller skip re-running a
        disruption that crashed *after* it actually resolved, on top of the
        idempotency_key CALL-E already dedupes concurrent in-flight calls on.
        """
        return self.get_outcome(disruption) is not None

    def get_outcome(self, disruption: DisruptionEvent) -> dict | None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT outcome_json FROM disruption_runs WHERE order_id = ? AND detected_at = ?",
                (disruption.order_id, disruption.detected_at),
            ).fetchone()
            return json.loads(row[0]) if row and row[0] else None
        finally:
            conn.close()

    def all_runs(self) -> list[dict]:
        """Every recorded run, most recent first -- for a future admin view
        or a crash-recovery sweep ("which disruptions never got an
        outcome?").
        """
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT order_id, detected_at, reason, source, booking_json, outcome_json, call_id, confirmed "
                "FROM disruption_runs ORDER BY created_at DESC"
            ).fetchall()
            return [
                {
                    "order_id": r[0],
                    "detected_at": r[1],
                    "reason": r[2],
                    "source": r[3],
                    "booking": json.loads(r[4]),
                    "outcome": json.loads(r[5]) if r[5] else None,
                    "call_id": r[6],
                    "confirmed": bool(r[7]) if r[7] is not None else None,
                }
                for r in rows
            ]
        finally:
            conn.close()
