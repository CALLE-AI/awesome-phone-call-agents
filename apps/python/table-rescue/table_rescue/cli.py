"""Command line entrypoint."""
import argparse
import sys
from datetime import datetime, time as dt_time
from pathlib import Path

from .calle_client import DEFAULT_BASE_URL, DEFAULT_CACHE_ROOT, DEFAULT_CHANNEL, DryRunClient, McpCallClient
from .engine import BudgetExceededError, CascadeEngine, EngineConfig
from .models import CallOutcome, CallStatus, ReservationStatus
from .report import render_report
from .stores import AuditLog, load_reservations, load_waitlist, write_jsonl_atomic


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="table-rescue",
        description=(
            "Confirm restaurant reservations and backfill cancelled tables from the "
            "waitlist via CALL-E. Dry-run by default; --live places real calls."
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="Run confirm + cascade phases")
    run.add_argument("--data-dir", default="data")
    run.add_argument("--state-dir", default="state")
    run.add_argument(
        "--fixture",
        default=None,
        help="Dry-run fixture JSONL (default: <data-dir>/fixtures/dry_run_outcomes.jsonl)",
    )
    run.add_argument("--run-id", default=None, help="Stable run id; defaults to timestamped")
    run.add_argument("--live", action="store_true", help="Place real calls (default: dry-run)")
    run.add_argument("--max-calls", type=int, default=10, help="Live call budget per run")
    run.add_argument(
        "--party-size-tolerance",
        type=int,
        default=0,
        help="How much smaller than the slot a waitlist party may be",
    )
    run.add_argument("--no-answer-retries", type=int, default=1)
    run.add_argument("--call-window-start", default="09:00")
    run.add_argument("--call-window-end", default="21:00")
    run.add_argument("--base-url", default=DEFAULT_BASE_URL)
    run.add_argument("--channel", default=DEFAULT_CHANNEL)
    run.add_argument("--cache-root", default=DEFAULT_CACHE_ROOT)
    run.add_argument("--calle-command", default="calle")
    run.add_argument("--region", default=None)
    run.add_argument("--language", default=None)
    run.set_defaults(func=cmd_run)

    cancel = subparsers.add_parser("cancel", help="Mark a run as operator-cancelled")
    cancel.add_argument("--run-id", required=True)
    cancel.add_argument("--state-dir", default="state")
    cancel.set_defaults(func=cmd_cancel)
    return parser


def parse_window(value: str) -> dt_time:
    hour, minute = value.split(":")
    return dt_time(int(hour), int(minute))


def cmd_run(args: argparse.Namespace) -> int:
    data_dir = Path(args.data_dir)
    state_dir = Path(args.state_dir)
    run_id = args.run_id or f"run-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    fixture = args.fixture or str(data_dir / "fixtures" / "dry_run_outcomes.jsonl")

    config = EngineConfig(
        max_calls=args.max_calls,
        party_size_tolerance=args.party_size_tolerance,
        no_answer_retries=args.no_answer_retries,
        call_window_start=parse_window(args.call_window_start),
        call_window_end=parse_window(args.call_window_end),
    )
    reservations = load_reservations(data_dir / "reservations.jsonl")
    waitlist = load_waitlist(data_dir / "waitlist.jsonl")

    if args.live:
        client = McpCallClient(
            base_url=args.base_url,
            channel=args.channel,
            cache_root=args.cache_root,
            calle_command=args.calle_command,
            region=args.region,
            language=args.language,
        )
    else:
        client = DryRunClient(fixture)

    audit = AuditLog(state_dir / "runs" / run_id)
    engine = CascadeEngine(client, audit, config)
    now = datetime.now().astimezone()
    outcomes: list[CallOutcome] = []
    exit_code = 0
    pending = [r for r in reservations if r.status == ReservationStatus.PENDING_CONFIRM]
    try:
        for reservation in pending:
            outcome = engine.confirm_reservation(run_id, reservation, now)
            outcomes.append(outcome)
            if outcome.status == CallStatus.CANCELLED:
                fill = engine.fill_slot(run_id, reservation, waitlist, now)
                if fill is not None:
                    outcomes.append(fill)
    except BudgetExceededError as error:
        print(f"WARNING: {error}; writing back state collected so far", file=sys.stderr)
        exit_code = 2

    write_jsonl_atomic(
        data_dir / "reservations.jsonl", [r.to_line() for r in reservations]
    )
    write_jsonl_atomic(data_dir / "waitlist.jsonl", [w.to_line() for w in waitlist])
    report = render_report(run_id, outcomes, reservations, waitlist)
    report_path = audit.run_dir / "report.md"
    report_path.write_text(report, encoding="utf-8")
    print(report)
    print(f"Report: {report_path}")
    return exit_code


def cmd_cancel(args: argparse.Namespace) -> int:
    audit = AuditLog(Path(args.state_dir) / "runs" / args.run_id)
    audit.append(
        CallOutcome(
            run_id=args.run_id, target_id="-", status=CallStatus.CANCELLED_BY_OPERATOR
        )
    )
    print(
        f"Run {args.run_id} marked CANCELLED_BY_OPERATOR. "
        "Later invocations with the same run id refuse to dial."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)
