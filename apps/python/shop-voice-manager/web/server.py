#!/usr/bin/env python3
"""HTTP API and static host for the Shop Check-In console.

Standard library only, because the app declares `dependencies = []` and a test
asserts it stays that way. `http.server` is enough for a single-operator
console on loopback; it is not a public web server.

Additive by construction: this package imports the existing modules and does
not modify them. Deleting `web/` leaves the CLI and the ledger untouched.

Everything is configuration, not code:

    CALLE_API_KEY           required to place a real call. Never read by the browser.
    SHOPVOICE_DB            ledger path            (default: ./shop.db)
    SHOPVOICE_HOST          bind address           (default: 127.0.0.1; loopback only
                                                   unless SHOPVOICE_ALLOW_REMOTE=1)
    SHOPVOICE_PORT          port                   (default: 8765)
    SHOPVOICE_DEMO          "1" replays a stored call instead of dialling
    SHOPVOICE_ALLOW_REMOTE  "1" permits non-loopback bind (still needs a token)
    SHOPVOICE_REMOTE_TOKEN  required when remote bind is enabled; sent as
                            X-ShopVoice-Token on mutating requests
    CALLE_BASE_URL          honoured by live_call, allowlisted there

Run:  python3 web/server.py
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import traceback
import uuid
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

APP_ROOT = Path(__file__).resolve().parent.parent
STATIC = Path(__file__).resolve().parent / "static"
sys.path.insert(0, str(APP_ROOT))

import client            # noqa: E402  (build_task, schema_path, load_json)
import ingest            # noqa: E402
import live_call         # noqa: E402
import store             # noqa: E402

DB_PATH = Path(os.environ.get("SHOPVOICE_DB", APP_ROOT / "shop.db"))
RESULTS_DIR = Path(os.environ.get("SHOPVOICE_RESULTS", DB_PATH.parent / "call-results"))
FIXTURES = APP_ROOT / "fixtures" / "calls"
PROCUREMENT_FIXTURES = APP_ROOT / "fixtures" / "procurement"

# Demo mode's fixed script for the auto-chain: which fixture stands in for
# each leg. inventory-low-stock.json always shows something running low, so
# a demo inventory call always has something to chain into — the ordinary
# demo path (fixtures/calls/) has no such guarantee and isn't written for
# this shop. Anything without an entry here (sales, onboarding) falls back
# to the newest same-call_type fixture, same as before this map existed.
DEMO_CHAIN_FIXTURE = {
    "inventory": PROCUREMENT_FIXTURES / "inventory-low-stock.json",
    "reorder_offer": PROCUREMENT_FIXTURES / "reorder-offer-yes.json",
    "vendor_order": PROCUREMENT_FIXTURES / "vendor-order-result.json",
    "order_status": PROCUREMENT_FIXTURES / "order-status-result.json",
}
DEMO = os.environ.get("SHOPVOICE_DEMO") == "1"

# Region support is a property of the CALL-E account, so it is configuration.
# Anything not listed is offered but flagged; the operator decides.
SUPPORTED = [r.strip() for r in os.environ.get(
    "SHOPVOICE_REGIONS", "NG,GH,KE,ZA,US,GB,CA,IN,AU,SG,AE,PH").split(",") if r.strip()]
BLOCKED = {r.strip() for r in os.environ.get("SHOPVOICE_BLOCKED_REGIONS", "").split(",") if r.strip()}
# Currencies offered per shop. The first is the default for a new shop.
CURRENCIES = [c.strip().upper() for c in os.environ.get(
    "SHOPVOICE_CURRENCIES",
    "NGN,GHS,KES,ZAR,INR,USD,GBP,EUR,CAD,AUD,SGD,AED,PHP").split(",") if c.strip()]
# Units a shop owner actually says on the phone. Suggestions, not a whitelist:
# the field stays free text so an unusual unit is never blocked.
UNITS = [u.strip() for u in os.environ.get(
    "SHOPVOICE_UNITS",
    # Nigeria
    "bags,cartons,kegs,pieces,sachets,crates,tins,bottles,packs,"
    "rolls,baskets,bundles,cups,dericas,paint rubbers,"
    # India
    "kg,litres,packets,dozens,sacks,quintals,strips").split(",") if u.strip()]

# A "voice" is the one question an operator can actually answer: what should
# the owner hear? Locale and style are the two fields underneath it, and
# keeping them as separate dropdowns made the form answer a question nobody
# asked.
VOICES = [
    {"id": "english",        "name": "English",         "locale": "en", "style": "english"},
    {"id": "pidgin-english", "name": "Nigerian Pidgin", "locale": "en", "style": "pidgin-english"},
    {"id": "hindi",          "name": "Hindi",           "locale": "hi", "style": "hindi-english"},
]
VOICE_BY_ID = {v["id"]: v for v in VOICES}

# Reference data, not business configuration: dialling codes and country names
# do not change per deployment. SHOPVOICE_REGIONS still decides which of these
# are offered, and every default below is only a default.
COUNTRY_INFO = {
    "NG": ("Nigeria",        "234", "NGN", "pidgin-english"),
    "GH": ("Ghana",          "233", "GHS", "english"),
    "KE": ("Kenya",          "254", "KES", "english"),
    "ZA": ("South Africa",    "27", "ZAR", "english"),
    "IN": ("India",           "91", "INR", "hindi"),
    "US": ("United States",    "1", "USD", "english"),
    "GB": ("United Kingdom",  "44", "GBP", "english"),
    "CA": ("Canada",           "1", "CAD", "english"),
    "AU": ("Australia",       "61", "AUD", "english"),
    "SG": ("Singapore",       "65", "SGD", "english"),
    "AE": ("United Arab Emirates", "971", "AED", "english"),
    "PH": ("Philippines",     "63", "PHP", "english"),
}


def countries() -> list[dict]:
    """Offered countries, each carrying the defaults it implies."""
    out = []
    for code in SUPPORTED:
        name, dial, currency, voice = COUNTRY_INFO.get(
            code, (code, "", CURRENCIES[0], VOICES[0]["id"]))
        out.append({
            "code": code, "name": name, "dial": dial,
            # only suggest a currency the deployment actually offers
            "currency": currency if currency in CURRENCIES else CURRENCIES[0],
            "voice": voice if voice in VOICE_BY_ID else VOICES[0]["id"],
            "blocked": code in BLOCKED,
        })
    return out

# Lists are read once at import, so a running server can be older than the
# files on disk. The console needs to be able to say so.
STARTED_AT = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
CONFIG_KEYS = ("regions", "blocked", "currencies", "units", "locales", "styles")

RUNS: dict[str, dict] = {}
RUNS_LOCK = threading.Lock()

# --------------------------------------------------------------------------
# Phase 2 — procurement chain
#
# Demo (`SHOPVOICE_DEMO=1`): the inventory trigger may auto-rehearse
# reorder → vendor → owner-status using fixtures (sandbox / advisory).
#
# Live: the same plan is computed, but vendor ordering and follow-up legs are
# advisory-only until an operator POSTs /api/checkins/approve with explicit
# per-recipient authorization. Consent is never synthesized from the shop
# owner's check-in opt-in.
#
# CHAIN_CAP caps total calls per chain (demo auto-fire or live approvals).
# --------------------------------------------------------------------------

CHAIN_CAP = 10  # 1 trigger + at most 9 follow-up calls, per chain
CHAIN_COUNTS: dict[str, int] = {}
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})
SERVER_HOST = os.environ.get("SHOPVOICE_HOST", "127.0.0.1")
SERVER_PORT = int(os.environ.get("SHOPVOICE_PORT", "8765"))


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------

def _conn():
    conn = store.connect(DB_PATH)
    store.initialize(conn)
    return conn


def _rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args)]


def raw_result(call_id: str) -> dict | None:
    """The full CALL-E response, which is where transcripts live.

    Live results are written to RESULTS_DIR as they land. Fixture calls are
    read from their source file, so history predating the console still opens.
    """
    saved = RESULTS_DIR / f"{call_id}.json"
    if saved.is_file():
        try:
            return json.loads(saved.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return None
    for path in sorted(FIXTURES.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if payload.get("call_id") == call_id:
            return payload
    return None


def transcript_of(payload: dict) -> list[dict]:
    for recipient in payload.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            turns = attempt.get("transcript_turns") or []
            if turns:
                return [{"at": t.get("offset_seconds", 0),
                         "who": t.get("speaker", "bot"),
                         "text": t.get("text", "")} for t in turns]
    return []


def duration_of(payload: dict) -> int | None:
    for recipient in payload.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            if attempt.get("duration_seconds"):
                return int(attempt["duration_seconds"])
            start, end = attempt.get("started_at"), attempt.get("completed_at")
            if start and end:
                try:
                    fmt = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
                    return int((fmt(end) - fmt(start)).total_seconds())
                except ValueError:
                    pass
    return None


def checkpoint_stats(shop_ids: list[str]) -> dict[str, dict]:
    """Attempt counts per shop, read once from the checkpoints.

    A shop id can contain dashes, so the key is matched against the known ids
    rather than parsed, longest first: "alpha-mall" must not swallow a key
    belonging to "alpha-mall-annex".
    """
    provider_hash = live_call.provider_account_hash(
        os.environ.get("CALLE_API_KEY") or "demo")
    folder = live_call.STATE_DIR / provider_hash
    stats = {sid: {"placed": 0, "failed": 0, "last": None} for sid in shop_ids}
    if not folder.is_dir():
        return stats
    ordered = sorted(shop_ids, key=len, reverse=True)
    for path in folder.glob("*.json"):
        try:
            cp = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        key = cp.get("idempotency_key") or ""
        sid = next((s for s in ordered if key.startswith(f"shopvoice-{s}-")), None)
        if sid is None:
            continue
        bucket = stats[sid]
        if cp.get("call_id"):
            bucket["placed"] += 1
        else:
            bucket["failed"] += 1
        when = cp.get("updated_at")
        if when and (bucket["last"] is None or when > bucket["last"]):
            bucket["last"] = when
    return stats


def customers() -> list[dict]:
    conn = _conn()
    try:
        shops = _rows(conn, "SELECT * FROM shops ORDER BY COALESCE(display_name, id)")
        counts = {r["shop_id"]: r for r in _rows(conn,
            "SELECT shop_id, COUNT(*) AS calls, MAX(created_at) AS last_call"
            " FROM call_receipts GROUP BY shop_id")}
        attempts = checkpoint_stats([s["id"] for s in shops])
        for shop in shops:
            stat = counts.get(shop["id"], {})
            tried = attempts.get(shop["id"], {})
            shop["calls"] = stat.get("calls", 0)
            # attempts that never became a ledger row still happened
            shop["failed"] = tried.get("failed", 0)
            shop["last_call"] = stat.get("last_call") or tried.get("last")
            shop["products"] = [r["display_name"] for r in _rows(conn,
                "SELECT display_name FROM products WHERE shop_id = ? ORDER BY display_name",
                (shop["id"],))]
        return shops
    finally:
        conn.close()


def customer(shop_id: str) -> dict:
    conn = _conn()
    try:
        rows = _rows(conn, "SELECT * FROM shops WHERE id = ?", (shop_id,))
        if not rows:
            raise ApiError(404, f"No shop with id {shop_id!r}.")
        shop = rows[0]
        shop["products"] = _rows(conn,
            "SELECT display_name AS name, unit, quantity_estimate, running_low"
            " FROM products WHERE shop_id = ? ORDER BY display_name", (shop_id,))
        return shop
    finally:
        conn.close()


def calls_for(shop_id: str) -> list[dict]:
    conn = _conn()
    try:
        receipts = _rows(conn,
            "SELECT * FROM call_receipts WHERE shop_id = ? ORDER BY created_at DESC", (shop_id,))
        for r in receipts:
            readings = _rows(conn,
                "SELECT display_name AS name, quantity_estimate AS qty, unit, running_low"
                " FROM inventory_readings WHERE source_call_id = ? ORDER BY display_name",
                (r["call_id"],))
            sales = _rows(conn,
                "SELECT sales_date, estimated_revenue, procurement_spend, top_sellers_json"
                " FROM daily_sales WHERE source_call_id = ?", (r["call_id"],))
            r["products"] = readings
            r["low"] = sum(1 for x in readings if x["running_low"])
            if sales:
                r["revenue"] = sales[0]["estimated_revenue"]
                r["spend"] = sales[0]["procurement_spend"]
                r["date"] = sales[0]["sales_date"]
            elif readings:
                dates = _rows(conn,
                    "SELECT DISTINCT reading_date FROM inventory_readings WHERE source_call_id = ?",
                    (r["call_id"],))
                r["date"] = dates[0]["reading_date"] if dates else r["created_at"][:10]
            else:
                r["date"] = r["created_at"][:10]
        return receipts
    finally:
        conn.close()


def attempts_for(shop_id: str) -> list[dict]:
    """Calls that were attempted, from the checkpoints.

    The ledger only records calls that completed and passed the confidence
    gate, so a refused or failed call leaves no trace there. An operator still
    needs to see it: "no calls yet" after two failed attempts is a lie, and it
    hides the reason they failed.
    """
    provider_hash = live_call.provider_account_hash(
        os.environ.get("CALLE_API_KEY") or "demo")
    folder = live_call.STATE_DIR / provider_hash
    if not folder.is_dir():
        return []
    out = []
    for path in sorted(folder.glob("*.json")):
        try:
            cp = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        key = cp.get("idempotency_key") or ""
        if not key.startswith(f"shopvoice-{shop_id}-"):
            continue
        rest = key[len(f"shopvoice-{shop_id}-"):]
        call_type, _, remainder = rest.partition("-")
        if not remainder:
            continue
        # vendor_order/order_status key on an order_id (itself full of
        # dashes), not a date — treating it as YYYY-MM-DD produced garbage
        # ("undefined undefined NaN" in the console). Branch on which shape
        # this call_type actually uses.
        order_id = date = None
        if call_type in client.REQUEST_KEYED_CALL_TYPES:
            order_id = remainder
        else:
            parts = remainder.split("-")
            if len(parts) < 3:
                continue
            date = "-".join(parts[:3])
        out.append({
            "call_id": cp.get("call_id"),
            "call_type": call_type,
            "shop_id": shop_id,
            "order_id": order_id,
            "date": date,
            "phase": cp.get("phase"),
            "status": cp.get("status"),
            "error": live_call.redact_phones(cp.get("error")),
            "created_at": cp.get("updated_at") or "",
        })
    return out


def today_for(shop_id: str) -> dict:
    """What has already been dialled for this shop today.

    Consults the checkpoints as well as the ledger. Checkpoints outlive the
    database on purpose: a ledger can be rebuilt from call results, but a call
    that already rang someone cannot be un-placed. Reading only the ledger
    means a wiped database offers a "first" call that would silently resume the
    previous one instead of dialling.
    """
    shop = customer(shop_id)
    today = date.today().isoformat()
    ledger = [c for c in calls_for(shop["id"]) if c.get("date") == today]
    provider_hash = live_call.provider_account_hash(
        os.environ.get("CALLE_API_KEY") or "demo")
    attempts = {
        call_type: live_call.next_attempt(provider_hash, shop["id"], call_type, today) - 1
        for call_type in ("inventory", "sales")
    }
    return {
        "date": today,
        "calls": [{"call_id": c["call_id"], "call_type": c["call_type"]} for c in ledger],
        "attempts": attempts,
        "dialled": {k: v > 0 for k, v in attempts.items()},
    }


def call_detail(call_id: str) -> dict:
    conn = _conn()
    try:
        rows = _rows(conn, "SELECT * FROM call_receipts WHERE call_id = ?", (call_id,))
    finally:
        conn.close()
    payload = raw_result(call_id)
    if not rows and not payload:
        raise ApiError(404, f"No call with id {call_id!r}.")
    detail = rows[0] if rows else {"call_id": call_id}
    if rows:
        shop_calls = [c for c in calls_for(rows[0]["shop_id"]) if c["call_id"] == call_id]
        if shop_calls:
            detail = shop_calls[0]
    if payload:
        structured = payload.get("structured_result") or {}
        detail["transcript"] = _redact_transcript(transcript_of(payload))
        detail["duration"] = duration_of(payload)
        detail["evidence"] = live_call.deep_redact(payload.get("evidence") or [])
        detail["notes"] = live_call.redact_phones(structured.get("owner_notes") or "")
        detail["top_sellers"] = structured.get("top_sellers") or []
        detail["procurement"] = structured.get("procurement_items") or []
        detail["raw_products"] = structured.get("products") or []
        # Nested provider projection for the UI — never ship raw phones.
        detail["provider"] = live_call.public_result({
            k: payload[k] for k in payload
            if k in ("task", "structured_result", "recipients", "notes", "evidence")
        })
    if detail.get("shop_id"):
        try:
            detail["currency"] = customer(detail["shop_id"])["currency"]
        except ApiError:
            pass
    detail.setdefault("currency", CURRENCIES[0])
    detail.setdefault("transcript", [])
    detail.setdefault("evidence", [])
    detail.setdefault("notes", "")
    return detail


# --------------------------------------------------------------------------
# Writing
# --------------------------------------------------------------------------

def save_customer(body: dict) -> dict:
    voice = VOICE_BY_ID.get(str(body.get("voice") or ""))
    if voice and not body.get("locale"):
        body["locale"] = voice["locale"]
    body.setdefault("locale", VOICES[0]["locale"])
    for field in ("shop_id", "phone", "region", "locale"):
        if not str(body.get(field) or "").strip():
            raise ApiError(400, f"{field} is required.")
    try:
        phone = live_call.validate_e164(body["phone"])
    except live_call.LiveCallError as exc:
        raise ApiError(400, str(exc)) from exc
    profile = {
        "shop_id": body["shop_id"].strip(),
        "display_name": (body.get("display_name") or "").strip() or body["shop_id"].strip(),
        "phone": phone,
        "region": body["region"].strip().upper(),
        "locale": body["locale"].strip(),
        "currency": (body.get("currency") or CURRENCIES[0]).strip().upper(),
        "language_style": (body.get("language_style")
                           or VOICE_BY_ID.get(str(body.get("voice") or ""), {}).get("style")
                           or VOICES[0]["style"]),
        "consent_timestamp": body.get("consent_timestamp") or _now(),
        "typical_products": [
            {"name": p["name"].strip(), "unit": (p.get("unit") or "").strip() or None}
            for p in (body.get("products") or []) if str(p.get("name") or "").strip()
        ],
    }
    if body.get("create"):
        conn = _conn()
        try:
            taken = _rows(conn, "SELECT id FROM shops WHERE id = ?", (profile["shop_id"],))
        finally:
            conn.close()
        if taken:
            raise ApiError(409,
                f"The ID {profile['shop_id']!r} is already taken. "
                "Pick a different name, or open the existing shop.")
    conn = _conn()
    try:
        with conn:
            store.upsert_shop(conn, profile)
            store.seed_products(conn, profile)
    finally:
        conn.close()
    return _public_shop(customer(profile["shop_id"]))


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _log(msg: str) -> None:
    """Server-side trace for the confidence gate and the chain decisions
    built on it — where an operator watching the process, not the browser,
    can see why a leg was or wasn't trusted, and why the next call did or
    didn't fire. stderr, same as the request log below, never stdout."""
    print(f"  [chain] {live_call.redact_phones(msg)}", file=sys.stderr, flush=True)


