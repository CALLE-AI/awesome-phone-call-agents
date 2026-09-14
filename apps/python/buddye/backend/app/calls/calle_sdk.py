"""CALL-E Developer API provider via the official `calle-ai` Python SDK.

The SDK is synchronous (httpx.Client), so every network call runs in a worker thread.
We deliberately do NOT use `create_and_wait`: we create, persist the call id, then poll
`get()` and `list_events()` so CALL-E's own developer events flow into the UI timeline.
A terminal webhook (see api/webhooks.py) can short-circuit the poll.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from app.calls.provider import (
    CANDIDATE_SKIP_CODES,
    RUN_FATAL_CODES,
    CallOutcome,
    CallRequest,
    CandidateRejectedByProvider,
    EventSink,
    ProviderEvent,
    ProviderFatalError,
)
from app import obs
from app.config import Settings

TERMINAL = {"completed", "failed", "canceled"}


def outcome_from_call(call: dict[str, Any]) -> CallOutcome:
    """Map a CALL-E `call_task` object onto our provider-neutral outcome."""
    status = call.get("status")
    recipients = call.get("recipients") or []
    attempts = (recipients[0].get("attempts") or []) if recipients else []
    last = attempts[-1] if attempts else {}
    transcript = list(last.get("transcript_turns") or [])
    duration = None
    if last.get("started_at") and last.get("completed_at"):
        try:
            duration = int((_parse(last["completed_at"]) - _parse(last["started_at"])).total_seconds())
        except ValueError:
            duration = None
    failure_code = call.get("failure_code") or last.get("failure_code")
    failure_message = call.get("failure_message") or last.get("failure_message")
    confidence = call.get("completion_confidence")
    if not isinstance(confidence, dict):
        confidence = None
    evidence = [str(e) for e in (call.get("evidence") or []) if isinstance(e, str)]

    if status == "completed":
        structured = call.get("structured_result")
        if structured is None and recipients:
            structured = recipients[0].get("structured_result")
        out_status = "COMPLETED" if structured is not None else "INVALID_RESULT"
    elif failure_code and "answer" in str(failure_code).lower():
        out_status = "NO_ANSWER"
    else:
        out_status = "FAILED"
        structured = None
    return CallOutcome(
        provider_call_id=call.get("id"),
        status=out_status,
        structured_result=structured if out_status == "COMPLETED" else None,
        transcript=transcript,
        summary=call.get("summary") or last.get("summary"),
        duration_s=duration,
        failure_code=failure_code,
        failure_message=failure_message,
        task_completed=call.get("task_completed") if isinstance(call.get("task_completed"), bool) else None,
        completion_confidence=confidence,
        evidence=evidence,
        raw=obs.redact(call),
    )


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _error_code(exc: Exception) -> str:
    return str(getattr(exc, "code", None) or type(exc).__name__)


def classify_api_error(exc: Exception) -> ProviderFatalError | CandidateRejectedByProvider | None:
    """Map a calle-ai exception onto the orchestrator's three responses.
    Returns None for transient failures (the caller records a FAILED outcome and moves on)."""
    code = getattr(exc, "code", None)
    status = getattr(exc, "status_code", None)
    message = str(exc)
    details = getattr(exc, "details", None)
    if code in RUN_FATAL_CODES or status in {401, 403}:
        return ProviderFatalError(str(code or status), message, details)
    if code in CANDIDATE_SKIP_CODES:
        return CandidateRejectedByProvider(str(code), message, details)
    return None


class CalleSdkProvider:
    name = "calle_sdk"

    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        if client is None:
            from calle import CalleClient  # imported lazily so tests never need the key

            if not settings.CALLE_API_KEY:
                raise RuntimeError("CALL_PROVIDER=calle_sdk requires CALLE_API_KEY")
            client = CalleClient(api_key=settings.CALLE_API_KEY, base_url=settings.CALLE_BASE_URL)
        self.client = client
        self.settings = settings
        self.poll_count = 0
        self.last_error_details: Any = None
        self._webhook_results: dict[str, asyncio.Future[dict[str, Any]]] = {}

    # --- webhook short-circuit -------------------------------------------------
    def expect_webhook(self, call_id: str) -> asyncio.Future[dict[str, Any]]:
        fut = self._webhook_results.get(call_id)
        if fut is None:
            fut = asyncio.get_event_loop().create_future()
            self._webhook_results[call_id] = fut
        return fut

    def deliver_webhook(self, call_id: str, call: dict[str, Any]) -> bool:
        fut = self._webhook_results.get(call_id)
        if fut is not None and not fut.done():
            fut.set_result(call)
            return True
        return False

    # --- provider --------------------------------------------------------------
    async def place(self, req: CallRequest, on_event: EventSink) -> CallOutcome:
        self.poll_count = 0  # per call, not per provider instance
        if req.existing_provider_call_id:
            call_id = req.existing_provider_call_id
            await on_event(ProviderEvent(type="call.resumed", message="Re-attached to in-flight CALL-E call", provider_call_id=call_id))
        else:
            kwargs: dict[str, Any] = dict(
                task=req.task,
                recipient={"phone": req.phone, "region": req.region, "locale": req.locale},
                result_schema=req.result_schema,
                metadata=req.metadata,
                idempotency_key=req.idempotency_key,
            )
            if req.webhook_url:
                kwargs["webhook_url"] = req.webhook_url
            try:
                with obs.timed("calle.create", idempotency_key=req.idempotency_key, to=obs.mask_phone(req.phone),
                               region=req.region, locale=req.locale, schema_fields=len(req.result_schema.get("properties", {}))) as leg:
                    created = await asyncio.to_thread(self.client.calls.create, **kwargs)
                    leg["provider_call_id"] = created.get("id")
                    leg["status"] = created.get("status")
            except Exception as exc:  # noqa: BLE001
                # details carries the server's reason (which schema keyword it rejected, etc.)
                self.last_error_details = getattr(exc, "details", None)
                classified = classify_api_error(exc)
                if classified is not None:
                    raise classified from exc
                return CallOutcome(
                    provider_call_id=None, status="FAILED", structured_result=None,
                    failure_code=_error_code(exc), failure_message=str(exc),
                    raw={"error": {"code": _error_code(exc), "message": str(exc), "details": obs.redact(self.last_error_details)}},
                )
            call_id = str(created["id"])
            await on_event(
                ProviderEvent(type="call.created", message="CALL-E accepted the call task", status=created.get("status"), provider_call_id=call_id, details={"id": call_id})
            )
        return await self._poll(call_id, on_event)

    async def _poll(self, call_id: str, on_event: EventSink) -> CallOutcome:
        s = self.settings
        webhook_fut = self.expect_webhook(call_id)
        cursor: str | None = None
        seen: set[str] = set()
        deadline = asyncio.get_event_loop().time() + s.CALLE_CALL_TIMEOUT_S
        last_status: str | None = None
        try:
            while True:
                if webhook_fut.done():
                    return outcome_from_call(webhook_fut.result())
                self.poll_count += 1
                try:
                    with obs.timed("calle.get", provider_call_id=call_id, poll=self.poll_count) as leg:
                        call = await asyncio.to_thread(self.client.calls.get, call_id)
                        leg["status"] = call.get("status")
                except Exception as exc:  # noqa: BLE001
                    # One slow GET is not the end of a call. A live call sat `queued` for three
                    # minutes, then a single status request timed out after 30 s; raising here killed
                    # the whole call task and left the row at DIALING forever, while the neighbour
                    # went on to have a perfectly good 28-turn conversation nobody recorded. Only an
                    # error the API classifies as fatal ends the poll; anything transient (timeout,
                    # connection reset, 5xx, rate limit) waits a tick and asks again, bounded by the
                    # same deadline as everything else.
                    classified = classify_api_error(exc)
                    if classified is not None:
                        raise classified from exc  # the orchestrator's contract, same as create()
                    await on_event(ProviderEvent(type="call.poll_retry", provider_call_id=call_id,
                                                 message=f"status check failed ({type(exc).__name__}); retrying"))
                    if asyncio.get_event_loop().time() > deadline:
                        return CallOutcome(provider_call_id=call_id, status="FAILED", structured_result=None,
                                           failure_code="timeout", failure_message=f"poll timeout after {type(exc).__name__}",
                                           raw=None)
                    await asyncio.sleep(s.CALLE_POLL_INTERVAL_S)
                    continue
                if call.get("status") != last_status:
                    last_status = call.get("status")
                    await on_event(ProviderEvent(type=f"call.status.{last_status}", message=f"CALL-E status: {last_status}", status=last_status, provider_call_id=call_id))
                try:
                    with obs.timed("calle.list_events", provider_call_id=call_id) as leg:
                        page = await asyncio.to_thread(self.client.calls.list_events, call_id, cursor=cursor)
                        leg["events"] = len(page.get("data", []))
                    for ev in page.get("data", []):
                        if ev["id"] in seen:
                            continue
                        seen.add(ev["id"])
                        await on_event(
                            ProviderEvent(type=ev.get("type", "call.event"), message=ev.get("message", ""), status=ev.get("status"), provider_call_id=call_id, details=dict(ev.get("details") or {}, level=ev.get("level"), provider_event_id=ev["id"]))
                        )
                    cursor = page.get("next_cursor") or cursor
                except Exception as exc:  # events are best-effort; never fail the call over them
                    await on_event(ProviderEvent(type="call.events_unavailable", message=f"event feed error: {type(exc).__name__}", provider_call_id=call_id))
                if call.get("status") in TERMINAL:
                    return outcome_from_call(call)
                if asyncio.get_event_loop().time() > deadline:
                    return CallOutcome(provider_call_id=call_id, status="FAILED", structured_result=None, failure_code="timeout", failure_message="poll timeout", raw=call)
                try:
                    await asyncio.wait_for(asyncio.shield(webhook_fut), timeout=s.CALLE_POLL_INTERVAL_S)
                except asyncio.TimeoutError:
                    pass
        finally:
            self._webhook_results.pop(call_id, None)
