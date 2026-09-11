import sqlite3
from datetime import datetime

DB_NAME = "jobradar.db"


def get_connection():
    return sqlite3.connect(DB_NAME)


def init_db():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS discovered_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_name TEXT NOT NULL,
            job_title TEXT,
            hiring_status TEXT,
            salary_min INTEGER,
            salary_max INTEGER,
            shift TEXT,
            experience_required TEXT,
            joining_timeline TEXT,
            verification_status TEXT,
            created_at TEXT,
            UNIQUE(
                business_name,
                job_title,
                hiring_status,
                salary_min,
                salary_max,
                shift,
                joining_timeline
            )
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS interested_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_name TEXT,
            business_name TEXT NOT NULL,
            job_title TEXT NOT NULL,
            created_at TEXT,
            UNIQUE(
                candidate_name,
                business_name,
                job_title
            )
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS call_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_name TEXT NOT NULL,
            masked_phone TEXT,
            idempotency_key TEXT UNIQUE,
            status TEXT,
            attempt INTEGER,
            outcome TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS candidate_consents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_name TEXT,
            business_name TEXT NOT NULL,
            job_title TEXT NOT NULL,
            consent_status TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(
                candidate_name,
                business_name,
                job_title
            )
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS employer_followups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_name TEXT,
            business_name TEXT NOT NULL,
            job_title TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT,
            UNIQUE(
                candidate_name,
                business_name,
                job_title
            )
        )
    """)

    conn.commit()
    conn.close()


def save_discovered_job(result: dict):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT OR IGNORE INTO discovered_jobs (
                business_name,
                job_title,
                hiring_status,
                salary_min,
                salary_max,
                shift,
                experience_required,
                joining_timeline,
                verification_status,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            result.get("business_name"),
            result.get("job_title"),
            result.get("hiring_status"),
            result.get("salary_min"),
            result.get("salary_max"),
            result.get("shift"),
            result.get("experience_required"),
            result.get("joining_timeline"),
            result.get("verification_status"),
            datetime.now().isoformat()
        ))

        conn.commit()

    finally:
        conn.close()


def save_interest(
    candidate_name: str,
    business_name: str,
    job_title: str
):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT OR IGNORE INTO interested_jobs (
                candidate_name,
                business_name,
                job_title,
                created_at
            )
            VALUES (?, ?, ?, ?)
        """, (
            candidate_name,
            business_name,
            job_title,
            datetime.now().isoformat()
        ))

        conn.commit()

    finally:
        conn.close()


def save_call_record(call_record: dict):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO call_logs (
                business_name,
                masked_phone,
                idempotency_key,
                status,
                attempt,
                outcome,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)

            ON CONFLICT(idempotency_key)
            DO UPDATE SET
                status = excluded.status,
                attempt = excluded.attempt,
                outcome = excluded.outcome,
                updated_at = excluded.updated_at
        """, (
            call_record.get("business_name"),
            call_record.get("masked_phone"),
            call_record.get("idempotency_key"),
            call_record.get("status"),
            call_record.get("attempt", 0),
            call_record.get("outcome"),
            call_record.get(
                "created_at",
                datetime.now().isoformat()
            ),
            datetime.now().isoformat()
        ))

        conn.commit()

    finally:
        conn.close()


def get_call_logs():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            business_name,
            masked_phone,
            status,
            attempt,
            outcome,
            created_at,
            updated_at
        FROM call_logs
        ORDER BY id DESC
    """)

    rows = cursor.fetchall()
    conn.close()

    return rows


def get_discovered_jobs():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            business_name,
            job_title,
            hiring_status,
            salary_min,
            salary_max,
            shift,
            verification_status,
            created_at
        FROM discovered_jobs
        ORDER BY id DESC
    """)

    rows = cursor.fetchall()
    conn.close()

    return rows


def save_profile_sharing_consent(
    candidate_name: str,
    business_name: str,
    job_title: str,
    consent_status: str
):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO candidate_consents (
                candidate_name,
                business_name,
                job_title,
                consent_status,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)

            ON CONFLICT(
                candidate_name,
                business_name,
                job_title
            )
            DO UPDATE SET
                consent_status = excluded.consent_status,
                updated_at = excluded.updated_at
        """, (
            candidate_name,
            business_name,
            job_title,
            consent_status,
            datetime.now().isoformat(),
            datetime.now().isoformat()
        ))

        conn.commit()

    finally:
        conn.close()


def get_profile_sharing_consent(
    candidate_name: str,
    business_name: str,
    job_title: str
):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT consent_status
        FROM candidate_consents
        WHERE candidate_name = ?
          AND business_name = ?
          AND job_title = ?
        LIMIT 1
    """, (
        candidate_name,
        business_name,
        job_title
    ))

    row = cursor.fetchone()
    conn.close()

    return row[0] if row else None


def save_employer_followup(
    candidate_name: str,
    business_name: str,
    job_title: str,
    status: str
):
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("""
            INSERT INTO employer_followups (
                candidate_name,
                business_name,
                job_title,
                status,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)

            ON CONFLICT(
                candidate_name,
                business_name,
                job_title
            )
            DO UPDATE SET
                status = excluded.status,
                updated_at = excluded.updated_at
        """, (
            candidate_name,
            business_name,
            job_title,
            status,
            datetime.now().isoformat(),
            datetime.now().isoformat()
        ))

        conn.commit()

    finally:
        conn.close()


def get_employer_followup(
    candidate_name: str,
    business_name: str,
    job_title: str
):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT status
        FROM employer_followups
        WHERE candidate_name = ?
          AND business_name = ?
          AND job_title = ?
        LIMIT 1
    """, (
        candidate_name,
        business_name,
        job_title
    ))

    row = cursor.fetchone()
    conn.close()

    return row[0] if row else None


def get_employer_followups():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            candidate_name,
            business_name,
            job_title,
            status,
            created_at,
            updated_at
        FROM employer_followups
        ORDER BY id DESC
    """)

    rows = cursor.fetchall()
    conn.close()

    return rows


def reset_demo_data():
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("DELETE FROM call_logs")
        cursor.execute("DELETE FROM discovered_jobs")
        cursor.execute("DELETE FROM interested_jobs")
        cursor.execute("DELETE FROM candidate_consents")
        cursor.execute("DELETE FROM employer_followups")

        conn.commit()

    finally:
        conn.close()