def _public_shop(shop: dict) -> dict:
    """API copy of a shop row — never ship raw E.164 to the browser."""
    out = dict(shop)
    phone = out.pop("phone_e164", None)
    out["phone_masked"] = live_call.mask_phone(phone)
    return out


def _pending_leg_public(request: dict) -> dict:
    """Advisory chain plan for the UI: masked phone, no synthesized consent."""
    return {
        "call_type": request["call_type"],
        "shop_id": request["shop_id"],
        "phone_masked": live_call.mask_phone(request.get("phone")),
        "requires_authorization": True,
        "requires_vendor_authorization": request["call_type"] == "vendor_order",
        "request_id": request.get("request_id"),
        "vendor_display_name": request.get("vendor_display_name"),
        "low_stock_items": request.get("low_stock_items"),
        "order_items": request.get("order_items"),
        "order_status_known": request.get("order_status_known"),
    }


def _is_loopback_host(host: str) -> bool:
    return host.strip().lower().split("%")[0] in LOOPBACK_HOSTS


def _loopback_origins(port: int) -> set[str]:
    return {
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
        f"http://[::1]:{port}",
    }


def _redact_transcript(turns: list[dict]) -> list[dict]:
    out = []
    for turn in turns:
        item = dict(turn)
        if "text" in item:
            item["text"] = live_call.redact_phones(item.get("text"))
        out.append(item)
    return out


