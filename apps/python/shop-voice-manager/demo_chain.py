#!/usr/bin/env python3
"""Narrate the Phase 2 procurement loop end to end, from fixtures only.

    python3 demo_chain.py [--out shop-chain-demo.db]

This replays four already-completed CALL-E call results through the real
`ingest.ingest_call` path — the same function the live client will use — so
what you see here is exactly what the ledger looks like after the chain:

    inventory (low stock flagged)
      -> reorder offer (owner says yes, names a vendor)
      -> vendor order (vendor confirms price + ETA)
      -> order status (owner told the outcome)

IMPORTANT — what this script is, and is not:
  * No live call is placed here. Every step ingests a canned fixture result
    under `fixtures/procurement/`. This is safe to run any number of times.
  * It does NOT demonstrate auto-chaining a real `run_call`. In production,
    each of these four steps is its own plan-first, host-confirmed CALL-E
    call (see CLAUDE.md and docs/projects/voice-shop-manager/NEXT_STEPS.md).
    The owner's spoken "yes" on the reorder-offer call is consent to contact
    that vendor — it is not a substitute for the host confirm gate in front
    of the next `run_call`. This script only fast-forwards through results
    that would exist *after* a human approved each of those four calls.
  * `store.create_order` between steps 2 and 3 is bookkeeping (opening the
    order row the vendor call result will update), not a call — nothing
    rings until step 3's fixture is ingested.

Refs #31 (P7).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import ingest
import store

APP_ROOT = Path(__file__).resolve().parent
PROCUREMENT = APP_ROOT / "fixtures" / "procurement"
SHOP_PROFILE = APP_ROOT / "fixtures" / "shop-profile.json"

STEPS = [
    ("Morning inventory check-in", "inventory-low-stock.json"),
    ("Reorder offer to the owner", "reorder-offer-yes.json"),
    ("Vendor order call", "vendor-order-result.json"),
    ("Order status callback to the owner", "order-status-result.json"),
]


def _load(name: str) -> dict:
    return json.loads((PROCUREMENT / name).read_text(encoding="utf-8"))


def _line(char: str = "-", width: int = 60) -> str:
    return char * width


def _print_step(n: int, title: str) -> None:
    print(f"\n[{n}/4] {title}")
    print(_line())


def run(out_path: Path) -> int:
    if out_path.exists():
        out_path.unlink()

    conn = store.connect(out_path)
    store.initialize(conn)

    profile = json.loads(SHOP_PROFILE.read_text(encoding="utf-8"))
    with conn:
        store.upsert_shop(conn, profile)
        store.seed_products(conn, profile)
    shop_id = profile["shop_id"]

    print("Voice Shop Manager — Phase 2 procurement chain (fixture replay, no live calls)")
    print(f"Shop: {profile['display_name']} ({shop_id})")

    # --- Step 1: inventory --------------------------------------------------
    title, fname = STEPS[0]
    _print_step(1, title)
    call = _load(fname)
    result = ingest.ingest_call(conn, call)
    print(f"  Call result: {result}")
    low = [p["name"] for p in call["structured_result"]["products"] if p.get("running_low")]
    print(f"  Running low: {', '.join(low) if low else 'nothing'}")
    if not result.accepted or not low:
        print("  Nothing running low — chain stops here in real life; continuing for the demo.")

    # --- Step 2: reorder offer ----------------------------------------------
    title, fname = STEPS[1]
    _print_step(2, title)
    call = _load(fname)
    result = ingest.ingest_call(conn, call)
    print(f"  Call result: {result}")
    sr = call["structured_result"]
    wants_order = bool(sr.get("owner_wants_to_order"))
    print(f"  Owner wants to order: {wants_order}")
    if not wants_order:
        print("  Owner said no — vendor is never called. Chain stops here for real.")
        conn.close()
        print(f"\nWrote {out_path}")
        return 0

    request_id = f"restock-{call['call_id']}"
    request = store.get_restock_request(conn, request_id=request_id)
    items = json.loads(request["items_json"])
    for item in items:
        print(f"  - {item['name']}: {item['quantity_needed']} {item['unit']} "
              f"from {item.get('vendor_name', 'unspecified vendor')}")

    # Open the order row before the vendor call. This is bookkeeping, not a
    # call — it records intent so the vendor-order result has somewhere to
    # land. No phone rings until step 3 is ingested.
    vendor_name = items[0]["vendor_name"]
    vendor = store.find_vendor_by_name(conn, shop_id=shop_id, name=vendor_name)
    with conn:
        order_id = store.create_order(
            conn, request_id=request_id, shop_id=shop_id,
            vendor_id=vendor["vendor_id"], now=call["metadata"]["call_date"],
        )
    print(f"  Order opened: {order_id} (vendor: {vendor_name}, "
          f"phone {store.mask_phone(vendor['phone_e164'])})")

    # --- Step 3: vendor order -------------------------------------------
    title, fname = STEPS[2]
    _print_step(3, title)
    call = _load(fname)
    if call["metadata"]["order_id"] != order_id:
        # Keep the fixture's own order_id in sync with what step 2 actually
        # produced, rather than silently ingesting a mismatched call.
        call["metadata"]["order_id"] = order_id
    result = ingest.ingest_call(conn, call)
    print(f"  Call result: {result}")
    sr = call["structured_result"]
    if sr.get("available"):
        print(f"  Vendor confirmed: {sr.get('quoted_amount')} NGN, ETA {sr.get('eta_text')}")
    else:
        print("  Vendor could not fulfill the order.")

    # --- Step 4: order status callback --------------------------------------
    title, fname = STEPS[3]
    _print_step(4, title)
    call = _load(fname)
    if call["structured_result"].get("order_id") != order_id:
        call["structured_result"]["order_id"] = order_id
        call["metadata"]["order_id"] = order_id
    result = ingest.ingest_call(conn, call)
    print(f"  Call result: {result}")
    sr = call["structured_result"]
    print(f"  Owner told: status={sr.get('status_reported')}, ETA {sr.get('eta_text')}")

    # --- Final ledger state --------------------------------------------------
    print(f"\n{_line('=')}")
    print("Final state")
    print(_line('='))
    order = store.get_order(conn, order_id=order_id)
    print(f"  restock_requests: 1 confirmed ({request_id})")
    print(f"  vendors: {vendor_name} ({store.mask_phone(vendor['phone_e164'])})")
    print(f"  orders: {order['order_id']} — status={order['status']}, "
          f"amount={order['amount']}, eta={order['eta_text']}")
    print(f"    vendor_call_id={order['vendor_call_id']}, "
          f"callback_call_id={order['callback_call_id']}")

    conn.close()
    print(f"\nWrote {out_path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=Path("shop-chain-demo.db"))
    args = parser.parse_args()
    return run(args.out)


if __name__ == "__main__":
    sys.exit(main())
