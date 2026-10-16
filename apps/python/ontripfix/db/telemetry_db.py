import os
import json
import sqlite3
import datetime
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger("airflow.task")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

TELEMETRY_DB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "telemetry_data.db")
)

def get_db_connection():
    conn = sqlite3.connect(TELEMETRY_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_telemetry_db():
    """Initializes SQLite database tables for incidents, queue logs, service logs, and step timelines."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Incidents table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS incidents (
            incident_id TEXT PRIMARY KEY,
            dag_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            error_message TEXT NOT NULL,
            status TEXT NOT NULL,
            engineer_name TEXT,
            engineer_phone TEXT,
            recommended_sql TEXT,
            playbook_source TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    """)

    # Queue logs table (tracks Error Queue & Resolution Queue events)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS queue_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            queue_name TEXT NOT NULL,
            incident_id TEXT NOT NULL,
            action TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );
    """)

    # Service logs table (tracks microservice activity: Airflow, FastAPI, Jira, Confluence, Call-E, LangGraph)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS service_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id TEXT NOT NULL,
            service_name TEXT NOT NULL,
            event_type TEXT NOT NULL,
            log_status TEXT NOT NULL,
            message TEXT NOT NULL,
            details_json TEXT,
            timestamp TEXT NOT NULL
        );
    """)

    # Incident timeline steps (tracks the 6 remediation steps)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS step_timeline (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            incident_id TEXT NOT NULL,
            step_number INTEGER NOT NULL,
            step_name TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );
    """)

    conn.commit()
    conn.close()

def log_incident_create(incident_id: str, dag_id: str, task_id: str, error_message: str) -> Dict[str, Any]:
    """Logs creation of a new incident when Airflow failure webhook is received."""
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().isoformat()

    cursor.execute("""
        INSERT INTO incidents (incident_id, dag_id, task_id, error_message, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(incident_id) DO UPDATE SET
            error_message = excluded.error_message,
            updated_at = excluded.updated_at;
    """, (incident_id, dag_id, task_id, error_message, "QUEUED", now, now))

    conn.commit()
    conn.close()

    log_step(incident_id, 1, "Airflow Webhook Failure Intercepted", "SUCCESS", f"Received failure payload for DAG '{dag_id}' task '{task_id}'")
    log_service_event(incident_id, "AIRFLOW", "DAG_FAILURE_WEBHOOK", "WARNING", f"Pipeline failed: {error_message}", {"dag_id": dag_id, "task_id": task_id})
    return {"incident_id": incident_id, "status": "QUEUED"}

def log_incident_update(incident_id: str, updates: Dict[str, Any]):
    """Updates incident fields (status, engineer, playbook_source, recommended_sql)."""
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().isoformat()

    set_clauses = ["updated_at = ?"]
    params = [now]
    for key, val in updates.items():
        set_clauses.append(f"{key} = ?")
        params.append(val)
    params.append(incident_id)

    query = f"UPDATE incidents SET {', '.join(set_clauses)} WHERE incident_id = ?"
    cursor.execute(query, params)
    conn.commit()
    conn.close()

def log_queue_action(queue_name: str, incident_id: str, action: str, payload: dict):
    """Logs Queue actions (ENQUEUED, DEQUEUED, PROCESSED)."""
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().isoformat()

    cursor.execute("""
        INSERT INTO queue_logs (queue_name, incident_id, action, payload_json, timestamp)
        VALUES (?, ?, ?, ?, ?);
    """, (queue_name, incident_id, action, json.dumps(payload or {}), now))

    conn.commit()
    conn.close()

def log_service_event(incident_id: str, service_name: str, event_type: str, log_status: str, message: str, details: dict = None):
    """Logs individual microservice activity."""
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().isoformat()

    cursor.execute("""
        INSERT INTO service_logs (incident_id, service_name, event_type, log_status, message, details_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?);
    """, (incident_id, service_name, event_type, log_status, message, json.dumps(details or {}), now))

    conn.commit()
    conn.close()

def log_step(incident_id: str, step_number: int, step_name: str, status: str, summary: str):
    """Logs progress step for an incident timeline (1 to 6)."""
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.datetime.now().isoformat()

    cursor.execute("""
        INSERT INTO step_timeline (incident_id, step_number, step_name, status, summary, timestamp)
        VALUES (?, ?, ?, ?, ?, ?);
    """, (incident_id, step_number, step_name, status, summary, now))

    conn.commit()
    conn.close()

def get_dashboard_stats() -> Dict[str, Any]:
    """Calculates KPI statistics for the React Dashboard."""
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM incidents;")
    total_incidents = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM incidents WHERE status = 'RESOLVED';")
    resolved_incidents = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM queue_logs WHERE queue_name = 'ERROR_QUEUE' AND action = 'ENQUEUED';")
    error_queue_received = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM queue_logs WHERE queue_name = 'RESOLUTION_QUEUE' AND action = 'ENQUEUED';")
    resolution_queue_received = cursor.fetchone()[0]

    cursor.execute("SELECT incident_id, dag_id, task_id, status, engineer_name, created_at FROM incidents ORDER BY created_at DESC LIMIT 5;")
    recent_incidents = [dict(row) for row in cursor.fetchall()]

    conn.close()

    success_rate = round((resolved_incidents / total_incidents * 100), 1) if total_incidents > 0 else 100.0

    return {
        "total_incidents": total_incidents,
        "resolved_incidents": resolved_incidents,
        "success_rate": success_rate,
        "error_queue_received": error_queue_received,
        "resolution_queue_received": resolution_queue_received,
        "recent_incidents": recent_incidents
    }

def get_all_incidents() -> List[Dict[str, Any]]:
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incidents ORDER BY created_at DESC;")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows

def get_incident_details(incident_id: str) -> Optional[Dict[str, Any]]:
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM incidents WHERE incident_id = ?;", (incident_id,))
    incident_row = cursor.fetchone()
    if not incident_row:
        conn.close()
        return None

    incident = dict(incident_row)

    cursor.execute("SELECT * FROM step_timeline WHERE incident_id = ? ORDER BY id ASC;", (incident_id,))
    steps = [dict(row) for row in cursor.fetchall()]

    cursor.execute("SELECT * FROM service_logs WHERE incident_id = ? ORDER BY id ASC;", (incident_id,))
    logs = [dict(row) for row in cursor.fetchall()]

    conn.close()
    incident["steps"] = steps
    incident["logs"] = logs
    return incident

def get_queue_messages() -> Dict[str, Any]:
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM queue_logs WHERE queue_name = 'ERROR_QUEUE' ORDER BY id DESC LIMIT 30;")
    error_logs = [dict(row) for row in cursor.fetchall()]
    for item in error_logs:
        try:
            item["payload"] = json.loads(item["payload_json"])
        except Exception:
            item["payload"] = {}

    cursor.execute("SELECT * FROM queue_logs WHERE queue_name = 'RESOLUTION_QUEUE' ORDER BY id DESC LIMIT 30;")
    resolution_logs = [dict(row) for row in cursor.fetchall()]
    for item in resolution_logs:
        try:
            item["payload"] = json.loads(item["payload_json"])
        except Exception:
            item["payload"] = {}

    conn.close()
    return {
        "error_queue": {
            "total_received": len(error_logs),
            "messages": error_logs
        },
        "resolution_queue": {
            "total_received": len(resolution_logs),
            "messages": resolution_logs
        }
    }

def get_audit_logs(limit: int = 60) -> List[Dict[str, Any]]:
    init_telemetry_db()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM service_logs ORDER BY id DESC LIMIT ?;", (limit,))
    logs = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return logs
