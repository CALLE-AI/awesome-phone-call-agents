"""Operator dashboard: ladder board, review queue, reports.

FastAPI, Jinja2 and HTMX polling. No build step, no single-page app. Every phone number
rendered here is masked; the templates never receive a raw one.

The webhook receiver is mounted on the same application, so `pc serve` is both the
operator surface and the terminal-event endpoint.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from ..escalate import (
    OperatorError,
    approve_field_visit,
    operator_confirm,
    operator_refuse,
    sweep_cutoff,
)
from ..intake import WebhookReceiver, build_router, poll_pending, process_inbox
from ..ledger import Ledger, LedgerError
from ..models import Event, IntentState
from ..policy import Policy
from ..redact import mask_e164
from ..report import build_report, work_orders_csv

LOG = logging.getLogger("positive_contact.web")
DEFAULT_WORKER_INTERVAL_SECONDS = 10

# Errors an operator action can raise from a stale form: the intent moved on between the
# page render and the click, so the state machine refuses the edge.
OPERATOR_ERRORS = (OperatorError, LedgerError, RuntimeError, ValueError)

TEMPLATES_DIR = Path(__file__).parent / "templates"

STATE_TONE = {
    IntentState.CONFIRMED: "good",
    IntentState.FIELD_VISIT_ISSUED: "good",
    IntentState.RESERVED: "waiting",
    IntentState.SUBMITTED: "waiting",
    IntentState.TERMINAL_UNVERIFIED: "waiting",
    IntentState.ADJUDICATED: "waiting",
    IntentState.UNCONFIRMED_WAITING: "waiting",
    IntentState.NEEDS_HUMAN: "attention",
    IntentState.SUBMISSION_UNKNOWN: "attention",
    IntentState.FIELD_VISIT_PENDING: "truck",
    IntentState.CLOSED_REFUSED: "closed",
}


def _board_rows(ledger: Ledger, event: Event) -> list[dict]:
    rows: list[dict] = []
    for contact in ledger.list_contacts(event.event_id):
        intents = ledger.list_intents_for_contact(contact.contact_id)
        if not intents:
            reason = ledger.conn.execute(
                "SELECT retired_reason FROM contacts WHERE contact_id = ?",
                (contact.contact_id,),
            ).fetchone()
            rows.append(
                {
                    "contact_id": contact.contact_id,
                    "first_name": contact.first_name,
                    "phone": mask_e164(contact.phone_e164),
                    "locale": contact.locale,
                    "step": "-",
                    "state": "NOT DIALLED",
                    "tone": "attention",
                    "reason": (reason["retired_reason"] if reason else None)
                    or "no ladder started",
                    "next_at": None,
                }
            )
            continue
        latest = sorted(intents, key=lambda item: (item.ladder_step, item.created_at))[-1]
        state = ledger.reconstruct(latest.intent_id)
        disposition = ledger.get_disposition(latest.intent_id)
        rows.append(
            {
                "contact_id": contact.contact_id,
                "first_name": contact.first_name,
                "phone": mask_e164(contact.phone_e164),
                "locale": contact.locale,
                "step": latest.ladder_step,
                "state": state.value,
                "tone": STATE_TONE.get(state, "waiting"),
                "reason": disposition.reason_code if disposition else "-",
                "next_at": latest.not_before if state is IntentState.RESERVED else None,
            }
        )
    return rows


def _review_rows(ledger: Ledger, event: Event) -> list[dict]:
    rows: list[dict] = []
    for intent in ledger.list_intents(event.event_id, [IntentState.NEEDS_HUMAN]):
        contact = ledger.get_contact(intent.contact_id)
        disposition = ledger.get_disposition(intent.intent_id)
        rows.append(
            {
                "intent_id": intent.intent_id,
                "contact_id": intent.contact_id,
                "first_name": contact.first_name if contact else "",
                "phone": mask_e164(contact.phone_e164) if contact else "",
                "step": intent.ladder_step,
                "reason": disposition.reason_code if disposition else "unadjudicated",
                "contact_type": disposition.contact_type.value if disposition else "-",
                "acknowledged": disposition.acknowledged.value if disposition else "-",
                "needs_assistance": disposition.needs_assistance.value if disposition else "-",
                "confidence": (
                    f"{disposition.confidence_score:.2f} ({disposition.confidence_label})"
                    if disposition and disposition.confidence_score is not None
                    else "n/a"
                ),
                "judge_a": disposition.judge_a if disposition else "-",
                "judge_b": disposition.judge_b if disposition else "-",
                "judges_agree": disposition.judges_agree if disposition else False,
                "notes": disposition.notes_for_human if disposition else None,
                "spans": [span.model_dump() for span in disposition.evidence_spans]
                if disposition
                else [],
            }
        )
    return rows


def create_app(
    db_path: Path | str,
    event: Event,
    policy: Policy,
    *,
    transport=None,
    judge_c=None,
    worker_interval_seconds: int = DEFAULT_WORKER_INTERVAL_SECONDS,
) -> FastAPI:
    """Build the operator dashboard, the webhook receiver, and the worker that drains it.

    Without the worker this process would accept terminal webhooks, write them to the
    inbox, and never look at them again: the ladder would not advance and the cutoff sweep
    would never run. The receiver is deliberately inert, so something has to do the work,
    and in a deployment that something is this loop.

    `transport` is optional so tests can build the pages without a provider. No transport
    means no worker.
    """
    app = FastAPI(title="PositiveContact", docs_url=None, redoc_url=None)
    templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
    ledger = Ledger(db_path)
    app.include_router(build_router(WebhookReceiver(ledger)))

    async def worker() -> None:
        while True:
            try:
                await asyncio.to_thread(_drain_once, ledger, transport, event, policy, judge_c)
            except asyncio.CancelledError:
                raise
            except Exception:  # keep the loop alive; one bad cycle must not stop intake
                LOG.exception("intake worker cycle failed")
            await asyncio.sleep(worker_interval_seconds)

    @app.on_event("startup")
    async def _start_worker() -> None:
        if transport is None:
            return
        app.state.worker = asyncio.create_task(worker())

    @app.on_event("shutdown")
    async def _stop_worker() -> None:
        task = getattr(app.state, "worker", None)
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def context(request: Request, **extra) -> dict:
        base = {
            "request": request,
            "event": event,
            "policy": policy,
            "now": datetime.now(timezone.utc),
        }
        base.update(extra)
        return base

    @app.get("/", response_class=HTMLResponse)
    async def root() -> RedirectResponse:
        return RedirectResponse("/board")

    @app.get("/board", response_class=HTMLResponse)
    async def board(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request, "board.html", context(request, rows=_board_rows(ledger, event), page="board")
        )

    @app.get("/board/rows", response_class=HTMLResponse)
    async def board_rows(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request, "_board_rows.html", context(request, rows=_board_rows(ledger, event))
        )

    @app.get("/review", response_class=HTMLResponse)
    async def review(request: Request, message: str | None = None) -> HTMLResponse:
        return templates.TemplateResponse(
            request,
            "review.html",
            context(
                request,
                rows=_review_rows(ledger, event),
                page="review",
                message=message,
            ),
        )

    @app.get("/review/rows", response_class=HTMLResponse)
    async def review_rows(request: Request) -> HTMLResponse:
        return templates.TemplateResponse(
            request, "_review_rows.html", context(request, rows=_review_rows(ledger, event))
        )

    @app.post("/review/{intent_id}/confirm")
    async def confirm(
        intent_id: str, actor: str = Form(...), evidence: str = Form(...)
    ) -> RedirectResponse:
        intent = ledger.get_intent(intent_id)
        if intent is None:
            return RedirectResponse("/review?message=unknown+intent", status_code=303)
        try:
            operator_confirm(
                ledger,
                intent,
                actor=actor,
                evidence_text=evidence,
                now=datetime.now(timezone.utc),
            )
        except OPERATOR_ERRORS as exc:
            # A stale or double-submitted form must not 500 the dashboard mid-event.
            return RedirectResponse(f"/review?message={exc}", status_code=303)
        return RedirectResponse(
            f"/review?message=confirmed+{intent.contact_id}", status_code=303
        )

    @app.post("/review/{intent_id}/refuse")
    async def refuse(
        intent_id: str, actor: str = Form(...), evidence: str = Form(...)
    ) -> RedirectResponse:
        intent = ledger.get_intent(intent_id)
        if intent is None:
            return RedirectResponse("/review?message=unknown+intent", status_code=303)
        try:
            operator_refuse(
                ledger,
                intent,
                actor=actor,
                evidence_text=evidence,
                now=datetime.now(timezone.utc),
            )
        except OPERATOR_ERRORS as exc:
            return RedirectResponse(f"/review?message={exc}", status_code=303)
        return RedirectResponse("/review?message=refusal+recorded", status_code=303)

    @app.get("/reports", response_class=HTMLResponse)
    async def reports(request: Request) -> HTMLResponse:
        report = build_report(ledger, event, now=datetime.now(timezone.utc))
        return templates.TemplateResponse(
            request,
            "reports.html",
            context(
                request,
                report=report,
                page="reports",
                work_orders=ledger.list_work_orders(event.event_id),
                contacts={
                    contact.contact_id: contact
                    for contact in ledger.list_contacts(event.event_id)
                },
                mask=mask_e164,
                export=work_orders_csv(ledger, event, approved_only=True),
            ),
        )

    @app.get("/reports/table", response_class=HTMLResponse)
    async def reports_table(request: Request) -> HTMLResponse:
        report = build_report(ledger, event, now=datetime.now(timezone.utc))
        return templates.TemplateResponse(
            request, "_report_table.html", context(request, report=report)
        )

    @app.post("/field-visits/{work_order_id}/approve")
    async def approve(work_order_id: str, actor: str = Form(...)) -> RedirectResponse:
        now = datetime.now(timezone.utc)
        try:
            approve_field_visit(ledger, event, work_order_id, actor=actor, now=now)
            ledger.mark_work_order_exported(work_order_id, at=now)
        except OPERATOR_ERRORS as exc:
            return RedirectResponse(f"/reports?message={exc}", status_code=303)
        return RedirectResponse("/reports", status_code=303)

    return app


def _drain_once(ledger: Ledger, transport, event: Event, policy: Policy, judge_c) -> None:
    """One worker cycle: drain the inbox, poll anything still open, sweep the cutoff."""
    now = datetime.now(timezone.utc)
    process_inbox(ledger, transport, event, policy, now=now, judge_c=judge_c)
    poll_pending(ledger, transport, event, policy, now=now, judge_c=judge_c)
    sweep_cutoff(ledger, event, policy, now=now)
