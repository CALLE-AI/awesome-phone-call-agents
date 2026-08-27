from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from .calle import CalleAPIError, CalleClient
from .core import (
    PartLineError,
    SourcingRequest,
    approval_token,
    build_payload,
    build_plan,
    idempotency_key,
    rank_results,
)
from .web import serve_web


def _print_json(data: Any) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False))


def _load_json(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _attach_supplier_names(result: dict[str, Any], request: SourcingRequest) -> None:
    for index, recipient in enumerate(result.get("recipients", [])):
        if index < len(request.suppliers):
            recipient.setdefault("name", request.suppliers[index].name)


def _clip(value: Any, width: int) -> str:
    text = "-" if value in (None, "") else str(value)
    return text if len(text) <= width else f"{text[: width - 1]}…"


def _print_preview(plan: dict[str, Any], path: str) -> None:
    print("PARTLINE  /  CALL PREVIEW")
    print("=" * 72)
    print(f"Request     {plan['request_id']}")
    print(f"Purpose     {plan['purpose']}")
    window = plan["call_window"]
    print(
        f"Window      Weekdays {window['start']}–{window['end']} {window['timezone']}"
    )
    print(f"Side effect {plan['side_effect']}")
    print(f"Authority   Purchase authority: {plan['purchase_authority']}")
    print("\nAPPROVED CONTACTS")
    print(f"{'Supplier':30} {'Masked number':18} Authorization")
    print("-" * 72)
    for recipient in plan["recipients"]:
        print(
            f"{_clip(recipient['name'], 30):30} "
            f"{recipient['phone']:18} "
            f"{_clip(recipient['authorization_reference'], 22)}"
        )
    print("\nCALL GOAL")
    print(plan["task"])
    print("\nAPPROVAL CHECKPOINT")
    print("No call was placed. Review this exact request before approving it.")
    print(f"Token        {plan['approval_token']}")
    print(f"Live command partline run {path} --live --confirm {plan['approval_token']}")


def _print_summary(result: dict[str, Any], ranked: list[dict[str, Any]]) -> None:
    print("PARTLINE  /  SOURCING BRIEF")
    print("=" * 86)
    print(f"CALL-E task  {result.get('id') or result.get('call_id') or '-'}")
    print(f"Status       {str(result.get('status') or 'unknown').upper()}")
    print("\nCANDIDATE COMPARISON")
    print(f"{'Supplier':26} {'Match':11} {'Qty':5} {'Lead':7} {'Ship date':12} Decision")
    print("-" * 86)
    for item in ranked:
        decision = "Review" if item["needs_human_followup"] else "Candidate"
        lead = f"{item['lead_time_days']}d" if item.get("lead_time_days") is not None else "-"
        print(
            f"{_clip(item['supplier'], 26):26} "
            f"{item['match_status'].upper():11} "
            f"{_clip(item.get('quantity_available'), 5):5} "
            f"{lead:7} "
            f"{_clip(item.get('earliest_ship_date'), 12):12} "
            f"{decision}"
        )
    print("\nEVIDENCE")
    for item in ranked:
        print(f"• {item['supplier']}: {_clip(item.get('evidence_quote'), 76)}")
        if item.get("alternative_caveats"):
            print(f"  Caveat: {item['alternative_caveats']}")
    print("\nHUMAN DECISION REQUIRED")
    print("PartLine does not purchase, reserve stock, approve alternates or accept supplier terms.")


def preview(path: str, as_json: bool = False) -> int:
    request = SourcingRequest.load(path)
    plan = build_plan(request)
    if as_json:
        _print_json(plan)
    else:
        _print_preview(plan, path)
    return 0


def run_live(path: str, live: bool, confirmation: str | None, no_wait: bool) -> int:
    request = SourcingRequest.load(path)
    expected = approval_token(request)
    if not live:
        raise PartLineError("Live execution requires --live. Use preview first.")
    if confirmation != expected:
        raise PartLineError("Approval token does not match this exact sourcing request.")
    if not request.call_window.is_open():
        raise PartLineError(
            "The configured supplier calling window is closed. Run preview now and execute during the window."
        )
    client = CalleClient(
        api_key=os.environ.get("CALLE_API_KEY", ""),
        base_url=os.environ.get("CALLE_BASE_URL", "https://api.heycall-e.com"),
    )
    created = client.create_call(build_payload(request), idempotency_key(request))
    call_id = str(created.get("id") or created.get("call_id") or "")
    if not call_id:
        raise CalleAPIError("CALL-E created a task but did not return a call ID.")
    print(f"CALL-E task created: {call_id}")
    print("Do not run the command again. The idempotency key protects this approved batch.")
    if no_wait:
        return 0
    completed = client.wait_for_completion(call_id)
    _attach_supplier_names(completed, request)
    _print_json(
        {
            "call_id": call_id,
            "status": completed.get("status"),
            "candidates": rank_results(completed, request),
        }
    )
    return 0


def summarize(
    path: str, request_path: str | None = None, as_json: bool = False
) -> int:
    result = _load_json(path)
    request = SourcingRequest.load(request_path) if request_path else None
    if request is not None:
        _attach_supplier_names(result, request)
    ranked = rank_results(result, request)
    if as_json:
        _print_json(
            {
                "call_id": result.get("id") or result.get("call_id"),
                "status": result.get("status"),
                "candidates": ranked,
                "decision": "Human review required before any purchase, reservation or supplier commitment.",
            }
        )
    else:
        _print_summary(result, ranked)
    return 0


def web(request_path: str, result_path: str, host: str, port: int) -> int:
    serve_web(request_path, result_path, host=host, port=port)
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="partline",
        description="Evidence-backed industrial part sourcing with CALL-E.",
    )
    commands = root.add_subparsers(dest="command", required=True)
    preview_parser = commands.add_parser("preview", help="Create a masked no-call preview.")
    preview_parser.add_argument("request")
    preview_parser.add_argument("--json", action="store_true", help="Print machine-readable output.")
    run_parser = commands.add_parser("run", help="Place an explicitly approved CALL-E batch.")
    run_parser.add_argument("request")
    run_parser.add_argument("--live", action="store_true")
    run_parser.add_argument("--confirm")
    run_parser.add_argument("--no-wait", action="store_true")
    summarize_parser = commands.add_parser("summarize", help="Rank a completed CALL-E result.")
    summarize_parser.add_argument("result")
    summarize_parser.add_argument("--request", help="Validate exact matches against the original request.")
    summarize_parser.add_argument("--json", action="store_true", help="Print machine-readable output.")
    web_parser = commands.add_parser("web", help="Open the local evidence review console.")
    web_parser.add_argument(
        "--request",
        default="fixtures/example-request.json",
        help="Sourcing request used by the console.",
    )
    web_parser.add_argument(
        "--result",
        default="fixtures/completed-call.json",
        help="Completed CALL-E result used by the console.",
    )
    web_parser.add_argument("--host", default="127.0.0.1", choices=("127.0.0.1", "localhost", "::1"))
    web_parser.add_argument("--port", default=8787, type=int)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "preview":
            return preview(args.request, args.json)
        if args.command == "run":
            return run_live(args.request, args.live, args.confirm, args.no_wait)
        if args.command == "summarize":
            return summarize(args.result, args.request, args.json)
        if args.command == "web":
            return web(args.request, args.result, args.host, args.port)
    except (PartLineError, CalleAPIError, OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"PartLine refused: {exc}", file=sys.stderr)
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
