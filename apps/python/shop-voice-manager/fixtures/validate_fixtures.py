#!/usr/bin/env python3
"""Validate the Voice Shop Manager demo fixtures.

Runs with no credentials and places no calls.

    python3 fixtures/validate_fixtures.py

Checks performed:

1.  Every fixture parses as JSON.
2.  Each ``structured_result`` validates against the committed skill schema for
    its call type (``skills/shop-voice-checkin/references/result-schema-*.json``).
3.  No fixture contains a phone number outside the fictional allowlist.
4.  Envelope invariants: identifiers, known statuses, confidence in [0, 1].
5.  Idempotency keys are unique and follow the documented format.
6.  Every completed conversation carries the AI disclosure the skill requires.
7.  The weekly totals implied by the call fixtures reconcile exactly with
    ``expected/weekly-summary.json``.

Uses ``jsonschema`` when it is installed and falls back to a small built-in
checker covering the subset of JSON Schema these files use, so the fixtures stay
verifiable in a bare environment.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent
APP_ROOT = FIXTURES.parent
REPO_ROOT = APP_ROOT.parents[2]
SCHEMA_DIR = REPO_ROOT / "skills" / "shop-voice-checkin" / "references"

SCHEMAS = {
    "inventory": SCHEMA_DIR / "result-schema-inventory.json",
    "sales": SCHEMA_DIR / "result-schema-sales.json",
    "reorder_offer": SCHEMA_DIR / "result-schema-reorder-offer.json",
    "vendor_order": SCHEMA_DIR / "result-schema-vendor-order.json",
    "order_status": SCHEMA_DIR / "result-schema-order-status.json",
    "onboarding": SCHEMA_DIR / "result-schema-onboarding.json",
}

# Reserved / fictional numbers only. Nothing dialable may enter git.
# +2348111111111 is the fictional vendor number used by the procurement fixtures.
ALLOWED_PHONES = {"+2348000000000", "+919000000000", "+2348111111111"}

KNOWN_STATUSES = {
    "completed", "failed", "no_answer", "declined",
    "canceled", "cancelled", "voicemail", "busy", "expired",
}

DISCLOSURE_MARKERS = (
    "ai assistant",
    "i be ai",
)

# Most call types dial once per calendar day. `vendor_order`/`order_status`
# instead key on the restock request they belong to (see safety.md's
# idempotency table), since a shop can restock more than once a day.
IDEMPOTENCY_DATE_RE = re.compile(
    r"^shopvoice-[a-z0-9-]+-(inventory|sales|reorder_offer|onboarding)-\d{4}-\d{2}-\d{2}$"
)
IDEMPOTENCY_REQUEST_RE = re.compile(
    r"^shopvoice-[a-z0-9-]+-(vendor_order|order_status)-[a-z0-9-]+$"
)
PHONE_RE = re.compile(r"\+\d[\d\s-]{6,}\d")

errors: list[str] = []


def fail(where: str, message: str) -> None:
    errors.append(f"{where}: {message}")


# ------------------------------------------------------------------ schema

def _check(instance, schema, path: str, where: str) -> None:
    """Minimal JSON Schema subset checker: type, required, properties, items."""
    expected = schema.get("type")
    types = {
        "object": dict, "array": list, "string": str,
        "number": (int, float), "integer": int, "boolean": bool,
    }
    if expected in types:
        if expected == "number" and isinstance(instance, bool):
            fail(where, f"{path}: expected number, got boolean")
            return
        if not isinstance(instance, types[expected]):
            fail(where, f"{path}: expected {expected}, got {type(instance).__name__}")
            return

    if expected == "object":
        for key in schema.get("required", []):
            if key not in instance:
                fail(where, f"{path}: missing required property '{key}'")
        for key, subschema in schema.get("properties", {}).items():
            if key in instance:
                _check(instance[key], subschema, f"{path}.{key}", where)

    if expected == "array" and "items" in schema:
        for i, item in enumerate(instance):
            _check(item, schema["items"], f"{path}[{i}]", where)

    if "enum" in schema and instance not in schema["enum"]:
        fail(where, f"{path}: {instance!r} not in enum {schema['enum']}")


try:
    from jsonschema import Draft7Validator

    def validate_schema(instance, schema, where: str) -> None:
        for err in sorted(Draft7Validator(schema).iter_errors(instance), key=str):
            loc = "$" + "".join(f".{p}" if isinstance(p, str) else f"[{p}]" for p in err.absolute_path)
            fail(where, f"{loc}: {err.message}")

    BACKEND = "jsonschema"
except ImportError:  # pragma: no cover - exercised only in bare environments
    def validate_schema(instance, schema, where: str) -> None:
        _check(instance, schema, "$", where)

    BACKEND = "built-in fallback"


# ------------------------------------------------------------------ helpers

def num(value) -> float | int:
    """Coerce a fixture value to a number for reconciliation totals.

    Non-numeric values have already been reported as schema violations; return
    0 so the reconciliation pass can still run and report everything at once.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    return value


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(path.name, f"invalid JSON — {exc}")
        return None


