"""CALL-E terminal webhook receiver.

Current CALL-E deliveries are unsigned, so trust is established three ways instead of HMAC:
  1. the receiver path carries a random token (CALLE_WEBHOOK_SECRET) that only CALL-E was given;
  2. the `CALL-E-Event-Id` header must equal the body `id`, and each id is processed once;
  3. before acting, the call is re-fetched from the Calls API by id, so a forged body cannot
     inject a result. Pattern borrowed from apps/python/webhook-result-receiver.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlmodel import select

from app.api.deps import settings_dep
from app.calls.budget import count_real_calls
from app.calls.preflight import preflight, snapshot
from app.calls.registry import get_provider
from app import obs
from app.config import Settings
from app.db import session_scope
from app.models import CheckCall, WebhookReceipt

log = logging.getLogger("buddye.webhook")
router = APIRouter(prefix="/api/calle", tags=["webhooks"])

TERMINAL_TYPES = {"call.completed", "call.failed", "call.result_validation_failed"}


@router.post("/webhook/{token}")
async def calle_webhook(
    token: str,
    request: Request,
    settings: Settings = Depends(settings_dep),
    event_id_header: str | None = Header(default=None, alias="CALL-E-Event-Id"),
) -> dict[str, Any]:
    if not hmac.compare_digest(token, settings.CALLE_WEBHOOK_SECRET):
        raise HTTPException(404, "not found")
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("id"), str):
        raise HTTPException(400, "webhook body must be an object with an id")
    if event_id_header is not None and event_id_header != body["id"]:
        raise HTTPException(400, "CALL-E-Event-Id header does not match body id")
    if body.get("type") not in TERMINAL_TYPES:
        return {"ok": True, "ignored": "non-terminal type"}
    call = body.get("data") or {}
    call_id = call.get("id")
    if not isinstance(call_id, str):
        raise HTTPException(400, "webhook data.id missing")

    with session_scope() as s:
        if s.get(WebhookReceipt, body["id"]) is not None:
            return {"ok": True, "duplicate": True}
        s.add(WebhookReceipt(event_id=body["id"], call_id=call_id, event_type=body["type"]))
        record = s.exec(select(CheckCall).where(CheckCall.provider_call_id == call_id)).first()
        known = record is not None

    if not known:
        log.warning("webhook for unknown call %s", call_id)
        return {"ok": True, "unknown_call": True}

    # Re-verify with the API before acting; the webhook body is treated as a hint, not a fact.
    provider = get_provider(settings)
    verified: dict[str, Any] | None = None
    client = getattr(provider, "client", None)
    if client is not None:
        try:
            verified = await asyncio.to_thread(client.calls.get, call_id)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not re-verify call %s: %s", call_id, exc)
    if verified is None:
        return {"ok": True, "deferred": "poller will pick up the terminal state"}
    delivered = provider.deliver_webhook(call_id, verified) if hasattr(provider, "deliver_webhook") else False
    with session_scope() as s:
        rec = s.exec(select(CheckCall).where(CheckCall.provider_call_id == call_id)).first()
        if rec is not None:
            rec.webhook_received = True  # visible in the trace: the call finished by webhook, not by poll
            s.add(rec)
    obs.event("calle.webhook", provider_call_id=call_id, event_type=body["type"], delivered_to_poller=delivered)
    return {"ok": True, "delivered_to_poller": delivered}


@router.get("/status")
async def calle_status(settings: Settings = Depends(settings_dep)) -> dict[str, Any]:
    """Connection preflight. Never places, plans, or schedules a call.
    Served from the background snapshot when one exists; the live budget count is always fresh."""
    with session_scope() as s:
        used = count_real_calls(s)
    snap = snapshot()
    if snap is None:
        return await preflight(settings, budget_used=used)
    out = dict(snap)
    out["budget"] = {**snap["budget"], "used": used, "remaining": max(0, settings.CALL_BUDGET_MAX - used)}
    return out
