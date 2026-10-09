#!/usr/bin/env python3
"""SQLite ledger for Voice Shop Manager.

Owns the schema and the write primitives. It holds no policy about which calls
are worth recording — that belongs in `ingest.py`, because policy changes far
more often than schema does.

    python3 store.py --init shop.db

Schema contract: SCHEMA.md. Refs #14, #33 (P1 vendors), #37 (P9 payments).
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import uuid
from pathlib import Path

SCHEMA_VERSION = 3

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY, display_name TEXT, phone_e164 TEXT NOT NULL,
  region TEXT NOT NULL, locale TEXT NOT NULL, currency TEXT DEFAULT 'NGN',
  language_style TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  shop_id TEXT NOT NULL, name_normalized TEXT NOT NULL, display_name TEXT NOT NULL,
  quantity_estimate REAL, unit TEXT, running_low INTEGER DEFAULT 0,
  preferred_supplier TEXT, last_cost REAL, updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, name_normalized)
);
CREATE TABLE IF NOT EXISTS inventory_readings (
  shop_id TEXT NOT NULL, reading_date TEXT NOT NULL, name_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL, quantity_estimate REAL, unit TEXT,
  running_low INTEGER DEFAULT 0, source_call_id TEXT,
  PRIMARY KEY (shop_id, reading_date, name_normalized)
);
CREATE TABLE IF NOT EXISTS daily_sales (
  shop_id TEXT NOT NULL, sales_date TEXT NOT NULL, estimated_revenue REAL,
  procurement_spend REAL, top_sellers_json TEXT, source_call_id TEXT,
  PRIMARY KEY (shop_id, sales_date)
);
CREATE TABLE IF NOT EXISTS procurement_items (
  shop_id TEXT NOT NULL, purchase_date TEXT NOT NULL, name_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL, amount REAL, supplier TEXT, source_call_id TEXT,
  PRIMARY KEY (shop_id, purchase_date, name_normalized)
);
CREATE TABLE IF NOT EXISTS call_receipts (
  call_id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, call_type TEXT NOT NULL,
  status TEXT NOT NULL, task_completed INTEGER, confidence REAL,
  accepted INTEGER NOT NULL DEFAULT 0, reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vendors (
  vendor_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  phone_e164 TEXT,
  goods_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  payee_ref TEXT,
  payee_provider TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (shop_id, name_normalized)
);
CREATE TABLE IF NOT EXISTS restock_requests (
  request_id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL,
  owner_consented INTEGER NOT NULL DEFAULT 0,
  source_call_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  status TEXT NOT NULL,
  eta_text TEXT,
  amount REAL,
  vendor_call_id TEXT,
  callback_call_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_intents (
  intent_id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL,
  owner_approved INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL UNIQUE,
  payee_ref TEXT,
  provider TEXT,
  provider_transfer_id TEXT,
  source_call_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_shop_date ON inventory_readings(shop_id, reading_date);
CREATE INDEX IF NOT EXISTS idx_sales_shop_date ON daily_sales(shop_id, sales_date);
CREATE INDEX IF NOT EXISTS idx_receipts_shop ON call_receipts(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vendors_shop ON vendors(shop_id, name_normalized);
CREATE INDEX IF NOT EXISTS idx_restock_shop ON restock_requests(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_intents_shop ON payment_intents(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_intent ON payment_events(intent_id, created_at);
"""

class StoreError(Exception):
    pass


def normalize(name: str) -> str:
    """Join key for a product. Display name is kept separately, as spoken."""
    return " ".join(str(name).strip().lower().split())


def connect(path: Path | str, read_only: bool = False) -> sqlite3.Connection:
    path = Path(path)
    if read_only:
        if not path.is_file():
            raise StoreError(f"No ledger at {path}")
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    else:
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def _ensure_vendor_payee_columns(conn: sqlite3.Connection) -> None:
    """v2 → v3: add offline payee fields without rebuilding the vendors table."""
    cols = _table_columns(conn, "vendors")
    if "payee_ref" not in cols:
        conn.execute("ALTER TABLE vendors ADD COLUMN payee_ref TEXT")
    if "payee_provider" not in cols:
        conn.execute("ALTER TABLE vendors ADD COLUMN payee_provider TEXT")