def scan_phones(node, where: str) -> None:
    if isinstance(node, str):
        for found in PHONE_RE.findall(node):
            normalized = re.sub(r"[\s-]", "", found)
            if normalized not in ALLOWED_PHONES:
                fail(where, f"non-fictional phone number in git: {found!r}")
    elif isinstance(node, dict):
        for value in node.values():
            scan_phones(value, where)
    elif isinstance(node, list):
        for value in node:
            scan_phones(value, where)


def check_envelope(doc: dict, where: str, seen_keys: dict[str, str]) -> None:
    for field in ("call_id", "idempotency_key", "status", "task_completed",
                  "completion_confidence", "recipients", "metadata"):
        if field not in doc:
            fail(where, f"envelope missing '{field}'")

    status = doc.get("status")
    if status not in KNOWN_STATUSES:
        fail(where, f"unknown status {status!r}")

    score = (doc.get("completion_confidence") or {}).get("score")
    if not isinstance(score, (int, float)) or not 0.0 <= score <= 1.0:
        fail(where, f"completion_confidence.score out of range: {score!r}")

    key = doc.get("idempotency_key", "")
    call_type = doc.get("metadata", {}).get("call_type")
    pattern = IDEMPOTENCY_REQUEST_RE if call_type in ("vendor_order", "order_status") else IDEMPOTENCY_DATE_RE
    if not pattern.match(key):
        fail(where, f"idempotency_key does not match documented format: {key!r}")
    if key in seen_keys:
        fail(where, f"duplicate idempotency_key, also used by {seen_keys[key]}")
    else:
        seen_keys[key] = where

    for recipient in doc.get("recipients", []):
        for phone in recipient.get("phones", []):
            if phone not in ALLOWED_PHONES:
                fail(where, f"recipient phone not in fictional allowlist: {phone!r}")


def check_disclosure(doc: dict, where: str) -> None:
    """The skill requires the agent to disclose it is an AI, once per call."""
    for recipient in doc.get("recipients", []):
        for attempt in recipient.get("attempts", []):
            turns = attempt.get("transcript_turns", [])
            bot_turns = [t for t in turns if t.get("speaker") == "bot"]
            if len(bot_turns) < 2:
                continue  # too short to be a real conversation
            spoken = " ".join(t.get("text", "") for t in bot_turns).lower()
            if not any(marker in spoken for marker in DISCLOSURE_MARKERS):
                fail(where, "transcript has no AI disclosure line (required by the skill)")


# ------------------------------------------------------------------ main

