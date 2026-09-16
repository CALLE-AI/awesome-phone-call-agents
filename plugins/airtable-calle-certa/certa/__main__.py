"""Command line for Certa.

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

from .airtable import (
    CREATE_BASE_SCOPES,
    AirtableError,
    FieldMap,
    FixtureAirtable,
    LiveAirtable,
    base_definition,
    create_base,
)
from .audit import AuditLog
from .config import load as load_config
from .panel.server import Panel, serve
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


def cmd_init(args: argparse.Namespace) -> int:
    """Create the Airtable base with the correct columns, in one call."""
    # --dry-run creates nothing, so it must not demand a credential first.
    if args.dry_run:
        table = base_definition()["tables"][0]
        print(f"\n  would create: {base_definition()['name']}")
        print(f"  table: {table['name']}  ({len(table['fields'])} fields)\n")
        for f in table["fields"]:
            kind = f["type"]
            if kind == "singleSelect":
                kind += " (" + ", ".join(c["name"] for c in f["options"]["choices"]) + ")"
            print(f"    {f['name']:<30} {kind}")
        print("\n  Nothing was created. Re-run without --dry-run.\n")
        return 0

    token = os.environ.get("AIRTABLE_TOKEN", "") or load_config().airtable_token
    if not token:
        raise SystemExit(
            "An Airtable token is needed. Create one at "
            "https://airtable.com/create/tokens with scopes:\n  "
            + "\n  ".join(CREATE_BASE_SCOPES)
        )
    if not args.workspace:
        raise SystemExit(
            "A workspace id is required: certa init --workspace wsp...\n"
            "Open Airtable and copy the wsp… segment from the address bar."
        )
    try:
        created = create_base(token, args.workspace)
    except AirtableError as exc:
        raise SystemExit(str(exc)) from exc

    base_id = created.get("id", "")
    print(f"\n  Created base {base_id}\n")
    print("  Next: open the console, choose Connections, and paste this base id.")
    print("  Then create a view named 'Ready to verify' filtered to rows that")
    print("  have a consent token and a sourced number.\n")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Open the operator's control panel on loopback.

    Starts with no configuration at all: with no credentials it runs on sample
    data, and the operator enters keys in the panel rather than in a shell.
    """
    import secrets

    panel = Panel(
        AuditLog(args.audit),
        table=args.table,
        default_view=args.view,
        max_calls=args.max_calls,
        token=secrets.token_urlsafe(24),
        force_fixtures=args.fixtures,
    )
    serve(panel, host=args.host, port=args.port, open_browser=args.open)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="certa",
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
        help="force sample data even when credentials exist; places no calls",
    )
    panel.add_argument(
        "--open", action="store_true", help="open the panel in a browser"
    )
    panel.add_argument("--base")
    panel.add_argument("--scenario")
    panel.set_defaults(func=cmd_serve)

    init = sub.add_parser("init", help="create the Airtable base with the right columns")
    init.add_argument("--workspace", help="Airtable workspace id (wsp...)")
    init.add_argument(
        "--dry-run", action="store_true",
        help="print the table that would be created and stop",
    )
    init.set_defaults(func=cmd_init)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
