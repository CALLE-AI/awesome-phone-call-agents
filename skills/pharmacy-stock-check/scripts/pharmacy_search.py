#!/usr/bin/env python3
"""
Pharmacy stock check — reference implementation for the pharmacy-stock-check
Agent Skill.

Dry run is FULLY OFFLINE. It loads no credentials, opens no socket, and sends
no phone number or medication context anywhere. It validates the input and
prints the exact payload it would send. Only --live touches the network.

    python3 pharmacy_search.py --pharmacies pharmacies.csv           # offline
    python3 pharmacy_search.py --pharmacies pharmacies.csv --live    # calls

Live mode requires the CALL-E CLI to be authenticated and fastmcp installed:

    npm install -g @call-e/cli && calle auth login
    pip install fastmcp

Sample numbers use the reserved fictional range +1 555 0100–0199. Replace them
with real E.164 numbers you have permission to call.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("pharmacy-stock-check")

SERVER_URL = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"
TOKEN_CACHE = Path.home() / ".calle-mcp" / "cli"

TERMINAL_STATUSES = {"COMPLETED", "NO ANSWER", "DECLINED", "FAILED", "CANCELLED"}
TERMINAL_ACTIONS = {"report_result", "report_blocked", "none"}
BLOCKED_ACTIONS = {"ask_user_for_missing_info", "ask_user_for_retry_confirmation"}

# E.164: a plus, a non-zero country code digit, then 7-14 more digits.
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")

# Below this, a result is reported but never allowed to outrank a verified one.
MIN_CONFIDENCE = 0.6

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
# Validation
# --------------------------------------------------------------------------


class InvalidPhoneNumber(ValueError):
    pass


def validate_e164(phone: str) -> str:
    """Reject anything that isn't E.164 before it can be dialled.

    Documenting the requirement isn't enough — a local-format number silently
    reaching the planner is how the wrong person gets called.
    """
    cleaned = (phone or "").strip().replace(" ", "").replace("-", "")
    if not E164_RE.match(cleaned):
        raise InvalidPhoneNumber(
            f"{phone!r} is not E.164. Expected + followed by country code and "
            f"number, 8-15 digits total, e.g. +15550100. Do not guess a "
            f"country code — ask the user."
        )
    return cleaned


def mask(phone: str) -> str:
    """Never print a full number in a summary or log."""
    return f"…{phone[-4:]}" if len(phone) >= 4 else "…"


# --------------------------------------------------------------------------
# Budget
# --------------------------------------------------------------------------


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
# Durable run state
# --------------------------------------------------------------------------


@dataclass
class RunStore:
    """Persisted plan and run IDs, so an interruption resumes instead of redials.

    Without this, a lost response or a killed process means the next invocation
    plans afresh and calls the pharmacist a second time — spending a call and
    bothering a real person. `plan_id` is CALL-E's idempotency key, so it only
    protects you if it survives the crash.
    """

    path: Path = field(default=Path(".pharmacy_runs.json"))

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        try:
            return json.loads(self.path.read_text())
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def key(phone: str, goal: str) -> str:
        return hashlib.sha256(f"{phone}|{goal}".encode()).hexdigest()[:32]

    def get(self, key: str) -> dict[str, Any]:
        return self._load().get(key, {})

    def put(self, key: str, **fields: Any) -> None:
        data = self._load()
        entry = data.setdefault(key, {})
        entry.update(fields)
        entry["updated_at"] = datetime.now(timezone.utc).isoformat()
        self.path.write_text(json.dumps(data, indent=2))

    def clear(self, key: str) -> None:
        data = self._load()
        data.pop(key, None)
        self.path.write_text(json.dumps(data, indent=2))


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
    result.extracted. Values contain commas, so split on key= boundaries.

    The separator between fields is not stable — both ", " and "; " observed.
    """
    if not summary:
        return {}
    matches = list(_FIELD_RE.finditer(summary))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(summary)
        value = summary[m.end():end].strip().strip(",;").strip()
        out[m.group(1).lower()] = value.rstrip(".;,") if len(value) < 40 else value
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
    """Build a record, refusing to report stock fields from an incomplete call.

    A call that failed, went to voicemail, or was cut off can still carry a
    partially filled summary. Treating that as a stock check is how a patient
    gets sent somewhere on the strength of a sentence nobody finished.
    """
    result = final.get("result") or {}
    outcome = result.get("outcome") or {}
    confidence = (outcome.get("completion_confidence") or {}).get("score")
    completed = outcome.get("task_completed") is True
    status = (final.get("status") or "").upper()

    reached = completed and status == "COMPLETED"
    verified = reached and (confidence is not None and confidence >= MIN_CONFIDENCE)

    if reached:
        summary = result.get("summary") or result.get("post_summary") or ""
        record = normalise(parse_summary(summary))
    else:
        # Not a stock check. Say so rather than reporting whatever was scraped.
        record = {name: ("unknown" if name in ENUMS else None) for name in FIELDS}
        record["pharmacist_notes"] = (
            f"Call did not complete ({status.lower() or 'unknown status'}). "
            f"No stock information obtained."
        )

    record.update(
        pharmacy=pharmacy.get("name"),
        phone_masked=mask(pharmacy.get("phone", "")),
        run_status=final.get("status"),
        task_completed=completed,
        confidence=confidence,
        reached=reached,
        verified=verified,
        evidence=outcome.get("evidence") or [],
        transcript=result.get("transcript"),
    )
    return record


