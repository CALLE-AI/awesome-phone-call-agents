from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .approval import ApprovalReceipt, create_approval
from .calle_transport import OFFICIAL_BASE_URL, OfficialCalleTransport
from .demo import run_demo
from .ledger import CallLedger
from .models import load_case
from .preview import preview_digest
from .workflow import PawPassageWorkflow

REAL_CALL_ACKNOWLEDGEMENT = "I_APPROVE_ONE_REAL_CALL"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pawpassage",
        description="Approval-gated CALL-E evidence checks for cross-border pet journeys.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    demo = subparsers.add_parser(
        "demo", help="Run the complete local fake-server demo."
    )
    demo.add_argument(
        "--case",
        type=Path,
        default=Path(__file__).with_name("data") / "fictional_hkg_kul_journey.json",
    )
    demo.add_argument("--output-dir", type=Path, default=Path.cwd() / "artifacts")

    prepare = subparsers.add_parser(
        "prepare", help="Render a masked exact-call preview."
    )
    prepare.add_argument("--case", type=Path, required=True)
    prepare.add_argument("--checkpoint", required=True)
    prepare.add_argument("--output", type=Path)

    approve = subparsers.add_parser(
        "approve", help="Create a content-bound approval receipt."
    )
    approve.add_argument("--case", type=Path, required=True)
    approve.add_argument("--checkpoint", required=True)
    approve.add_argument("--digest", required=True)
    approve.add_argument("--operator", required=True)
    approve.add_argument("--mode", choices=("fake", "live"), required=True)
    approve.add_argument("--output", type=Path, required=True)

    live = subparsers.add_parser(
        "execute-live", help="Place at most one explicitly approved real call."
    )
    live.add_argument("--case", type=Path, required=True)
    live.add_argument("--checkpoint", required=True)
    live.add_argument("--approval", type=Path, required=True)
    live.add_argument("--ledger", type=Path, required=True)
    live.add_argument(
        "--window-start", required=True, help="ISO-8601 instant with timezone."
    )
    live.add_argument(
        "--window-end", required=True, help="ISO-8601 instant with timezone."
    )
    live.add_argument("--confirm-real-call", required=True)

    reconcile = subparsers.add_parser(
        "reconcile-live", help="Read one previously accepted call; never dial."
    )
    reconcile.add_argument("--case", type=Path, required=True)
    reconcile.add_argument("--checkpoint", required=True)
    reconcile.add_argument("--approval", type=Path, required=True)
    reconcile.add_argument("--ledger", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "demo":
            packet, json_path, html_path = run_demo(args.case, args.output_dir)
            print("PawPassage fake-server demo completed.")
            print(f"Overall disposition: {packet['overallDisposition']}")
            print(
                f"Fake SDK submissions: {packet['providerBoundary']['fakeServerCreateRequests']}"
            )
            print(f"Real calls: {packet['providerBoundary']['realCalls']}")
            print(f"JSON report: {json_path}")
            print(f"HTML report: {html_path}")
            return 0
        if args.command == "prepare":
            case = load_case(args.case)
            checkpoint = case.checkpoint(args.checkpoint)
            preview = PawPassageWorkflow(CallLedger(Path(":memory:"))).prepare(
                case, checkpoint
            )
            packet = {"preview": preview, "approvalDigest": preview_digest(preview)}
            _emit(packet, args.output)
            return 0
        if args.command == "approve":
            case = load_case(args.case)
            checkpoint = case.checkpoint(args.checkpoint)
            preview = PawPassageWorkflow(CallLedger(Path(":memory:"))).prepare(
                case, checkpoint
            )
            receipt = create_approval(
                preview,
                presented_digest=args.digest,
                approved_by=args.operator,
                mode=args.mode,
            )
            _emit(receipt.to_dict(), args.output)
            return 0
        if args.command == "execute-live":
            return _execute_live(args)
        if args.command == "reconcile-live":
            return _reconcile_live(args)
    except Exception as error:  # noqa: BLE001 - CLI must fail closed with a bounded message
        print(f"Blocked safely: {type(error).__name__}: {error}", file=sys.stderr)
        return 2
    return 2


def _execute_live(args: argparse.Namespace) -> int:
    if os.environ.get("PAWPASSAGE_LIVE_CALLS") != "ENABLED":
        raise ValueError("PAWPASSAGE_LIVE_CALLS must be exactly ENABLED")
    if args.confirm_real_call != REAL_CALL_ACKNOWLEDGEMENT:
        raise ValueError(
            f"--confirm-real-call must be exactly {REAL_CALL_ACKNOWLEDGEMENT}"
        )
    _verify_live_window(args.window_start, args.window_end)
    api_key = os.environ.get("CALLE_API_KEY", "")
    if not api_key:
        raise ValueError("CALLE_API_KEY is required for live mode")
    case = load_case(args.case)
    checkpoint = case.checkpoint(args.checkpoint)
    if os.environ.get("PAWPASSAGE_ALLOWED_RECIPIENT_E164") != checkpoint.phone_e164:
        raise ValueError("Recipient does not match PAWPASSAGE_ALLOWED_RECIPIENT_E164")
    receipt = ApprovalReceipt.from_dict(_read_json(args.approval))
    workflow = PawPassageWorkflow(CallLedger(args.ledger))
    transport = OfficialCalleTransport(
        api_key=api_key, base_url=OFFICIAL_BASE_URL, live=True
    )
    report = workflow.execute(
        case=case,
        checkpoint=checkpoint,
        approval=receipt,
        transport=transport,
        mode="live",
    )
    print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    return 0


def _reconcile_live(args: argparse.Namespace) -> int:
    if not args.ledger.is_file():
        raise ValueError("Read-only reconciliation requires an existing ledger")
    api_key = os.environ.get("CALLE_API_KEY", "")
    if not api_key:
        raise ValueError("CALLE_API_KEY is required to read an existing live call")
    case = load_case(args.case)
    checkpoint = case.checkpoint(args.checkpoint)
    if os.environ.get("PAWPASSAGE_ALLOWED_RECIPIENT_E164") != checkpoint.phone_e164:
        raise ValueError("Recipient does not match PAWPASSAGE_ALLOWED_RECIPIENT_E164")
    receipt = ApprovalReceipt.from_dict(_read_json(args.approval))
    workflow = PawPassageWorkflow(CallLedger(args.ledger))
    transport = OfficialCalleTransport(
        api_key=api_key, base_url=OFFICIAL_BASE_URL, live=True
    )
    report = workflow.reconcile(
        case=case,
        checkpoint=checkpoint,
        approval=receipt,
        transport=transport,
        mode="live",
    )
    print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    return 0


def _verify_live_window(
    start_raw: str, end_raw: str, now: datetime | None = None
) -> None:
    start = _parse_instant(start_raw)
    end = _parse_instant(end_raw)
    current = (now or datetime.now(UTC)).astimezone(UTC)
    if end <= start:
        raise ValueError("Live call window end must be after start")
    if end - start > timedelta(hours=4):
        raise ValueError("Live call window may not exceed four hours")
    if not start <= current <= end:
        raise ValueError(
            "Current time is outside the explicitly approved live call window"
        )


def _parse_instant(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError("Call window values must be ISO-8601 instants") from error
    if parsed.tzinfo is None:
        raise ValueError("Call window values must include a timezone")
    return parsed.astimezone(UTC)


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _emit(value: Any, output: Path | None) -> None:
    rendered = json.dumps(value, indent=2, sort_keys=True) + "\n"
    if output is None:
        print(rendered, end="")
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(rendered, encoding="utf-8")
    print(f"Wrote {output}")


if __name__ == "__main__":
    raise SystemExit(main())
