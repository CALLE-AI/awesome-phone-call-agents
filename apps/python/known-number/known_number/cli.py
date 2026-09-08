"""Command-line entry point.

Commands:

  preview    Policy gates + the exact task text and schema that would be sent. No network.
  verify     Dry-run by default. With --live and --approver, creates one CALL-E call, polls, reconciles.
  status     Re-read a live ticket by its stored call id and reconcile if terminal.
  reconcile  Run reconciliation on a saved call JSON (fixture or exported result). No network.
  demo       Run every fixture in ./fixtures through reconciliation and print the verdict table.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .models import ChangeRequest, VendorRecord, load_request, load_vendors, mask_phone, verification_code
from .policy import DEFAULT_MIN_KNOWN_PHONE_AGE_DAYS, evaluate
from .reconcile import reconcile
from .render import audit_record, memo
from .store import TicketStore
from .task import RESULT_SCHEMA, build_metadata, build_task, idempotency_key

DEFAULT_COMPANY = os.environ.get("KNOWN_NUMBER_COMPANY", "Example Manufacturing Ltd")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="known-number", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=f"known-number {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--request", required=True, type=Path, help="change request JSON")
        p.add_argument("--vendors", required=True, type=Path, help="vendor master JSON")
        p.add_argument("--company", default=DEFAULT_COMPANY, help="your company name as spoken on the call")
        p.add_argument("--min-known-phone-age-days", type=int, default=DEFAULT_MIN_KNOWN_PHONE_AGE_DAYS)
        p.add_argument("--state-dir", type=Path, default=Path("state"), help="where per-ticket state and audit records go")

    p = sub.add_parser("preview", help="show gates, task text and schema; no network")
    add_common(p)

    p = sub.add_parser("verify", help="dry-run by default; --live places one real call")
    add_common(p)
    p.add_argument("--live", action="store_true", help="actually create the CALL-E call")
    p.add_argument("--approver", help="name of the human approving this live call")
    p.add_argument("--timeout-seconds", type=float, default=900.0)
    p.add_argument("--poll-seconds", type=float, default=5.0)

    p = sub.add_parser("status", help="re-read a live ticket and reconcile if terminal")
    add_common(p)

    p = sub.add_parser("reconcile", help="reconcile a saved call JSON; no network")
    add_common(p)
    p.add_argument("--call-json", required=True, type=Path)

    p = sub.add_parser("demo", help="run all fixtures; no network")
    p.add_argument("--fixtures", type=Path, default=Path(__file__).resolve().parent.parent / "fixtures")
    p.add_argument("--examples", type=Path, default=Path(__file__).resolve().parent.parent / "examples")

    args = parser.parse_args(argv)
    try:
        return {
            "preview": cmd_preview,
            "verify": cmd_verify,
            "status": cmd_status,
            "reconcile": cmd_reconcile,
            "demo": cmd_demo,
        }[args.command](args)
    except KnownNumberError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        return 2


class KnownNumberError(RuntimeError):
    pass


def _load(args: argparse.Namespace) -> tuple[ChangeRequest, VendorRecord | None]:
    request = load_request(args.request)
    vendors = load_vendors(args.vendors)
    return request, vendors.get(request.vendor_id)


def _gate(args: argparse.Namespace, *, live: bool, approver: str | None):
    request, vendor = _load(args)
    decision = evaluate(request, vendor, min_known_phone_age_days=args.min_known_phone_age_days, live=live, approver=approver)
    return request, vendor, decision


def cmd_preview(args: argparse.Namespace) -> int:
    request, vendor, decision = _gate(args, live=False, approver=None)
    out: dict[str, Any] = {"ok": decision.allowed, "ticket_id": request.ticket_id, "policy": decision.to_dict()}
    if vendor is not None:
        out["task"] = build_task(request, vendor, company_name=args.company)
        out["result_schema"] = RESULT_SCHEMA
        out["recipient"] = {"phones": [mask_phone(vendor.known_phone)], "region": vendor.region, "locale": vendor.locale}
        out["metadata"] = build_metadata(request, vendor)
        out["idempotency_key"] = idempotency_key(request, out["task"])
        out["verification_code_for_written_notice"] = verification_code(request, _code_secret())
        task_l = out["task"].lower()
        out["payment_free_task"] = (
            request.new_account_last4 not in out["task"]
            and request.new_bank_name.lower() not in task_l
            and vendor.current_bank_name.lower() not in task_l
            and "bank" not in task_l.replace("banking, account, or payment information", "")
        )
    print(json.dumps(out, indent=2))
    return 0 if decision.allowed else 1


def cmd_verify(args: argparse.Namespace) -> int:
    request, vendor, decision = _gate(args, live=args.live, approver=args.approver)
    if not decision.allowed or vendor is None:
        print(json.dumps({"ok": False, "ticket_id": request.ticket_id, "policy": decision.to_dict()}, indent=2))
        return 1

    store = TicketStore(args.state_dir)
    existing = store.load(request.ticket_id)
    if not args.live:
        print(
            json.dumps(
                {
                    "ok": True,
                    "mode": "dry-run",
                    "ticket_id": request.ticket_id,
                    "policy": decision.to_dict(),
                    "would_dial": mask_phone(vendor.known_phone),
                    "existing_call_id": (existing or {}).get("call_id"),
                    "next": "re-run with --live --approver <name> to place the call",
                },
                indent=2,
            )
        )
        return 0

    if existing and existing.get("call_id"):
        print(json.dumps({"ok": True, "note": "ticket already has a call; resuming with status", "call_id": existing["call_id"]}, indent=2))
        return cmd_status(args)

    client = _client()
    task = build_task(request, vendor, company_name=args.company)
    payload = {
        "task": task,
        "recipient": {"phone": vendor.known_phone, "region": vendor.region, "locale": vendor.locale},
        "result_schema": RESULT_SCHEMA,
        "metadata": build_metadata(request, vendor),
        "idempotency_key": idempotency_key(request, task),
    }
    created = client.calls.create(**payload)
    call_id = str(created["id"])
    store.save(
        request.ticket_id,
        {"ticket_id": request.ticket_id, "call_id": call_id, "approver": args.approver, "mode": "live", "status": created.get("status")},
    )
    print(json.dumps({"ok": True, "call_id": call_id, "status": created.get("status"), "dialed": mask_phone(vendor.known_phone)}, indent=2), flush=True)
    call = client.calls.wait_for_result(call_id, interval_seconds=args.poll_seconds, timeout_seconds=args.timeout_seconds)
    return _finish(args, request, vendor, call, store, approver=args.approver, mode="live")


def cmd_status(args: argparse.Namespace) -> int:
    request, vendor, _ = _gate(args, live=False, approver=None)
    if vendor is None:
        raise KnownNumberError("vendor not in master")
    store = TicketStore(args.state_dir)
    existing = store.load(request.ticket_id)
    if not existing or not existing.get("call_id"):
        raise KnownNumberError(f"no call recorded for ticket {request.ticket_id}")
    call = _client().calls.get(existing["call_id"])
    if call.get("status") not in {"completed", "failed", "canceled"}:
        print(json.dumps({"ok": True, "call_id": call["id"], "status": call.get("status"), "terminal": False}, indent=2))
        return 0
    return _finish(args, request, vendor, call, store, approver=existing.get("approver"), mode=existing.get("mode", "live"))


def cmd_reconcile(args: argparse.Namespace) -> int:
    request, vendor, _ = _gate(args, live=False, approver=None)
    if vendor is None:
        raise KnownNumberError("vendor not in master")
    call = json.loads(args.call_json.read_text(encoding="utf-8"))
    store = TicketStore(args.state_dir)
    return _finish(args, request, vendor, call, store, approver=None, mode="offline")


def cmd_demo(args: argparse.Namespace) -> int:
    request = load_request(args.examples / "change_request.json")
    vendor = load_vendors(args.examples / "vendors.json")[request.vendor_id]
    rows = []
    for fixture in sorted(args.fixtures.glob("*.json")):
        call = json.loads(fixture.read_text(encoding="utf-8"))
        rec = reconcile(request, vendor, call)
        rows.append((fixture.stem, rec.verdict.value, rec.reasons[0] if rec.reasons else ""))
    width = max(len(r[0]) for r in rows)
    print(f"{'fixture'.ljust(width)}  {'verdict'.ljust(17)}  first reason")
    for name, verdict, reason in rows:
        print(f"{name.ljust(width)}  {verdict.ljust(17)}  {reason}")
    return 0


def _finish(args, request, vendor, call, store: TicketStore, *, approver, mode) -> int:
    rec = reconcile(request, vendor, call, code_secret=_code_secret())
    record = audit_record(request, vendor, rec, call=call, approver=approver, mode=mode, code_secret=_code_secret())
    store.save(request.ticket_id, {**(store.load(request.ticket_id) or {}), "call_id": call.get("id"), "status": call.get("status"), "audit": record})
    memo_path = store.root / f"{request.ticket_id}.memo.md"
    memo_path.write_text(memo(record, request, vendor), encoding="utf-8")
    print(json.dumps({"ok": True, "verdict": rec.verdict.value, "memo": str(memo_path), "audit": record}, indent=2))
    return 0 if rec.verdict.releases_change else 3


def _code_secret() -> str:
    return os.environ.get("KNOWN_NUMBER_CODE_SECRET", "")


def _client():
    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        raise KnownNumberError("CALLE_API_KEY is not set; export it from a private env file, never pass it on the command line")
    try:
        from calle import CalleClient
    except ImportError as exc:  # pragma: no cover
        raise KnownNumberError("install the SDK first: pip install calle-ai") from exc
    kwargs: dict[str, Any] = {"api_key": api_key}
    base_url = os.environ.get("CALLE_BASE_URL")
    if base_url:
        kwargs["base_url"] = base_url
    return CalleClient(**kwargs)


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
