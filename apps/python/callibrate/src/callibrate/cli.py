"""Command line entry points, including the CALL-E login a deployment needs once."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any

from callibrate.calling.mcp import (
    CalleAuthRequired,
    CalleError,
    CalleMcpClient,
    finish_broker_login,
    start_broker_login,
)
from callibrate.config import Settings
from callibrate.store import Store
from callibrate.verification import VerificationWorkflow


def _store(settings: Settings) -> Store:
    store = Store(settings.database_path)
    store.initialize()
    store.seed_demo(settings)
    return store


def _print(payload: Any) -> None:
    print(json.dumps(payload, indent=2, ensure_ascii=False, default=str))


def cmd_serve(args: argparse.Namespace, settings: Settings) -> int:
    import uvicorn

    uvicorn.run(
        "callibrate.api:app",
        host=args.host or settings.host,
        port=args.port or settings.port,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        proxy_headers=True,
    )
    return 0


def cmd_init(args: argparse.Namespace, settings: Settings) -> int:
    store = _store(settings)
    _print(
        {
            "database": str(settings.database_path),
            "ledger_intact": store.verify_audit_chain(),
            "services": len(store.list_services()),
            "queue": len(store.list_tasks()),
        }
    )
    return 0


def cmd_queue(args: argparse.Namespace, settings: Settings) -> int:
    store = _store(settings)
    for task in store.list_tasks(args.limit):
        print(
            f"{task['priority']:8.1f}  {task['status']:12s}  {task['id']}  "
            f"{task['organization_name']} / {task['service_name']}  {task['fields']}"
        )
    return 0


def cmd_contract(args: argparse.Namespace, settings: Settings) -> int:
    """Print exactly what CALL-E would be told for one queued task."""
    store = _store(settings)
    preview = VerificationWorkflow(store, settings).preview(args.task_id)
    if args.json:
        _print(preview)
        return 0
    print(f"caller:      {preview['caller']}")
    print(f"allowlisted: {preview['destination_allowlisted']}")
    print(f"summary:     {preview['summary']}")
    print()
    print(preview["goal"])
    return 0


def cmd_verify(args: argparse.Namespace, settings: Settings) -> int:
    store = _store(settings)
    workflow = VerificationWorkflow(store, settings)
    try:
        result = asyncio.run(workflow.run(args.task_id, pilot_scenario=args.scenario))
    except CalleAuthRequired as error:
        print(f"CALL-E is not authorised: {error}", file=sys.stderr)
        print("Run: callibrate calle login", file=sys.stderr)
        return 2
    except Exception as error:
        print(f"verification failed: {error}", file=sys.stderr)
        return 1
    _print(
        {
            key: result[key]
            for key in ("run_id", "authority", "status", "outcome", "caller", "call_id", "applied", "unresolved")
        }
    )
    for decision in result["decisions"]:
        print(f"  {decision['authority']:8s} {decision['field'] or '-':16s} {decision['reason']}")
    return 0


def cmd_ledger(args: argparse.Namespace, settings: Settings) -> int:
    store = _store(settings)
    intact = store.verify_audit_chain()
    if args.verify:
        _print({"ledger_intact": intact, "first_break": store.audit_chain_break()})
        return 0 if intact else 1
    for event in reversed(store.audit_events(args.limit)):
        print(f"{event['created_at']}  {event['event_type']:26s} {event['actor']:22s} {event['entity_id']}")
    print(f"\nledger intact: {intact}")
    return 0 if intact else 1


def cmd_metrics(args: argparse.Namespace, settings: Settings) -> int:
    _print(_store(settings).call_metrics())
    return 0


def cmd_calle_status(args: argparse.Namespace, settings: Settings) -> int:
    workflow = VerificationWorkflow(Store(settings.database_path), settings)
    auth = workflow.calle_auth()
    status = auth.status()
    if not status["authenticated"]:
        _print(status)
        return 1

    async def probe() -> list[str]:
        client = CalleMcpClient(auth)
        try:
            return await client.connect()
        finally:
            await client.aclose()

    try:
        tools = asyncio.run(probe())
    except (CalleError, CalleAuthRequired) as error:
        _print({**status, "error": str(error)})
        return 1
    _print({**status, "tools": tools})
    return 0


def cmd_calle_login(args: argparse.Namespace, settings: Settings) -> int:
    """Brokered browser login. The token never passes through a model or a log."""
    workflow = VerificationWorkflow(Store(settings.database_path), settings)
    auth = workflow.calle_auth()

    async def run() -> dict[str, Any]:
        pending = await start_broker_login(auth)
        print("Open this URL in a browser and complete the CALL-E authorization:\n")
        print(f"    {pending['login_url']}\n")
        print("Waiting for authorization...")
        return await finish_broker_login(auth, pending, deadline_seconds=args.timeout)

    try:
        _print(asyncio.run(run()))
    except CalleError as error:
        print(f"login failed: {error}", file=sys.stderr)
        return 1
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="callibrate", description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    serve = subparsers.add_parser("serve", help="run the web application")
    serve.add_argument("--host")
    serve.add_argument("--port", type=int)
    serve.set_defaults(handler=cmd_serve)

    init = subparsers.add_parser("init", help="create the database and demonstration directory")
    init.set_defaults(handler=cmd_init)

    queue = subparsers.add_parser("queue", help="list the verification queue")
    queue.add_argument("--limit", type=int, default=20)
    queue.set_defaults(handler=cmd_queue)

    contract = subparsers.add_parser("contract", help="print the call CALL-E would be given")
    contract.add_argument("task_id")
    contract.add_argument("--json", action="store_true")
    contract.set_defaults(handler=cmd_contract)

    verify = subparsers.add_parser("verify", help="run one verification end to end")
    verify.add_argument("task_id")
    verify.add_argument("--scenario", help="pilot line scenario, when CBR_CALLER_MODE=pilot")
    verify.set_defaults(handler=cmd_verify)

    ledger = subparsers.add_parser("ledger", help="read or verify the evidence ledger")
    ledger.add_argument("--limit", type=int, default=30)
    ledger.add_argument("--verify", action="store_true")
    ledger.set_defaults(handler=cmd_ledger)

    metrics = subparsers.add_parser("metrics", help="call quality counted from the ledger")
    metrics.set_defaults(handler=cmd_metrics)

    calle = subparsers.add_parser("calle", help="CALL-E account state")
    calle_sub = calle.add_subparsers(dest="calle_command", required=True)
    status = calle_sub.add_parser("status", help="show token state and list the CALL-E tools")
    status.set_defaults(handler=cmd_calle_status)
    login = calle_sub.add_parser("login", help="brokered browser login")
    login.add_argument("--timeout", type=float, default=300.0)
    login.set_defaults(handler=cmd_calle_login)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    settings = Settings()
    return int(args.handler(args, settings))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
