import sqlite3
import json
from config import DB_PATH, mask_phone, encrypt_field, decrypt_field


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
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
            contact_consent INTEGER DEFAULT 0,
            contact_consent_at TEXT,
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
            quality_status TEXT DEFAULT '',
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
    _migrate_quality_status(conn)
    _migrate_contact_consent(conn)


def _migrate_contact_consent(conn):
    cols = [r[1] for r in conn.execute("PRAGMA table_info(candidates)").fetchall()]
    if "contact_consent" not in cols:
        conn.execute("ALTER TABLE candidates ADD COLUMN contact_consent INTEGER DEFAULT 0")
        conn.execute("ALTER TABLE candidates ADD COLUMN contact_consent_at TEXT")
        conn.commit()


def _migrate_quality_status(conn):
    cols = [r[1] for r in conn.execute("PRAGMA table_info(calls)").fetchall()]
    if "quality_status" not in cols:
        conn.execute("ALTER TABLE calls ADD COLUMN quality_status TEXT DEFAULT ''")
        conn.commit()


def add_candidate(name: str, role_title: str) -> int:
    conn = _connect()
    cursor = conn.execute(
        "INSERT INTO candidates (name, role_title) VALUES (?, ?)",
        (name, role_title),
    )
    conn.commit()
    return cursor.lastrowid


def record_candidate_consent(candidate_id: int) -> bool:
    conn = _connect()
    cursor = conn.execute(
        "UPDATE candidates SET contact_consent = 1, contact_consent_at = datetime('now') "
        "WHERE id = ?",
        (candidate_id,),
    )
    conn.commit()
    return cursor.rowcount > 0


def has_candidate_consent(candidate_id: int) -> bool:
    conn = _connect()
    row = conn.execute(
        "SELECT contact_consent FROM candidates WHERE id = ?",
        (candidate_id,),
    ).fetchone()
    return bool(row and row[0])


def get_candidate(candidate_id: int) -> dict:
    conn = _connect()
    row = conn.execute("SELECT * FROM candidates WHERE id = ?", (candidate_id,)).fetchone()
    return dict(row) if row else None


def get_all_candidates() -> list[dict]:
    conn = _connect()
    rows = conn.execute("SELECT * FROM candidates ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


def add_reference(candidate_id: int, name: str, phone: str, relation: str,
                  region: str = "IN", locale: str = "en-IN") -> int:
    conn = _connect()
    stored_phone = encrypt_field(phone)
    cursor = conn.execute(
        "INSERT INTO refs (candidate_id, name, phone, relation, region, locale) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (candidate_id, name, stored_phone, relation, region, locale),
    )
    conn.commit()
    return cursor.lastrowid


def get_references(candidate_id: int) -> list[dict]:
    """Returns references with masked phones (for display/logging)."""
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM refs WHERE candidate_id = ? ORDER BY id", (candidate_id,)
    ).fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["phone"] = mask_phone(decrypt_field(d["phone"]))
        results.append(d)
    return results


def get_references_for_calling(candidate_id: int) -> list[dict]:
    """Returns references with real decrypted phones (for live calls only)."""
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM refs WHERE candidate_id = ? ORDER BY id", (candidate_id,)
    ).fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["phone"] = decrypt_field(d["phone"])
        results.append(d)
    return results


def save_call(ref_id: int, candidate_id: int, calle_call_id: str,
              status: str, scores: dict, strengths: list, growth_areas: list,
              overall_recommendation: str, key_quotes: list, summary: str,
              transcript: str = "", quality_status: str = "") -> int:
    conn = _connect()
    stored_transcript = encrypt_field(transcript) if transcript else ""
    cursor = conn.execute(
        "INSERT INTO calls (ref_id, candidate_id, calle_call_id, status, quality_status, "
        "collaboration_score, technical_ability_score, reliability_score, "
        "communication_score, leadership_score, strengths, growth_areas, "
        "overall_recommendation, key_quotes, summary, transcript) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (ref_id, candidate_id, calle_call_id, status, quality_status,
         scores.get("collaboration", 0), scores.get("technical_ability", 0),
         scores.get("reliability", 0), scores.get("communication", 0),
         scores.get("leadership", 0),
         json.dumps(strengths), json.dumps(growth_areas),
         overall_recommendation, json.dumps(key_quotes), summary,
         stored_transcript),
    )
    conn.commit()
    return cursor.lastrowid


def get_calls_for_candidate(candidate_id: int) -> list[dict]:
    conn = _connect()
    rows = conn.execute(
        "SELECT c.*, r.name as ref_name, r.relation as ref_relation "
        "FROM calls c JOIN refs r ON c.ref_id = r.id "
        "WHERE c.candidate_id = ? ORDER BY c.id",
        (candidate_id,),
    ).fetchall()

    results = []
    for r in rows:
        d = dict(r)
        for field in ("strengths", "growth_areas", "key_quotes"):
            if d.get(field):
                try:
                    d[field] = json.loads(d[field])
                except (json.JSONDecodeError, TypeError):
                    pass
        if d.get("transcript"):
            d["transcript"] = decrypt_field(d["transcript"])
        results.append(d)
    return results


def count_calls_for_ref(ref_id: int) -> int:
    conn = _connect()
    row = conn.execute("SELECT COUNT(*) FROM calls WHERE ref_id = ?", (ref_id,)).fetchone()
    return row[0] if row else 0


def count_confirmed_failures_for_ref(ref_id: int) -> int:
    conn = _connect()
    row = conn.execute(
        "SELECT COUNT(*) FROM calls WHERE ref_id = ? "
        "AND quality_status IN ('wrong_person', 'no_consent')",
        (ref_id,),
    ).fetchone()
    return row[0] if row else 0


def get_last_call_id_for_ref(ref_id: int) -> str | None:
    conn = _connect()
    row = conn.execute(
        "SELECT calle_call_id FROM calls WHERE ref_id = ? ORDER BY id DESC LIMIT 1",
        (ref_id,),
    ).fetchone()
    return row[0] if row else None


def get_call_status_for_ref(ref_id: int) -> str | None:
    conn = _connect()
    row = conn.execute(
        "SELECT quality_status FROM calls WHERE ref_id = ? ORDER BY id DESC LIMIT 1",
        (ref_id,),
    ).fetchone()
    return row[0] if row else None


def get_completed_call_ids(candidate_id: int) -> set:
    conn = _connect()
    rows = conn.execute(
        "SELECT calle_call_id FROM calls WHERE candidate_id = ? AND status = 'completed'",
        (candidate_id,),
    ).fetchall()
    return {r[0] for r in rows if r[0]}


def get_refs_by_quality(candidate_id: int, statuses: set) -> set:
    conn = _connect()
    placeholders = ",".join("?" for _ in statuses)
    rows = conn.execute(
        f"SELECT c.ref_id FROM calls c "
        f"WHERE c.candidate_id = ? AND c.quality_status IN ({placeholders})",
        (candidate_id, *statuses),
    ).fetchall()
    return {r[0] for r in rows}


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
    return cursor.lastrowid


def get_analysis(candidate_id: int) -> dict:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM analysis WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1",
        (candidate_id,),
    ).fetchone()

    if not row:
        return None
    d = dict(row)
    if d.get("discrepancies"):
        try:
            d["discrepancies"] = json.loads(d["discrepancies"])
        except (json.JSONDecodeError, TypeError):
            pass
    return d