def _ensure_shop_language_column(conn: sqlite3.Connection) -> None:
    """Add the per-shop speaking style without rebuilding the shops table.

    A shop in Lagos and a shop in Pune want different calls. `locale` already
    carried the language CALL-E speaks; this carries how it speaks it.
    """
    if "language_style" not in _table_columns(conn, "shops"):
        conn.execute("ALTER TABLE shops ADD COLUMN language_style TEXT")


def _ensure_shop_onboarding_columns(conn: sqlite3.Connection) -> None:
    """Add onboarding consent/timezone fields without rebuilding the shops table."""
    cols = _table_columns(conn, "shops")
    if "consent_source" not in cols:
        conn.execute("ALTER TABLE shops ADD COLUMN consent_source TEXT")
    if "timezone" not in cols:
        conn.execute("ALTER TABLE shops ADD COLUMN timezone TEXT")


def initialize(conn: sqlite3.Connection) -> None:
    """Create the schema if absent. Safe to call on an existing ledger.

    Older ledgers upgrade in place: missing tables are created with
    ``CREATE TABLE IF NOT EXISTS``, vendor payee columns are added, and the
    meta version is bumped to the current schema.
    """
    with conn:
        conn.executescript(SCHEMA)
        _ensure_vendor_payee_columns(conn)
        _ensure_shop_language_column(conn)
        _ensure_shop_onboarding_columns(conn)
        row = conn.execute(
            "SELECT value FROM schema_meta WHERE key = 'version'"
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO schema_meta (key, value) VALUES ('version', ?)",
                (str(SCHEMA_VERSION),),
            )
        elif int(row["value"]) < SCHEMA_VERSION:
            conn.execute(
                "UPDATE schema_meta SET value = ? WHERE key = 'version'",
                (str(SCHEMA_VERSION),),
            )


def schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM schema_meta WHERE key = 'version'").fetchone()
    return int(row["value"]) if row else 0


def check_compatible(conn: sqlite3.Connection) -> None:
    found = schema_version(conn)
    if 1 <= found < SCHEMA_VERSION:
        initialize(conn)
        found = schema_version(conn)
    if found != SCHEMA_VERSION:
        raise StoreError(
            f"Ledger is schema version {found}, this code expects {SCHEMA_VERSION}. "
            "Rebuild the ledger or add a migration."
        )


def mask_phone(phone: str | None) -> str:
    """Mask an E.164 number for logs and summaries. Never invent digits."""
    if not phone:
        return ""
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 4:
        return "***"
    return f"+{'*' * (len(digits) - 4)}{digits[-4:]}"


def mask_payee_ref(payee_ref: str | None) -> str:
    """Mask an offline payee token for logs. Never invent characters."""
    if not payee_ref:
        return ""
    text = str(payee_ref).strip()
    if len(text) < 4:
        return "***"
    return f"{'*' * (len(text) - 4)}{text[-4:]}"


def _vendor_id(shop_id: str, name_normalized: str) -> str:
    return f"vendor-{shop_id}-{name_normalized.replace(' ', '-')}"


# ------------------------------------------------------------------ writes

def upsert_shop(conn: sqlite3.Connection, profile: dict) -> None:
    conn.execute(
        "INSERT INTO shops (id, display_name, phone_e164, region, locale, currency,"
        " language_style, consent_source, timezone, created_at)"
        " VALUES (:id, :display_name, :phone, :region, :locale, :currency,"
        " :language_style, :consent_source, :timezone, :created_at)"
        " ON CONFLICT(id) DO UPDATE SET"
        "   display_name = excluded.display_name, phone_e164 = excluded.phone_e164,"
        "   region = excluded.region, locale = excluded.locale, currency = excluded.currency,"
        "   language_style = COALESCE(excluded.language_style, shops.language_style),"
        "   consent_source = COALESCE(excluded.consent_source, shops.consent_source),"
        "   timezone = COALESCE(excluded.timezone, shops.timezone)",
        {
            "id": profile["shop_id"],
            "display_name": profile.get("display_name"),
            "phone": profile["phone"],
            "region": profile["region"],
            "locale": profile["locale"],
            "currency": profile.get("currency", "NGN"),
            "language_style": profile.get("language_style"),
            "consent_source": profile.get("consent_source"),
            "timezone": profile.get("timezone"),
            "created_at": profile.get("consent_timestamp", ""),
        },
    )