def main() -> int:
    if not SCHEMA_DIR.is_dir():
        print(f"Cannot locate skill schemas at {SCHEMA_DIR}", file=sys.stderr)
        return 2

    schemas = {}
    for call_type, path in SCHEMAS.items():
        if not path.is_file():
            fail("schemas", f"missing {path}")
            continue
        schemas[call_type] = load(path)

    expected = load(FIXTURES / "expected" / "weekly-summary.json")
    if not expected:
        return 2

    # Reconciliation is scoped to the shop and week the golden summary describes.
    # Every fixture is still schema-checked; only the totals are filtered, so
    # other shops and other weeks can live alongside without breaking the sums.
    recon_shop = expected["shop_id"]
    recon_start, recon_end = expected["week_start"], expected["week_end"]

    def in_scope(doc: dict) -> bool:
        meta = doc.get("metadata", {})
        return meta.get("shop_id") == recon_shop and recon_start <= meta.get("call_date", "") <= recon_end

    seen_keys: dict[str, str] = {}
    revenue = 0
    spend = 0
    last_inventory: dict | None = None
    last_date = ""
    top_sellers_seen: set[str] = set()
    call_count = 0
    total_fixtures = 0

    for path in sorted((FIXTURES / "calls").glob("*.json")):
        where = f"calls/{path.name}"
        doc = load(path)
        if doc is None:
            continue
        total_fixtures += 1
        scan_phones(doc, where)
        check_envelope(doc, where, seen_keys)
        check_disclosure(doc, where)

        call_type = doc.get("metadata", {}).get("call_type")
        if call_type not in schemas:
            fail(where, f"unknown metadata.call_type {call_type!r}")
            continue

        structured = doc.get("structured_result")
        if structured is None:
            fail(where, "completed call fixture has null structured_result")
            continue
        validate_schema(structured, schemas[call_type], where)

        if not in_scope(doc):
            continue
        call_count += 1

        if call_type == "sales":
            # Aggregate defensively: a schema violation is already reported above,
            # and reconciliation must not crash on it.
            revenue += num(structured.get("estimated_revenue"))
            spend += num(structured.get("procurement_spend"))
            sellers = structured.get("top_sellers", [])
            if isinstance(sellers, list):
                top_sellers_seen.update(s for s in sellers if isinstance(s, str))
            items = structured.get("procurement_items", [])
            if isinstance(items, list) and items:
                line_total = sum(num(i.get("amount")) for i in items if isinstance(i, dict))
                if line_total != num(structured.get("procurement_spend")):
                    fail(where, f"procurement_items sum to {line_total} but "
                                f"procurement_spend is {structured.get('procurement_spend')}")
        else:
            date = doc.get("metadata", {}).get("call_date", "")
            if date > last_date:
                last_date, last_inventory = date, structured

    for path in sorted((FIXTURES / "edge-cases").glob("*.json")):
        where = f"edge-cases/{path.name}"
        doc = load(path)
        if doc is None:
            continue
        scan_phones(doc, where)
        check_envelope(doc, where, seen_keys)
        check_disclosure(doc, where)

        structured = doc.get("structured_result")
        call_type = doc.get("metadata", {}).get("call_type")
        if structured is not None and call_type in schemas:
            validate_schema(structured, schemas[call_type], where)

    # Phase 2 procurement chain (P7). Kept out of `calls/` so the reorder /
    # vendor / callback fixtures never enter the weekly reconciliation above.
    for path in sorted((FIXTURES / "procurement").glob("*.json")):
        where = f"procurement/{path.name}"
        doc = load(path)
        if doc is None:
            continue
        scan_phones(doc, where)
        check_envelope(doc, where, seen_keys)
        check_disclosure(doc, where)

        call_type = doc.get("metadata", {}).get("call_type")
        if call_type not in schemas:
            fail(where, f"unknown metadata.call_type {call_type!r}")
            continue
        structured = doc.get("structured_result")
        if structured is None:
            fail(where, "completed call fixture has null structured_result")
            continue
        validate_schema(structured, schemas[call_type], where)

    # ---- reconciliation against the golden summary
    if expected:
        where = "expected/weekly-summary.json"
        if revenue != expected["estimated_revenue"]:
            fail(where, f"call fixtures total {revenue} revenue, summary claims {expected['estimated_revenue']}")
        if spend != expected["procurement_spend"]:
            fail(where, f"call fixtures total {spend} spend, summary claims {expected['procurement_spend']}")
        if revenue - spend != expected["estimated_gross"]:
            fail(where, "estimated_gross does not equal revenue minus spend")
        if call_count != expected["calls_ingested"]:
            fail(where, f"{call_count} call fixtures present, summary claims {expected['calls_ingested']}")

        if last_inventory:
            low = sorted(p["name"] for p in last_inventory["products"] if p.get("running_low"))
            if low != sorted(expected["products_running_low"]):
                fail(where, f"final-day running_low is {low}, summary claims {expected['products_running_low']}")

            by_name = {p["name"]: p for p in last_inventory["products"]}
            for slow in expected["slow_moving_products"]:
                name = slow["name"]
                if name in top_sellers_seen:
                    fail(where, f"{name} is listed as slow-moving but appears in top_sellers")
                product = by_name.get(name)
                if product is None:
                    fail(where, f"slow-moving product {name} absent from final inventory call")
                    continue
                if product["quantity_estimate"] != slow["quantity_estimate"]:
                    fail(where, f"{name}: final count {product['quantity_estimate']} "
                                f"but summary says {slow['quantity_estimate']}")
                if slow["quantity_estimate"] * slow["unit_cost"] != slow["capital_estimate"]:
                    fail(where, f"{name}: capital_estimate does not equal quantity x unit_cost")

            total_slow = sum(s["capital_estimate"] for s in expected["slow_moving_products"])
            if total_slow != expected["slow_moving_capital"]:
                fail(where, f"slow_moving_capital {expected['slow_moving_capital']} != sum {total_slow}")

    # ---- report
    if errors:
        print(f"Fixture validation FAILED ({len(errors)} problem(s), schema backend: {BACKEND})\n")
        for line in errors:
            print(f"  - {line}")
        return 1

    print(f"Fixture validation passed (schema backend: {BACKEND})")
    print(f"  {call_count} call fixtures, {len(list((FIXTURES / 'edge-cases').glob('*.json')))} edge cases")
    print(f"  week revenue {revenue:,} / spend {spend:,} / gross {revenue - spend:,} NGN")
    return 0


if __name__ == "__main__":
    sys.exit(main())
