#!/usr/bin/env python3
"""
Pharmacy stock check — reference implementation for the pharmacy-stock-check
Agent Skill.

Dry-run by default. Nothing is dialled without --live.

    python3 pharmacy_search.py --pharmacies pharmacies.csv           # no calls
    python3 pharmacy_search.py --pharmacies pharmacies.csv --live    # calls

Requires the CALL-E CLI to be authenticated (`calle auth login`) and fastmcp:

    npm install -g @call-e/cli && calle auth login
    pip install fastmcp

Sample numbers in this directory use the reserved fictional range
+1 555 0100–0199. Replace them with real E.164 numbers you have permission to
call.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastmcp import Client
from fastmcp.client.transports import StreamableHttpTransport

log = logging.getLogger("pharmacy-stock-check")

SERVER_URL = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"
TOKEN_CACHE = Path.home() / ".calle-mcp" / "cli"

TERMINAL_STATUSES = {"COMPLETED", "NO ANSWER", "DECLINED", "FAILED", "CANCELLED"}
TERMINAL_ACTIONS = {"report_result", "report_blocked", "none"}
BLOCKED_ACTIONS = {"ask_user_for_missing_info", "ask_user_for_retry_confirmation"}

FIELDS = [
    "in_stock", "form_available", "quantity_available", "unit_price", "currency",
    "requires_prescription", "can_hold", "hold_duration_hours",
    "alternative_suggested", "pharmacist_notes",
]
ENUMS = {
    "in_stock": {"yes", "no", "partial", "unknown"},
    "form_available": {"brand", "generic", "both", "unknown"},
    "requires_prescription": {"yes", "no", "unknown"},
    "can_hold": {"yes", "no", "unknown"},
}
NUMERIC = {"quantity_available", "unit_price", "hold_duration_hours"}
NULLISH = {"", "unknown", "unclear", "n/a", "na", "none", "not stated"}


# --------------------------------------------------------------------------
# Safety helpers
# --------------------------------------------------------------------------


def mask(phone: str) -> str:
    """Never print a full number in a summary or log."""
    return f"…{phone[-4:]}" if len(phone) >= 4 else "…"


def load_token() -> str:
    """Reuse the CALL-E CLI's cached token. The file shape is undocumented,
    so probe the likely key names rather than assuming one."""
    candidates = sorted(TOKEN_CACHE.glob("*/token.json"))
    if not candidates:
        raise SystemExit(f"No CALL-E token under {TOKEN_CACHE}. Run: calle auth login")
    data = json.loads(candidates[-1].read_text())
    for key in ("access_token", "accessToken", "token", "bearer"):
        value = data.get(key)
        if isinstance(value, str):
            return value
        if isinstance(value, dict):
            for inner in ("access_token", "accessToken", "token"):
                if isinstance(value.get(inner), str):
                    return value[inner]
    raise SystemExit(f"No access token found in {candidates[-1]}")


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class CallBudget:
    """Hard ceiling on outbound calls.

    `to_phones` is an array, so ONE plan can spend N calls. Always charge the
    number of phones, and check the whole batch before dialling anything.
    """

    max_calls: int
    spent: int = 0
    ledger: Path = field(default=Path(".pharmacy_budget.json"))

    def __post_init__(self) -> None:
        if self.ledger.exists():
            self.spent = json.loads(self.ledger.read_text()).get("spent", 0)

    @property
    def remaining(self) -> int:
        return max(0, self.max_calls - self.spent)

    def check(self, n: int) -> None:
        if n > self.remaining:
            raise BudgetExceeded(
                f"{n} call(s) needed, {self.remaining} left of {self.max_calls}."
            )

    def charge(self, n: int) -> None:
        self.check(n)
        self.spent += n
        self.ledger.write_text(json.dumps({"spent": self.spent}))
        log.warning("Placed %s call(s) — %s/%s used", n, self.spent, self.max_calls)


# --------------------------------------------------------------------------
# Goal and parsing
# --------------------------------------------------------------------------


def build_goal(drug: str, dosage: str, quantity: str) -> str:
    """MCP has no result_schema, so the field list lives in the prose.
    CALL-E honours these key names and emits them into result.summary."""
    return (
        "You are calling a pharmacy on behalf of a patient looking for a "
        "medication. Identify yourself as an automated assistant immediately, "
        "and keep the call brief and polite.\n\n"
        f"Find out whether they currently have {drug} {dosage} in stock. The "
        f"patient needs {quantity}.\n\n"
        "Capture these fields in the structured result, using exactly these key names:\n"
        "- in_stock: yes, no, partial, or unknown. Use partial if they have some "
        "but fewer than the patient needs.\n"
        "- form_available: brand, generic, both, or unknown\n"
        "- quantity_available: integer units they have\n"
        "- unit_price: number, price per unit\n"
        "- currency: three-letter currency code\n"
        "- requires_prescription: yes, no, or unknown\n"
        "- can_hold: yes, no, or unknown\n"
        "- hold_duration_hours: number of hours they will hold it\n"
        "- alternative_suggested: any alternative or other branch they mention\n"
        "- pharmacist_notes: anything else useful, one short sentence\n\n"
        "If they do not have it, still ask about alternatives or another branch. "
        "Do not place an order or commit to anything on the patient's behalf. "
        "Thank them and end the call. If nobody answers, report that the pharmacy "
        "could not be reached; do not treat that as a successful stock check."
    )


_FIELD_RE = re.compile(
    r"\b(" + "|".join(sorted(FIELDS, key=len, reverse=True)) + r")\s*=\s*", re.I
)


def parse_summary(summary: str) -> dict[str, str]:
    """Extraction arrives in result.summary as key=value pairs, not in
    result.extracted. Values contain commas, so split on key= boundaries."""
    if not summary:
        return {}
    matches = list(_FIELD_RE.finditer(summary))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(summary)
        value = summary[m.end():end].strip().strip(",").strip()
        out[m.group(1).lower()] = value.rstrip(".") if len(value) < 40 else value
    return out


def normalise(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in FIELDS:
        value = raw.get(name)
        text = str(value).strip().lower() if value is not None else ""
        if name in ENUMS:
            out[name] = text if text in ENUMS[name] else "unknown"
        elif name in NUMERIC:
            match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
            out[name] = float(match.group()) if match else None
        else:
            out[name] = None if text in NULLISH else str(value).strip()
    return out


def to_record(final: dict[str, Any], pharmacy: dict[str, str]) -> dict[str, Any]:
    result = final.get("result") or {}
    summary = result.get("summary") or result.get("post_summary") or ""
    record = normalise(parse_summary(summary))

    outcome = result.get("outcome") or {}
    confidence = outcome.get("completion_confidence") or {}
    record.update(
        pharmacy=pharmacy.get("name"),
        phone_masked=mask(pharmacy.get("phone", "")),
        run_status=final.get("status"),
        confidence=confidence.get("score"),
        evidence=outcome.get("evidence") or [],
        transcript=result.get("transcript"),
    )
    return record


def rank(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """In stock first, then cheapest, then whoever will hold it.

    Low-confidence results sink: a reliable "no" beats an unreliable "yes"
    that sends someone across town while unwell.
    """
    order = {"yes": 0, "partial": 1, "unknown": 2, "no": 3}

    def key(r: dict[str, Any]):
        conf = r.get("confidence")
        return (
            order.get(r.get("in_stock"), 3),
            0 if (conf is None or conf >= 0.6) else 1,
            r["unit_price"] if r.get("unit_price") is not None else float("inf"),
            0 if r.get("can_hold") == "yes" else 1,
        )

    return sorted(records, key=key)


# --------------------------------------------------------------------------
# CALL-E
# --------------------------------------------------------------------------


class Caller:
    def __init__(self, budget: CallBudget, *, dry_run: bool = True) -> None:
        self.budget = budget
        self.dry_run = dry_run
        self._token = load_token()

    def _client(self) -> Client:
        return Client(StreamableHttpTransport(
            SERVER_URL, headers={"Authorization": f"Bearer {self._token}"}
        ))

    @staticmethod
    def _unwrap(result: Any) -> dict[str, Any]:
        if getattr(result, "structured_content", None):
            return result.structured_content
        if getattr(result, "data", None):
            return result.data
        blocks = getattr(result, "content", None) or []
        if blocks and hasattr(blocks[0], "text"):
            return json.loads(blocks[0].text)
        return {}

    async def call(self, pharmacy: dict[str, str], goal: str, region: str
                   ) -> dict[str, Any] | None:
        phone = pharmacy["phone"]

        async with self._client() as client:
            plan = self._unwrap(await client.call_tool("plan_call", {
                "goal": goal, "to_phones": [phone], "region": region,
                "language": "English", "ttl_seconds": 0, "user_input": goal,
            }))

        if not plan.get("ready_to_run"):
            log.warning("  %s: planner needs more detail — %s",
                        mask(phone), plan.get("clarifying_questions"))
            return None

        if self.dry_run:
            print(f"  DRY RUN {pharmacy['name']} ({mask(phone)}) — "
                  f"plan {plan['plan_id']}, would spend 1 call")
            return None

        expires = plan.get("confirm_expires_at")
        if expires:
            exp = datetime.fromisoformat(expires.replace("Z", "+00:00"))
            if exp < datetime.now(timezone.utc):
                log.error("  %s: confirm_token expired", mask(phone))
                return None

        self.budget.charge(1)
        async with self._client() as client:
            run = self._unwrap(await client.call_tool("run_call", {
                "plan_id": plan["plan_id"], "confirm_token": plan["confirm_token"],
            }))
            run_id = run.get("run_id")
            if not run_id:
                return None

            seen: set[str] = set()
            deadline = time.time() + 900
            delay = 2.0
            while time.time() < deadline:
                final = self._unwrap(
                    await client.call_tool("get_call_run", {"run_id": run_id})
                )
                status = (final.get("status") or "").upper()
                nxt = final.get("next_step")
                nxt = nxt if isinstance(nxt, dict) else {}

                # The activity feed is cumulative on every poll — dedupe.
                for entry in final.get("activity", []):
                    key = f"{entry.get('ts')}|{entry.get('message')}"
                    if key not in seen:
                        seen.add(key)
                        log.info("    %s", entry.get("message"))

                action = nxt.get("action")
                if status in TERMINAL_STATUSES or action in TERMINAL_ACTIONS:
                    return to_record(final, pharmacy)
                if action in BLOCKED_ACTIONS:
                    log.warning("  %s: needs user input — %s",
                                mask(phone), nxt.get("instruction"))
                    return None

                delay = float(nxt.get("poll_after_seconds") or delay)
                await asyncio.sleep(min(delay, 15.0))
        return None


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


async def main() -> None:
    parser = argparse.ArgumentParser(description="Pharmacy stock check")
    parser.add_argument("--pharmacies", type=Path, default=Path("pharmacies.csv"))
    parser.add_argument("--drug", default="amoxicillin")
    parser.add_argument("--dosage", default="500mg")
    parser.add_argument("--quantity", default="21 capsules")
    parser.add_argument("--region", default="US")
    parser.add_argument("--max-calls", type=int, default=3)
    parser.add_argument("--concurrency", type=int, default=3)
    parser.add_argument("--live", action="store_true",
                        help="ACTUALLY PLACE CALLS. Without this, nothing is dialled.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if not args.pharmacies.exists():
        raise SystemExit(f"No such file: {args.pharmacies}")
    with args.pharmacies.open() as fh:
        pharmacies = [row for row in csv.DictReader(fh) if row.get("phone")]

    budget = CallBudget(max_calls=args.max_calls)
    if args.live:
        # Fail before dialling anything, not halfway through the batch.
        budget.check(len(pharmacies))

    caller = Caller(budget, dry_run=not args.live)
    goal = build_goal(args.drug, args.dosage, args.quantity)

    print(f"\n{args.drug} {args.dosage} — {args.quantity} · "
          f"{len(pharmacies)} pharmacies · "
          f"{'LIVE' if args.live else 'dry run, no calls'}\n")

    semaphore = asyncio.Semaphore(args.concurrency)

    async def one(pharmacy: dict[str, str]):
        async with semaphore:
            try:
                return await caller.call(pharmacy, goal, args.region)
            except Exception as exc:
                log.error("  %s failed: %s", pharmacy.get("name"), exc)
                return None

    results = [r for r in await asyncio.gather(*(one(p) for p in pharmacies)) if r]
    if not results:
        return

    print(f"\n{'Pharmacy':<26} {'Stock':<9} {'Qty':>5} {'Price':>10} "
          f"{'Rx':<8} {'Hold':>6} {'Conf':>6}")
    print("-" * 76)
    for r in rank(results):
        hold = f"{r['hold_duration_hours']:.0f}h" if r.get("hold_duration_hours") else "—"
        price = (f"{r['unit_price']:g} {r.get('currency') or ''}".strip()
                 if r.get("unit_price") is not None else "—")
        print(f"{(r['pharmacy'] or '?')[:26]:<26} {r['in_stock']:<9} "
              f"{r['quantity_available'] or '—':>5} {price:>10} "
              f"{r['requires_prescription']:<8} {hold:>6} "
              f"{r['confidence'] if r['confidence'] is not None else '—':>6}")
        if r.get("pharmacist_notes"):
            print(f"    {r['pharmacist_notes']}")
    print()


if __name__ == "__main__":
    asyncio.run(main())