def _require_true(body: dict, field: str) -> None:
    """Strict boolean approval — truthy strings must not synthesize consent."""
    if body.get(field) is not True:
        raise ApiError(400, f"{field} must be the boolean true.")


def build_request(shop: dict, body: dict) -> dict:
    """The request dict the existing CLI path already understands."""
    products = [p["name"] for p in (body.get("products") or []) if str(p.get("name") or "").strip()]
    if not products:
        products = [p["name"] for p in shop.get("products", [])]
    if not products:
        raise ApiError(400, "Add at least one product to ask about.")
    _require_true(body, "consent")
    try:
        phone = live_call.validate_e164(shop.get("phone_e164") or shop.get("phone"))
    except live_call.LiveCallError as exc:
        raise ApiError(400, str(exc)) from exc
    return {
        "workflow_id": body.get("workflow_id") or f"console-{uuid.uuid4().hex[:8]}",
        "call_type": body.get("call_type") or "inventory",
        "phone": phone,
        "region": shop["region"],
        "locale": shop["locale"],
        "currency": shop["currency"],
        "shop_id": shop["id"],
        "recipient_consented": True,  # only after body.consent is True above
        "language_style": body.get("language_style")
                          or shop.get("language_style") or VOICES[0]["style"],
        "products_to_ask": products,
        "max_minutes": int(body.get("max_minutes") or 4),
    }


