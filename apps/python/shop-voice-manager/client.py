#!/usr/bin/env python3
"""Voice Shop Manager — runner. Preview by default; live calls are opt-in.

Default and `--fixture` paths place no call and need no credentials. A real
call requires BOTH `--execute` and `--confirm-recipient-opt-in`, as specified
in skills/shop-voice-checkin/references/safety.md.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SKILL = ROOT.parents[2] / "skills" / "shop-voice-checkin"
FIXTURES = ROOT / "fixtures"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


SCHEMA_FILES = {
    "inventory": "result-schema-inventory.json",
    "sales": "result-schema-sales.json",
    "reorder_offer": "result-schema-reorder-offer.json",
    "vendor_order": "result-schema-vendor-order.json",
    "order_status": "result-schema-order-status.json",
    "onboarding": "result-schema-onboarding.json",
}

# Phase 2 calls that dial a *request* (a vendor call, or its owner callback)
# key on request_id/order_id rather than the calendar date, per safety.md.
REQUEST_KEYED_CALL_TYPES = {"vendor_order", "order_status"}

# request["phone"] is a third party's number for these, not the shop's own —
# a caller must never pass one of these requests to store.upsert_shop, which
# unconditionally overwrites shops.phone_e164 with whatever "phone" it is
# given. Confused live vendor calls with the owner's callback this way once
# already (2026-09-11): the vendor call clobbered the shop's own number, and
# every callback after it dialed the vendor instead of the owner.
THIRD_PARTY_RECIPIENT_CALL_TYPES = {"vendor_order"}


def schema_path(call_type: str) -> Path:
    name = SCHEMA_FILES.get(call_type)
    if name is None:
        raise SystemExit(f"Unknown call_type: {call_type!r}")
    return SKILL / "references" / name


def build_task(request: dict) -> str:
    shop = request.get("shop_id", "the shop")
    style = request.get("language_style", "english")
    if style == "pidgin-english":
        tone = "Pidgin-influenced English"
    elif style == "hindi-english":
        tone = "Hindi-English (Hinglish) mix"
    else:
        tone = "plain English"
    minutes = request.get("max_minutes", 4)
    disclose = "Disclose you are an AI shop manager assistant."
    call_type = request["call_type"]

    if call_type == "inventory":
        products = ", ".join(request.get("products_to_ask", ["stock items"]))
        return (
            f"Call the consenting shop owner for a short morning inventory check-in at {shop}. "
            f"Use {tone}. Ask about: {products}. Capture approximate quantities and units. "
            f"Ask what is running low. Ask once about any new goods not on that list and "
            f"capture name, quantity, and unit if they mention any. "
            f"{disclose} Keep under {minutes} minutes. Do not give financial advice."
        )
    if call_type == "sales":
        return (
            f"Call the consenting shop owner for a short evening sales recap at {shop}. "
            f"Ask roughly how much they sold today, top sellers, and any restock purchases. "
            f"{disclose} Keep under {minutes} minutes. Do not give financial advice."
        )
    if call_type == "reorder_offer":
        low_stock = request.get("low_stock_items") or ["the items running low"]
        items = ", ".join(low_stock)
        verb = "is" if len(low_stock) == 1 else "are"
        return (
            f"Call the consenting shop owner at {shop}. Use {tone}. Tell them {items} {verb} "
            f"running low and ask if they want to place a restock order. If yes, ask quantity "
            f"needed per item, then ask which vendor to use. If it is a vendor already on file, "
            f"you do not need to ask what they sell or their phone number again. If it is a new "
            f"vendor, you must explicitly ask two more questions before ending the call: what "
            f"the vendor sells, and the vendor's phone number — do not skip the phone number "
            f"just because the owner did not offer it; ask for it directly. If the owner truly "
            f"does not have it, say the vendor cannot be called yet without it. Never invent a "
            f"vendor phone number. If no, end politely; do not place any vendor call. "
            f"{disclose} Keep under {minutes} minutes. Do not give financial advice or discuss loans."
        )
    if call_type == "vendor_order":
        items = ", ".join(request.get("order_items", ["the requested items"]))
        vendor = request.get("vendor_display_name", "the vendor")
        return (
            f"Call {vendor} on behalf of {shop}. {disclose} State you are calling to place an "
            f"order for: {items}. Ask if they are available, the price if they wish to share "
            f"it, and an estimated delivery time. Do not discuss payment, bank details, or loans."
        )
    if call_type == "order_status":
        status = request.get("order_status_known")
        outcome = {
            "placed": "The order was placed with the vendor.",
            "unavailable": "The vendor could not fulfill the order.",
            "delayed": "The order is placed but delayed.",
        }.get(status, "The order status is unknown — say the office will follow up.")
        eta = request.get("order_eta_text")
        amount = request.get("order_amount")
        extra = " ".join(filter(None, [
            f"Delivery is expected {eta}." if eta else "",
            f"The quoted amount is {amount}." if amount else "",
        ]))
        message = " ".join(filter(None, [outcome, extra]))
        return (
            f"Call the consenting shop owner at {shop} with a short update on their restock "
            f"order. {disclose} Tell them exactly this: {message} "
            f"Keep under 2 minutes. Do not give financial advice."
        )
    if call_type == "onboarding":
        return (
            f"Call the consenting new shop owner. {disclose} Explain you will collect basic "
            f"shop details to set up their account: shop name, phone number (read back to "
            f"confirm), region, and language. Ask for 3 to 5 staple products they sell and, "
            f"optionally, one preferred supplier's name. Ask for consent to store this "
            f"information and to make future check-in calls. Do not infer region, locale, or "
            f"currency — ask explicitly. Keep under {minutes} minutes."
        )
    raise SystemExit(f"Unknown call_type: {call_type!r}")


def _idempotency_key(request: dict) -> str:
    shop_id, call_type = request["shop_id"], request["call_type"]
    if call_type in REQUEST_KEYED_CALL_TYPES:
        request_id = request.get("request_id") or request.get("order_id") or "DEMO"
        return f"shopvoice-{shop_id}-{call_type}-{request_id}"
    return f"shopvoice-{shop_id}-{call_type}-DEMO"


def preview(request: dict) -> dict:
    import live_call

    return {
        "mode": "demo",
        "side_effects": "none — no CALL-E network call",
        "phone_masked": live_call.mask_phone(request.get("phone")),
        "region": request["region"],
        "locale": request["locale"],
        "call_type": request["call_type"],
        "task": build_task(request),
        "result_schema": load_json(schema_path(request["call_type"])),
        "idempotency_key": _idempotency_key(request),
    }


def demo_summary(shop_id: str, method: str = "turnover") -> str:
    """Compute the weekly summary from the fixture call results.

    Nothing here is hardcoded. `demo_ledger.build` runs the fixtures through
    the production path — `ingest.ingest_call` into a real SQLite ledger built
    by `store.py` — and summarize.py derives every figure from it. Only the
    *input* is a fixture instead of a CALL-E result, so the numbers change if
    the fixtures change and the demo cannot drift from live behaviour.
    """
    import sqlite3
    import tempfile

    import summarize
    from demo_ledger import build

    with tempfile.TemporaryDirectory() as tmp:
        ledger = build(Path(tmp) / "demo.db")
        conn = sqlite3.connect(f"file:{ledger}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            summary = summarize.build_summary(conn, shop_id, method=method)
        finally:
            conn.close()

    return (
        summarize.render_text(summary)
        + "\n\nComputed from fixture call results — not a live retailer."
    )


DEFAULT_FIXTURES = {
    "inventory": "inventory-result.json",
    "sales": "sales-result.json",
    "reorder_offer": "reorder-offer-result.json",
    "vendor_order": "vendor-order-result.json",
    "order_status": "order-status-result.json",
    "onboarding": "onboarding-result.json",
}


def run_demo(request: dict, fixture_name: str | None) -> dict:
    if fixture_name:
        fixture = FIXTURES / fixture_name
    else:
        fixture = FIXTURES / DEFAULT_FIXTURES[request["call_type"]]
    if not fixture.is_file():
        raise SystemExit(f"Missing fixture: {fixture}")
    return {
        "preview": preview(request),
        "structured_result": load_json(fixture),
        "demo_note": "Fixture result — simulates a completed CALL-E call without placing one.",
    }


def run_live(args) -> int:
    """Place one real call, then ingest it through the same path as the demo."""
    import live_call

    request = load_json(args.request)

    if not args.confirm_recipient_opt_in:
        print(
            "Live calls require --confirm-recipient-opt-in.\n"
            "Confirm the shop owner has opted in, then re-run with both flags.",
            file=sys.stderr,
        )
        return 2

    if request.get("recipient_consented") is not True:
        print(
            f"{args.request}: recipient_consented must be the boolean true. "
            "Do not place a call the owner has not agreed to.",
            file=sys.stderr,
        )
        return 2

    if request.get("call_type") in THIRD_PARTY_RECIPIENT_CALL_TYPES:
        if not args.confirm_vendor_order:
            print(
                "vendor_order requires --confirm-vendor-order in addition to "
                "recipient opt-in. Do not dial a vendor without explicit authorization.",
                file=sys.stderr,
            )
            return 2
        if request.get("vendor_contact_authorized") is not True:
            print(
                f"{args.request}: vendor_contact_authorized must be the boolean true. "
                "Do not synthesize vendor consent from the shop owner's opt-in.",
                file=sys.stderr,
            )
            return 2

    try:
        live_call.validate_e164(request.get("phone"))
    except live_call.LiveCallError as exc:
        print(f"Live call failed: {exc}", file=sys.stderr)
        return 1

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key:
        print("CALLE_API_KEY is not set. Export it, then re-run.", file=sys.stderr)
        return 2

    call_date = args.call_date or date.today().isoformat()

    try:
        base_url = live_call.resolve_base_url()
        client = live_call.build_client(api_key, base_url)
        result = live_call.execute_live(
            request,
            client,
            task=build_task(request),
            schema=load_json(schema_path(request["call_type"])),
            provider_hash=live_call.provider_account_hash(api_key),
            call_date=call_date,
            request_id=request.get("request_id") or request.get("order_id"),
            progress=live_call.stderr_progress,
        )
    except live_call.LiveCallError as exc:
        print(f"Live call failed: {live_call.redact_phones(str(exc))}", file=sys.stderr)
        return 1

    print(json.dumps(live_call.public_result(result), ensure_ascii=False, indent=2))

    if args.db:
        import ingest
        import store

        conn = store.connect(args.db)
        store.initialize(conn)
        try:
            # Without this the readings land but `shops` stays empty, and
            # summarize.py reports the shop is not in the ledger. Skipped for
            # vendor_order: request["phone"] is the vendor's number there,
            # and upsert_shop would overwrite shops.phone_e164 with it.
            if request["call_type"] not in THIRD_PARTY_RECIPIENT_CALL_TYPES:
                with conn:
                    store.upsert_shop(conn, request)
            verdict = ingest.ingest_call(conn, result)
        finally:
            conn.close()
        print(f"\nLedger: {verdict}", file=sys.stderr)

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Voice Shop Manager demo (default: no live call)"
    )
    parser.add_argument(
        "--request",
        type=Path,
        default=ROOT / "example_request.json",
        help="Request JSON path",
    )
    parser.add_argument(
        "--fixture",
        type=str,
        default=None,
        help="Fixture filename under fixtures/ (default by call_type)",
    )
    parser.add_argument(
        "--weekly-summary",
        action="store_true",
        help="Compute and print the weekly business summary from the fixture ledger",
    )
    parser.add_argument(
        "--slow-moving-method",
        choices=("turnover", "top-sellers"),
        default="turnover",
        help="How slow-moving stock is identified (see fixtures/README.md)",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Place a REAL CALL-E call. Requires --confirm-recipient-opt-in.",
    )
    parser.add_argument(
        "--confirm-recipient-opt-in",
        action="store_true",
        help="Required with --execute: the recipient has consented to be called.",
    )
    parser.add_argument(
        "--confirm-vendor-order",
        action="store_true",
        help="Required with vendor_order: explicit authorization to dial the vendor.",
    )
    parser.add_argument(
        "--call-date",
        default=None,
        help="Ledger date for the call (default: today). Also fixes the idempotency key.",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="With --execute: ingest the result into this SQLite ledger.",
    )
    parser.add_argument(
        "--live",
        action="store_true",
        help=argparse.SUPPRESS,  # deprecated alias, kept so old commands fail loudly
    )
    args = parser.parse_args()

    if args.live:
        print(
            "--live has been renamed. Use the spelling the safety docs specify:\n"
            "  --execute --confirm-recipient-opt-in",
            file=sys.stderr,
        )
        return 2

    if args.execute:
        return run_live(args)

    request = load_json(args.request)
    payload = run_demo(request, args.fixture)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if args.weekly_summary:
        print()
        print(demo_summary(request["shop_id"], args.slow_moving_method))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