def rank(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Verified results first, then stock, then price, then hold.

    Verification outranks stock status deliberately. A confident "no" is more
    useful than an unreliable "yes" that sends someone across town while
    unwell — so a low-confidence yes must never outrank a high-confidence no.
    """
    order = {"yes": 0, "partial": 1, "unknown": 2, "no": 3}

    def key(r: dict[str, Any]):
        return (
            0 if r.get("verified") else 1,          # verified beats everything
            order.get(r.get("in_stock"), 3),
            r["unit_price"] if r.get("unit_price") is not None else float("inf"),
            0 if r.get("can_hold") == "yes" else 1,
        )

    return sorted(records, key=key)


# --------------------------------------------------------------------------
# CALL-E — live only. Nothing here is imported or touched in dry run.
# --------------------------------------------------------------------------


def load_token() -> str:
    """Reuse the CALL-E CLI's cached token. Live mode only."""
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


class Caller:
    """Live caller. Constructing this loads credentials, so it is only ever
    instantiated under --live."""

    def __init__(self, budget: CallBudget, store: RunStore) -> None:
        from fastmcp import Client
        from fastmcp.client.transports import StreamableHttpTransport

        self._Client = Client
        self._Transport = StreamableHttpTransport
        self.budget = budget
        self.store = store
        self._token = load_token()

    def _client(self):
        return self._Client(self._Transport(
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

    @staticmethod
    def _token_live(expires_at: str | None) -> bool:
        if not expires_at:
            return True
        return datetime.fromisoformat(
            expires_at.replace("Z", "+00:00")
        ) > datetime.now(timezone.utc)

    async def _poll(self, client, run_id: str, phone: str) -> dict[str, Any] | None:
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
                return final
            if action in BLOCKED_ACTIONS:
                log.warning("  %s: needs user input — %s",
                            mask(phone), nxt.get("instruction"))
                return final

            delay = float(nxt.get("poll_after_seconds") or delay)
            await asyncio.sleep(min(delay, 15.0))
        return None

    async def call(self, pharmacy: dict[str, str], goal: str, region: str
                   ) -> dict[str, Any] | None:
        phone = validate_e164(pharmacy["phone"])
        key = self.store.key(phone, goal)
        saved = self.store.get(key)

        async with self._client() as client:
            # Resume an in-flight run rather than planning again. Without this,
            # an interrupted poll causes a second call to the same pharmacist.
            if saved.get("run_id"):
                log.info("  %s: resuming run %s", mask(phone), saved["run_id"][:12])
                final = await self._poll(client, saved["run_id"], phone)
                if final is None:
                    return None
                self.store.clear(key)
                return to_record(final, pharmacy)

            # Reuse a stored plan if its confirm_token is still valid.
            plan = None
            if saved.get("plan_id") and self._token_live(saved.get("confirm_expires_at")):
                plan = {
                    "plan_id": saved["plan_id"],
                    "confirm_token": saved["confirm_token"],
                    "ready_to_run": True,
                }
                log.info("  %s: reusing plan %s", mask(phone), saved["plan_id"])

            if plan is None:
                plan = self._unwrap(await client.call_tool("plan_call", {
                    "goal": goal, "to_phones": [phone], "region": region,
                    "language": "English", "ttl_seconds": 0, "user_input": goal,
                }))
                if not plan.get("ready_to_run"):
                    log.warning("  %s: planner needs more detail — %s",
                                mask(phone), plan.get("clarifying_questions"))
                    return None
                self.store.put(
                    key,
                    plan_id=plan["plan_id"],
                    confirm_token=plan["confirm_token"],
                    confirm_expires_at=plan.get("confirm_expires_at"),
                    phone_masked=mask(phone),
                )

            self.budget.charge(1)
            run = self._unwrap(await client.call_tool("run_call", {
                "plan_id": plan["plan_id"], "confirm_token": plan["confirm_token"],
            }))
            run_id = run.get("run_id")
            if not run_id:
                return None
            self.store.put(key, run_id=run_id)

            final = await self._poll(client, run_id, phone)
            if final is None:
                log.error("  %s: poll timed out — rerun to resume, not redial",
                          mask(phone))
                return None
            self.store.clear(key)
            return to_record(final, pharmacy)


# --------------------------------------------------------------------------
# Dry run — fully offline
# --------------------------------------------------------------------------


def dry_run(pharmacies: list[dict[str, str]], goal: str, region: str) -> None:
    """Validate and print. No credentials read, no socket opened, no data sent.

    The point of a dry run in a workflow that calls real people is to be able
    to inspect exactly what would happen without anything leaving the machine.
    A dry run that still transmits the recipient's number and the medication
    being sought is not a dry run.
    """
    print(f"\nDRY RUN — offline. No credentials read, nothing sent.\n")
    for pharmacy in pharmacies:
        phone = validate_e164(pharmacy["phone"])
        payload = {
            "tool": "plan_call",
            "goal": goal,
            "to_phones": [phone],
            "region": region,
            "language": "English",
            "ttl_seconds": 0,
        }
        print(f"  {pharmacy.get('name', '?')} ({mask(phone)}) — would send:")
        print("  " + json.dumps(payload, indent=2)[:400].replace("\n", "\n  "))
        print()
    print(f"  {len(pharmacies)} call(s) would be placed. Add --live to dial.\n")


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def render(records: list[dict[str, Any]]) -> None:
    print(f"\n{'Pharmacy':<24} {'Stock':<9} {'Qty':>5} {'Price':>10} "
          f"{'Rx':<8} {'Hold':>6} {'Conf':>6}")
    print("-" * 74)
    for r in rank(records):
        hold = f"{r['hold_duration_hours']:.0f}h" if r.get("hold_duration_hours") else "—"
        price = (f"{r['unit_price']:g} {r.get('currency') or ''}".strip()
                 if r.get("unit_price") is not None else "—")
        conf = f"{r['confidence']:.2f}" if r.get("confidence") is not None else "—"
        flag = "" if r.get("verified") else "  ⚠ unverified"
        print(f"{(r['pharmacy'] or '?')[:24]:<24} {r['in_stock']:<9} "
              f"{r['quantity_available'] or '—':>5} {price:>10} "
              f"{r['requires_prescription']:<8} {hold:>6} {conf:>6}{flag}")
        if r.get("pharmacist_notes"):
            print(f"    {r['pharmacist_notes']}")
    print()


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
                        help="ACTUALLY PLACE CALLS. Without this the run is "
                             "fully offline: no credentials, no network.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if not args.pharmacies.exists():
        raise SystemExit(f"No such file: {args.pharmacies}")
    with args.pharmacies.open() as fh:
        pharmacies = [row for row in csv.DictReader(fh) if row.get("phone")]

    # Validate every number before anything else happens, in either mode.
    try:
        for pharmacy in pharmacies:
            pharmacy["phone"] = validate_e164(pharmacy["phone"])
    except InvalidPhoneNumber as exc:
        raise SystemExit(f"Invalid phone number: {exc}")

    goal = build_goal(args.drug, args.dosage, args.quantity)

    if not args.live:
        dry_run(pharmacies, goal, args.region)
        return

    budget = CallBudget(max_calls=args.max_calls)
    store = RunStore()
    budget.check(len(pharmacies))     # fail before dialling, not halfway

    caller = Caller(budget, store)
    print(f"\n{args.drug} {args.dosage} — {args.quantity} · "
          f"{len(pharmacies)} pharmacies · LIVE\n")

    semaphore = asyncio.Semaphore(args.concurrency)

    async def one(pharmacy: dict[str, str]):
        async with semaphore:
            try:
                return await caller.call(pharmacy, goal, args.region)
            except Exception as exc:
                log.error("  %s failed: %s", pharmacy.get("name"), exc)
                return None

    results = [r for r in await asyncio.gather(*(one(p) for p in pharmacies)) if r]
    if results:
        render(results)


if __name__ == "__main__":
    asyncio.run(main())