def _next_chain_requests(request: dict, result: dict, shop: dict, conn) -> list[dict]:
    """What to auto-fire next after `request` completed, or [] to stop here.

    Each returned dict is a ready-to-launch request, same shape build_request
    produces. Called with the shop's own vendor rows already written (ingest
    ran in _persist before this), so a vendor named on the reorder-offer call
    can be looked up by name.
    """
    call_type = request["call_type"]
    structured = result.get("structured_result") or {}

    if call_type == "inventory":
        low = [p["name"] for p in structured.get("products", []) if p.get("running_low")]
        if not low:
            _log(f"{shop['id']}/inventory ({result.get('call_id')}): nothing running low, "
                f"no reorder-offer callback")
            return []
        _log(f"{shop['id']}/inventory ({result.get('call_id')}): running low: "
            f"{', '.join(low)} -> calling {shop['id']} back to offer a reorder")
        return [{
            "call_type": "reorder_offer", "phone": shop["phone_e164"],
            "region": shop["region"], "locale": shop["locale"],
            "currency": shop["currency"], "shop_id": shop["id"],
            "language_style": shop.get("language_style") or VOICES[0]["style"],
            "low_stock_items": low, "max_minutes": 4,
        }]

    if call_type == "reorder_offer":
        if not structured.get("owner_wants_to_order"):
            _log(f"{shop['id']}/reorder_offer ({result.get('call_id')}): owner declined, "
                f"no vendor called")
            return []
        items = structured.get("items") or []
        request_id = f"restock-{result['call_id']}"
        by_vendor: dict[str, list[dict]] = {}
        for item in items:
            name = item.get("vendor_name")
            if name:
                by_vendor.setdefault(name, []).append(item)
        out = []
        for vendor_name, vendor_items in by_vendor.items():
            vendor = store.find_vendor_by_name(conn, shop_id=shop["id"], name=vendor_name)
            if not vendor or not vendor["phone_e164"]:
                # never invent a vendor phone number — skip, don't guess
                _log(f"{shop['id']}/reorder_offer: owner named {vendor_name!r} but no phone "
                    f"is on file — not calling")
                continue
            with conn:
                order_id = store.create_order(
                    conn, request_id=request_id, shop_id=shop["id"],
                    vendor_id=vendor["vendor_id"], now=_now())
            _log(f"{shop['id']}/reorder_offer: owner said yes -> calling vendor "
                f"{vendor_name!r} to place order {order_id}")
            out.append({
                "call_type": "vendor_order", "phone": vendor["phone_e164"],
                # Same region/locale as the shop — the account is scoped to one
                # region for this deployment; a cross-border vendor is out of
                # scope for the demo.
                "region": shop["region"], "locale": shop["locale"],
                "currency": shop["currency"], "shop_id": shop["id"],
                "vendor_display_name": vendor_name,
                "order_items": [
                    " ".join(str(x) for x in
                             (i.get("quantity_needed"), i.get("unit"), i.get("name")) if x)
                    for i in vendor_items
                ],
                "request_id": order_id, "max_minutes": 3,
            })
        return out

    if call_type == "vendor_order":
        order_id = result.get("metadata", {}).get("order_id")
        if not order_id:
            _log(f"{shop['id']}/vendor_order ({result.get('call_id')}): no order_id in "
                f"metadata — cannot call the owner back about an order we can't identify")
            return []
        # The owner callback has to state a real outcome, not ask the model to
        # invent one — pull it from the order row the vendor-call ingest just
        # updated (store.record_vendor_call), not from `structured` again,
        # since the row is the one place both legs agree on.
        order = store.get_order(conn, order_id=order_id)
        if order is None:
            _log(f"{shop['id']}/vendor_order: order {order_id} not found — cannot report "
                f"a status that isn't on file")
            return []
        _log(f"{shop['id']}/vendor_order: order {order_id} {order['status']} -> calling "
            f"{shop['id']} back with the status")
        return [{
            "call_type": "order_status", "phone": shop["phone_e164"],
            "region": shop["region"], "locale": shop["locale"],
            "currency": shop["currency"], "shop_id": shop["id"],
            "request_id": order_id, "max_minutes": 2,
            "order_status_known": order["status"],
            "order_amount": order["amount"], "order_eta_text": order["eta_text"],
        }]

    return []  # order_status is terminal; onboarding/sales never chain


