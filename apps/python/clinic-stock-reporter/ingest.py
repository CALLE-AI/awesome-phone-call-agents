"""SQLite store and stdlib dashboard for clinic stock reports.

The store is the "act on it" surface the hackathon brief asks for: each
completed call's parsed REPORT becomes a row here, red flags are surfaced to
the district health office dashboard, and a red severity row raises an SMS
escalation record (the SMS send itself is out of scope and stubbed).

Uses only the standard library so the app keeps the same dependency footprint
as apps/python/batch-runner (fastmcp + rich).
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from questionnaire import ParsedReport

DEFAULT_DB_NAME = "clinic_reports.db"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    """Thread-safe SQLite store for ingested clinic reports."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS reports (
                    clinic_id TEXT NOT NULL,
                    clinic_name TEXT,
                    nurse_name TEXT,
                    district TEXT,
                    severity TEXT NOT NULL,
                    red_flags TEXT NOT NULL,
                    fridge_temp_c REAL,
                    arv_stockout TEXT,
                    antimalarial_stockout TEXT,
                    malaria_cases INTEGER,
                    anc_visits INTEGER,
                    stockout_items TEXT,
                    missing_fields TEXT,
                    final_status TEXT,
                    call_id TEXT,
                    duration_seconds REAL,
                    ingested_at TEXT NOT NULL,
                    post_summary TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS escalations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    clinic_id TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    red_flags TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    sent INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.commit()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def ingest(self, clinic_meta: dict[str, Any], report: ParsedReport, call_record: dict[str, Any]) -> None:
        f = report.fields
        district = clinic_meta.get("district")
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO reports (
                    clinic_id, clinic_name, nurse_name, district, severity, red_flags,
                    fridge_temp_c, arv_stockout, antimalarial_stockout, malaria_cases,
                    anc_visits, stockout_items, missing_fields,
                    final_status, call_id, duration_seconds, ingested_at, post_summary
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clinic_meta.get("clinic_id"),
                    clinic_meta.get("clinic_name"),
                    clinic_meta.get("nurse_name"),
                    district if isinstance(district, str) else None,
                    report.severity,
                    ",".join(report.red_flags),
                    f.get("fridge_temp_c") if isinstance(f.get("fridge_temp_c"), (int, float)) else None,
                    f.get("arv_stockout") if isinstance(f.get("arv_stockout"), str) else None,
                    f.get("antimalarial_stockout") if isinstance(f.get("antimalarial_stockout"), str) else None,
                    f.get("malaria_cases") if isinstance(f.get("malaria_cases"), int) else None,
                    f.get("anc_visits") if isinstance(f.get("anc_visits"), int) else None,
                    f.get("stockout_items") if isinstance(f.get("stockout_items"), str) else None,
                    ",".join(report.missing),
                    call_record.get("final_status"),
                    call_record.get("call_id") or call_record.get("run_id"),
                    call_record.get("duration_seconds"),
                    utc_now_iso(),
                    call_record.get("post_summary"),
                ),
            )
            if report.severity == "red" and report.red_flags:
                conn.execute(
                    """
                    INSERT INTO escalations (clinic_id, severity, red_flags, message, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        clinic_meta.get("clinic_id"),
                        report.severity,
                        ",".join(report.red_flags),
                        self._escalation_message(clinic_meta, report),
                        utc_now_iso(),
                    ),
                )
            conn.commit()

    @staticmethod
    def _escalation_message(clinic_meta: dict[str, Any], report: ParsedReport) -> str:
        name = clinic_meta.get("clinic_name") or clinic_meta.get("clinic_id") or "clinic"
        return f"[CALL-E clinic-stock-reporter] RED at {name}: {', '.join(report.red_flags)}. Review and act."

    def latest_reports(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM reports ORDER BY ingested_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(row) for row in rows]

    def pending_escalations(self) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM escalations WHERE sent = 0 ORDER BY created_at DESC"
            ).fetchall()
            return [dict(row) for row in rows]

    def mark_escalations_sent(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._lock, self._connect() as conn:
            conn.executemany("UPDATE escalations SET sent = 1 WHERE id = ?", [(i,) for i in ids])
            conn.commit()


def _rows_html(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "<p>No reports yet.</p>"
    cells = "".join(
        f"<th>{col}</th>" for col in (
            "clinic_id", "clinic_name", "district", "severity", "red_flags",
            "fridge_temp_c", "arv_stockout", "antimalarial_stockout", "malaria_cases",
            "anc_visits", "stockout_items", "final_status", "ingested_at",
        )
    )
    body = ""
    for row in rows:
        sev = row.get("severity") or "green"
        cls = {"red": "red", "amber": "amber", "green": "green"}.get(sev, "")
        body += f"<tr class='{cls}'>" + "".join(
            f"<td>{row.get(col) if row.get(col) is not None else ''}</td>"
            for col in (
                "clinic_id", "clinic_name", "district", "severity", "red_flags",
                "fridge_temp_c", "arv_stockout", "antimalarial_stockout", "malaria_cases",
                "anc_visits", "stockout_items", "final_status", "ingested_at",
            )
        ) + "</tr>"
    return f"<table><tr>{cells}</tr>{body}</table>"


def _escalations_html(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "<p>No pending escalations.</p>"
    body = ""
    for row in rows:
        body += (
            f"<tr class='red'><td>{row.get('id')}</td><td>{row.get('clinic_id')}</td>"
            f"<td>{row.get('red_flags')}</td><td>{row.get('message')}</td>"
            f"<td>{row.get('created_at')}</td></tr>"
        )
    return f"<table><tr><th>id</th><th>clinic_id</th><th>red_flags</th><th>message</th><th>created_at</th></tr>{body}</table>"


_CSS = """
<style>
body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; background: #f8f9fa; }
h1 { font-size: 1.4rem; }
h2 { font-size: 1.1rem; margin-top: 2rem; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; font-size: 12px; }
th { background: #eee; }
tr.red { background: #f8d7da; }
tr.amber { background: #fff3cd; }
tr.green { background: #d4edda; }
.note { color: #555; font-size: 12px; }
</style>
"""


def serve_dashboard(store: Store, host: str = "127.0.0.1", port: int = 8787) -> ThreadingHTTPServer:
    """Start a stdlib HTTP server serving the district health office dashboard."""

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            return

        def do_GET(self) -> None:
            if self.path not in ("/", "/escalations"):
                self.send_response(404)
                self.end_headers()
                return
            reports = store.latest_reports(100)
            escalations = store.pending_escalations()
            title = "CALL-E Clinic Stock Reporter - District Health Office Dashboard"
            body = (
                f"<html><head><meta charset='utf-8'><title>{title}</title>{_css}</head><body>"
                f"<h1>{title}</h1>"
                f"<p class='note'>Last-mile HMIS reports collected by CALL-E phone interviews. "
                f"Red rows raised an SMS escalation to the district health office.</p>"
                f"<h2>Latest reports</h2>{_rows_html(reports)}"
                f"<h2>Pending escalations</h2>{_escalations_html(escalations)}"
                f"</body></html>"
            )
            data = body.encode("utf-8")
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer((host, port), Handler)
    return server


def demo() -> None:
    """ponytail: smallest self-check for the store + ingest path."""
    import tempfile
    from questionnaire import classify

    with tempfile.TemporaryDirectory() as tmp:
        store = Store(Path(tmp) / DEFAULT_DB_NAME)
        report = classify(
            {
                "fridge_temp_c": 10.0,
                "arv_stockout": "no",
                "antimalarial_stockout": "yes",
                "malaria_cases": 7,
                "anc_visits": 2,
                "stockout_items": "ACT",
            },
            clinic_id="hcii-test",
        )
        store.ingest(
            {"clinic_id": "hcii-test", "clinic_name": "Test HC II", "district": "Demo"},
            report,
            {"final_status": "completed", "call_id": "call_1", "duration_seconds": 42.0, "post_summary": "Stockout reported."},
        )
        rows = store.latest_reports()
        esc = store.pending_escalations()
        assert rows and rows[0]["clinic_id"] == "hcii-test", rows
        assert rows[0]["severity"] == "red", rows[0]
        assert esc and esc[0]["clinic_id"] == "hcii-test", esc
        store.mark_escalations_sent([esc[0]["id"]])
        assert store.pending_escalations() == []
    print("ingest.demo ok")


if __name__ == "__main__":
    demo()
