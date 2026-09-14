"""Lightweight SQLite persistence layer for SmartRent Maintenance Coordinator.

Zero-dependency persistence using Python's built-in sqlite3 module.
Ensures maintenance requests, call records, and timeline audit logs
persist reliably across application restarts.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from typing import Optional

from app.models import MaintenanceRequest

logger = logging.getLogger(__name__)

DEFAULT_DB_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_DB_PATH = DEFAULT_DB_DIR / "smartrent.db"


def _get_connection(db_path: Optional[Path | str] = None) -> sqlite3.Connection:
    target = Path(db_path) if db_path else DEFAULT_DB_PATH
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path: Optional[Path | str] = None) -> None:
    """Initialize the SQLite schema."""
    with _get_connection(db_path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS maintenance_requests (
                id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.commit()
    logger.info("SQLite persistence database initialized")


def save_request(req: MaintenanceRequest, db_path: Optional[Path | str] = None) -> None:
    """Insert or update a maintenance request record."""
    payload_json = req.model_dump_json()
    with _get_connection(db_path) as conn:
        conn.execute("""
            INSERT INTO maintenance_requests (id, data, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                data = excluded.data,
                updated_at = excluded.updated_at
        """, (
            req.id,
            payload_json,
            req.created_at.isoformat(),
            req.updated_at.isoformat()
        ))
        conn.commit()


def get_request(req_id: str, db_path: Optional[Path | str] = None) -> Optional[MaintenanceRequest]:
    """Retrieve a single maintenance request by ID."""
    with _get_connection(db_path) as conn:
        cur = conn.execute("SELECT data FROM maintenance_requests WHERE id = ?", (req_id,))
        row = cur.fetchone()
        if not row:
            return None
        return MaintenanceRequest.model_validate_json(row["data"])


def list_requests(db_path: Optional[Path | str] = None) -> list[MaintenanceRequest]:
    """Retrieve all maintenance requests ordered by creation time descending."""
    with _get_connection(db_path) as conn:
        cur = conn.execute("SELECT data FROM maintenance_requests ORDER BY created_at DESC")
        rows = cur.fetchall()
        return [MaintenanceRequest.model_validate_json(r["data"]) for r in rows]
