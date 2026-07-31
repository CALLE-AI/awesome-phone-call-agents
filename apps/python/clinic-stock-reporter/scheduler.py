"""Host-side scheduler for the clinic stock-reporter.

Implements the repository design principle "host scheduler handles recurrence;
phone-call provider handles exactly one call per scheduled run." Runs the
client on a fixed interval in hours, in dry-run by default. Live execution and
real recurrence are opt-in and must be stated explicitly.

Cancellation: Ctrl-C stops the loop. No provider-side recurring job is ever
created, so there is nothing to cancel upstream. A single in-flight call
cannot be cancelled through the CALL-E MCP tools used here (plan_call,
run_call, get_call_run), as documented in README.md.
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

from rich.console import Console

import client


def parse_positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("expected a positive number")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Schedule recurring clinic stock-report CALL-E runs.")
    parser.add_argument("--input", required=True, type=Path, help="Path to the clinic roster JSONL file.")
    parser.add_argument("--every-hours", type=parse_positive_float, default=168.0, help="Run interval in hours. Default 168 (weekly).")
    parser.add_argument("--execute", action="store_true", help="Place real calls (run_call). Default is dry-run.")
    parser.add_argument("--once", action="store_true", help="Run a single invocation and exit instead of recurring.")
    parser.add_argument("--results-dir", type=Path, default=Path(client.DEFAULT_RESULTS_DIR))
    parser.add_argument("--db", type=Path)
    parser.add_argument("--base-url", default=client.DEFAULT_BASE_URL)
    parser.add_argument("--channel", default=client.DEFAULT_CHANNEL)
    parser.add_argument("--server-url")
    parser.add_argument("--cache-root", default=client.DEFAULT_CACHE_ROOT)
    parser.add_argument("--calle-command", default="calle")
    parser.add_argument("--poll-interval-seconds", type=parse_positive_float, default=10.0)
    parser.add_argument("--poll-timeout-seconds", type=parse_positive_float, default=900.0)
    return parser


def shared_args(args: argparse.Namespace) -> list[str]:
    argv = ["--input", str(args.input), "--results-dir", str(args.results_dir)]
    if args.execute:
        argv.append("--execute")
    if args.db:
        argv.extend(["--db", str(args.db)])
    argv.extend(["--base-url", args.base_url, "--channel", args.channel])
    if args.server_url:
        argv.extend(["--server-url", args.server_url])
    argv.extend(["--cache-root", args.cache_root, "--calle-command", args.calle_command])
    argv.extend(["--poll-interval-seconds", str(args.poll_interval_seconds)])
    argv.extend(["--poll-timeout-seconds", str(args.poll_timeout_seconds)])
    return argv


def main() -> int:
    console = Console()
    args = build_parser().parse_args()
    if not args.execute:
        console.print("[yellow]Dry-run mode:[/] no real calls will be placed. Pass --execute for live calls.")
    if not args.once:
        console.print(f"[bold]Scheduling[/] every {args.every_hours}h. Ctrl-C to stop. No provider-side recurring job is created.")

    stop = False

    def on_signal(_signum, _frame):
        nonlocal stop
        stop = True

    signal.signal(signal.SIGINT, on_signal)
    signal.signal(signal.SIGTERM, on_signal)

    while not stop:
        console.print(f"[green]Running[/] client at {time.strftime('%Y-%m-%d %H:%M:%S')}")
        code = client.run(shared_args(args))
        if code != 0:
            console.print(f"[red]client exited with code {code}[/]")
        if args.once:
            return code
        if stop:
            break
        # Sleep in small slices so signals interrupt promptly.
        sleep_seconds = args.every_hours * 3600.0
        slept = 0.0
        while not stop and slept < sleep_seconds:
            time.sleep(1.0)
            slept += 1.0
    console.print("[bold]Stopped.[/]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
