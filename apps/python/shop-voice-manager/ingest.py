#!/usr/bin/env python3
"""Turn a CALL-E call result into ledger rows.

This is the policy layer: it decides which results are trustworthy enough to
write. `store.py` holds the schema and the write primitives and makes no such
judgement.

    python3 ingest.py --db shop.db result.json [result2.json ...]

Refs #16. Rules this implements are stated in SCHEMA.md.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

import store

# A result can report success and still be unreliable. See
# fixtures/edge-cases/low-confidence.json — task_completed is true, score is 0.41.
CONFIDENCE_THRESHOLD = 0.6

TERMINAL_WITHOUT_DATA = {"no_answer", "voicemail", "busy", "declined",
                         "canceled", "cancelled", "expired", "failed"}


@dataclass(frozen=True)
class IngestResult:
    call_id: str
    accepted: bool
    reason: str
    rows_written: int = 0

    def __str__(self) -> str:
        verdict = "accepted" if self.accepted else "rejected"
        return f"{self.call_id}: {verdict} ({self.reason}), {self.rows_written} row(s)"


def _decide(call: dict, threshold: float) -> tuple[bool, str]:
    """Accept or reject, with the reason recorded on the receipt either way."""
    status = call.get("status")
    if status in TERMINAL_WITHOUT_DATA:
        return False, f"call ended as {status}"
    if status != "completed":
        return False, f"unknown status {status!r}"
    if not call.get("task_completed"):
        return False, "owner did not complete the check-in"

    score = (call.get("completion_confidence") or {}).get("score")
    if score is None:
        return False, "no confidence score"
    if score < threshold:
        return False, f"confidence {score:.2f} below threshold {threshold:.2f}"

    if not isinstance(call.get("structured_result"), dict):
        return False, "no structured result"
    return True, "ok"


def ingest_call(conn: sqlite3.Connection, call: dict, *,
                threshold: float = CONFIDENCE_THRESHOLD) -> IngestResult:
    """Ingest one call result. Idempotent: re-ingesting the same call is a no-op.

    Every call leaves a receipt, including the ones that write no data. The
    receipt is the record that a call happened; the other tables are the record
    of what it said.
    """
    meta = call.get("metadata") or {}
    call_id = call.get("call_id")
    shop_id = meta.get("shop_id")
    call_type = meta.get("call_type")
    call_date = meta.get("call_date")

    if not (call_id and shop_id and call_type and call_date):
        raise ValueError(
            "call is missing call_id or metadata.{shop_id,call_type,call_date}"
        )

    try:
        started = call["recipients"][0]["attempts"][0].get("started_at") or call_date
    except (KeyError, IndexError, TypeError):
        started = call_date

    accepted, reason = _decide(call, threshold)
    rows = 0

    with conn:  # one call, one transaction
        if accepted:
            result = call["structured_result"]
            if call_type == "inventory":
                for product in result.get("products", []):
                    if isinstance(product, dict) and product.get("name"):
                        store.write_inventory_reading(
                            conn, shop_id=shop_id, reading_date=call_date,
                            product=product, source_call_id=call_id)
                        rows += 1
            elif call_type == "sales":
                store.write_daily_sales(
                    conn, shop_id=shop_id, sales_date=call_date,
                    result=result, source_call_id=call_id)
                rows += 1
                store.clear_shop_day(conn, shop_id, call_date)
                rows += store.write_procurement_items(
                    conn, shop_id=shop_id, purchase_date=call_date,
                    items=result.get("procurement_items", []) or [],
                    source_call_id=call_id)
            elif call_type == "reorder_offer":
                items = result.get("items", []) or []
                store.create_restock_request(
                    conn, shop_id=shop_id, items=items,
                    owner_consented=bool(result.get("owner_wants_to_order")),
                    source_call_id=call_id, now=started)
                rows += 1
                if result.get("owner_wants_to_order"):
                    for item in items:
                        if isinstance(item, dict) and item.get("vendor_name"):
                            store.upsert_vendor(
                                conn, shop_id=shop_id, display_name=item["vendor_name"],
                                goods=item.get("vendor_goods"),
                                phone_e164=item.get("vendor_phone_e164"), now=started)
                            rows += 1
            elif call_type == "vendor_order":
                order_id = meta.get("order_id")
                if order_id and store.record_vendor_call(
                    conn, order_id=order_id, vendor_call_id=call_id,
                    available=bool(result.get("available")),
                    amount=result.get("quoted_amount"), eta_text=result.get("eta_text"),
                ):
                    rows = 1
                else:
                    accepted, reason = False, f"unknown order_id {order_id!r}"
                    rows = 0
            elif call_type == "order_status":
                order_id = result.get("order_id") or meta.get("order_id")
                if order_id and store.record_order_status(
                    conn, order_id=order_id, callback_call_id=call_id,
                    status=result.get("status_reported"), eta_text=result.get("eta_text"),
                ):
                    rows = 1
                else:
                    accepted, reason = False, f"unknown order_id {order_id!r}"
                    rows = 0
            elif call_type == "onboarding":
                profile = {
                    "shop_id": shop_id,
                    "display_name": result.get("display_name"),
                    "phone": result.get("phone"),
                    "region": result.get("region"),
                    "locale": result.get("locale"),
                    "currency": result.get("currency", "NGN"),
                    "language_style": result.get("language_style"),
                    "consent_source": "voice_onboarding_call",
                    "timezone": result.get("timezone"),
                    "consent_timestamp": started,
                }
                store.upsert_shop(conn, profile)
                rows += 1
                products = result.get("typical_products", []) or []
                store.seed_products(conn, {"shop_id": shop_id, "typical_products": products})
                rows += len(products)
                supplier = result.get("preferred_supplier_nickname")
                if supplier:
                    store.upsert_vendor(conn, shop_id=shop_id, display_name=supplier, now=started)
                    rows += 1
            else:
                accepted, reason = False, f"unknown call_type {call_type!r}"
                rows = 0

        store.record_receipt(
            conn, call_id=call_id, shop_id=shop_id, call_type=call_type,
            status=call.get("status", "unknown"),
            task_completed=bool(call.get("task_completed")),
            confidence=(call.get("completion_confidence") or {}).get("score"),
            accepted=accepted, reason=reason, created_at=started)

    return IngestResult(call_id, accepted, reason, rows)


def ingest_files(conn: sqlite3.Connection, paths: list[Path], *,
                 threshold: float = CONFIDENCE_THRESHOLD) -> list[IngestResult]:
    results = []
    for path in paths:
        call = json.loads(path.read_text(encoding="utf-8"))
        results.append(ingest_call(conn, call, threshold=threshold))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest CALL-E results into the ledger")
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("results", type=Path, nargs="+", help="Call result JSON files")
    parser.add_argument("--confidence-threshold", type=float, default=CONFIDENCE_THRESHOLD)
    args = parser.parse_args()

    if not 0 <= args.confidence_threshold <= 1:
        parser.error("--confidence-threshold must be between 0 and 1")

    conn = store.connect(args.db)
    store.initialize(conn)
    try:
        results = ingest_files(conn, args.results, threshold=args.confidence_threshold)
    except (ValueError, json.JSONDecodeError) as exc:
        print(f"Ingest failed: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    for result in results:
        print(result)
    accepted = sum(1 for r in results if r.accepted)
    print(f"\n{accepted} accepted, {len(results) - accepted} rejected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
