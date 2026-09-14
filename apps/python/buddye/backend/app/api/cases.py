"""One person's case: everything the case page shows, and the button that rings them.

The console's flow is a notification -> **this page** -> a call -> a deployment case a human approves.
So this module has exactly two jobs, and the shape of each follows from the fact that the person
using it is in a hurry and frightened on somebody else's behalf.

`GET /api/cases/{hazard_id}/{neighbour_id}` returns the **whole case in one response**: the
neighbour, what triage concluded and the plain-English sentences it concluded it from, every call
with its transcript and outcome, the agent log (`OperatorAction` — which agent decided what, on what
model, with what rationale, and whether a human accepted it), the escalation ladder rung by rung,
and the incidents and dispatches that came out of it. One request rather than six, because a case
page assembled from six racing fetches shows a half-drawn picture of somebody's emergency.

`POST /api/cases/{hazard_id}/{neighbour_id}/call` dials **one person**, through the same runner path
a sweep uses — the same idempotency key written before the dial, the same allowlist and budget
gates, the same event stream, the same `decide()` — and nothing else. It is not a one-person sweep:
no roster is triaged, nobody else is rung, and `sweep.unaccounted` is never emitted, because telling
a captain that thirteen people are unaccounted for after she deliberately rang one would be a lie
told by an implementation detail.

Three decisions worth defending:

**It returns 202 and the answer arrives on the stream.** A real welfare call takes a minute or two.
Blocking the request would leave the console with a spinner and no way to show the call connecting,
the transcript landing, or the outcome being decided — all of which are already events. The button
starts the call; the page watches the same SSE stream it was already watching.

**A second click cannot ring a frail person twice.** One in-flight call per person, enforced here
before the task is created, and the runner's idempotency key behind that.

**The ladder's *calls* stay with the sweep driver.** A case call opens the escalation and raises the
deployment case, which is what the flow needs. It does not ring the neighbour's daughter off the
back of one button press: telling a third party about somebody's health is a decision, and spending
a second call on it is a decision, and neither belongs to a button labelled "call Walter".
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app import obs
from app.api.deps import settings_dep
from app.api.hazards import hazard_out
from app.api.incidents import action_out, incident_out
from app.api.neighbours import neighbour_out
from app.calls.budget import CallBudget
from app.calls.contract import compile_contract
from app.calls.provider import CallBudgetExhausted, NumberNotAllowlisted
from app.config import get_settings, Settings
from app.events.bus import bus
from app.db import session_scope
from app.domain.risk import assess
from app.domain.state import CheckOutcome, SweepState
from app.models import (
    AgentEvent,
    CheckCall,
    Dispatch,
    Escalation,
    HandoffPacket,
    Hazard,
    Incident,
    Neighbour,
    OperatorAction,
    Sweep,
    utcnow,
)
from app.orchestrator import escalate as ladder
from app.orchestrator import incidents as incident_layer
from app.orchestrator.decide import decide
from app.orchestrator.runner import Runner
from app.orchestrator.sweep import hazard_view, neighbour_view

log = logging.getLogger("buddye.cases")

router = APIRouter(prefix="/api/cases", tags=["cases"])

#: One in-flight case call per person, keyed hazard:neighbour. The lock a double-click hits.
_in_flight: dict[str, asyncio.Task[Any]] = {}


class LaunchCallIn(BaseModel):
    """Starting a call from the case page. The name is optional and is recorded when given: this is
    a person choosing to ring somebody, and the record should say who chose."""

    launched_by: str = ""


def in_flight() -> dict[str, asyncio.Task[Any]]:
    return dict(_in_flight)


# ------------------------------------------------------------------------------------------------
# Reading the case
# ------------------------------------------------------------------------------------------------
def _latest_sweep(session: Session, hazard_id: str) -> Sweep | None:
    rows = list(session.exec(select(Sweep).where(Sweep.hazard_id == hazard_id)
                             .order_by(Sweep.created_at)).all())
    active = [r for r in rows if r.is_active]
    return active[-1] if active else (rows[-1] if rows else None)


def _risk_for(session: Session, hazard: Hazard, nbr: Neighbour) -> dict[str, Any]:
    """What triage concluded about this person under this hazard.

    The sweep's stored assessment first: that is the one the calls were actually ordered by, and it
    is what the escalation was opened against. Re-scoring live is the fallback, and it is what a
    case opened before any sweep gets.
    """
    sweep = _latest_sweep(session, hazard.id)
    stored = (dict(sweep.triage or {}).get(nbr.id) if sweep else None)
    return dict(stored) if isinstance(stored, dict) else assess(nbr, hazard).to_dict()


def _call_out(call: CheckCall) -> dict[str, Any]:
    """One call, with the conversation in it. The transcript is the evidence for everything else on
    the page, so it is returned rather than summarised."""
    return {
        "id": call.id,
        "sweep_id": call.sweep_id,
        "callee": call.callee,
        "attempt": call.attempt,
        "provider": call.provider,
        "provider_call_id": call.provider_call_id,
        "status": call.status,
        "outcome": call.outcome,
        "outcome_reason": call.outcome_reason,
        "concerns": list(call.concerns or []),
        "structured_result": call.structured_result,
        "validation_errors": list(call.validation_errors or []),
        "transcript": list(call.transcript or []),
        "summary": call.summary,
        "task_completed": call.task_completed,
        "completion_confidence": call.completion_confidence,
        "evidence": list(call.evidence or []),
        "risk_snapshot": call.risk_snapshot,
        "reconciled": call.reconciled,
        "duration_s": call.duration_s,
        "started_at": (call.started_at.isoformat() + "Z") if call.started_at else None,
        "completed_at": (call.completed_at.isoformat() + "Z") if call.completed_at else None,
    }


def _escalation_out(esc: Escalation) -> dict[str, Any]:
    return {
        "id": esc.id, "sweep_id": esc.sweep_id, "outcome": esc.outcome, "level": str(esc.level),
        "status": str(esc.status), "reason": esc.reason, "rungs": list(esc.rungs or []),
        "trigger_call_id": esc.trigger_call_id, "resolved_by": esc.resolved_by,
        "resolved_note": esc.resolved_note,
        "created_at": esc.created_at.isoformat() + "Z",
        "resolved_at": (esc.resolved_at.isoformat() + "Z") if esc.resolved_at else None,
    }


def _callable_now(session: Session, nbr: Neighbour, settings: Settings) -> dict[str, Any]:
    """Whether the call button is live, and if not, the sentence that says why.

    Checked here rather than discovered when the call is already in flight: a refusal that arrives
    as a skipped-call event thirty seconds later reads like a failure, and this one is a policy the
    operator is entitled to see before they press anything.
    """
    if not nbr.check_in_consent:
        return {"allowed": False, "reason": "no consent on file for automated check-in calls",
                "provider": settings.CALL_PROVIDER, "budget_remaining": None}
    budget = CallBudget(settings)
    try:
        budget.reserve(session, phone=nbr.phone, provider=settings.CALL_PROVIDER)
    except NumberNotAllowlisted as exc:
        return {"allowed": False, "reason": f"not allowlisted: {exc}",
                "provider": settings.CALL_PROVIDER, "budget_remaining": budget.remaining(session)}
    except CallBudgetExhausted as exc:
        return {"allowed": False, "reason": str(exc),
                "provider": settings.CALL_PROVIDER, "budget_remaining": 0}
    return {"allowed": True, "reason": "", "provider": settings.CALL_PROVIDER,
            "budget_remaining": budget.remaining(session)}


def case_for(session: Session, hazard: Hazard, nbr: Neighbour, settings: Settings) -> dict[str, Any]:
    """Assemble one case. Everything the page renders, from rows only."""
    risk = _risk_for(session, hazard, nbr)

    calls = list(session.exec(
        select(CheckCall).where(CheckCall.hazard_id == hazard.id, CheckCall.neighbour_id == nbr.id)
        .order_by(CheckCall.started_at)  # type: ignore[arg-type]
    ).all())
    escalations = list(session.exec(
        select(Escalation).where(Escalation.hazard_id == hazard.id, Escalation.neighbour_id == nbr.id)
        .order_by(Escalation.created_at)
    ).all())
    packets = list(session.exec(
        select(HandoffPacket).where(HandoffPacket.neighbour_id == nbr.id,
                                    HandoffPacket.hazard_id == hazard.id)
    ).all())
    incidents = list(session.exec(
        select(Incident).where(Incident.hazard_id == hazard.id, Incident.neighbour_id == nbr.id)
        .order_by(Incident.opened_at)
    ).all())
    incident_ids = [i.id for i in incidents]
    actions = list(session.exec(
        select(OperatorAction).where(OperatorAction.incident_id.in_(incident_ids or [""]))  # type: ignore[attr-defined]
        .order_by(OperatorAction.created_at)
    ).all())
    dispatches = list(session.exec(
        select(Dispatch).where(Dispatch.incident_id.in_(incident_ids or [""]))  # type: ignore[attr-defined]
        .order_by(Dispatch.proposed_at)
    ).all())
    # Their agent's own log: every event the orchestrator published about this person, in order.
    # This is the "what has BuddyE been doing about Walter" column, and it is the event stream the
    # console is already watching, filtered — not a second, parallel account of the same evening.
    timeline = list(session.exec(
        select(AgentEvent).where(AgentEvent.hazard_id == hazard.id, AgentEvent.neighbour_id == nbr.id)
        .order_by(AgentEvent.id)  # type: ignore[arg-type]
    ).all())
    sweep = _latest_sweep(session, hazard.id)

    return {
        "hazard": hazard_out(session, hazard).model_dump(),
        "neighbour": neighbour_out(nbr, risk=risk).model_dump(),
        "risk": risk,
        # The sentences the captain's board already shows, lifted out so the case page does not have
        # to know the shape of a RiskAssessment to render "why is this person on my screen".
        "risk_reasons": [str(r) for r in (risk.get("reasons") or [])],
        "sweep": None if sweep is None else {
            "id": sweep.id, "state": str(sweep.state), "is_active": bool(sweep.is_active),
            "provider": sweep.provider,
        },
        "calls": [_call_out(c) for c in calls],
        "escalations": [_escalation_out(e) for e in escalations],
        "handoffs": [{
            "id": p.id, "escalation_id": p.escalation_id, "recommended_action": p.recommended_action,
            "spoken_script": p.spoken_script, "last_words": p.last_words,
            "concerns": list(p.concerns or []),
            "released": p.released_at is not None, "released_by": p.released_by,
            "prepared_at": p.prepared_at.isoformat() + "Z",
            # Stated rather than left to be inferred from a null: an unreleased packet has told
            # nobody anything, and no emergency service has been contacted.
            "status_note": ("released by " + p.released_by) if p.released_at
            else "prepared only — nobody has been contacted and nobody has been sent",
        } for p in packets],
        "incidents": [incident_out(session, i, full=True) for i in incidents],
        "dispatches": [d.id for d in dispatches],  # the full objects ride inside each incident
        "actions": [action_out(a) for a in actions],
        "timeline": [{
            "id": e.id, "type": e.type, "payload": dict(e.payload or {}),
            "at": e.created_at.isoformat() + "Z",
        } for e in timeline],
        "can_call": _callable_now(session, nbr, settings),
    }


@router.get("/{hazard_id}/{neighbour_id}")
def get_case(hazard_id: str, neighbour_id: str,
             settings: Settings = Depends(settings_dep)) -> dict[str, Any]:
    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        if hazard is None:
            raise HTTPException(404, "hazard not found")
        nbr = s.get(Neighbour, neighbour_id)
        if nbr is None:
            raise HTTPException(404, "neighbour not found")
        return obs.redact(case_for(s, hazard, nbr, settings))


# ------------------------------------------------------------------------------------------------
# The situation brief
#
# Deliberately its OWN endpoint rather than a field on the case payload. The brief is written by a
# model on a free tier that answers in 20-100 s and sometimes not at all; folding it into
# `get_case` would make the most important screen in the product wait on it, or worse, appear
# broken. The case page renders every structured field the call returned immediately and without a
# model, then asks for this and drops it in when it lands. Absence costs nothing.
# ------------------------------------------------------------------------------------------------
_brief_tasks: dict[str, asyncio.Task[Any]] = {}


def _cached_brief(session: Session, *, hazard_id: str, call_id: str) -> dict[str, Any] | None:
    """The brief already written for this exact call, if there is one.

    Keyed on the call rather than the person: a second call changes the situation, and showing the
    first call's brief above the second call's data would be worse than showing none.
    """
    rows = session.exec(
        select(OperatorAction)
        .where(OperatorAction.hazard_id == hazard_id, OperatorAction.kind == "situation_brief")
        .order_by(OperatorAction.created_at.desc())  # type: ignore[attr-defined]
    ).all()
    for row in rows:
        if (row.inputs or {}).get("call_id") == call_id and (row.output or {}).get("generated"):
            return dict(row.output)
    return None


async def _write_brief(hazard_id: str, neighbour_id: str, call_id: str) -> None:
    from app.agents.brief_agent import write_situation_brief
    from app.agents.client import build_client

    settings = get_settings()
    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        nbr = s.get(Neighbour, neighbour_id)
        call = s.get(CheckCall, call_id)
        if hazard is None or nbr is None or call is None:
            return
        payload = dict(
            neighbour={"id": nbr.id, "name": nbr.name, "age_band": nbr.age_band,
                       "lives_alone": nbr.lives_alone, "power_dependent": nbr.power_dependent,
                       "power_backup_hours": nbr.power_backup_hours, "mobility": nbr.mobility,
                       "conditions": list(nbr.conditions or []), "address": nbr.address},
            hazard={"kind": hazard.kind, "headline": hazard.headline, "facts": dict(hazard.facts or {})},
            result=call.structured_result, outcome=str(call.outcome or ""),
            outcome_reason=call.outcome_reason or "", transcript=list(call.transcript or []),
            risk_reasons=list((call.risk_snapshot or {}).get("reasons") or []),
        )
    # The session is closed before the await on purpose: sqlite holds a write lock, and a model call
    # can take a minute and a half. See app/agents/client.py's module docstring.
    out = await write_situation_brief(hazard_id=hazard_id, **payload, client=build_client(settings))
    with session_scope() as s:
        rows = s.exec(
            select(OperatorAction)
            .where(OperatorAction.hazard_id == hazard_id, OperatorAction.kind == "situation_brief")
            .order_by(OperatorAction.created_at.desc())  # type: ignore[attr-defined]
        ).first()
        if rows is not None and not (rows.inputs or {}).get("call_id"):
            rows.inputs = {**(rows.inputs or {}), "call_id": call_id, "neighbour_id": neighbour_id}
            s.add(rows)
    bus.publish(hazard_id=hazard_id, neighbour_id=neighbour_id, type="case.brief",
                payload={"neighbour_id": neighbour_id, "call_id": call_id, "brief": obs.redact(out)})


@router.get("/{hazard_id}/{neighbour_id}/brief")
async def get_brief(hazard_id: str, neighbour_id: str) -> dict[str, Any]:
    """The brief for this person's latest finished call.

    `ready` with the brief when one has been written, `pending` while a model is working, and
    `unavailable` when there is nothing to summarise yet. The page shows what it has either way.
    """
    with session_scope() as s:
        calls = s.exec(
            select(CheckCall)
            .where(CheckCall.hazard_id == hazard_id, CheckCall.neighbour_id == neighbour_id,
                   CheckCall.callee == "neighbour")
            .order_by(CheckCall.started_at.desc())  # type: ignore[attr-defined]
        ).all()
        finished = next((c for c in calls if c.outcome), None)
        if finished is None:
            return {"status": "unavailable", "reason": "no finished call for this person yet"}
        call_id = finished.id
        cached = _cached_brief(s, hazard_id=hazard_id, call_id=call_id)
    if cached is not None:
        return {"status": "ready", "call_id": call_id, "brief": obs.redact(cached)}

    task = _brief_tasks.get(call_id)
    if task is None or task.done():
        task = asyncio.create_task(_write_brief(hazard_id, neighbour_id, call_id), name=f"brief:{call_id}")
        _brief_tasks[call_id] = task
        task.add_done_callback(lambda t: _brief_tasks.pop(call_id, None))
    return {"status": "pending", "call_id": call_id}


# ------------------------------------------------------------------------------------------------
# Calling one person
# ------------------------------------------------------------------------------------------------
def _case_sweep(session: Session, hazard: Hazard, neighbour_id: str, *, settings: Settings) -> Sweep:
    """The sweep a case call is filed under. Reused wherever possible, created inert when not.

    Every call in BuddyE belongs to a sweep — that is where the outcome, the triage snapshot and the
    audit trail hang from — so a case call needs one. It reuses the hazard's sweep, live or finished:
    a captain ringing Walter back at nine o'clock is still part of tonight's evening, and filing it
    somewhere else would split his record in two.

    When the hazard has never been swept, a sweep is created **inactive and already closed**, and
    that is deliberate rather than lazy. An active sweep with no driver attached to it is a trap in
    two directions: a restart would find it in `resumable_sweeps()` and spawn a driver that triages
    the whole roster and rings all fourteen people, and the "Start sweep" button would find it and
    hand it back instead of starting a real one, so pressing the button would call nobody at all.
    """
    sweep = _latest_sweep(session, hazard.id)
    if sweep is not None:
        return sweep
    sweep = Sweep(
        hazard_id=hazard.id,
        provider=settings.CALL_PROVIDER,
        state=SweepState.COMPLETE,
        is_active=False,
        call_order=[neighbour_id],
        current_index=1,
        completed_at=utcnow(),
    )
    session.add(sweep)
    session.flush()
    return sweep


def _next_attempt(session: Session, sweep_id: str, neighbour_id: str) -> int:
    """The attempt number for a fresh case call.

    Always a new attempt, never a reuse. The runner's idempotency key is built from it, so counting
    up is what makes "call him again" mean a second call rather than a lookup of the first one — and
    it is also why an interrupted call is resumed by the sweep driver and not accidentally by this.
    """
    rows = list(session.exec(
        select(CheckCall).where(CheckCall.sweep_id == sweep_id,
                                CheckCall.neighbour_id == neighbour_id,
                                CheckCall.callee == "neighbour")
    ).all())
    return max([int(r.attempt or 1) for r in rows], default=0) + 1


async def launch_call(hazard_id: str, neighbour_id: str, *, settings: Settings,
                      provider: Any = None, reconciler: Any = None,
                      launched_by: str = "", resume_attempt: int | None = None) -> dict[str, Any]:
    """Ring one neighbour and understand what came back. The runner path, for a single person.

    Returns a summary of what happened. Everything a console needs arrives on the event stream
    first — `call.started`, `provider.*`, `call.completed`, `check.decided`, `incident.opened` — so
    this return value is the record, not the notification.
    """
    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        nbr = s.get(Neighbour, neighbour_id)
        if hazard is None or nbr is None:
            raise ValueError("hazard or neighbour not found")
        sweep = _case_sweep(s, hazard, neighbour_id, settings=settings)
        risk = _risk_for(s, hazard, nbr)
        # Written onto the sweep so the call row's risk snapshot and the board agree about why this
        # person was rung when they were rung.
        if neighbour_id not in (sweep.triage or {}):
            sweep.triage = {**(sweep.triage or {}), neighbour_id: risk}
            s.add(sweep)
        sweep_id = sweep.id
        # A resume keeps the attempt it was given: the idempotency key is built from it, so the same
        # number finds the existing CheckCall row and re-attaches to the CALL-E call already placed.
        # A fresh number would ring the neighbour a second time.
        attempt = resume_attempt if resume_attempt is not None else _next_attempt(s, sweep_id, neighbour_id)
        s.expunge(hazard)
        s.expunge(nbr)

    runner = Runner(sweep_id, settings=settings, provider=provider, reconciler=reconciler)
    contract = compile_contract(hazard_view(hazard, settings), neighbour_view(nbr))
    if resume_attempt is None:
        runner.emit(
            "case.call_requested",
            {"neighbour_id": nbr.id, "name": nbr.name, "attempt": attempt,
             "requested_by": launched_by or settings.BLOCK_CAPTAIN_NAME,
             "note": "a single call from the case page; no sweep, nobody else is being rung"},
            neighbour_id=nbr.id,
        )
    else:
        runner.emit(
            "case.call_resumed",
            {"neighbour_id": nbr.id, "name": nbr.name, "attempt": attempt,
             "note": "re-attaching to a call that was already placed; nobody is being rung again"},
            neighbour_id=nbr.id,
        )
    # `_place` is the runner's own dial: the CheckCall row written before the dial, the idempotency
    # key, the allowlist and budget gates, the spent-call ledger, the provider events, the transcript
    # and the reconcile pass. Reached across the module boundary the same way app/api/incidents.py
    # reaches for `dispatcher._needs` — reimplementing any of it here is how two dialling paths with
    # two sets of guards come to exist.
    leg = await runner._place(  # noqa: SLF001
        hazard=hazard, neighbour=nbr, contract=contract, callee="neighbour",
        phone=nbr.phone, to_name=nbr.name, risk=risk, attempt=attempt,
        extra_metadata={"source": "case_page", "requested_by": launched_by},
    )
    if leg.status == "SKIPPED":
        # A gate said no. `_place` already put a `call.skipped` event on the stream with the reason.
        return {"status": "refused", "reason": leg.reason, "sweep_id": sweep_id,
                "neighbour_id": nbr.id, "attempt": attempt, "call_id": None,
                "budget_exhausted": bool(leg.budget)}

    placed = True
    if leg.status != "COMPLETED" and leg.call_id:
        with session_scope() as s:
            row = s.get(CheckCall, leg.call_id)
            placed = bool(row and row.provider_call_id)
    d = decide(
        status=leg.status,
        result=leg.result,
        risk=risk,
        hard_fields=contract.hard_fields,
        validation_errors=leg.validation_errors,
        completion_confidence=leg.confidence,
        placed=placed,
    )
    with session_scope() as s:
        call = s.get(CheckCall, leg.call_id)
        if call is not None:
            call.outcome = d.outcome.value
            call.outcome_reason = d.reason
            call.concerns = list(d.concerns)
            s.add(call)
        sweep_row = s.get(Sweep, sweep_id)
        if sweep_row is not None:
            # Rebound rather than mutated: `outcomes` is a plain Column(JSON) and an in-place update
            # never goes dirty.
            sweep_row.outcomes = {**(sweep_row.outcomes or {}), neighbour_id: d.outcome.value}
            sweep_row.updated_at = utcnow()
            s.add(sweep_row)

    runner.emit("check.decided",
                {"call_id": leg.call_id, "neighbour_id": nbr.id, "name": nbr.name, **d.to_dict()},
                neighbour_id=nbr.id)

    escalation_id = None
    if d.escalates:
        escalation_id = _record_escalation(runner, nbr, leg.call_id, d, sweep_id=sweep_id,
                                           hazard_id=hazard_id)

    # And the point of the whole flow: a deployment case, opened from what the call established —
    # or, when nobody picked up, from the silence. `sync_sweep` runs both routes and is idempotent,
    # so it is safe here whether or not the background reconciler also reaches this sweep.
    with session_scope() as s:
        opened = incident_layer.sync_sweep(s, sweep_id)
        payloads = [incident_layer.event_payload(i) for i in opened]
        standing = incident_layer.incident_for_neighbour(s, sweep_id, neighbour_id)
        incident_id = standing.id if standing is not None else None
    incident_layer.announce(payloads)

    # The brief and the ICS-214 log, written now rather than when someone gets round to clicking.
    # Not awaited: the call's own outcome is already on the stream and must not wait on a model.
    from app.orchestrator import aftercall
    followup = asyncio.create_task(aftercall.run(hazard_id, nbr.id, leg.call_id, incident_id),
                                   name=f"aftercall:{leg.call_id}")
    followup.add_done_callback(_log_failure)

    return {
        "status": "completed",
        "sweep_id": sweep_id,
        "neighbour_id": nbr.id,
        "attempt": attempt,
        "call_id": leg.call_id,
        "call_status": leg.status,
        "outcome": d.outcome.value,
        "reason": d.reason,
        "escalation_id": escalation_id,
        "incident_id": incident_id,
        "incidents_opened": [p["incident_id"] for p in payloads],
        # Where the console goes next. Silence and speech land in the same place on purpose: both
        # produced a case, and the case is what a human has to decide about.
        "route": (f"/hazards/{hazard_id}/incidents/{incident_id}" if incident_id
                  else f"/hazards/{hazard_id}/sweep/{neighbour_id}"),
    }


def _record_escalation(runner: Runner, nbr: Neighbour, call_id: str | None, d: Any, *,
                       sweep_id: str, hazard_id: str) -> str | None:
    """Open the ladder for this person, or note that it is already open.

    Only the row: the rungs that *place calls* — ringing the person they nominated — belong to the
    sweep driver, which is the thing allowed to decide that a third party should be told about
    somebody's health and to spend a second call doing it. A button labelled "call Walter" rings
    Walter.
    """
    outcome = CheckOutcome(d.outcome)
    with session_scope() as s:
        # Still-open ladders only. A CANCELLED or RESOLVED escalation is a human's decision about an
        # earlier call, and appending a rung to it would both reopen that decision and be refused by
        # `record_attempt`; a fresh bad call after somebody closed the last one deserves its own row.
        existing = [
            e for e in s.exec(select(Escalation).where(Escalation.sweep_id == sweep_id,
                                                       Escalation.neighbour_id == nbr.id)).all()
            if str(e.status) not in {"CANCELLED", "RESOLVED"}
        ]
        if existing:
            ladder.record_attempt(s, existing[0], action="noted",
                                  result=f"a further check-in call ended {outcome.value}",
                                  note=d.reason, call_id=call_id)
            return existing[0].id
        esc = ladder.open_escalation(
            s, sweep_id=sweep_id, hazard_id=hazard_id, neighbour=nbr,
            outcome=outcome, reason=d.reason, trigger_call_id=call_id,
        )
        if esc is None:
            return None
        s.flush()
        esc_id, level = esc.id, str(esc.level)
    runner.emit(
        "escalation.opened",
        {"escalation_id": esc_id, "neighbour_id": nbr.id, "name": nbr.name,
         "outcome": outcome.value, "level": level, "band": d.band.value, "priority": d.priority,
         "reason": d.reason},
        neighbour_id=nbr.id,
    )
    return esc_id


@router.post("/{hazard_id}/{neighbour_id}/call", status_code=202)
async def start_case_call(hazard_id: str, neighbour_id: str, body: LaunchCallIn | None = None,
                          settings: Settings = Depends(settings_dep)) -> dict[str, Any]:
    """Ring this one person now. Accepted immediately; the call plays out on the event stream."""
    body = body or LaunchCallIn()
    with session_scope() as s:
        hazard = s.get(Hazard, hazard_id)
        if hazard is None:
            raise HTTPException(404, "hazard not found")
        nbr = s.get(Neighbour, neighbour_id)
        if nbr is None:
            raise HTTPException(404, "neighbour not found")
        gate = _callable_now(s, nbr, settings)
        name = nbr.name
    if not gate["allowed"]:
        # 409 rather than 403: nothing about the request is wrong, the state of the world says no.
        raise HTTPException(409, gate["reason"])

    key = f"{hazard_id}:{neighbour_id}"
    running = _in_flight.get(key)
    if running is not None and not running.done():
        raise HTTPException(409, f"a call to {name} is already in progress")

    task = asyncio.create_task(
        launch_call(hazard_id, neighbour_id, settings=settings, launched_by=body.launched_by),
        name=f"case-call:{key}",
    )
    _in_flight[key] = task
    task.add_done_callback(lambda t: _in_flight.pop(key, None))
    task.add_done_callback(_log_failure)

    return {
        "status": "dialing",
        "hazard_id": hazard_id,
        "neighbour_id": neighbour_id,
        "name": name,
        "provider": settings.CALL_PROVIDER,
        "watch": f"/api/stream/hazards/{hazard_id}",
        "note": "one call to one person; watch the stream for call.started, call.completed and check.decided",
    }


def resume_stuck_calls(settings: Settings) -> list[str]:
    """Re-attach to every case call that was placed but never finished being read.

    A call is stuck when its row sits at PENDING/DIALING with a provider call id and no task is
    watching it. Two ways to get there, both seen live: the watching task died on a transient API
    error mid-poll, or the process was restarted while the phone was ringing. Case calls hang off an
    inactive sweep, so the sweep driver's startup resume never reaches them — this does.

    Each resume uses the call's own attempt number, which re-attaches through the idempotency key to
    the CALL-E call that already exists. It never dials again. Safe to run repeatedly: a call with a
    live watcher is skipped, and a finished call is not PENDING/DIALING any more.
    """
    if settings.CALL_PROVIDER == "mock":
        return []  # mock calls finish in-process; there is nothing remote to re-attach to
    with session_scope() as s:
        rows = list(s.exec(
            select(CheckCall).where(CheckCall.callee == "neighbour",
                                    CheckCall.status.in_(["PENDING", "DIALING"]),  # type: ignore[attr-defined]
                                    CheckCall.provider_call_id.is_not(None))  # type: ignore[union-attr]
        ).all())
        stuck = [(r.hazard_id, r.neighbour_id, int(r.attempt or 1), r.id) for r in rows]
    resumed: list[str] = []
    for hazard_id, neighbour_id, attempt, call_id in stuck:
        key = f"{hazard_id}:{neighbour_id}"
        running = _in_flight.get(key)
        if running is not None and not running.done():
            continue
        log.info("resuming case call %s (attempt %s)", call_id, attempt)
        task = asyncio.create_task(
            launch_call(hazard_id, neighbour_id, settings=settings, resume_attempt=attempt),
            name=f"case-call-resume:{key}",
        )
        _in_flight[key] = task
        task.add_done_callback(lambda t, k=key: _in_flight.pop(k, None))
        task.add_done_callback(_log_failure)
        resumed.append(call_id)
    return resumed


async def resume_loop(settings: Settings, *, interval_s: float = 30.0) -> None:
    """Keep re-attaching stuck calls. A missed pass costs seconds, not a lost call."""
    while True:
        try:
            resume_stuck_calls(settings)
        except Exception:  # noqa: BLE001
            log.exception("resume pass failed")
        await asyncio.sleep(interval_s)


def _log_failure(task: asyncio.Task[Any]) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.exception("case call failed: %s", task.get_name(), exc_info=exc)
