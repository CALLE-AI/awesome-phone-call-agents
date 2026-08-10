import sqlite3
import json
from config import DB_PATH


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = _connect()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role_title TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS refs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL REFERENCES candidates(id),
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            relation TEXT NOT NULL,
            region TEXT DEFAULT 'IN',
            locale TEXT DEFAULT 'en-IN',
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS calls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ref_id INTEGER NOT NULL REFERENCES refs(id),
            candidate_id INTEGER NOT NULL REFERENCES candidates(id),
            calle_call_id TEXT,
            status TEXT DEFAULT 'pending',
            collaboration_score INTEGER,
            technical_ability_score INTEGER,
            reliability_score INTEGER,
            communication_score INTEGER,
            leadership_score INTEGER,
            strengths TEXT,
            growth_areas TEXT,
            overall_recommendation TEXT,
            key_quotes TEXT,
            summary TEXT,
            transcript TEXT,
            raw_result TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_id INTEGER NOT NULL REFERENCES candidates(id),
            discrepancies TEXT,
            overall_summary TEXT,
            hire_recommendation TEXT,
            confidence_score INTEGER,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.close()


def add_candidate(name: str, role_title: str) -> int:
    conn = _connect()
    cursor = conn.execute(
        "INSERT INTO candidates (name, role_title) VALUES (?, ?)",
        (name, role_title),
    )
    conn.commit()
    cid = cursor.lastrowid
    conn.close()
    return cid


def get_candidate(candidate_id: int) -> dict:
    conn = _connect()
    row = conn.execute("SELECT * FROM candidates WHERE id = ?", (candidate_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def get_all_candidates() -> list[dict]:
    conn = _connect()
    rows = conn.execute("SELECT * FROM candidates ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]


def add_reference(candidate_id: int, name: str, phone: str, relation: str,
                  region: str = "IN", locale: str = "en-IN") -> int:
    conn = _connect()
    cursor = conn.execute(
        "INSERT INTO refs (candidate_id, name, phone, relation, region, locale) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (candidate_id, name, phone, relation, region, locale),
    )
    conn.commit()
    rid = cursor.lastrowid
    conn.close()
    return rid


def get_references(candidate_id: int) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM refs WHERE candidate_id = ? ORDER BY id", (candidate_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def save_call(ref_id: int, candidate_id: int, calle_call_id: str,
              status: str, scores: dict, strengths: list, growth_areas: list,
              overall_recommendation: str, key_quotes: list, summary: str,
              transcript: str = "", raw_result: dict = None) -> int:
    conn = _connect()
    cursor = conn.execute(
        "INSERT INTO calls (ref_id, candidate_id, calle_call_id, status, "
        "collaboration_score, technical_ability_score, reliability_score, "
        "communication_score, leadership_score, strengths, growth_areas, "
        "overall_recommendation, key_quotes, summary, transcript, raw_result) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ref_id, candidate_id, calle_call_id, status,
         scores.get("collaboration", 0), scores.get("technical_ability", 0),
         scores.get("reliability", 0), scores.get("communication", 0),
         scores.get("leadership", 0),
         json.dumps(strengths), json.dumps(growth_areas),
         overall_recommendation, json.dumps(key_quotes), summary,
         transcript, json.dumps(raw_result) if raw_result else None),
    )
    conn.commit()
    call_id = cursor.lastrowid
    conn.close()
    return call_id


def get_calls_for_candidate(candidate_id: int) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        "SELECT c.*, r.name as ref_name, r.relation as ref_relation "
        "FROM calls c JOIN refs r ON c.ref_id = r.id "
        "WHERE c.candidate_id = ? ORDER BY c.id",
        (candidate_id,),
    ).fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        for field in ("strengths", "growth_areas", "key_quotes", "raw_result"):
            if d.get(field):
                try:
                    d[field] = json.loads(d[field])
                except (json.JSONDecodeError, TypeError):
                    pass
        results.append(d)
    return results


def save_analysis(candidate_id: int, discrepancies: list, overall_summary: str,
                  hire_recommendation: str, confidence_score: int) -> int:
    conn = _connect()
    cursor = conn.execute(
        "INSERT INTO analysis (candidate_id, discrepancies, overall_summary, "
        "hire_recommendation, confidence_score) VALUES (?, ?, ?, ?, ?)",
        (candidate_id, json.dumps(discrepancies), overall_summary,
         hire_recommendation, confidence_score),
    )
    conn.commit()
    aid = cursor.lastrowid
    conn.close()
    return aid


def get_analysis(candidate_id: int) -> dict:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM analysis WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1",
        (candidate_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    if d.get("discrepancies"):
        try:
            d["discrepancies"] = json.loads(d["discrepancies"])
        except (json.JSONDecodeError, TypeError):
            pass
    return d