def find_shop_by_phone(conn: sqlite3.Connection, phone_e164: str) -> sqlite3.Row | None:
    """Lookup an existing shop by phone, so onboarding can skip repeat owners."""
    return conn.execute(
        "SELECT * FROM shops WHERE phone_e164 = ?", (phone_e164,)
    ).fetchone()


def seed_products(conn: sqlite3.Connection, profile: dict) -> None:
    """Seed known products and their reference costs.

    Without a cost the summary cannot convert quantities into money, and the
    call result only carries a price when the owner happens to mention one.
    """
    for product in profile.get("typical_products", []):
        conn.execute(
            "INSERT INTO products (shop_id, name_normalized, display_name, unit, last_cost, updated_at)"
            " VALUES (?, ?, ?, ?, ?, '')"
            " ON CONFLICT(shop_id, name_normalized) DO UPDATE SET"
            "   unit = COALESCE(products.unit, excluded.unit),"
            "   last_cost = COALESCE(products.last_cost, excluded.last_cost)",
            (
                profile["shop_id"], normalize(product["name"]), product["name"],
                product.get("unit"), product.get("reference_cost"),
            ),
        )


def record_receipt(conn: sqlite3.Connection, *, call_id: str, shop_id: str, call_type: str,
                   status: str, task_completed: bool, confidence: float | None,
                   accepted: bool, reason: str, created_at: str) -> None:
    conn.execute(
        "INSERT INTO call_receipts"
        " (call_id, shop_id, call_type, status, task_completed, confidence, accepted, reason, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(call_id) DO UPDATE SET"
        "   status = excluded.status, task_completed = excluded.task_completed,"
        "   confidence = excluded.confidence, accepted = excluded.accepted, reason = excluded.reason",
        (call_id, shop_id, call_type, status, 1 if task_completed else 0,
         confidence, 1 if accepted else 0, reason, created_at),
    )


def write_inventory_reading(conn: sqlite3.Connection, *, shop_id: str, reading_date: str,
                            product: dict, source_call_id: str) -> None:
    key = normalize(product["name"])
    conn.execute(
        "INSERT OR REPLACE INTO inventory_readings"
        " (shop_id, reading_date, name_normalized, display_name, quantity_estimate,"
        "  unit, running_low, source_call_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (shop_id, reading_date, key, product["name"], product.get("quantity_estimate"),
         product.get("unit"), 1 if product.get("running_low") else 0, source_call_id),
    )
    # Latest-state projection. COALESCE keeps a known value when this call did
    # not mention one — a partial check-in must not erase what we already knew.
    conn.execute(
        "INSERT INTO products (shop_id, name_normalized, display_name, quantity_estimate,"
        " unit, running_low, preferred_supplier, last_cost, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(shop_id, name_normalized) DO UPDATE SET"
        "   quantity_estimate = excluded.quantity_estimate,"
        "   unit = COALESCE(excluded.unit, products.unit),"
        "   running_low = excluded.running_low,"
        "   preferred_supplier = COALESCE(excluded.preferred_supplier, products.preferred_supplier),"
        "   last_cost = COALESCE(excluded.last_cost, products.last_cost),"
        "   updated_at = excluded.updated_at",
        (shop_id, key, product["name"], product.get("quantity_estimate"),
         product.get("unit"), 1 if product.get("running_low") else 0,
         product.get("supplier_mentioned"), product.get("last_purchase_price"), reading_date),
    )


def write_daily_sales(conn: sqlite3.Connection, *, shop_id: str, sales_date: str,
                      result: dict, source_call_id: str) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO daily_sales"
        " (shop_id, sales_date, estimated_revenue, procurement_spend, top_sellers_json, source_call_id)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        (shop_id, sales_date, result.get("estimated_revenue"),
         result.get("procurement_spend") or 0,
         json.dumps(result.get("top_sellers", [])), source_call_id),
    )


