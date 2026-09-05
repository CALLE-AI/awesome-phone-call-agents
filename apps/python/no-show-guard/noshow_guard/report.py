"""Daily summary report generation.

Produces a human-readable console report (a pretty table) and, optionally, a
CSV audit file. The summary answers the question: *"How did today's
confirmation calls go?"* — total calls made, confirmed, rescheduled,
cancelled, and no-answer counts, plus the list of customers who asked to
reschedule (for staff to follow up).
"""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path
from typing import Optional

from prettytable import PrettyTable

from .db import Database, OUTCOMES
from .config import Settings, get_settings


def build_summary_data(db: Database) -> dict:
    """Aggregate call counts into a dict for the report."""
    total, confirmed, rescheduled, cancelled, no_answer = db.summary_counts()
    return {
        "total_calls": total,
        "confirmed": confirmed,
        "rescheduled": rescheduled,
        "cancelled": cancelled,
        "no_answer": no_answer,
    }


def print_console_report(db: Database, data: Optional[dict] = None) -> str:
    """Render and return a console-friendly ASCII table report.

    Args:
        db: The database to read from.
        data: Optional pre-computed summary dict (via :func:`build_summary_data`).

    Returns:
        The rendered report as a string.
    """
    data = data or build_summary_data(db)

    lines = []
    lines.append("=" * 52)
    lines.append("  No-Show Guard — Daily Call Summary")
    lines.append(f"  Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
    lines.append("=" * 52)

    table = PrettyTable()
    table.field_names = ["Metric", "Count"]
    table.add_row(["Total calls placed", data["total_calls"]])
    for outcome in OUTCOMES:
        label = {"confirmed": "Confirmed", "rescheduled": "Rescheduled",
                 "cancelled": "Cancelled", "no_answer": "No answer"}[outcome]
        table.add_row([label, data[outcome]])
    lines.append(table.get_string())

    # Reschedule follow-ups for staff.
    resched = [
        r for r in db.list_appointments(status="rescheduled")
        if r["new_datetime"]
    ]
    if resched:
        lines.append("\nAwaiting staff review — customers who asked to RESCHEDULE:")
        stable = PrettyTable()
        stable.field_names = ["Name", "Phone", "Original", "Requested new"]
        for r in resched:
            stable.add_row(
                [r["name"], r["phone"], r["appointment_datetime"], r["new_datetime"]]
            )
        lines.append(stable.get_string())
    else:
        lines.append("\nNo reschedule requests to review.")

    return "\n".join(lines)


def write_csv_report(db: Database, output_path: str, data: Optional[dict] = None) -> str:
    """Write a CSV audit report and return the path it was written to.

    Contains one row per call attempt with the appointment and outcome.
    """
    data = data or build_summary_data(db)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(
            fh,
            fieldnames=[
                "appointment_id", "name", "phone", "service",
                "appointment_datetime", "status", "outcome", "new_datetime",
                "cancel_reason", "last_call_at", "call_id",
            ],
        )
        writer.writeheader()
        for r in db.list_appointments():
            writer.writerow(
                {
                    "appointment_id": r["id"],
                    "name": r["name"],
                    "phone": r["phone"],
                    "service": r["service"],
                    "appointment_datetime": r["appointment_datetime"],
                    "status": r["status"],
                    "outcome": r["outcome"] or "",
                    "new_datetime": r["new_datetime"] or "",
                    "cancel_reason": r["cancel_reason"] or "",
                    "last_call_at": r["last_call_at"] or "",
                    "call_id": r["call_id"] or "",
                }
            )

    # Summary block appended as comments at the bottom.
    with path.open("a", encoding="utf-8") as fh:
        fh.write("\n# summary,")
        fh.write(",".join(str(data[k]) for k in
                          ["total_calls", "confirmed", "rescheduled",
                           "cancelled", "no_answer"]))
        fh.write("\n")
    return str(path)


def generate_report(
    db: Database,
    *,
    csv_output: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> dict:
    """Generate both the console report and (optionally) a CSV report.

    Args:
        db: The database.
        csv_output: If provided, also write a CSV audit file to this path.
        settings: Application settings (used for the default CSV path).

    Returns:
        A dict with ``console`` text and ``csv`` path (if written).
    """
    settings = settings or get_settings()
    data = build_summary_data(db)
    console = print_console_report(db, data)

    result = {"console": console, "csv": None}
    target = csv_output or settings.database_path.replace(".db", "_report.csv")
    if target:
        result["csv"] = write_csv_report(db, target, data)
    return result
