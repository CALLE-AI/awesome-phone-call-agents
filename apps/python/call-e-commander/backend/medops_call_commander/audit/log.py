import logging
import os
import sqlite3
from dataclasses import asdict
from datetime import datetime
from typing import List

from ..core.models import AuditEntry

logger = logging.getLogger(__name__)


class AuditLog:
    """
    Immutable append-only audit log backed by SQLite.
    Designed to meet HIPAA compliance requirements for audit controls (45 CFR § 164.312(1)(b)).

    Rules:
    - append() only — no update, no delete
    - Never stores PHI: no phone numbers, names, balances, transcript content
    - Every CallPlan state transition must be logged before the state changes
    """

    def __init__(self, db_path: str = "medops_audit.db") -> None:
        self.db_path = db_path
        self._init_db()

    def _get_connection(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self._get_connection() as conn:
            # Enable WAL mode for better concurrency and durability
            conn.execute('PRAGMA journal_mode=WAL;')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    agent_type TEXT,
                    admin_id TEXT,
                    reason TEXT,
                    timestamp TEXT NOT NULL
                )
            ''')
            conn.commit()
            
        # Enforce strict file permissions for HIPAA compliance (read/write by owner only)
        if os.name == 'posix' and os.path.exists(self.db_path):
            os.chmod(self.db_path, 0o600)

    def append(self, entry: AuditEntry) -> None:
        """Write an audit entry. Raises if PHI fields are detected."""
        self._check_no_phi(entry)
        
        with self._get_connection() as conn:
            conn.execute('''
                INSERT INTO audit_log (plan_id, action, agent_type, admin_id, reason, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                entry.plan_id,
                entry.action,
                entry.agent_type,
                entry.admin_id,
                entry.reason,
                entry.timestamp.isoformat()
            ))
            conn.commit()

        logger.info(
            "AUDIT plan_id=%s action=%s admin=%s ts=%s",
            entry.plan_id,
            entry.action,
            entry.admin_id or "system",
            entry.timestamp.isoformat(),
        )

    def _row_to_entry(self, row) -> AuditEntry:
        return AuditEntry(
            plan_id=row[1],
            action=row[2],
            agent_type=row[3],
            admin_id=row[4],
            reason=row[5],
            timestamp=datetime.fromisoformat(row[6])
        )

    def get(self, plan_id: str) -> List[AuditEntry]:
        """Return all entries for a given plan_id."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                'SELECT * FROM audit_log WHERE plan_id = ? ORDER BY timestamp ASC',
                (plan_id,)
            )
            return [self._row_to_entry(row) for row in cursor.fetchall()]

    def all(self) -> List[AuditEntry]:
        """Return full log. Read-only."""
        with self._get_connection() as conn:
            cursor = conn.execute('SELECT * FROM audit_log ORDER BY timestamp ASC')
            return [self._row_to_entry(row) for row in cursor.fetchall()]

    @staticmethod
    def _check_no_phi(entry: AuditEntry) -> None:
        """
        Lightweight guard: rejects entries whose reason field
        contains patterns that look like phone numbers or emails.
        Full PHI scanning handled at the adapter layer.
        """
        suspicious = ["+1", "@", "dob:", "ssn:", "balance:"]
        reason = (entry.reason or "").lower()
        for pattern in suspicious:
            if pattern in reason:
                raise ValueError(
                    f"AuditEntry.reason appears to contain PHI (matched '{pattern}'). "
                    f"Strip PHI before logging."
                )