def write_procurement_items(conn: sqlite3.Connection, *, shop_id: str, purchase_date: str,
                            items: list[dict], source_call_id: str) -> int:
    written = 0
    for item in items:
        if not isinstance(item, dict) or "name" not in item:
            continue
        conn.execute(
            "INSERT OR REPLACE INTO procurement_items"
            " (shop_id, purchase_date, name_normalized, display_name, amount, supplier, source_call_id)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (shop_id, purchase_date, normalize(item["name"]), item["name"],
             item.get("amount"), item.get("supplier"), source_call_id),
        )
        written += 1
    return written


def clear_shop_day(conn: sqlite3.Connection, shop_id: str, date: str) -> None:
    """Remove a day's rows so a re-ingest cannot leave stale line items behind.

    INSERT OR REPLACE alone would keep procurement rows that the corrected call
    no longer mentions, because they are keyed by product name.
    """
    conn.execute("DELETE FROM procurement_items WHERE shop_id = ? AND purchase_date = ?", (shop_id, date))


# ------------------------------------------------------------------ vendors (P1)


def upsert_vendor(
    conn: sqlite3.Connection,
    *,
    shop_id: str,
    display_name: str,
    goods: list[str] | None = None,
    phone_e164: str | None = None,
    notes: str | None = None,
    now: str,
) -> str:
    """Create or update a vendor for a shop. Returns ``vendor_id``.

    Phone may be null until the owner provides E.164 — never invent one.
    Lookup key is ``(shop_id, normalized display name)``.
    """
    key = normalize(display_name)
    if not key:
        raise StoreError("vendor display_name is required")
    vendor_id = _vendor_id(shop_id, key)
    goods_json = json.dumps(list(goods or []), ensure_ascii=False)
    conn.execute(
        "INSERT INTO vendors"
        " (vendor_id, shop_id, display_name, name_normalized, phone_e164,"
        "  goods_json, notes, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(shop_id, name_normalized) DO UPDATE SET"
        "   display_name = excluded.display_name,"
        "   phone_e164 = COALESCE(excluded.phone_e164, vendors.phone_e164),"
        "   goods_json = CASE"
        "     WHEN excluded.goods_json = '[]' THEN vendors.goods_json"
        "     ELSE excluded.goods_json END,"
        "   notes = COALESCE(excluded.notes, vendors.notes),"
        "   updated_at = excluded.updated_at",
        (vendor_id, shop_id, display_name.strip(), key, phone_e164,
         goods_json, notes, now, now),
    )
    row = conn.execute(
        "SELECT vendor_id FROM vendors WHERE shop_id = ? AND name_normalized = ?",
        (shop_id, key),
    ).fetchone()
    return row["vendor_id"]


def find_vendor_by_name(
    conn: sqlite3.Connection, *, shop_id: str, name: str
) -> sqlite3.Row | None:
    """Lookup a saved vendor by spoken name (normalized)."""
    return conn.execute(
        "SELECT * FROM vendors WHERE shop_id = ? AND name_normalized = ?",
        (shop_id, normalize(name)),
    ).fetchone()


