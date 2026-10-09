#!/usr/bin/env python3
"""Compile a CALL-E task + result schema for one cash-on-delivery order.

Dry-run only: reads an order JSON, prints the masked phone, the spoken brief,
the result_schema and the idempotency key. Never dials, never needs a key.

    python3 scripts/build_task.py assets/sample-order.json
    python3 scripts/build_task.py assets/sample-order.json --json   # machine-readable
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

GUARDRAILS = (
    "Rules: never invent items, prices, discounts or delivery times that are not in this brief. "
    "If asked something you do not know, say a team member will follow up. "
    "Be brief and natural — this call should take under two minutes. "
    "If you reach voicemail, leave a short message saying who you are, then end the call without promising another attempt."
)

RESULT_SCHEMA = {
    "type": "object",
    "required": ["disposition", "confirmed"],
    "properties": {
        "disposition": {
            "type": "string",
            "description": "What happened on the call",
            "enum": ["confirmed", "changed", "cancelled", "voicemail", "no_answer", "wrong_number", "needs_human"],
        },
        "confirmed": {
            "type": "string",
            "description": "Did the customer confirm they want this order as read back",
            "enum": ["yes", "no", "unknown"],
        },
        "address_correct": {
            "type": "string",
            "description": "Did the customer confirm the delivery address",
            "enum": ["yes", "no", "unknown"],
        },
        "delivery_address": {"type": "string", "description": "Delivery address as the customer stated it, if given"},
        "requested_changes": {"type": "string", "description": "Exact changes the customer asked for, if any"},
        "preferred_delivery_window": {"type": "string", "description": "Any delivery time preference the customer stated"},
        "customer_notes": {"type": "string", "description": "Anything else the team should know"},
    },
}


def money(amount: float, currency: str) -> str:
    return f"{amount:,.2f} {currency}"


def mask_phone(phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 6:
        return "***"
    return f"+{digits[:3]}****{digits[-3:]}"


PHONE_TEXT = re.compile(r"(?<![0-9])\+?[0-9](?:[ ()\t.-]*[0-9]){7,14}(?![0-9])")


def display_copy(value):
    """Mask phone-like text in preview copies; do not alter the private task."""
    if isinstance(value, str):
        return PHONE_TEXT.sub(lambda match: mask_phone(match.group(0)), value)
    if isinstance(value, dict):
        return {key: display_copy(item) for key, item in value.items()}
    if isinstance(value, list):
        return [display_copy(item) for item in value]
    return value


def build(order: dict) -> dict:
    if not order.get("consent") or order.get("do_not_call"):
        raise SystemExit("Refusing: consent must be true and do_not_call must be false.")
    items = order.get("items") or []
    if not items:
        raise SystemExit("Refusing: the order has no items to confirm.")
    currency = order["currency"]
    lines = []
    for it in items:
        label = f"{it['name']} ({it['variant']})" if it.get("variant") else it["name"]
        lines.append(f"{it['quantity']} x {label} at {money(float(it['unit_price']), currency)}")
    placed = order.get("placed_at")
    placed_friendly = ""
    if placed:
        dt = datetime.fromisoformat(placed.replace("Z", "+00:00")).astimezone(timezone.utc)
        placed_friendly = f", placed {dt.strftime('%b %d, %Y %H:%M')} UTC"
    parts = [
        f"You are calling on behalf of {order['business_display_name']} to confirm a cash-on-delivery order before it is prepared and dispatched. Disclose that you are an AI assistant.",
        f"Customer: {order.get('customer_name') or 'the customer'}. Order reference {order['order_ref']}{placed_friendly}.",
        f"Items: {'; '.join(lines)}.",
    ]
    if float(order.get("delivery_fee") or 0) > 0:
        parts.append(f"Delivery fee: {money(float(order['delivery_fee']), currency)}.")
    parts.append(f"Total to pay in cash on delivery: {money(float(order['total']), currency)}.")
    if order.get("delivery_address"):
        parts.append(f"Delivery address on file: {order['delivery_address']}.")
    else:
        parts.append("No delivery address is on file — ask for it.")
    if order.get("delivery_policy"):
        parts.append(f"Delivery policy: {order['delivery_policy']}")
    parts.append(
        "Goal: 1) greet and say you are calling from the shop to confirm their order; 2) read back the items and the total; "
        "3) confirm the delivery address (or collect it); 4) ask if they want any change — record it precisely; "
        "5) if they no longer want the order, accept politely and record that."
    )
    if order.get("language"):
        parts.append(f"Speak {order['language']} unless the customer switches language.")
    parts.append(GUARDRAILS)
    attempt = int(order.get("attempt") or 1)
    return {
        "to_phone_masked": mask_phone(order["to_phone_e164"]),
        "idempotency_key": f"cod-confirm:{order['order_ref']}:{attempt}",
        "task": " ".join(parts),
        "result_schema": RESULT_SCHEMA,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    order = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    out = display_copy(build(order))
    if "--json" in argv:
        print(json.dumps(out, indent=2))
        return 0
    print("DRY RUN — nothing is dialed.\n")
    print(f"To (masked):      {out['to_phone_masked']}")
    print(f"Idempotency key:  {out['idempotency_key']}\n")
    print("Task:\n" + out["task"] + "\n")
    print("result_schema:\n" + json.dumps(out["result_schema"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