def _launch(request: dict, call_date: str, api_key: str, *,
           attempt: int = 1, chain_id: str | None = None,
           parent_key: str | None = None) -> str | None:
    """Register a run and start it on its own thread. Returns the new key,
    or None if the chain has hit CHAIN_CAP and this call was refused."""
    key = uuid.uuid4().hex[:12]
    root = chain_id or key
    with RUNS_LOCK:
        count = CHAIN_COUNTS.get(root, 0) + 1
        if count > CHAIN_CAP:
            return None
        CHAIN_COUNTS[root] = count
        RUNS[key] = {"key": key, "phase": "queued", "elapsed": 0.0, "status": "queued",
                     "call_type": request["call_type"],
                     "demo": DEMO, "shop_id": request["shop_id"], "started": time.time(),
                     "masked_phone": live_call.mask_phone(request["phone"]),
                     "attempt": attempt,
                     "chain_id": root, "chain_position": count, "parent_key": parent_key,
                     "next_keys": [],
                     "call_id": None, "error": None, "done": False, "result": None}
        if parent_key and parent_key in RUNS:
            RUNS[parent_key]["next_keys"].append(key)
    target = _demo_run if DEMO else _live_run
    threading.Thread(target=target, args=(key, request, call_date, api_key, attempt),
                     daemon=True).start()
    return key


def start_checkin(body: dict) -> dict:
    _require_true(body, "consent")
    shop = customer(str(body.get("shop_id") or ""))
    if shop["region"].upper() in BLOCKED:
        raise ApiError(400,
            f"{shop['region'].upper()} is not enabled on this account. "
            "CALL-E rejects the call at creation, so it is refused here instead.")

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key and not DEMO:
        raise ApiError(400,
            "CALLE_API_KEY is not set on the server. Export it and restart, "
            "or set SHOPVOICE_DEMO=1 to replay a stored call.")

    request = build_request(shop, body)
    call_date = body.get("call_date") or date.today().isoformat()

    # "One call per shop per type per day" is the safety default. A repeat is
    # allowed but must be asked for, and its key stays derived so a crash-retry
    # still resumes rather than dialling again.
    provider_hash = live_call.provider_account_hash(api_key or "demo")
    attempt = (live_call.next_attempt(provider_hash, shop["id"],
                                      request["call_type"], call_date)
               if body.get("again") else 1)

    # Live: only this check-in is authorized here. Follow-up procurement legs
    # stay advisory until POST /api/checkins/approve. Demo may auto-rehearse.
    key = _launch(request, call_date, api_key, attempt=attempt)
    if key is None:  # unreachable for a fresh chain — CHAIN_CAP starts at 0
        raise ApiError(500, "Could not start the chain.")
    return {"key": key, "demo": DEMO, "attempt": attempt, "chain_id": key}


def retry_order_status(order_id: str, body: dict | None = None) -> dict:
    """Queue (live) or launch (demo) an owner status callback for an order.

    Live mode does not dial until the operator approves with explicit consent.
    """
    body = body or {}
    order_id = str(order_id or "").strip()
    if not order_id:
        raise ApiError(400, "order_id is required.")

    conn = _conn()
    try:
        order = store.get_order(conn, order_id=order_id)
    finally:
        conn.close()
    if order is None:
        raise ApiError(404, f"No order with id {order_id!r}.")

    shop = customer(order["shop_id"])
    if shop["region"].upper() in BLOCKED:
        raise ApiError(400,
            f"{shop['region'].upper()} is not enabled on this account.")

    api_key = os.environ.get("CALLE_API_KEY")
    if not api_key and not DEMO:
        raise ApiError(400,
            "CALLE_API_KEY is not set on the server. Export it and restart, "
            "or set SHOPVOICE_DEMO=1 to replay a stored call.")

    request = {
        "call_type": "order_status", "phone": shop["phone_e164"],
        "region": shop["region"], "locale": shop["locale"],
        "currency": shop["currency"], "shop_id": shop["id"],
        "request_id": order_id, "max_minutes": 2,
        "order_status_known": order["status"],
        "order_amount": order["amount"], "order_eta_text": order["eta_text"],
    }
    call_date = date.today().isoformat()

    if not DEMO:
        _require_true(body, "consent")
        request["recipient_consented"] = True
    else:
        request["recipient_consented"] = True

    key = _launch(request, call_date, api_key)
    if key is None:
        raise ApiError(500, "Could not start the retry.")
    _log(f"{shop['id']}/order_status: retrying order {order_id} (status={order['status']})")
    return {"key": key, "demo": DEMO}


def _set(key: str, **fields):
    with RUNS_LOCK:
        if key in RUNS:
            RUNS[key].update(fields)


