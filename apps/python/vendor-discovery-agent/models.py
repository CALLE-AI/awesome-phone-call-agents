from __future__ import annotations

import sqlite3
import json
from dataclasses import dataclass, field
from typing import Optional
from pathlib import Path

DB_PATH = Path(__file__).parent / "vendor_discovery.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _migrate(conn):
    """Add new columns to existing DBs without breaking old ones."""
    cols_c = {r[1] for r in conn.execute("PRAGMA table_info(campaigns)").fetchall()}
    cols_l = {r[1] for r in conn.execute("PRAGMA table_info(leads)").fetchall()}
    cols_s = {r[1] for r in conn.execute("PRAGMA table_info(scheduled_calls)").fetchall()}
    for col, defn in [("consent_basis", "TEXT DEFAULT 'client-reviewed-and-approved'"),
                      ("consent_approved_at", "TEXT"),
                      ("persona_name", "TEXT"), ("persona_tone", "TEXT")]:
        if col not in cols_c:
            conn.execute(f"ALTER TABLE campaigns ADD COLUMN {col} {defn}")
    for col, defn in [("masked_phone", "TEXT"), ("candidate_id", "TEXT"),
                      ("skip_reason", "TEXT"), ("address", "TEXT"),
                      ("retry_count", "INTEGER DEFAULT 0"), ("lead_score", "REAL"),
                      ("score_reasons", "TEXT")]:
        if col not in cols_l:
            conn.execute(f"ALTER TABLE leads ADD COLUMN {col} {defn}")
    for col, defn in [("region", "TEXT"), ("language", "TEXT")]:
        if col not in cols_s:
            conn.execute(f"ALTER TABLE scheduled_calls ADD COLUMN {col} {defn}")


def init_db():
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_description TEXT NOT NULL,
            location TEXT NOT NULL,
            goal_script TEXT,
            consent_basis TEXT DEFAULT 'client-reviewed-and-approved',
            consent_approved_at TEXT,
            persona_name TEXT,
            persona_tone TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
            name TEXT,
            phone TEXT NOT NULL,
            masked_phone TEXT,
            category TEXT,
            source TEXT DEFAULT 'openstreetmap',
            candidate_id TEXT,
            skip_reason TEXT,
            consent_basis TEXT DEFAULT 'client-reviewed-and-approved',
            lat REAL,
            lon REAL,
            osm_id TEXT,
            status TEXT DEFAULT 'not_called',
            round1_call_id TEXT,
            round2_call_id TEXT,
            retry_count INTEGER DEFAULT 0,
            lead_score REAL,
            score_reasons TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS call_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL REFERENCES leads(id),
            call_id TEXT,
            round INTEGER NOT NULL,
            timestamp TEXT DEFAULT (datetime('now')),
            raw_status_output TEXT,
            extracted_fields TEXT
        );

        CREATE TABLE IF NOT EXISTS scheduled_calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL REFERENCES leads(id),
            campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
            scheduled_at TEXT NOT NULL,
            timezone TEXT DEFAULT 'UTC',
            status TEXT DEFAULT 'pending',
            round INTEGER DEFAULT 2,
            goal_script TEXT,
            region TEXT,
            language TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER REFERENCES leads(id),
            campaign_id INTEGER REFERENCES campaigns(id),
            phone TEXT,
            body TEXT,
            provider TEXT DEFAULT 'mock',
            status TEXT DEFAULT 'sent',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            goal_script TEXT,
            persona_name TEXT,
            persona_tone TEXT DEFAULT 'professional',
            region TEXT,
            language TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_scheduled_status_at
        ON scheduled_calls(status, scheduled_at);
        """)
        _migrate(conn)


def _mask_phone(phone: str) -> str:
    digits = "".join(c for c in phone if c.isdigit() or c == "+")
    if len(digits) >= 6:
        return digits[:3] + "****" + digits[-3:]
    return "***"


@dataclass
class Campaign:
    product_description: str
    location: str
    goal_script: Optional[str] = None
    consent_basis: str = "client-reviewed-and-approved"
    consent_approved_at: Optional[str] = None
    id: Optional[int] = None

    def save(self, conn):
        if self.id:
            conn.execute(
                """UPDATE campaigns SET consent_basis=?, consent_approved_at=?, goal_script=? WHERE id=?""",
                (self.consent_basis, self.consent_approved_at, self.goal_script, self.id)
            )
        else:
            cur = conn.execute(
                """INSERT INTO campaigns (product_description, location, goal_script,
                   consent_basis, consent_approved_at)
                   VALUES (?,?,?,?,?)""",
                (self.product_description, self.location, self.goal_script,
                 self.consent_basis, self.consent_approved_at)
            )
            self.id = cur.lastrowid
        return self


def save_template(name: str, goal_script: str = None, persona_name: str = None,
                  persona_tone: str = "professional", region: str = None,
                  language: str = None) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO templates (name, goal_script, persona_name, persona_tone, region, language)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(name) DO UPDATE SET
               goal_script=excluded.goal_script, persona_name=excluded.persona_name,
               persona_tone=excluded.persona_tone, region=excluded.region,
               language=excluded.language""",
            (name, goal_script, persona_name, persona_tone, region, language)
        )
        conn.commit()
        return cur.lastrowid


def load_template(name: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM templates WHERE name=?", (name,)).fetchone()
        return dict(row) if row else None


def list_templates() -> list:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM templates ORDER BY name").fetchall()
        return [dict(r) for r in rows]


@dataclass
class Lead:
    phone: str
    campaign_id: int
    name: Optional[str] = None
    category: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    osm_id: Optional[str] = None
    candidate_id: Optional[str] = None
    skip_reason: Optional[str] = None
    address: Optional[str] = None
    status: str = "not_called"
    lead_score: Optional[float] = None
    id: Optional[int] = None

    @property
    def masked_phone(self) -> str:
        return _mask_phone(self.phone)

    def save(self, conn):
        if self.id:
            # Deliberately does NOT touch round1_call_id/round2_call_id — this
            # dataclass never carries them, so overwriting always nulled out
            # whatever the calling pipeline had already recorded for a lead.
            conn.execute(
                "UPDATE leads SET status=?, skip_reason=? WHERE id=?",
                (self.status, self.skip_reason, self.id)
            )
        else:
            cur = conn.execute(
                """INSERT INTO leads (campaign_id, name, phone, masked_phone, category,
                   lat, lon, osm_id, candidate_id, skip_reason, address)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (self.campaign_id, self.name, self.phone, self.masked_phone, self.category,
                 self.lat, self.lon, self.osm_id, self.candidate_id, self.skip_reason,
                 self.address)
            )
            self.id = cur.lastrowid
        return self
