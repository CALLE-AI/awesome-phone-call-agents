"""GetPaid — a freelancer's polite invoice follow-up caller, built on CALL-E.

Run:
    uvicorn main:app --reload

Env vars (see .env.example):
    CALLE_MODE      "fixture" (default, no network/credentials needed) or "live"
    CALLE_API_KEY   required when CALLE_MODE=live
    CALLE_BASE_URL  defaults to https://api.heycall-e.com
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import ratelimit
import storage
from calle_client import CalleClient
from models import Invoice, CallAttempt, CallStatus, MAX_AUTO_FOLLOW_UPS

DEMO_LIMIT_MESSAGE = (
    "Demo limit reached for this session, please try again tomorrow or fork "
    "the repo to test with your own CALL-E account."
)
CONSENT_REQUIRED_MESSAGE = (
    "Consent required: confirm you have permission to call this number "
    "before placing a live call."
)
CREDITS_EXHAUSTED_MESSAGE = "Demo credits exhausted, see the video instead."

def _seed_demo_data_if_empty() -> None:
    """On hosts with ephemeral disk (e.g. a free-tier redeploy/restart wiping
    data/invoices.json), re-seed sample invoices so the app never boots to an
    empty, judge-visible list. Opt-in via AUTO_SEED_ON_EMPTY so local dev and
    tests are unaffected."""
    if os.environ.get("AUTO_SEED_ON_EMPTY", "").lower() not in ("1", "true", "yes"):
        return
    if storage.list_invoices():
        return
    from scripts.seed_demo import seed

    seed()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _seed_demo_data_if_empty()
    yield


app = FastAPI(title="GetPaid", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class NewInvoice(BaseModel):
    freelancer_name: str
    client_name: str
    client_phone: str
    invoice_number: str
    amount: str
    currency: str = "USD"
    due_date: str
    region: str = "US"
    locale: str = "en-US"
    notes: str = ""


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/mode")
def get_mode():
    mode = os.environ.get("CALLE_MODE", "fixture")
    info = {"mode": mode, "live_ready": bool(os.environ.get("CALLE_API_KEY"))}
    if mode == "live":
        placed = ratelimit.total_calls_placed()
        info["live_calls_placed"] = placed
        info["live_calls_max"] = ratelimit.MAX_TOTAL_LIVE_CALLS
        info["live_calls_exhausted"] = placed >= ratelimit.MAX_TOTAL_LIVE_CALLS
    return info


@app.get("/api/invoices")
def api_list_invoices():
    return storage.list_invoices()


@app.post("/api/invoices")
def api_create_invoice(payload: NewInvoice):
    invoice = Invoice.new(**payload.model_dump())
    storage.save_invoice(invoice)
    return invoice.to_dict()


def _invoice_from_dict(d: dict) -> Invoice:
    d = dict(d)
    d["status"] = CallStatus(d.get("status", "not_called"))
    d.pop("attempts", None)
    return Invoice(**d)


@app.post("/api/invoices/{invoice_id}/call")
def api_call_invoice(
    invoice_id: str, request: Request, follow_up: bool = False, consent: bool = False
):
    record = storage.get_invoice(invoice_id)
    if not record:
        raise HTTPException(404, "Invoice not found")

    invoice = _invoice_from_dict(record)
    client = CalleClient()

    if client.mode == "live":
        # Fast-fail cheap check first: once the global cap is hit, live
        # calling is done for good — no reason to burn a per-IP rate-limit
        # slot checking anything else. The authoritative, atomic check
        # happens again right before the real call below.
        if ratelimit.total_calls_placed() >= ratelimit.MAX_TOTAL_LIVE_CALLS:
            raise HTTPException(503, CREDITS_EXHAUSTED_MESSAGE)

        # Rate limit is checked before consent: through the real UI the call
        # button is disabled until consent is checked, so every request that
        # actually reaches the server in normal use already has consent=true.
        # Checking the limit first means even a raw, unconsented request
        # (e.g. curl) counts against the same per-IP budget and 429s once
        # exhausted, instead of always just 403ing regardless of call count.
        ip = request.client.host if request.client else "unknown"
        try:
            ratelimit.check_and_record(ip)
        except ratelimit.RateLimitExceeded:
            raise HTTPException(429, DEMO_LIMIT_MESSAGE)
        if not consent:
            raise HTTPException(403, CONSENT_REQUIRED_MESSAGE)

        # Authoritative gate: only increments right before a real call is
        # actually placed, so this count always matches real credit spend.
        try:
            ratelimit.check_and_record_global()
        except ratelimit.GlobalCapReached:
            raise HTTPException(503, CREDITS_EXHAUSTED_MESSAGE)

    result = client.place_call(invoice, follow_up=follow_up)

    status = CallStatus(result["status"])
    attempt = CallAttempt(
        id=f"{invoice_id}_{len(record.get('attempts', []))}",
        invoice_id=invoice_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        mode=result["mode"],
        status=status,
        promised_date=result.get("promised_date"),
        note=result.get("note", ""),
        calle_call_id=result.get("calle_call_id"),
    )
    storage.append_attempt(invoice_id, attempt)
    new_follow_up_count = record.get("follow_up_count", 0) + (1 if follow_up else 0)
    storage.update_invoice_fields(
        invoice_id,
        status=status.value,
        promised_date=result.get("promised_date"),
        follow_up_count=new_follow_up_count,
        last_attempt_at=attempt.created_at,
        needs_human_review=(
            record.get("needs_human_review", False) or new_follow_up_count >= MAX_AUTO_FOLLOW_UPS
        ),
    )
    return storage.get_invoice(invoice_id)


@app.post("/api/follow-ups/run")
def api_run_follow_ups(request: Request):
    """Finds every invoice eligible for an automatic follow-up call and
    places one each — a promised invoice whose promised_date has passed, or
    a voicemail/no_answer invoice whose retry window has elapsed — and
    places one automatic follow-up call each. Disputed/declined/wrong-number
    invoices are never auto-called again, and any invoice that has already
    hit MAX_AUTO_FOLLOW_UPS is excluded and flagged needs_human_review
    instead of being retried further.

    In live mode this is disabled entirely: automatic follow-ups have no
    per-invoice consent confirmation, so they never place a real call —
    only the per-invoice "call" button (which requires consent) can.
    """
    if CalleClient().mode == "live":
        return {
            "follow_ups_placed": 0,
            "invoices": [],
            "message": "Automatic follow-up calls are disabled in live mode — "
            "place individual calls with consent confirmed instead.",
        }

    placed = []
    for record in storage.list_invoices():
        invoice = _invoice_from_dict(record)
        if invoice.is_eligible_for_auto_follow_up():
            result = api_call_invoice(invoice.id, request, follow_up=True)
            placed.append(result)
    return {"follow_ups_placed": len(placed), "invoices": placed}


@app.delete("/api/invoices/{invoice_id}")
def api_delete_invoice(invoice_id: str):
    data = storage._read()
    data.pop(invoice_id, None)
    storage._write(data)
    return {"ok": True}
