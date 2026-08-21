"""Command-line entry point for No-Show Guard.

Run with::

    python -m noshow_guard run [--dry-run] [--report-csv PATH]

Subcommands:
    init      Create the database and import ``sample_appointments.csv``.
    run       Process today's appointments needing confirmation calls.
    status    Show the current database contents as a table.

``--dry-run`` simulates calls locally (no dialing) so the whole pipeline can
be tested safely without a CALL-E API key or phone calls.
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional

from . import __version__
from .call_agent import CallAgent, CallError, CallTimeoutError, CallOutcome
from .config import Settings, get_settings
from .db import Database
from .report import generate_report
from .scheduler import due_appointments, format_apt_datetime


# ---------------------------------------------------------------------------
# Dry-run: simulate a call locally so development needs no API key / dialing.
# ---------------------------------------------------------------------------
def _simulate_outcome(name: str) -> CallOutcome:
    """Return a deterministic fake outcome for ``--dry-run`` mode."""
    bucket = hash(name) % 5
    outcomes = ["confirmed", "confirmed", "rescheduled", "cancelled", "no_answer"]
    out = outcomes[bucket]
    return CallOutcome(
        outcome=out,
        new_datetime="2025-12-28 15:00" if out == "rescheduled" else None,
        cancel_reason="Work conflict" if out == "cancelled" else None,
        call_id="dry-run",
        status="completed",
    )


def _normalize_e164(phone: str) -> str:
    """Normalise a phone number to E.164 format (``+<digits>``).

    Strips spaces, dashes, parentheses and dots, and ensures a leading ``+``.
    A number with no leading ``+`` is assumed to already carry its country
    code (as in the sample data, e.g. ``+91 85738 54153``).

    Args:
        phone: The raw phone string (e.g. ``"+91 85738 54153"``).

    Returns:
        An E.164-style string (e.g. ``+918573845153``).
    """
    digits = "".join(ch for ch in phone if ch.isdigit() or ch == "+").replace(" ", "")
    if not digits:
        return ""
    if not digits.startswith("+"):
        digits = "+" + digits
    return digits


def _dial(appointment, *, settings: Settings, dry_run: bool = False) -> CallOutcome:
    """Place (or simulate) the confirmation call and return the outcome.

    In ``--dry-run`` mode the SDK is NOT called — a simulated outcome is
    returned instead so the whole pipeline can be tested safely offline.

    For real calls, the appointment's phone number is normalised to E.164 and
    passed to ``create_and_wait`` as the ``recipient`` so the CALL-E SDK knows
    who to dial.
    """
    date, time_ = format_apt_datetime(appointment["appointment_datetime"])
    if dry_run:
        return _simulate_outcome(appointment["name"])

    from . import prompts

    e164 = _normalize_e164(appointment["phone"])
    if not e164:
        raise CallError(f"Invalid phone number for appointment #{appointment['id']}: {appointment['phone']!r}")

    agent = CallAgent(api_key=settings.calle_api_key)
    return agent.create_and_wait(
        task=prompts.build_task(date, time_, appointment["service"]),
        result_schema=prompts.RESULT_SCHEMA,
        recipient={"phone": e164},
        metadata={"appointment_id": appointment["id"]},
    )


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------
def _cmd_init(args) -> int:
    settings = get_settings()
    db = Database(settings.database_path)
    inserted = db.import_csv(settings.appointments_csv)
    print(f"Imported {inserted} appointment(s) from {settings.appointments_csv}.")
    print(f"Database: {settings.database_path}")
    return 0


def _cmd_run(args) -> int:
    settings = get_settings()
    if not args.dry_run:
        settings.validate(require_key=True)

    db = Database(settings.database_path)
    db.import_csv(settings.appointments_csv)  # idempotent import on every run

    due = due_appointments(db, settings=settings)
    if not due:
        print("No appointments are due for a confirmation call right now.")
    else:
        print(f"Found {len(due)} appointment(s) due for a call.\n")

    for apt in due:
        label = f"#{apt['id']} {apt['name']} ({apt['phone']}) — {apt['service']}"
        print(f"[{apt['status']}] Calling {label} ...")

        # Determine attempt number (increment retries for retry calls).
        attempt = 1
        if apt["status"] == "pending_retry":
            attempt = db.record_retry_attempt(apt["id"])

        try:
            outcome = _dial(apt, settings=settings, dry_run=args.dry_run)
            db.record_call(
                appointment_id=apt["id"],
                outcome=outcome.outcome,
                call_id=outcome.call_id,
                status=outcome.status,
                attempt=attempt,
                new_datetime=outcome.new_datetime,
                cancel_reason=outcome.cancel_reason,
                adjacent=(apt["status"] == "pending_retry"),
            )
            extra = ""
            if outcome.outcome == "rescheduled" and outcome.new_datetime:
                extra = f" -> requested new: {outcome.new_datetime}"
            elif outcome.outcome == "cancelled" and outcome.cancel_reason:
                extra = f" -> reason: {outcome.cancel_reason}"
            print(f"   Result: {outcome.outcome}{extra}")
            print(f"   Call ID: {outcome.call_id}")
        except (CallError, CallTimeoutError) as exc:
            print(f"   ERROR placing/reading call: {exc}", file=sys.stderr)
            # Mark this call as failed so it can be retried later.
            db.record_call(
                appointment_id=apt["id"],
                outcome="no_answer",
                status="failed",
                attempt=attempt,
                adjacent=(apt["status"] == "pending_retry"),
            )
        except Exception as exc:  # noqa: BLE001 - keep the batch going
            print(f"   UNEXPECTED error: {exc}", file=sys.stderr)

    # Generate the daily report after processing.
    print()
    report = generate_report(db, csv_output=args.report_csv, settings=settings)
    print(report["console"])
    if report["csv"]:
        print(f"\nFull audit CSV written to: {report['csv']}")
    return 0


def _cmd_status(args) -> int:
    settings = get_settings()
    db = Database(settings.database_path)
    rows = db.list_appointments()
    if not rows:
        print("Database is empty. Run `python -m noshow_guard init` first.")
        return 0
    print(f"{'id':<4}{'name':<18}{'phone':<16}{'datetime':<18}{'service':<22}{'status':<14}outcome")
    print("-" * 100)
    for r in rows:
        print(
            f"{r['id']:<4}{r['name']:<18}{r['phone']:<16}"
            f"{r['appointment_datetime']:<18}{r['service']:<22}"
            f"{r['status']:<14}{(r['outcome'] or ''):<10}"
        )
    return 0


def _cmd_version(args) -> int:
    print(f"noshow_guard {__version__}")
    return 0


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="noshow_guard",
        description="No-Show Guard — automatic appointment confirmation calls via CALL-E.",
    )
    parser.add_argument("--version", action="store_true", help="Show version and exit.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_init = sub.add_parser("init", help="Create DB and import sample appointments.")
    p_init.set_defaults(func=_cmd_init)

    p_run = sub.add_parser("run", help="Process today's appointments needing calls.")
    p_run.add_argument("--dry-run", action="store_true",
                       help="Simulate calls without dialing (no API key needed).")
    p_run.add_argument("--report-csv", default=None,
                       help="Write a CSV audit report to this path.")
    p_run.set_defaults(func=_cmd_run)

    p_status = sub.add_parser("status", help="Show the current database contents.")
    p_status.set_defaults(func=_cmd_status)

    return parser


def main(argv: Optional[list] = None) -> int:
    """CLI entry point. Returns the process exit code."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if getattr(args, "version", False):
        return _cmd_version(args)

    try:
        return args.func(args)
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