def list_vendors(conn: sqlite3.Connection, *, shop_id: str) -> list[dict]:
    """Return vendors for a shop with phones masked for safe display."""
    rows = conn.execute(
        "SELECT * FROM vendors WHERE shop_id = ? ORDER BY display_name",
        (shop_id,),
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["phone_masked"] = mask_phone(item.get("phone_e164"))
        item["payee_ref_masked"] = mask_payee_ref(item.get("payee_ref"))
        item["goods"] = json.loads(item.get("goods_json") or "[]")
        item.pop("phone_e164", None)
        item.pop("payee_ref", None)
        out.append(item)
    return out


# ------------------------------------------------------------------ procurement (P2-P5)


def create_restock_request(
    conn: sqlite3.Connection,
    *,
    shop_id: str,
    items: list[dict],
    owner_consented: bool,
    source_call_id: str,
    now: str,
) -> str:
    """Record the owner's reorder decision from a reorder-offer call.

    ``request_id`` is derived from ``source_call_id``, not random, so
    re-ingesting the same call cannot create a second draft.
    """
    request_id = f"restock-{source_call_id}"
    conn.execute(
        "INSERT INTO restock_requests"
        " (request_id, shop_id, status, items_json, owner_consented, source_call_id, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)"
        " ON CONFLICT(request_id) DO NOTHING",
        (request_id, shop_id, "confirmed" if owner_consented else "declined",
         json.dumps(items, ensure_ascii=False), 1 if owner_consented else 0,
         source_call_id, now),
    )
    return request_id


def get_restock_request(conn: sqlite3.Connection, *, request_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM restock_requests WHERE request_id = ?", (request_id,)
    ).fetchone()


def create_order(
    conn: sqlite3.Connection,
    *,
    request_id: str,
    shop_id: str,
    vendor_id: str,
    now: str,
) -> str:
    """Create (or reuse) the order for one vendor within a restock request.

    ``order_id`` is derived from ``(request_id, vendor_id)`` so a retried
    vendor dial for the same request cannot create a second order row.
    """
    order_id = f"order-{request_id}-{vendor_id}"
    conn.execute(
        "INSERT INTO orders (order_id, request_id, shop_id, vendor_id, status, created_at)"
        " VALUES (?, ?, ?, ?, 'pending_call', ?)"
        " ON CONFLICT(order_id) DO NOTHING",
        (order_id, request_id, shop_id, vendor_id, now),
    )
    return order_id


def get_order(conn: sqlite3.Connection, *, order_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM orders WHERE order_id = ?", (order_id,)).fetchone()


def record_vendor_call(
    conn: sqlite3.Connection,
    *,
    order_id: str,
    vendor_call_id: str,
    available: bool,
    amount: float | None = None,
    eta_text: str | None = None,
) -> bool:
    """Update an order with the vendor call outcome. False if ``order_id`` is unknown."""
    if get_order(conn, order_id=order_id) is None:
        return False
    conn.execute(
        "UPDATE orders SET status = ?, amount = COALESCE(?, amount),"
        " eta_text = COALESCE(?, eta_text), vendor_call_id = ?"
        " WHERE order_id = ?",
        ("placed" if available else "unavailable", amount, eta_text, vendor_call_id, order_id),
    )
    return True


def record_order_status(
    conn: sqlite3.Connection,
    *,
    order_id: str,
    callback_call_id: str,
    status: str,
    eta_text: str | None = None,
) -> bool:
    """Record the owner-facing status callback. False if ``order_id`` is unknown."""
    if get_order(conn, order_id=order_id) is None:
        return False
    conn.execute(
        "UPDATE orders SET status = ?, eta_text = COALESCE(?, eta_text), callback_call_id = ?"
        " WHERE order_id = ?",
        (status, eta_text, callback_call_id, order_id),
    )
    return True


# ------------------------------------------------------------------ payments (P9)


def link_vendor_payee(
    conn: sqlite3.Connection,
    *,
    vendor_id: str,
    payee_ref: str,
    payee_provider: str,
    now: str,
) -> None:
    """Attach an offline payee token to a vendor. Never invent bank details.

    ``payee_ref`` is a provider recipient code / token obtained outside the
    voice path (e.g. Paystack transfer recipient). Full account numbers, PINs,
    and OTPs must not be stored here.
    """
    ref = (payee_ref or "").strip()
    provider = (payee_provider or "").strip().lower()
    if not ref or not provider:
        raise StoreError("payee_ref and payee_provider are required")
    row = conn.execute(
        "SELECT vendor_id FROM vendors WHERE vendor_id = ?", (vendor_id,)
    ).fetchone()
    if row is None:
        raise StoreError(f"unknown vendor_id: {vendor_id}")
    conn.execute(
        "UPDATE vendors SET payee_ref = ?, payee_provider = ?, updated_at = ?"
        " WHERE vendor_id = ?",
        (ref, provider, now, vendor_id),
    )


def record_payment_event(
    conn: sqlite3.Connection,
    *,
    intent_id: str,
    event_type: str,
    detail: str | None,
    created_at: str,
    event_id: str | None = None,
) -> str:
    eid = event_id or f"pevt-{uuid.uuid4().hex[:16]}"
    conn.execute(
        "INSERT INTO payment_events (event_id, intent_id, event_type, detail, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (eid, intent_id, event_type, detail, created_at),
    )
    return eid


def create_payment_intent(
    conn: sqlite3.Connection,
    *,
    order_id: str,
    shop_id: str,
    vendor_id: str,
    amount: float,
    currency: str,
    idempotency_key: str,
    now: str,
    source_call_id: str | None = None,
    intent_id: str | None = None,
) -> str:
    """Create a draft payment intent for a confirmed order. Returns ``intent_id``."""
    if amount is None or float(amount) <= 0:
        raise StoreError("payment amount must be > 0")
    key = (idempotency_key or "").strip()
    if not key:
        raise StoreError("idempotency_key is required")
    existing = conn.execute(
        "SELECT intent_id, status FROM payment_intents WHERE idempotency_key = ?",
        (key,),
    ).fetchone()
    if existing is not None:
        return existing["intent_id"]
    iid = intent_id or f"pay-{uuid.uuid4().hex[:16]}"
    conn.execute(
        "INSERT INTO payment_intents"
        " (intent_id, order_id, shop_id, vendor_id, amount, currency, status,"
        "  owner_approved, idempotency_key, payee_ref, provider,"
        "  provider_transfer_id, source_call_id, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?, NULL, NULL, NULL, ?, ?, ?)",
        (iid, order_id, shop_id, vendor_id, float(amount), currency or "NGN",
         key, source_call_id, now, now),
    )
    record_payment_event(
        conn, intent_id=iid, event_type="created",
        detail=f"order={order_id}", created_at=now,
    )
    return iid


def approve_payment_intent(
    conn: sqlite3.Connection,
    *,
    intent_id: str,
    now: str,
    source_call_id: str | None = None,
) -> None:
    """Mark owner consent for this exact intent amount."""
    row = conn.execute(
        "SELECT status FROM payment_intents WHERE intent_id = ?", (intent_id,)
    ).fetchone()
    if row is None:
        raise StoreError(f"unknown intent_id: {intent_id}")
    if row["status"] in ("paid", "submitted"):
        return
    if row["status"] == "cancelled":
        raise StoreError("cannot approve a cancelled payment intent")
    conn.execute(
        "UPDATE payment_intents SET status = 'owner_approved', owner_approved = 1,"
        " source_call_id = COALESCE(?, source_call_id), updated_at = ?"
        " WHERE intent_id = ?",
        (source_call_id, now, intent_id),
    )
    record_payment_event(
        conn, intent_id=intent_id, event_type="approved",
        detail="owner_approved", created_at=now,
    )


def get_payment_intent(
    conn: sqlite3.Connection, *, intent_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM payment_intents WHERE intent_id = ?", (intent_id,)
    ).fetchone()


def find_payment_intent_by_key(
    conn: sqlite3.Connection, *, idempotency_key: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM payment_intents WHERE idempotency_key = ?",
        (idempotency_key,),
    ).fetchone()


def list_payment_events(
    conn: sqlite3.Connection, *, intent_id: str
) -> list[sqlite3.Row]:
    return list(conn.execute(
        "SELECT * FROM payment_events WHERE intent_id = ? ORDER BY created_at, event_id",
        (intent_id,),
    ))


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or inspect the SQLite ledger")
    parser.add_argument("--init", type=Path, metavar="DB", help="Create the schema at this path")
    parser.add_argument("--info", type=Path, metavar="DB", help="Show row counts")
    args = parser.parse_args()

    if args.init:
        conn = connect(args.init)
        initialize(conn)
        print(f"Ledger ready at {args.init} (schema v{schema_version(conn)})")
        conn.close()
        return 0

    if args.info:
        try:
            conn = connect(args.info, read_only=True)
        except StoreError as exc:
            print(exc, file=sys.stderr)
            return 1
        print(f"schema v{schema_version(conn)}")
        for table in ("shops", "products", "inventory_readings", "daily_sales",
                      "procurement_items", "call_receipts", "vendors",
                      "restock_requests", "orders", "payment_intents",
                      "payment_events"):
            n = conn.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]
            print(f"  {table:<20} {n}")
        conn.close()
        return 0

    parser.error("give --init or --info")


if __name__ == "__main__":
    sys.exit(main())