def _persist(key: str, result: dict, request: dict) -> "ingest.IngestResult":
    call_id = result.get("call_id")
    if call_id:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        # Persist a masked projection — never leave raw phones on disk for logs.
        (RESULTS_DIR / f"{call_id}.json").write_text(
            json.dumps(live_call.public_result(result), ensure_ascii=False, indent=2),
            encoding="utf-8")
    conn = _conn()
    try:
        # request["phone"] is the vendor's number for vendor_order, not the
        # shop's — upsert_shop would overwrite shops.phone_e164 with it. See
        # THIRD_PARTY_RECIPIENT_CALL_TYPES.
        if request["call_type"] not in client.THIRD_PARTY_RECIPIENT_CALL_TYPES:
            with conn:
                store.upsert_shop(conn, {**request, "display_name": request.get("shop_id")})
        verdict = ingest.ingest_call(conn, result)
    finally:
        conn.close()
    score = (result.get("completion_confidence") or {}).get("score")
    score_text = f"{score:.2f}" if isinstance(score, (int, float)) else "missing"
    _log(f"{request.get('shop_id')}/{request.get('call_type')} ({call_id}): "
        f"confidence {score_text} vs {ingest.CONFIDENCE_THRESHOLD:.2f} threshold -> {verdict}")
    # `done` is set by the caller, once the chain decision below has also
    # landed — otherwise a poll could see this leg as finished with
    # next_keys still empty, half a second before the next call is queued.
    _set(key, phase="completed", status=result.get("status", "completed"),
         call_id=call_id, result={"verdict": str(verdict), "call_id": call_id})
    return verdict


def _maybe_continue_chain(key: str, request: dict, result: dict, call_date: str,
                          api_key: str, accepted: bool) -> None:
    """Plan or fire the next call(s) in the Phase 2 chain.

    Gated on `accepted`: a rejected result carries no trustworthy
    structured_result. Live mode is advisory-only — pending legs wait for
    POST /api/checkins/approve with explicit consent. Demo sandbox may
    auto-rehearse, attaching sandbox consent only for fixture dials.
    """
    if not accepted:
        _log(f"{request.get('shop_id')}/{request.get('call_type')}: result not accepted "
            f"(see confidence line above) — chain stops here, nothing auto-fires")
        return
    with RUNS_LOCK:
        chain_id = RUNS.get(key, {}).get("chain_id", key)
    conn = _conn()
    try:
        rows = _rows(conn, "SELECT * FROM shops WHERE id = ?", (request["shop_id"],))
        if not rows:
            return
        next_requests = _next_chain_requests(request, result, rows[0], conn)
    finally:
        conn.close()
    if not next_requests:
        return

    if not DEMO:
        # Live: surface the plan; do not dial vendor/callback without approval.
        pending = []
        with RUNS_LOCK:
            stored = []
            for leg in next_requests:
                stored.append(dict(leg))
                pending.append(_pending_leg_public(leg))
            RUNS[key]["pending_next"] = pending
            RUNS[key]["pending_requests"] = stored
            RUNS[key]["chain_advisory"] = True
        _log(f"{request.get('shop_id')}/{request.get('call_type')}: live procurement is "
            f"advisory-only — {len(pending)} pending leg(s); POST /api/checkins/approve")
        return

    capped = False
    for next_request in next_requests:
        # Demo sandbox only: fixture path, not a real recipient consent claim.
        demo_req = {**next_request, "recipient_consented": True}
        if demo_req["call_type"] == "vendor_order":
            demo_req["vendor_contact_authorized"] = True
        new_key = _launch(demo_req, call_date, api_key,
                          chain_id=chain_id, parent_key=key)
        if new_key is None:
            capped = True
    if capped:
        _set(key, chain_capped=True)


def approve_next(body: dict) -> dict:
    """Operator-bound approval to dial one pending live chain leg."""
    if DEMO:
        raise ApiError(400, "Approve is for live mode; demo auto-rehearses the chain.")
    _require_true(body, "consent")
    parent_key = str(body.get("parent_key") or "").strip()
    if not parent_key:
        raise ApiError(400, "parent_key is required.")
    try:
        index = int(body.get("leg_index", 0))
    except (TypeError, ValueError) as exc:
        raise ApiError(400, "leg_index must be an integer.") from exc

    with RUNS_LOCK:
        parent = RUNS.get(parent_key)
        if not parent:
            raise ApiError(404, f"No run with key {parent_key!r}.")
        pending = list(parent.get("pending_requests") or [])
        if index < 0 or index >= len(pending):
            raise ApiError(400, "leg_index is out of range for pending_next.")
        leg = dict(pending[index])
        call_date = body.get("call_date") or date.today().isoformat()
        api_key = os.environ.get("CALLE_API_KEY")
        chain_id = parent.get("chain_id", parent_key)

    if not api_key:
        raise ApiError(400, "CALLE_API_KEY is not set on the server.")

    try:
        live_call.validate_e164(leg.get("phone"))
    except live_call.LiveCallError as exc:
        raise ApiError(400, str(exc)) from exc

    if leg["call_type"] == "vendor_order":
        _require_true(body, "vendor_contact_authorized")
        leg["vendor_contact_authorized"] = True

    leg["recipient_consented"] = True
    key = _launch(leg, call_date, api_key, chain_id=chain_id, parent_key=parent_key)
    if key is None:
        raise ApiError(429, "Chain cap reached; no further calls in this chain.")

    with RUNS_LOCK:
        parent = RUNS.get(parent_key) or {}
        remaining = list(parent.get("pending_requests") or [])
        if 0 <= index < len(remaining):
            remaining.pop(index)
        parent["pending_requests"] = remaining
        parent["pending_next"] = [_pending_leg_public(r) for r in remaining]
        RUNS[parent_key] = parent

    _log(f"{leg.get('shop_id')}/{leg.get('call_type')}: approved → launched {key}")
    return {"key": key, "demo": False, "parent_key": parent_key, "call_type": leg["call_type"]}


def _live_run(key: str, request: dict, call_date: str, api_key: str, attempt: int = 1):
    def progress(elapsed: float, status: str):
        phase = "completed" if status in live_call.TERMINAL_STATUSES else "in_progress"
        _set(key, elapsed=round(elapsed, 1), status=status, phase=phase)
    try:
        _set(key, phase="ringing")
        base_url = live_call.resolve_base_url()
        calle = live_call.build_client(api_key, base_url)
        result = live_call.execute_live(
            request, calle,
            task=client.build_task(request),
            schema=client.load_json(client.schema_path(request["call_type"])),
            provider_hash=live_call.provider_account_hash(api_key),
            call_date=call_date,
            attempt=attempt,
            request_id=request.get("request_id"),
            progress=progress,
        )
        verdict = _persist(key, result, request)
        _maybe_continue_chain(key, request, result, call_date, api_key, verdict.accepted)
        _set(key, done=True)
    except Exception as exc:                       # surfaced to the operator
        sys.stderr.write(live_call.redact_phones(traceback.format_exc()))
        _set(key, done=True, phase="failed", error=live_call.redact_phones(str(exc)))


