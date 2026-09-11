"""`pc`, the operator command line.

Fixture mode is the default for every command. A live call needs `PC_MODE=live`, the
`--i-understand-this-places-real-calls` flag, and an explicit `--max-calls N`, and it
prints the masked plan and the exact task text before it dials.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .adjudicate import JUDGE_C_ENV_VAR, DisabledJudgeC
from .config import (
    FIXTURES_DIR,
    LIVE_CONFIRMATION_FLAG,
    ConfigError,
    RunMode,
    Settings,
    load_settings,
)
from .dispatch import BudgetExceeded, LiveCallBudget, dispatch_intent
from .escalate import SETTLED_STATES, approve_field_visit, seed_first_step, sweep_cutoff
from .intake import poll_pending
from .ledger import Ledger
from .models import Event, IntentState
from .policy import Policy
from .preflight import (
    PreflightError,
    PreflightResult,
    load_event,
    load_roster_rows,
    render_preview,
    run_preflight,
)
from .redact import redact_snapshot
from .report import UNSUPPORTED_LOCALE_REASON, build_report, work_orders_csv, work_orders_json
from .script import SCHEMA_VERSION, TASK_VERSION

DEFAULT_EVENT = FIXTURES_DIR / "event.psps-demo.json"
DEFAULT_ROSTER = FIXTURES_DIR / "roster.demo.csv"
DEFAULT_SCENARIOS = FIXTURES_DIR / "scenarios"
DEFAULT_RECORDED = FIXTURES_DIR / "recorded"

MAX_LOOP_ITERATIONS = 400


@dataclass
class RunOutcome:
    event: Event
    policy: Policy
    preflight: PreflightResult
    log: list[str] = field(default_factory=list)
    calls_placed: int = 0
    iterations: int = 0


def _make_transport(settings: Settings, args: argparse.Namespace):
    if settings.mode is RunMode.FIXTURE:
        from .transports.fixture import FixtureTransport

        return FixtureTransport(getattr(args, "scenarios", None) or DEFAULT_SCENARIOS)
    if settings.mode is RunMode.REPLAY:
        from .transports.replay import ReplayTransport

        return ReplayTransport(getattr(args, "recorded", None) or DEFAULT_RECORDED)
    from .transports.calle import CalleTransport

    assert settings.api_key is not None
    return CalleTransport(
        settings.api_key, base_url=settings.base_url, webhook_url=settings.webhook_url
    )


def seed_ledger(ledger: Ledger, result: PreflightResult) -> None:
    """Write the event and the whole roster, including contacts we will never dial."""
    ledger.put_event(result.event)
    for contact in result.callable_contacts:
        ledger.put_contact(contact)
    for routed in result.routed:
        if routed.contact is None:
            continue
        # Stored so the report can count them honestly, and retired so nothing dials
        # them. `retired_reason` is what distinguishes this from a wrong number.
        ledger.put_contact(routed.contact)
        ledger.retire_number(routed.contact_id, UNSUPPORTED_LOCALE_REASON)


def execute_run(
    ledger: Ledger,
    transport,
    result: PreflightResult,
    *,
    now: datetime,
    simulated_clock: bool,
    budget: LiveCallBudget | None = None,
    judge_c=None,
    stop_before_cutoff: bool = False,
) -> RunOutcome:
    """Walk every contact's ladder until nothing is left to do.

    With a simulated clock the whole event runs in seconds: when no work is due, the clock
    jumps to the next scheduled step. With a real clock it does one pass and returns, and
    `pc serve` is what keeps it moving.

    `stop_before_cutoff` halts the simulated clock at the last moment before the
    field-visit deadline. That is the state an operator actually works in: calls done,
    review items still open, nothing swept to a truck yet. Without it the demo runs the
    whole event and the review queue is correctly, but unhelpfully, empty.
    """
    event = result.event
    policy = result.policy
    outcome = RunOutcome(event=event, policy=policy, preflight=result)
    clock = now

    for contact in result.callable_contacts:
        seed_first_step(
            ledger,
            event,
            policy,
            contact.contact_id,
            now=clock,
            task_version=TASK_VERSION,
            schema_version=SCHEMA_VERSION,
        )

    for iteration in range(MAX_LOOP_ITERATIONS):
        outcome.iterations = iteration + 1
        progressed = False

        due = [
            intent
            for intent in ledger.list_intents(
                event.event_id, [IntentState.RESERVED, IntentState.SUBMISSION_UNKNOWN]
            )
            if intent.not_before <= clock
        ]
        for intent in due:
            try:
                dispatched = dispatch_intent(
                    ledger, transport, event, policy, intent,
                    now=clock, budget=budget, log=outcome.log,
                )
            except BudgetExceeded as exc:
                outcome.log.append(str(exc))
                return outcome
            if dispatched.action in {"submitted", "reconciled"}:
                outcome.calls_placed += 1
                progressed = True
            elif dispatched.action in {"rejected"}:
                progressed = True

        for intake in poll_pending(
            ledger, transport, event, policy, now=clock, judge_c=judge_c
        ):
            if intake.action == "adjudicated":
                outcome.log.append(f"{intake.intent_id}: {intake.detail}")
                progressed = True
            elif intake.action in {"binding_mismatch", "quarantined"}:
                outcome.log.append(f"{intake.intent_id}: {intake.action} {intake.detail}")
                progressed = True

        moved = sweep_cutoff(ledger, event, policy, now=clock)
        if moved:
            outcome.log.append(
                f"cutoff reached: {len(moved)} open item(s) moved to the field-visit queue"
            )
            progressed = True

        if progressed:
            continue
        if not simulated_clock:
            break

        upcoming = [
            intent.not_before
            for intent in ledger.list_intents(event.event_id, [IntentState.RESERVED])
            if intent.not_before > clock
        ]
        # Anything not in a settled state still needs the cutoff sweep. Listing only
        # NEEDS_HUMAN and UNCONFIRMED_WAITING here used to strand a contact whose only
        # intent sat in SUBMISSION_UNKNOWN: the clock never reached the cutoff, the sweep
        # never ran, and nobody was sent to the door.
        open_items = [
            intent
            for intent in ledger.list_intents(event.event_id)
            if ledger.reconstruct(intent.intent_id) not in SETTLED_STATES
        ]
        if upcoming:
            next_time = min(upcoming)
            if open_items and event.field_visit_cutoff < next_time:
                if stop_before_cutoff:
                    break
                clock = event.field_visit_cutoff
            else:
                clock = next_time
            continue
        if open_items and clock < event.field_visit_cutoff:
            if stop_before_cutoff:
                break
            clock = event.field_visit_cutoff
            continue
        break

    return outcome


# -- commands ---------------------------------------------------------------------


def cmd_preflight(args: argparse.Namespace) -> int:
    event, policy = load_event(args.event)
    rows = load_roster_rows(args.roster)
    now = _resolve_now(RunMode.FIXTURE, args, event)
    result = run_preflight(event, policy, rows, now=now)
    print(render_preview(result, now=now))
    if result.blocking:
        print(f"\npreflight failed with {len(result.blocking)} blocking issue(s)", file=sys.stderr)
    return result.exit_code


def cmd_run(args: argparse.Namespace) -> int:
    try:
        settings = load_settings(
            mode=args.mode,
            db_path=args.db,
            max_calls=args.max_calls,
            live_confirmed=args.i_understand_this_places_real_calls,
        )
    except ConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    event, policy = load_event(args.event)
    rows = load_roster_rows(args.roster)
    now = _resolve_now(settings.mode, args, event)
    result = run_preflight(event, policy, rows, now=now)
    print(render_preview(result, now=now))
    if not result.ok:
        print("\npreflight failed; no call was placed", file=sys.stderr)
        return 1

    if settings.mode is RunMode.LIVE:
        print(
            f"\nMODE: LIVE. Up to {settings.max_calls} real call(s) will be placed to the "
            f"{len(result.callable_contacts)} contact(s) above."
        )
        # `--yes` deliberately does NOT apply here. It exists for the offline modes; a
        # live run always asks a person, because that typed word is the last gate before
        # somebody's phone rings.
        typed = input("Type the word PLACE to continue, anything else to abort: ")
        if typed.strip() != "PLACE":
            print("aborted; no call was placed")
            return 1

    transport = _make_transport(settings, args)
    if settings.mode is RunMode.REPLAY:
        print(f"\n{transport.provenance_line()}")
        if not transport.has_live_recordings:
            print(
                "note: no payload in this directory was captured from a live call, so this "
                "run does not verify live API behaviour."
            )

    ledger = Ledger(settings.db_path)
    try:
        seed_ledger(ledger, result)
        budget = LiveCallBudget(settings.max_calls) if settings.mode is RunMode.LIVE else None
        judge_c = _load_judge_c(settings)
        outcome = execute_run(
            ledger,
            transport,
            result,
            now=now,
            simulated_clock=settings.mode is not RunMode.LIVE,
            budget=budget,
            judge_c=judge_c,
            stop_before_cutoff=args.stop_before_cutoff,
        )
        print("\nRun log:")
        for line in outcome.log:
            print(f"  {line}")
        print(f"\nCalls placed this run: {outcome.calls_placed}")
        report = build_report(ledger, event, now=now)
        print()
        print(report.to_markdown())
        _write_report_files(args, report)
    finally:
        ledger.close()
        close = getattr(transport, "close", None)
        if callable(close):
            close()
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    event, _policy = load_event(args.event)
    ledger = Ledger(args.db or load_settings(mode=args.mode).db_path)
    try:
        report = build_report(ledger, event, now=datetime.now(timezone.utc))
        if args.format == "csv":
            print(report.to_csv(), end="")
        elif args.format == "json":
            print(report.to_json(), end="")
        else:
            print(report.to_markdown(), end="")
        _write_report_files(args, report)
    finally:
        ledger.close()
    return 0


def cmd_approve_field_visits(args: argparse.Namespace) -> int:
    event, _policy = load_event(args.event)
    ledger = Ledger(args.db or load_settings(mode=args.mode).db_path)
    try:
        now = datetime.now(timezone.utc)
        pending = [
            order for order in ledger.list_work_orders(event.event_id) if order.approved_at is None
        ]
        if not pending:
            print("no field visits are waiting for approval")
            return 0
        targets = (
            pending
            if args.all
            else [order for order in pending if order.work_order_id in set(args.work_order_id)]
        )
        if not targets:
            print("no matching field visit found", file=sys.stderr)
            return 1
        for order in targets:
            approve_field_visit(
                ledger, event, order.work_order_id, actor=args.approved_by, now=now
            )
            ledger.mark_work_order_exported(order.work_order_id, at=now)
            print(f"approved {order.work_order_id} for {order.contact_id} ({order.reason_code})")
        if args.out:
            out = Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(work_orders_csv(ledger, event), encoding="utf-8")
            out.with_suffix(".json").write_text(
                work_orders_json(ledger, event), encoding="utf-8"
            )
            print(f"exported approved field visits to {out} and {out.with_suffix('.json')}")
        else:
            print()
            print(work_orders_csv(ledger, event), end="")
    finally:
        ledger.close()
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .web.app import create_app

    settings = load_settings(
        mode=args.mode,
        db_path=args.db,
        max_calls=args.max_calls,
        live_confirmed=args.i_understand_this_places_real_calls,
    )
    event, policy = load_event(args.event)
    if settings.mode is RunMode.LIVE:
        print(
            f"MODE: LIVE. This worker may place up to {settings.max_calls} total real "
            "resident or provider calls, less any calls already recorded in this event."
        )
        typed = input("Type the word PLACE to start the live worker, anything else to abort: ")
        if typed.strip() != "PLACE":
            print("aborted; the server did not start and no call was placed")
            return 1
    transport = _make_transport(settings, args)
    budget = None
    if settings.mode is RunMode.LIVE:
        with Ledger(settings.db_path) as existing:
            already_placed = existing.count_call_authorizations_for_event(event.event_id)
        budget = LiveCallBudget(settings.max_calls, spent=already_placed)
    app = create_app(
        settings.db_path,
        event,
        policy,
        transport=transport,
        judge_c=_load_judge_c(settings),
        budget=budget,
        live_mode=settings.mode is RunMode.LIVE,
    )
    print(f"dashboard on http://{args.host}:{args.port}  (mode {settings.mode.value})")
    print(
        "intake worker running: draining the webhook inbox, polling open calls, and "
        "sweeping the field-visit cutoff"
    )
    try:
        uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    finally:
        close = getattr(transport, "close", None)
        if callable(close):
            close()
    return 0


def cmd_record(args: argparse.Namespace) -> int:
    """Fetch one real call, redact it, and save it for replay mode."""
    settings = load_settings(mode="live", max_calls=1, live_confirmed=True)
    from .transports.calle import CalleTransport

    assert settings.api_key is not None
    transport = CalleTransport(settings.api_key, base_url=settings.base_url)
    try:
        payload = transport.raw_payload(args.call_id)
    finally:
        transport.close()
    document = {
        "source": "live-redacted",
        "recorded_from": args.call_id,
        "match": {"contact_id": args.contact_id, "ladder_step": args.ladder_step},
        "note": args.note or "captured by pc record and passed through the redactor",
        "call_task": redact_snapshot(payload),
    }
    out_dir = Path(args.out or DEFAULT_RECORDED)
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{args.contact_id}-step{args.ladder_step}.json"
    target.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {target}")
    return 0


def _load_judge_c(settings: Settings):
    """Return the third judge. Disabled unless `PC_ENABLE_JUDGE_C` is explicitly set.

    Fixture and replay mode never consult a model, so this only ever returns something
    live in a live run whose operator asked for it.
    """
    if not settings.judge_c_enabled:
        return DisabledJudgeC()
    if settings.mode is not RunMode.LIVE:
        print(
            f"note: {JUDGE_C_ENV_VAR} is set but the run is offline; "
            "Judge C stays disabled so fixture and replay results remain deterministic"
        )
        return DisabledJudgeC()
    raise ConfigError(
        f"{JUDGE_C_ENV_VAR} is set, but no Judge C implementation is configured in this "
        "build. Unset it, or wire a Judge into _load_judge_c before enabling it."
    )


def _write_report_files(args: argparse.Namespace, report) -> None:
    out = getattr(args, "report_out", None)
    if not out:
        return
    base = Path(out)
    base.parent.mkdir(parents=True, exist_ok=True)
    base.with_suffix(".md").write_text(report.to_markdown(), encoding="utf-8")
    base.with_suffix(".csv").write_text(report.to_csv(), encoding="utf-8")
    base.with_suffix(".json").write_text(report.to_json(), encoding="utf-8")
    print(f"wrote {base.with_suffix('.md')}, {base.with_suffix('.csv')}, {base.with_suffix('.json')}")


def _resolve_now(mode: RunMode, args: argparse.Namespace, event: Event) -> datetime:
    """The clock a run works from.

    `mode` is the **resolved** run mode, not the CLI flag. Keying this off `args.mode`
    was a live-safety bug: `PC_MODE=live` is a documented way to select live mode, and it
    leaves `args.mode` as None, so a live run took the fixture branch and dialled real
    people on a clock rewound by up to four hours. Quiet hours were then evaluated at the
    wrong local time and every audit row was stamped with a fabricated timestamp.
    """
    override = getattr(args, "now", None)
    if override:
        parsed = datetime.fromisoformat(override)
        if parsed.tzinfo is None:
            raise ConfigError(
                "--now must carry a UTC offset, for example 2026-09-11T08:00:00-07:00; "
                "PositiveContact will not assume a timezone"
            )
        if mode is RunMode.LIVE:
            raise ConfigError("--now cannot be used in live mode; real calls use the real clock")
        return parsed
    if mode is RunMode.LIVE:
        return datetime.now(timezone.utc)
    # Offline modes only: keep the demo reproducible by starting the simulated clock far
    # enough ahead of the cutoff that the whole ladder has room to run.
    real_now = datetime.now(timezone.utc)
    latest_start = event.field_visit_cutoff - timedelta(hours=4)
    return latest_start if real_now > latest_start else real_now


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pc",
        description=(
            "PositiveContact: confirm that a live human heard a critical notice. "
            "Fixture mode is the default; no command places a real call without "
            f"PC_MODE=live, {LIVE_CONFIRMATION_FLAG}, and --max-calls N."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(target: argparse.ArgumentParser) -> None:
        target.add_argument("--event", default=str(DEFAULT_EVENT), help="event definition JSON")
        target.add_argument("--roster", default=str(DEFAULT_ROSTER), help="roster CSV")
        target.add_argument("--db", default=None, help="SQLite ledger path")
        target.add_argument("--now", default=None, help="ISO 8601 clock override for a run")

    preflight = sub.add_parser("preflight", help="validate the event and roster, place no calls")
    common(preflight)
    preflight.set_defaults(func=cmd_preflight, mode=RunMode.FIXTURE.value)

    run = sub.add_parser("run", help="walk the ladder for every contact")
    common(run)
    run.add_argument("--mode", default=None, choices=[item.value for item in RunMode])
    run.add_argument("--scenarios", default=None, help="fixture scenario directory")
    run.add_argument("--recorded", default=None, help="recorded payload directory for replay")
    run.add_argument("--max-calls", type=int, default=None, help="hard ceiling on real calls")
    run.add_argument(
        LIVE_CONFIRMATION_FLAG,
        dest="i_understand_this_places_real_calls",
        action="store_true",
        help="required for live mode, alongside PC_MODE=live and --max-calls",
    )
    run.add_argument(
        "--yes",
        action="store_true",
        help="skip prompts in the offline modes; it does not skip the live confirmation",
    )
    run.add_argument("--report-out", default=None, help="write the report next to this path")
    run.add_argument(
        "--stop-before-cutoff",
        action="store_true",
        help=(
            "stop the simulated clock just before the field-visit cutoff, leaving review "
            "items open. This is the mid-event view an operator works in"
        ),
    )
    run.set_defaults(func=cmd_run)

    report = sub.add_parser("report", help="print the denominator-honest report")
    common(report)
    report.add_argument("--format", default="md", choices=["md", "csv", "json"])
    report.add_argument("--report-out", default=None)
    report.set_defaults(func=cmd_report, mode=RunMode.FIXTURE.value)

    approve = sub.add_parser("approve-field-visits", help="approve and export field visits")
    common(approve)
    approve.add_argument("work_order_id", nargs="*", help="work order ids to approve")
    approve.add_argument("--all", action="store_true", help="approve every pending field visit")
    approve.add_argument("--approved-by", required=True, help="who is approving")
    approve.add_argument("--out", default=None, help="write the export here")
    approve.set_defaults(func=cmd_approve_field_visits, mode=RunMode.FIXTURE.value)

    serve = sub.add_parser("serve", help="run the operator dashboard")
    common(serve)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--mode", default=None, choices=[item.value for item in RunMode])
    serve.add_argument("--max-calls", type=int, default=None, help="hard ceiling on real calls")
    serve.add_argument(
        LIVE_CONFIRMATION_FLAG,
        dest="i_understand_this_places_real_calls",
        action="store_true",
        help="required for live mode, alongside PC_MODE=live and --max-calls",
    )
    serve.set_defaults(func=cmd_serve)

    record = sub.add_parser("record", help="save one real call as a redacted replay payload")
    record.add_argument("call_id")
    record.add_argument("--contact-id", required=True)
    record.add_argument("--ladder-step", type=int, required=True)
    record.add_argument("--note", default=None)
    record.add_argument("--out", default=None)
    record.set_defaults(func=cmd_record, mode=RunMode.LIVE.value)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (PreflightError, ConfigError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
