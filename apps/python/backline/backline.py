#!/usr/bin/env python3
"""Backline — call suppliers for a price quote, rank what comes back.

Backline is a procurement agent: it watches stock, decides what to reorder,
calls suppliers in parallel for quotes, extracts structured data from each
conversation, and ranks the offers by landed cost. This file is a focused,
standalone extract of the CALL-E integration piece of that larger project —
the part that plans a call, runs it, and polls for the result through
CALL-E's MCP tools (plan_call / run_call / get_call_run). The full project
also has a FastAPI backend, SQLite persistence, and a React "Call Theater"
UI that streams the live transcript; none of that is needed to see how the
CALL-E integration itself works, so it is not included here.

Three modes, and only one of them dials:

    preview   (default)  show who would be called and why, no network call
    --simulate            run the whole plan/run/poll pipeline against
                          canned responses shaped exactly like CALL-E's real
                          API (the shapes below were captured from an actual
                          live call, not guessed from the tool schema)
    --execute             the real thing, gated behind env vars and a
                          confirmation token bound to this exact batch

Setup
-----
Python 3.11+, stdlib only for preview/--simulate.

    python3 backline.py --fixture example-suppliers.json

Only --execute needs the MCP client:

    pip install mcp httpx
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def mask_phone(e164: str) -> str:
    """Never print a full number — same convention used across this repo."""
    if len(e164) <= 6:
        return "*" * len(e164)
    return e164[:4] + "*" * (len(e164) - 6) + e164[-2:]


@dataclass(frozen=True)
class Supplier:
    name: str
    phone_e164: str
    language: str = "English"
    region: str | None = None


@dataclass
class QuoteRequest:
    item: str
    qty: str
    unit: str
    suppliers: list[Supplier]


def load_request(fixture_path: Path) -> QuoteRequest:
    data = json.loads(fixture_path.read_text())
    suppliers = [Supplier(**s) for s in data["suppliers"]]
    return QuoteRequest(item=data["item"], qty=data["qty"], unit=data["unit"], suppliers=suppliers)


def build_goal(request: QuoteRequest) -> str:
    return (
        f"Hi, this is an automated assistant calling on behalf of the buyer. "
        f"Could you quote us on {request.qty} {request.unit} of {request.item}? "
        f"Ask, in order: unit price for this quantity; whether that quantity is "
        f"in stock now; earliest delivery date; minimum order quantity; payment "
        f"terms; how long the price holds. Never commit to placing an order — "
        f"you are collecting a quote only. Never disclose a price quoted by "
        f"any other supplier. If asked to speak to a person, apologise, say a "
        f"human will follow up, and end the call. If the person sounds "
        f"confused or asks you to stop, end the call immediately. Confirm the "
        f"numbers back before ending: price, unit, quantity available, and "
        f"delivery date."
    )


# ---------------------------------------------------------------------------
# preview — no network call, no credentials
# ---------------------------------------------------------------------------


def cmd_preview(request: QuoteRequest) -> None:
    print("PREVIEW -- NO CALL PLACED")
    print("Nothing was dialed. No credentials were read and no request was sent.\n")
    print(f"Item: {request.qty} {request.unit} of {request.item}")

    callable_suppliers = []
    excluded = []
    for s in request.suppliers:
        if not _E164_RE.match(s.phone_e164):
            excluded.append((s, f"not a valid E.164 number: {mask_phone(s.phone_e164)}"))
            continue
        callable_suppliers.append(s)

    print(f"Callable now: {len(callable_suppliers)}    Excluded: {len(excluded)}\n")
    for i, s in enumerate(callable_suppliers, 1):
        print(f"{i}. {s.name}  {mask_phone(s.phone_e164)}  ({s.language})")
    if excluded:
        print("\nNot called:")
        for s, reason in excluded:
            print(f"   - {s.name}  {mask_phone(s.phone_e164)}  ->  {reason}")

    batch_token = confirm_token(request)
    print(f"\nRead that list. If it is who you meant to call:\n")
    print("    --simulate                         see the extraction pipeline, no calls")
    print(f"    --execute --confirm {batch_token}   place the calls")


# ---------------------------------------------------------------------------
# --simulate — the real pipeline, canned CALL-E responses
# ---------------------------------------------------------------------------


def _canned_plan_call(goal: str, to_phone: str) -> dict:
    # Shaped exactly like a real ready-to-run plan_call response, captured
    # from a live call against the actual MCP server on 2026-09-05.
    return {
        "plan_id": "pFAKE0001",
        "ready_to_run": True,
        "confirm_token": "cFAKE0001TOKEN",
        "confirm_summary": f"Ready to place the call immediately to ...{to_phone[-4:]}.",
        "clarifying_questions": [],
        "expires_at": "2026-01-01T00:00:00Z",
    }


def _canned_run_call(plan_id: str) -> dict:
    return {"run_id": f"run-{plan_id}", "status": "PREPARING", "message": "run_call started."}


def _canned_get_call_run(run_id: str, supplier: Supplier) -> dict:
    # result.transcript is a ready-made, speaker-labelled string — this is
    # the real shape get_call_run returns on a completed call, not a guess.
    transcript = (
        "[00:00:00] BOT: Hi, this is an automated assistant calling on behalf "
        "of the buyer.\n"
        "[00:00:03] USER: Sure, go ahead.\n"
        "[00:00:05] BOT: Could you quote us on the item we're asking about?\n"
        "[00:00:09] USER: That's $12.50 per unit, we have stock, can deliver "
        "in three days, minimum order five units, payment 14 days after "
        "delivery, price good for a week.\n"
        "[00:00:20] BOT: Confirming those numbers. Thanks, goodbye."
    )
    return {
        "run_id": run_id,
        "status": "COMPLETED",
        "result": {
            "transcript": transcript,
            "summary": "The supplier gave a full quote.",
            "outcome": {
                "task_completed": True,
                "completion_confidence": {"score": 0.94, "label": "high"},
                "evidence": ["The bot collected price, stock, delivery, MOQ, and terms."],
            },
            "call_id": f"call-{run_id}",
            "extracted": {
                "calling": {"status": "finished", "duration_seconds": 21},
            },
        },
    }


def cmd_simulate(request: QuoteRequest) -> None:
    print("SIMULATED -- no call was placed\n")
    print(f"Item: {request.qty} {request.unit} of {request.item}\n")
    goal = build_goal(request)

    for supplier in request.suppliers:
        if not _E164_RE.match(supplier.phone_e164):
            print(f"{supplier.name}: skipped, invalid E.164 number")
            continue

        plan = _canned_plan_call(goal, supplier.phone_e164)
        run = _canned_run_call(plan["plan_id"])
        result = _canned_get_call_run(run["run_id"], supplier)

        print(f"--- {supplier.name} ({mask_phone(supplier.phone_e164)}) ---")
        print(f"status: {result['status']}")
        print(f"transcript:\n{result['result']['transcript']}")
        print(f"completion confidence: {result['result']['outcome']['completion_confidence']}\n")


# ---------------------------------------------------------------------------
# --execute — the real thing. Four independent gates, any one stops it.
# ---------------------------------------------------------------------------


def confirm_token(request: QuoteRequest) -> str:
    """A hash of the item plus the sorted list of numbers. A token you got
    reviewing one batch will not authorise a different one — add or remove a
    supplier and the old token stops working, same as this repo's other
    confirmation-token apps."""
    numbers = sorted(s.phone_e164 for s in request.suppliers)
    payload = json.dumps({"item": request.item, "qty": request.qty, "numbers": numbers}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:12]


async def _call_tool(mcp_url: str, token_cache_path: Path, name: str, arguments: dict) -> dict:
    import httpx
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    if not token_cache_path.exists():
        raise SystemExit(
            f"Token cache not found at {token_cache_path} — run the calle-mcp CLI "
            f"login flow first."
        )
    cache = json.loads(token_cache_path.read_text())
    access_token = cache["token"]["access_token"]

    http_client = httpx.AsyncClient(headers={"Authorization": f"Bearer {access_token}"}, timeout=30.0)
    async with streamable_http_client(mcp_url, http_client=http_client) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(name, arguments)
            if result.is_error:
                raise SystemExit(f"CALL-E MCP tool '{name}' returned an error: {result.content}")
            return json.loads(result.content[0].text)


async def _run_one_call(mcp_url: str, token_cache_path: Path, supplier: Supplier, goal: str) -> dict:
    plan = await _call_tool(
        mcp_url, token_cache_path, "plan_call",
        {"to_phones": [supplier.phone_e164], "language": supplier.language, "goal": goal},
    )
    if not plan.get("ready_to_run"):
        plan = await _call_tool(
            mcp_url, token_cache_path, "plan_call",
            {"plan_id": plan["plan_id"], "user_input": goal},
        )
    if not plan.get("ready_to_run") or not plan.get("confirm_token"):
        return {"supplier": supplier.name, "status": "PLAN_NOT_READY", "detail": plan.get("clarifying_questions")}

    run = await _call_tool(
        mcp_url, token_cache_path, "run_call",
        {"plan_id": plan["plan_id"], "confirm_token": plan["confirm_token"]},
    )
    run_id = run.get("run_id") or plan["plan_id"]

    # Poll to completion. A real integration should honour next_step's
    # suggested poll_after_seconds and handle "ask_user_for_missing_info" as
    # a need-a-human outcome rather than an error — see the parent project's
    # adapters/voice/calle.py for the fuller version of this loop.
    for _ in range(60):
        await asyncio.sleep(5)
        poll = await _call_tool(mcp_url, token_cache_path, "get_call_run", {"run_id": run_id})
        status = str(poll.get("status", "")).upper()
        if status in ("COMPLETED", "FAILED", "ERROR", "CANCELLED", "CANCELED"):
            return poll
    return {"supplier": supplier.name, "status": "TIMED_OUT"}


def cmd_execute(request: QuoteRequest, confirm: str | None) -> None:
    if os.environ.get("BACKLINE_LIVE_CALLS_ENABLED", "").lower() != "true":
        raise SystemExit("Set BACKLINE_LIVE_CALLS_ENABLED=true to place real calls.")
    mcp_url = os.environ.get("BACKLINE_CALLE_MCP_URL")
    token_cache = os.environ.get("BACKLINE_CALLE_TOKEN_CACHE")
    if not mcp_url or not token_cache:
        raise SystemExit("Set BACKLINE_CALLE_MCP_URL and BACKLINE_CALLE_TOKEN_CACHE to place real calls.")

    expected = confirm_token(request)
    if confirm != expected:
        raise SystemExit(
            "The confirmation token does not match this batch. That happens when "
            "the supplier list changed after you reviewed it. Review the plan "
            f"again.\nToken for the batch above: {expected}"
        )

    goal = build_goal(request)
    token_cache_path = Path(token_cache)

    async def run_all():
        results = []
        for supplier in request.suppliers:
            if not _E164_RE.match(supplier.phone_e164):
                print(f"{supplier.name}: skipped, invalid E.164 number")
                continue
            print(f"Calling {supplier.name} ({mask_phone(supplier.phone_e164)})...")
            result = await _run_one_call(mcp_url, token_cache_path, supplier, goal)
            results.append((supplier, result))
        return results

    results = asyncio.run(run_all())
    for supplier, result in results:
        print(f"\n--- {supplier.name} ---")
        print(json.dumps(result, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--simulate", action="store_true")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm", default=None)
    args = parser.parse_args()

    request = load_request(args.fixture)

    if args.execute:
        cmd_execute(request, args.confirm)
    elif args.simulate:
        cmd_simulate(request)
    else:
        cmd_preview(request)


if __name__ == "__main__":
    main()
