"""Command line for kept. Simulation is the default; live calling is gated twice.

`plan` and `report` never touch the network. `run --simulate` exercises the real
CALL-E SDK against a local transport. `run --live` additionally requires an
environment opt-in and a typed confirmation, because the side effect is a
stranger's phone ringing about money they owe.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path

from kept.calls.calle_port import CalleCallPort
from kept.calls.port import CallPlacementError
from kept.calls.simulation import SIMULATED_BASE_URL, CalleSimulator, Scenario, ScenarioError
from kept.clock import Clock, FrozenClock, SystemClock
from kept.config import (
    MissingCredentialsError,
    Organisation,
    Policy,
    UnauthorizedRecipientsError,
    UntrustedBaseUrlError,
    load_authorized_recipients,
    load_credentials,
)
from kept.engine import CollectionRun, Runtime
from kept.ledger import Ledger, LedgerIntegrityError
from kept.policy import CallPlanner
from kept.render.html import render_html
from kept.render.text import render_plan, render_portfolio, render_run
from kept.report import build_portfolio
from kept.store import AccountBook, DataError, load_book

LIVE_ENV_FLAG = "KEPT_LIVE_CALLS_ENABLED"
LIVE_CONFIRMATION = "PLACE-REAL-CALLS"

_EXPECTED_FAILURES = (
    DataError,
    ScenarioError,
    LedgerIntegrityError,
    MissingCredentialsError,
    UnauthorizedRecipientsError,
    UntrustedBaseUrlError,
    ValueError,
    TypeError,
    OSError,
)
"""Failures a user can act on. Anything else is a bug and keeps its traceback."""

DEFAULT_RUN_HOUR_UTC = 12
"""Midday UTC when `--as-of` names only a date. Pass a full timestamp to control
which customers are inside their local calling window."""


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except _EXPECTED_FAILURES as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kept", description="Phone promises, verified against cash.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_plan(subparsers)
    _add_run(subparsers)
    _add_report(subparsers)
    _add_verify(subparsers)
    _add_doctor(subparsers)
    _add_recover(subparsers)
    return parser


def _add_plan(subparsers: argparse._SubParsersAction) -> None:
    plan = subparsers.add_parser("plan", help="Show who would be called today. Places no calls.")
    _add_common(plan)
    plan.add_argument("--budget", type=int, default=None, help="Maximum calls this run may place.")
    plan.set_defaults(handler=_handle_plan)


def _add_run(subparsers: argparse._SubParsersAction) -> None:
    run = subparsers.add_parser("run", help="Place the planned calls and record what was said.")
    _add_common(run)
    run.add_argument("--budget", type=int, default=None, help="Maximum calls this run may place.")
    mode = run.add_mutually_exclusive_group()
    mode.add_argument("--simulate", action="store_true", default=True, help="Default. No real calls.")
    mode.add_argument("--live", action="store_true", help="Place real CALL-E calls.")
    run.add_argument("--scenario", type=Path, help="Scripted answers for --simulate.")
    run.add_argument("--confirm", default="", help=f"Type {LIVE_CONFIRMATION} to allow --live.")
    run.set_defaults(handler=_handle_run)


def _add_report(subparsers: argparse._SubParsersAction) -> None:
    report = subparsers.add_parser("report", help="Show the promise ledger and what it is worth.")
    _add_common(report)
    report.add_argument("--html", type=Path, help="Also write a self-contained HTML report here.")
    report.set_defaults(handler=_handle_report)


def _add_verify(subparsers: argparse._SubParsersAction) -> None:
    verify = subparsers.add_parser("verify", help="Check the audit ledger hash chain.")
    verify.add_argument("--data", type=Path, required=True, help="Directory holding the ledgers.")
    verify.set_defaults(handler=_handle_verify)


def _add_recover(subparsers: argparse._SubParsersAction) -> None:
    recover = subparsers.add_parser(
        "recover",
        help="Finish calls that were dialled but whose outcome was never recorded.",
    )
    _add_common(recover)
    recover.add_argument("--live", action="store_true", help="Read results from CALL-E.")
    recover.add_argument("--scenario", type=Path, help="Scripted answers when not --live.")
    recover.set_defaults(handler=_handle_recover)


def _handle_recover(args: argparse.Namespace) -> int:
    ledger, book, policy = _open(args.data)
    live = bool(args.live)
    clock = _clock(args, live=live)
    port, _ = _build_port(args, live=live, today=clock.now().date())
    runtime = Runtime(
        port=port, ledger=ledger, clock=clock, policy=policy, organisation=_organisation(args.data)
    )
    summary = CollectionRun(runtime).recover(book)
    port.close()
    if not summary.promises and not summary.disputes and not summary.rejections:
        print("No dialled calls are missing an outcome.")
        return 0
    print(render_run(summary))
    _warn_aborted(summary.aborted)
    return 0


def _add_doctor(subparsers: argparse._SubParsersAction) -> None:
    doctor = subparsers.add_parser(
        "doctor", help="Check the API key and call budget without placing a call."
    )
    doctor.set_defaults(handler=_handle_doctor)


def _handle_doctor(args: argparse.Namespace) -> int:
    credentials = load_credentials()
    port = CalleCallPort.live(api_key=credentials.api_key, base_url=credentials.base_url)
    try:
        print(f"{credentials.base_url}: {port.check_credentials()}")
    except CallPlacementError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        port.close()
    live = os.environ.get(LIVE_ENV_FLAG, "").lower() in {"1", "true", "yes"}
    print(f"{LIVE_ENV_FLAG}: {'on' if live else 'off (live calls refused)'}")
    return 0


def _add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--data", type=Path, required=True, help="Directory holding the input CSVs.")
    parser.add_argument(
        "--as-of",
        type=_parse_as_of,
        help="Run as if now were this ISO date or timestamp, for reproducible demos.",
    )


def _handle_plan(args: argparse.Namespace) -> int:
    _, book, policy = _open(args.data)
    clock = _clock(args, live=False)
    plan = CallPlanner(policy=policy).plan(book, clock.now(), _budget(args, policy))
    print(render_plan(plan))
    return 0


def _handle_run(args: argparse.Namespace) -> int:
    ledger, book, policy = _open(args.data)
    live = bool(args.live)
    _guard_live(args, live)
    clock = _clock(args, live=live)
    port, simulator = _build_port(args, live=live, today=clock.now().date())
    runtime = Runtime(
        port=port,
        ledger=ledger,
        clock=clock,
        policy=policy,
        organisation=_organisation(args.data),
        authorized_phones=load_authorized_recipients(args.data) if live else None,
    )
    summary = CollectionRun(runtime).execute(book, _budget(args, policy))
    print(render_plan(summary.plan))
    print(render_run(summary))
    _warn_aborted(summary.aborted)
    _warn_unscripted(simulator)
    port.close()
    return 0


def _handle_report(args: argparse.Namespace) -> int:
    ledger, book, policy = _open(args.data)
    portfolio = build_portfolio(book, ledger, policy, _clock(args, live=False).now().date())
    print(render_portfolio(portfolio))
    if args.html:
        args.html.write_text(render_html(portfolio), encoding="utf-8")
        print(f"\nHTML report written to {args.html}")
    return 0


def _handle_verify(args: argparse.Namespace) -> int:
    ledger = Ledger(args.data / "ledger.jsonl")
    ledger.verify()
    print(f"Ledger intact: {len(ledger.read())} entries, chain verified.")
    return 0


def _open(data_dir: Path) -> tuple[Ledger, AccountBook, Policy]:
    ledger = Ledger(data_dir / "ledger.jsonl")
    ledger.verify()
    return ledger, load_book(data_dir, ledger), _policy(data_dir)


def _policy(data_dir: Path) -> Policy:
    path = data_dir / "policy.json"
    if not path.exists():
        return Policy()
    return Policy(**json.loads(path.read_text(encoding="utf-8")))


def _organisation(data_dir: Path) -> Organisation:
    path = data_dir / "organisation.json"
    if not path.exists():
        raise DataError(
            f"Missing {path}. Calls must name the creditor and a callback number; "
            'create it with {"name": "...", "callback_number": "+1..."}.'
        )
    return Organisation(**json.loads(path.read_text(encoding="utf-8")))


def _budget(args: argparse.Namespace, policy: Policy) -> int:
    requested = getattr(args, "budget", None)
    return policy.max_calls_per_run if requested is None else requested


def _parse_as_of(raw: str) -> datetime:
    try:
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        moment = datetime.combine(date.fromisoformat(raw), time(DEFAULT_RUN_HOUR_UTC, 0))
    if moment.hour == 0 and moment.minute == 0 and "T" not in raw and " " not in raw:
        moment = moment.replace(hour=DEFAULT_RUN_HOUR_UTC)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _clock(args: argparse.Namespace, *, live: bool) -> Clock:
    as_of = getattr(args, "as_of", None)
    if as_of is None:
        return SystemClock()
    if live:
        raise ValueError("--as-of cannot be used with --live; real calls always use the real date.")
    return FrozenClock(as_of)


def _guard_live(args: argparse.Namespace, live: bool) -> None:
    if not live:
        return
    if os.environ.get(LIVE_ENV_FLAG, "").lower() not in {"1", "true", "yes"}:
        raise ValueError(f"Live calling is off. Set {LIVE_ENV_FLAG}=true to enable it.")
    if args.confirm != LIVE_CONFIRMATION:
        raise ValueError(f"Live calling needs --confirm {LIVE_CONFIRMATION}.")


def _build_port(
    args: argparse.Namespace, *, live: bool, today: date
) -> tuple[CalleCallPort, CalleSimulator | None]:
    if live:
        credentials = load_credentials()
        return CalleCallPort.live(api_key=credentials.api_key, base_url=credentials.base_url), None
    if getattr(args, "scenario", None) is None:
        raise ValueError("--simulate needs --scenario pointing at scripted answers.")
    simulator = CalleSimulator(scenario=Scenario.from_file(args.scenario), today=today)
    port = CalleCallPort.with_transport(transport=simulator.transport, base_url=SIMULATED_BASE_URL)
    return port, simulator


def _warn_aborted(code: str | None) -> None:
    """An ambiguous outcome stops the run; say so rather than looking finished."""
    if code is None:
        return
    print(
        f"\nwarning: run stopped after an ambiguous {code}. A call may be live and "
        "unrecorded; settle it with `kept recover` before running again.",
        file=sys.stderr,
    )


def _warn_unscripted(simulator: CalleSimulator | None) -> None:
    if simulator is None or not simulator.unscripted:
        return
    missing = ", ".join(sorted(simulator.unscripted))
    print(f"\nwarning: no scripted answer for {missing}; simulated as no_answer.", file=sys.stderr)
