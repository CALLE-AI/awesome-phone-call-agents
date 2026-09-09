"""Command line for Nominee.

Four commands, in order of how much they can do to the world:

    replay    reads bundled fixtures. No Airtable, no CALL-E, no credentials.
    preview   reads the real table. Writes nothing, dials nothing.
    verify    walks the audit chain and reports whether it is intact.
    run       places real calls. Needs --confirm-consent, said out loud.

`replay` is the reproducible path: clone the repository and run it. It drives
the same planner, the same gates and the same writeback as a live run, against
recorded CALL-E responses.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from .airtable import FieldMap, FixtureAirtable, LiveAirtable
from .audit import AuditLog
from .panel.server import serve
from .runner import Plan, RunError, execute, plan
from .transport import FixtureTransport, LiveTransport

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "examples" / "fixtures"

RULE = "─" * 68


def _print_plan(current: Plan) -> None:
    print(RULE)
    print(f"  view: {current.scope.view}")
    print(
        f"  {current.call_count} will be called   "
        f"{len(current.skipped)} skipped   "
        f"{current.scope.hidden} hidden by this view's filter"
    )
    print(f"  estimated: {current.call_count} calls  ~${current.estimated_cost_usd:.2f}")
    print(RULE)

    for item in current.planned:
        contact = item.contact
        print(f"\n  {contact.request_id}  {contact.employer_name}")
        print(
            f"    {contact.masked_number()}   source: "
            f"{contact.number.source.value}"
        )
        print("    what will be said:")
        for line in item.task.splitlines():
            print(f"      {line}" if line.strip() else "")

    for item in current.skipped:
        print(f"\n  SKIP {item.row.request.request_id or item.row.record_id}")
        print(f"    {item.reason}")

    if current.scope.hidden:
        print(
            f"\n  Note: {current.scope.hidden} rows in this table are hidden by "
            f"the view's filter and will not be called."
        )
    print()


def _live_clients(args: argparse.Namespace):
    token = os.environ.get("AIRTABLE_TOKEN", "")
    base_id = os.environ.get("AIRTABLE_BASE_ID", "")
    api_key = os.environ.get("CALLE_API_KEY", "")
    if not token or not base_id:
        raise SystemExit(
            "AIRTABLE_TOKEN and AIRTABLE_BASE_ID are required. See .env.example."
        )
    client = LiveAirtable(token, base_id)
    transport = LiveTransport(api_key) if api_key else None
    return client, transport


def _fixture_clients(args: argparse.Namespace):
    base = json.loads(Path(args.base or FIXTURES / "base.json").read_text())
    scenario = json.loads(
        Path(args.scenario or FIXTURES / "happy-path.json").read_text()
    )
    client = FixtureAirtable(
        base["schema"],
        base["records"],
        view_records=base.get("view_records"),
    )
    return client, FixtureTransport(scenario)


def cmd_replay(args: argparse.Namespace) -> int:
    """Full pipeline against fixtures. Places no calls and needs no credentials."""
    client, transport = _fixture_clients(args)
    audit = AuditLog(args.audit)
    report = execute(
        client,
        transport,
        audit,
        table=args.table,
        view=args.view,
        requester_name=args.requester,
        max_calls=args.max_calls,
        first_delay=0,
        interval=0,
        sleep=lambda _: None,
    )
    _print_plan(report.plan)
    print(RULE)
    print("  results")
    for outcome in report.outcomes:
        result = outcome.interpretation
        print(f"    {outcome.request_id:<10} {result.disposition.value:<22} {result.reason}")
    for item in report.plan.skipped:
        print(f"    {item.row.request.request_id:<10} {'skipped':<22} {item.reason}")
    print(RULE)
    print(f"  {report.by_disposition()}")
    status = audit.verify_chain()
    print(f"  audit: {status}")
    print("  no calls were placed; this run used recorded CALL-E responses.")
    print(RULE)
    return 0 if status.ok else 1


def cmd_preview(args: argparse.Namespace) -> int:
    client, _ = _live_clients(args)
    _print_plan(
        plan(
            client,
            table=args.table,
            view=args.view,
            requester_name=args.requester,
            fields=FieldMap(),
        )
    )
    print("  Nothing was called and nothing was written.")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    status = AuditLog(args.audit).verify_chain()
    print(status)
    if status.ok:
        print(
            "  Anchor this head externally to detect truncation; a shorter "
            "chain is still internally valid."
        )
    return 0 if status.ok else 1


def cmd_run(args: argparse.Namespace) -> int:
    if not args.confirm_consent:
        raise SystemExit(
            "run places real phone calls to real employers. Re-run with "
            "--confirm-consent once you have checked the preview."
        )
    client, transport = _live_clients(args)
    if transport is None:
        raise SystemExit("CALLE_API_KEY is required to place calls.")
    audit = AuditLog(args.audit)
    try:
        report = execute(
            client,
            transport,
            audit,
            table=args.table,
            view=args.view,
            requester_name=args.requester,
            max_calls=args.max_calls,
        )
    except RunError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"  {report.by_disposition()}  in {report.elapsed_seconds:.0f}s")
    print(f"  audit: {audit.verify_chain()}")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Open the operator's control panel on loopback."""
    import secrets

    if args.fixtures:
        client, transport = _fixture_clients(args)
        live = False
    else:
        client, transport = _live_clients(args)
        live = transport is not None
    serve(
        {
            "client": client,
            "transport": transport,
            "audit": AuditLog(args.audit),
            "table": args.table,
            "requester_name": args.requester,
            "default_view": args.view,
            "max_calls": args.max_calls,
            "token": secrets.token_urlsafe(24),
            "live": live,
        },
        host=args.host,
        port=args.port,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nominee",
        description="Consent-bound Verification of Employment, run from a table.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--table", default="Verification Requests")
        p.add_argument("--view", default="Ready to verify")
        p.add_argument("--requester", default="Meridian Lending")
        p.add_argument("--audit", default="audit.jsonl")
        p.add_argument("--max-calls", type=int, default=25)

    replay = sub.add_parser("replay", help="run the pipeline against fixtures")
    common(replay)
    replay.add_argument("--base", help="fixture base JSON")
    replay.add_argument("--scenario", help="fixture CALL-E scenario JSON")
    replay.set_defaults(func=cmd_replay)

    preview = sub.add_parser("preview", help="show what a run would do")
    common(preview)
    preview.set_defaults(func=cmd_preview)

    verify = sub.add_parser("verify", help="check the audit chain")
    verify.add_argument("--audit", default="audit.jsonl")
    verify.set_defaults(func=cmd_verify)

    run = sub.add_parser("run", help="place real calls")
    common(run)
    run.add_argument(
        "--confirm-consent",
        action="store_true",
        help="required; confirms the preview was checked",
    )
    run.set_defaults(func=cmd_run)

    panel = sub.add_parser("serve", help="open the control panel on loopback")
    common(panel)
    panel.add_argument("--host", default="127.0.0.1")
    panel.add_argument("--port", type=int, default=8787)
    panel.add_argument(
        "--fixtures", action="store_true",
        help="drive the panel from bundled fixtures; places no calls",
    )
    panel.add_argument("--base")
    panel.add_argument("--scenario")
    panel.set_defaults(func=cmd_serve)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