def _demo_fixture_for(request: dict) -> dict | None:
    """The fixture to replay for this leg. See DEMO_CHAIN_FIXTURE above."""
    dedicated = DEMO_CHAIN_FIXTURE.get(request["call_type"])
    if dedicated and dedicated.is_file():
        try:
            return json.loads(dedicated.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    # No dedicated fixture for this call_type (sales, onboarding, ...) —
    # fall back to the newest fixture that actually matches, rather than the
    # newest fixture full stop, which could silently replay the wrong type.
    for path in sorted(RESULTS_DIR.glob("*.json"), reverse=True) + \
                sorted(FIXTURES.glob("*.json"), reverse=True):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if payload.get("metadata", {}).get("call_type") == request["call_type"]:
            return payload
    return None


def _demo_run(key: str, request: dict, call_date: str, api_key, attempt: int = 1):
    """Replay a stored call at wall-clock speed. No CALL-E call is placed —
    but the result is ingested through the same path a live result would be,
    including the chain decision, so SHOPVOICE_DEMO=1 rehearses the whole
    auto-chain (vendor lookup, order creation, every leg) for free before
    testing it live. See DEMO_CHAIN_FIXTURE."""
    source = _demo_fixture_for(request)
    if source is None:
        _set(key, done=True, phase="failed", error="No stored call to replay.")
        return
    turns = transcript_of(source)
    total = (turns[-1]["at"] if turns else 30) + 4
    _set(key, phase="ringing", status="ringing")
    started = time.time()
    while True:
        elapsed = time.time() - started
        if elapsed >= total:
            break
        _set(key, elapsed=round(elapsed, 1), phase="in_progress", status="in_progress")
        time.sleep(0.5)

    # The fixture was written for a fictional shop and, for vendor_order /
    # order_status, a fictional order_id. Rebind both to this run so the
    # replay attaches to whichever shop is actually being tested and to the
    # order _next_chain_requests actually opened, not the fixture's own.
    result = dict(source)
    result["call_id"] = f"demo-{key}"
    result["metadata"] = {**source.get("metadata", {}), "shop_id": request["shop_id"],
                          "call_type": request["call_type"], "call_date": call_date}
    if request.get("request_id"):
        result["metadata"]["order_id"] = request["request_id"]
        structured = dict(source.get("structured_result") or {})
        if "order_id" in structured:
            structured["order_id"] = request["request_id"]
        result["structured_result"] = structured

    verdict = _persist(key, result, request)
    _maybe_continue_chain(key, request, result, call_date, api_key, verdict.accepted)
    _set(key, done=True)


def run_status(key: str) -> dict:
    with RUNS_LOCK:
        run = RUNS.get(key)
        if not run:
            raise ApiError(404, "Unknown run.")
        run = dict(run)
    # `elapsed` in RUNS is a snapshot from live_call's own progress callback,
    # which only fires on a status change or its 30s heartbeat — reporting it
    # as-is makes the modal's clock visibly stall between those, then jump.
    # Recompute it from `started` on every read instead, so it ticks with
    # however often the browser actually polls, independent of CALL-E's
    # internal cadence. A finished run keeps its last recorded value.
    if not run.get("done") and run.get("started"):
        run["elapsed"] = round(time.time() - run["started"], 1)
    return run


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

ROUTES_GET = {}
ROUTES_POST = {}


class Handler(BaseHTTPRequestHandler):
    server_version = "ShopVoiceConsole/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, payload):
        # Redact only the public projection; private execution/state stays intact.
        public_payload = live_call.deep_redact(payload)
        self._send(status, json.dumps(public_payload, ensure_ascii=False, default=str).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _console_origin_ok(self) -> bool:
        """Reject cross-origin mutating controls against the loopback console."""
        port = SERVER_PORT
        allowed = _loopback_origins(port)
        origin = (self.headers.get("Origin") or "").strip()
        referer = (self.headers.get("Referer") or "").strip()
        host = (self.headers.get("Host") or "").split(":")[0].strip().lower()
        if host and host not in LOOPBACK_HOSTS and os.environ.get("SHOPVOICE_ALLOW_REMOTE") != "1":
            return False
        if origin:
            return origin in allowed
        if referer:
            return any(referer.startswith(o + "/") or referer == o for o in allowed)
        # Same-origin navigations and curl without Origin: require loopback peer.
        peer = self.client_address[0] if self.client_address else ""
        return peer in ("127.0.0.1", "::1", "localhost")

    def _remote_authorized(self) -> bool:
        if os.environ.get("SHOPVOICE_ALLOW_REMOTE") != "1":
            return True
        expected = os.environ.get("SHOPVOICE_REMOTE_TOKEN") or ""
        if not expected:
            return False
        return (self.headers.get("X-ShopVoice-Token") or "") == expected

    def _authorize_api(self) -> bool:
        """Protect private records (GET and POST) on loopback/remote consoles."""
        if not self._console_origin_ok():
            self._json(403, {"error": "Cross-origin or non-loopback console controls are refused."})
            return False
        if not self._remote_authorized():
            self._json(401, {"error": "Remote console requires X-ShopVoice-Token."})
            return False
        return True

    def _static(self, path: str):
        name = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (STATIC / name).resolve()
        if not str(target).startswith(str(STATIC.resolve())) or not target.is_file():
            self._json(404, {"error": "Not found."})
            return
        types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".json": "application/json",
                 ".svg": "image/svg+xml", ".ico": "image/x-icon"}
        self._send(200, target.read_bytes(), types.get(target.suffix, "application/octet-stream"))

    def do_GET(self):
        route = urlparse(self.path).path
        try:
            if not route.startswith("/api/"):
                return self._static(route)
            parts = [p for p in route[5:].split("/") if p]
            # Public: mode/config only. Customer, call, and run records need auth.
            if parts == ["config"]:
                return self._json(200, {
                    "live": bool(os.environ.get("CALLE_API_KEY")),
                    "demo": DEMO, "db": str(DB_PATH),
                    "started_at": STARTED_AT, "config_keys": list(CONFIG_KEYS),
                    "regions": SUPPORTED, "blocked": sorted(BLOCKED),
                    "currencies": CURRENCIES, "units": UNITS,
                    "countries": countries(), "voices": VOICES,
                    "loopback_only": _is_loopback_host(SERVER_HOST),
                })
            if not self._authorize_api():
                return
            if parts == ["customers"]:
                return self._json(200, {"customers": [_public_shop(c) for c in customers()]})
            if len(parts) == 2 and parts[0] == "customers":
                return self._json(200, _public_shop(customer(parts[1])))
            if len(parts) == 3 and parts[0] == "customers" and parts[2] == "calls":
                ledger = calls_for(parts[1])
                seen = {c["call_id"] for c in ledger}
                with RUNS_LOCK:
                    live = [dict(r) for r in RUNS.values()
                            if r.get("shop_id") == parts[1] and not r.get("done")]
                running = [{
                    "key": r["key"],
                    "call_id": r.get("call_id") or ("run-" + r["key"]),
                    "call_type": r.get("call_type") or "inventory",
                    "date": date.today().isoformat(),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "outcome": "running", "phase": r.get("phase"),
                    "elapsed": round(time.time() - r["started"], 1) if r.get("started") else 0,
                    "accepted": 0, "confidence": None, "products": [], "low": 0,
                    "chain_id": r.get("chain_id"), "chain_position": r.get("chain_position"),
                    "parent_key": r.get("parent_key"), "next_keys": r.get("next_keys", []),
                    "pending_next": r.get("pending_next") or [],
                } for r in live]
                unrecorded = [
                    {**a, "accepted": 0, "confidence": None, "products": [], "low": 0,
                     "outcome": "failed",
                     "call_id": a["call_id"] or ("attempt-" + a["created_at"])}
                    for a in attempts_for(parts[1])
                    if a["call_id"] not in seen and a.get("phase") != "finished"
                ]
                merged = sorted(running + ledger + unrecorded,
                                key=lambda c: c.get("created_at") or "", reverse=True)
                return self._json(200, {"calls": merged})
            if len(parts) == 3 and parts[0] == "customers" and parts[2] == "today":
                return self._json(200, today_for(parts[1]))
            if len(parts) == 2 and parts[0] == "calls":
                return self._json(200, call_detail(parts[1]))
            if len(parts) == 2 and parts[0] == "checkins":
                return self._json(200, run_status(parts[1]))
            self._json(404, {"error": "Unknown endpoint."})
        except ApiError as exc:
            self._json(exc.status, {"error": live_call.redact_phones(exc.message)})
        except Exception as exc:
            sys.stderr.write(live_call.redact_phones(traceback.format_exc()))
            self._json(500, {"error": live_call.redact_phones(str(exc))})

    do_HEAD = do_GET

    def do_POST(self):
        route = urlparse(self.path).path
        try:
            if not self._authorize_api():
                return
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            parts = [p for p in route[5:].split("/") if p] if route.startswith("/api/") else []
            if parts == ["customers"]:
                return self._json(200, save_customer(body))
            if parts == ["checkins"]:
                return self._json(202, start_checkin(body))
            if parts == ["checkins", "approve"]:
                return self._json(202, approve_next(body))
            if len(parts) == 3 and parts[0] == "orders" and parts[2] == "retry-status":
                return self._json(202, retry_order_status(parts[1], body))
            self._json(404, {"error": "Unknown endpoint."})
        except ApiError as exc:
            self._json(exc.status, {"error": live_call.redact_phones(exc.message)})
        except json.JSONDecodeError:
            self._json(400, {"error": "Body must be JSON."})
        except Exception as exc:
            sys.stderr.write(live_call.redact_phones(traceback.format_exc()))
            self._json(500, {"error": live_call.redact_phones(str(exc))})


def _watch_and_reload():
    """Restart when a source file changes, so an edit does not need a manual
    restart. Opt in with SHOPVOICE_RELOAD=1.

    Never restarts while a call is in flight: the run state lives in memory,
    and losing it mid-call would leave the operator with no status for a call
    that is still ringing someone. The checkpoint would still protect the
    budget, but the console would go blind, so the reload simply waits.
    """
    watched = [Path(__file__).resolve()] + [
        APP_ROOT / name for name in
        ("live_call.py", "client.py", "ingest.py", "store.py", "summarize.py")
    ]
    stamps = {}
    for path in watched:
        try:
            stamps[path] = path.stat().st_mtime
        except OSError:
            pass
    while True:
        time.sleep(1.0)
        for path, was in list(stamps.items()):
            try:
                now = path.stat().st_mtime
            except OSError:
                continue
            if now == was:
                continue
            with RUNS_LOCK:
                busy = any(not r.get("done") for r in RUNS.values())
            if busy:
                continue                       # try again on the next tick
            print(f"\n  {path.name} changed, restarting")
            sys.stdout.flush()
            os.execv(sys.executable, [sys.executable] + sys.argv)


def main() -> int:
    host = SERVER_HOST
    port = SERVER_PORT
    if not _is_loopback_host(host):
        if os.environ.get("SHOPVOICE_ALLOW_REMOTE") != "1":
            print(
                f"Refusing non-loopback bind {host!r}. "
                "Set SHOPVOICE_HOST=127.0.0.1 (default), or set "
                "SHOPVOICE_ALLOW_REMOTE=1 and SHOPVOICE_REMOTE_TOKEN.",
                file=sys.stderr,
            )
            return 1
        if not os.environ.get("SHOPVOICE_REMOTE_TOKEN"):
            print(
                "Remote bind requires SHOPVOICE_REMOTE_TOKEN for mutating API calls.",
                file=sys.stderr,
            )
            return 1
    conn = _conn()
    conn.close()
    mode = "DEMO replay" if DEMO else ("live" if os.environ.get("CALLE_API_KEY") else "read only")
    if os.environ.get("SHOPVOICE_RELOAD") == "1":
        threading.Thread(target=_watch_and_reload, daemon=True).start()

    print(f"Shop Check-In console on http://{host}:{port}")
    print(f"  ledger  {DB_PATH}")
    print(f"  mode    {mode}")
    print(f"  bind    {'loopback' if _is_loopback_host(host) else 'remote-token'}")
    print(f"  started {STARTED_AT}"
          + ("  (auto-reload on)" if os.environ.get("SHOPVOICE_RELOAD") == "1" else ""))
    if not os.environ.get("CALLE_API_KEY") and not DEMO:
        print("  note    export CALLE_API_KEY to place calls, or SHOPVOICE_DEMO=1 to replay")
    ThreadingHTTPServer((host, port), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
