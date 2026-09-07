"""Command line entrypoint."""
import argparse
import sys
from datetime import datetime, time as dt_time
from pathlib import Path

from .calle_client import DEFAULT_BASE_URL, DEFAULT_CACHE_ROOT, DEFAULT_CHANNEL, DryRunClient, McpCallClient
from .engine import (
    BudgetExceededError,
    CascadeEngine,
    EngineConfig,
    ReconciliationRequiredError,
)
from .models import CallOutcome, CallStatus, ReservationStatus
from .report import render_report
from .safety import (
    RunSafety,
    SafetyViolation,
    load_authorizations,
    missing_authorizations,
)
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
    run.add_argument("--yes", action="store_true", help="Skip the live manifest confirmation prompt")
    run.add_argument("--max-calls", type=int, default=10, help="Live call budget per run")
    run.add_argument(
        "--party-size-tolerance",
        type=int,
        default=0,
        help="How much smaller than the slot a waitlist party may be",
    )
    run.add_argument(
        "--avg-check-per-guest",
        type=float,
        default=None,
        help="Optional average check per guest used to estimate protected revenue",
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
    reservations_path = data_dir / "reservations.jsonl"
    waitlist_path = data_dir / "waitlist.jsonl"
    for missing in (reservations_path, waitlist_path):
        if not missing.exists():
            print(
                f"ERROR: {missing} not found. Copy the samples first, e.g. "
                "cp data/reservations.sample.jsonl data/reservations.jsonl "
                "(see README Setup).",
                file=sys.stderr,
            )
            return 1
    reservations = load_reservations(reservations_path)
    waitlist = load_waitlist(waitlist_path)
    return _run_pipeline(
        args, run_id, reservations, waitlist, state_dir, data_dir, fixture,
        resumed_from=None, refill_cancelled=False,
    )


def _build_config(args: argparse.Namespace) -> EngineConfig:
    return EngineConfig(
        max_calls=args.max_calls,
        party_size_tolerance=args.party_size_tolerance,
        no_answer_retries=args.no_answer_retries,
        call_window_start=parse_window(args.call_window_start),
        call_window_end=parse_window(args.call_window_end),
    )


def _render_manifest(run_id, reservations, waitlist, region, authorizations, max_calls):
    lines = [
        f"Live call manifest for run {run_id}",
        "",
        f"Region: {region} | Budget: {max_calls} calls | Origin: pinned official MCP endpoint",
        "",
        "| Target | Name | Phone | Authorized by |",
        "| --- | --- | --- | --- |",
    ]
    for target in [*reservations, *waitlist]:
        if not target.consent:
            continue
        row = authorizations.get(target.phone, {})
        target_id = getattr(target, "booking_id", None) or target.entry_id
        lines.append(
            f"| {target_id} | {target.name} | {target.phone} | {row.get('authorized_by', '-')} |"
        )
    lines += [
        "",
        "Every destination above passed region-aware E.164 validation and exact "
        "operator authorization. Fictional NANP numbers can never appear here.",
    ]
    return "\n".join(lines) + "\n"


def _prepare_safety(args, data_dir, reservations, waitlist, audit, run_id):
    """Live gates: region, allowlist coverage, manifest confirmation."""
    if not args.live:
        return RunSafety(live=False)
    if not args.region:
        print("ERROR: --region is required for live runs.", file=sys.stderr)
        raise SystemExit(1)
    auth_path = data_dir / "authorized_destinations.jsonl"
    if not auth_path.exists():
        print(
            f"ERROR: {auth_path} not found. Copy data/authorized_destinations.sample.jsonl "
            "and authorize every live destination first (see README Safety model).",
            file=sys.stderr,
        )
        raise SystemExit(1)
    try:
        authorizations = load_authorizations(auth_path)
    except SafetyViolation as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
    dialable = [r.phone for r in reservations if r.consent]
    dialable += [w.phone for w in waitlist if w.consent]
    missing = missing_authorizations(dialable, authorizations)
    if missing:
        print(
            f"ERROR: {len(missing)} dialable destination(s) lack operator authorization:",
            file=sys.stderr,
        )
        for phone in missing:
            print(f"  {phone}", file=sys.stderr)
        raise SystemExit(1)
    manifest = _render_manifest(
        run_id, reservations, waitlist, args.region, authorizations, args.max_calls
    )
    manifest_path = audit.run_dir / f"manifest-{run_id}.txt"
    manifest_path.write_text(manifest, encoding="utf-8")
    print(manifest)
    print(f"Manifest saved: {manifest_path}")
    if not getattr(args, "yes", False):
        answer = input("Type yes to place live calls: ")
        if answer.strip().lower() != "yes":
            print("Aborted before any call was placed.", file=sys.stderr)
            raise SystemExit(1)
    return RunSafety(live=True, region=args.region, authorizations=authorizations)


def _run_pipeline(
    args, run_id, reservations, waitlist, state_dir, data_dir, fixture,
    resumed_from, refill_cancelled,
):
    config = _build_config(args)
    audit = AuditLog(state_dir / "runs" / run_id)
    try:
        safety = _prepare_safety(args, data_dir, reservations, waitlist, audit, run_id)
    except SystemExit as error:
        return int(error.code)
    if args.live:
        try:
            client = McpCallClient(
                base_url=args.base_url,
                channel=args.channel,
                cache_root=args.cache_root,
                calle_command=args.calle_command,
                region=args.region,
                language=args.language,
            )
        except SafetyViolation as error:
            print(f"ERROR: {error}", file=sys.stderr)
            return 1
    else:
        if not Path(fixture).exists():
            print(f"ERROR: dry-run fixture {fixture} not found.", file=sys.stderr)
            return 1
        client = DryRunClient(fixture)

    engine = CascadeEngine(client, audit, config, safety=safety)
    now = datetime.now().astimezone()
    outcomes: list[CallOutcome] = []
    exit_code = 0
    pending = [r for r in reservations if r.status == ReservationStatus.PENDING_CONFIRM]
    try:
        for reservation in pending:
            outcome = engine.confirm_reservation(run_id, reservation, now)
            outcomes.append(outcome)
            if outcome.status == CallStatus.CANCELLED:
                outcomes.extend(engine.fill_slot(run_id, reservation, waitlist, now))
        if refill_cancelled:
            for reservation in reservations:
                if reservation.status == ReservationStatus.CANCELLED:
                    outcomes.extend(engine.fill_slot(run_id, reservation, waitlist, now))
    except BudgetExceededError as error:
        print(f"WARNING: {error}; writing back state collected so far", file=sys.stderr)
        exit_code = 3
    except ReconciliationRequiredError as error:
        outcomes.append(error.outcome)
        print(f"NEEDS REVIEW: {error}", file=sys.stderr)
        print(
            f"Run stopped fail-closed. Review the report, then "
            f"`table-rescue resume --run-id {run_id}`.",
            file=sys.stderr,
        )
        exit_code = 2
    except SafetyViolation as error:
        print(f"SAFETY: {error}; no further calls placed", file=sys.stderr)
        exit_code = 1

    write_jsonl_atomic(
        data_dir / "reservations.jsonl", [r.to_line() for r in reservations]
    )
    write_jsonl_atomic(data_dir / "waitlist.jsonl", [w.to_line() for w in waitlist])
    report = render_report(
        run_id, outcomes, reservations, waitlist,
        avg_check_per_guest=args.avg_check_per_guest,
        resumed_from=resumed_from,
    )
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


if __name__ == "__main__":
    sys.exit(main())
