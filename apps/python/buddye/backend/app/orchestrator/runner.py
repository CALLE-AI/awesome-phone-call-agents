"""The sweep driver. State lives in the DB; this coroutine only pushes it forward.

Ported from ShiftFill's runner, which is the part of this system with real miles on it: DB as the
source of truth, an idempotency key written before any dial, the SSE event bus, polling with a
webhook shortcut, the allowlist/budget guard, `obs.timed` around every provider leg, and a redacted
audit trail. All of that is kept. The **shape of the work** is not, and three differences are the
whole product:

1. **A sweep fans out. It does not stop at the first success.** ShiftFill walked candidates until
   one accepted and then stopped, and the people it never got to did not matter. Here the triage
   order is worked to the end, because the point is that nobody is missed. There is no early exit
   in `_loop()` — only the budget running out or the provider failing in a way that is the same for
   every neighbour.

2. **NO_ANSWER and FAILED go *into* `decide()`, not around it.** ShiftFill's `_evaluate` returned
   early on those statuses; that early return is gone. An unanswered call to Walter during a
   blackout is `CheckOutcome.UNREACHABLE`, it carries his risk assessment, and it escalates. Silence
   is the finding this product exists to surface, so it takes the same path as speech: it gets an
   outcome, a reason, an escalation, and a row on the board.

3. **Consent is enforced here, on the row, at the moment of dialling.** `risk.call_order` already
   drops a neighbour who never opted in, and this checks again anyway, next to the allowlist and the
   budget. A guard that only exists one layer up is a guard that an off-by-one gets past, and the
   thing on the other side of it is somebody's phone ringing after they said no.

What this module cannot do, structurally: contact an emergency service. It may dial a neighbour and
it may dial the person that neighbour nominated. The responder rung is `escalate.build_handoff_packet`,
which writes a document and stops; the only way out of that document is a named human calling
`escalate.release`, which lives in an API handler and not in here.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import select

from app import obs
from app.calls.budget import CallBudget, record_spent_call
from app.calls.contract import CallContract, compile_contract
from app.calls.provider import (
    CallBudgetExhausted,
    CallOutcome,
    CallProvider,
    CallRequest,
    CandidateRejectedByProvider,
    NumberNotAllowlisted,
    ProviderEvent,
    ProviderFatalError,
)
from app.calls.registry import get_provider
from app.config import Settings, get_settings
from app.db import session_scope
from app.domain.phone import region_for
from app.domain.risk import triage
from app.domain.state import (
    TERMINAL_SWEEP_STATES,
    CheckOutcome,
    EscalationLevel,
    HazardStatus,
    SweepState,
    assert_hazard_transition,
    assert_sweep_transition,
)
from app.events.bus import bus
from app.models import CheckCall, Escalation, Hazard, Neighbour, Sweep, utcnow
from app.orchestrator import escalate as ladder
from app.orchestrator.decide import decide
from app.orchestrator.reconcile import Reconciler, failing_fields_for, get_reconciler, merge_reconciled
from app.orchestrator.sweep import (
    CONTACT_CALL_OUTCOMES,
    OUTCOME_UNKNOWN_REASON,
    band_at_least,
    calls_for_neighbour,
    contact_contract,
    hazard_view,
    load_roster,
    neighbour_view,
    outcome_unknown_neighbours,
    unaccounted,
    unknown_call_for,
)

log = logging.getLogger("buddye.runner")

_tasks: dict[str, asyncio.Task[None]] = {}


def spawn(sweep_id: str) -> asyncio.Task[None]:
    task = asyncio.create_task(Runner(sweep_id).run(), name=f"sweep:{sweep_id}")
    _tasks[sweep_id] = task
    task.add_done_callback(lambda t: _tasks.pop(sweep_id, None))
    return task


def active_tasks() -> dict[str, asyncio.Task[None]]:
    return dict(_tasks)


@dataclass
class Leg:
    """One dial and everything the outcome layer needs from it.

    `status` is a provider status verbatim — COMPLETED, NO_ANSWER, FAILED, INVALID_RESULT — and it
    is handed to `decide()` whatever it says. `SKIPPED` is the one value that never reaches
    `decide()`, because it does not describe the neighbour at all: it means an operator gate (the
    allowlist) stopped us dialling, and inventing `UNREACHABLE` from it would put "did not answer"
    against the name of someone whose phone never rang.

    `UNKNOWN` never reaches `decide()` either, for the opposite reason: a phone may well have rung.
    It carries `unknown=True`, and the caller stops — no outcome, no escalation, no next dial.
    """

    status: str
    call_id: str | None = None
    result: dict[str, Any] | None = None
    validation_errors: list[str] = field(default_factory=list)
    confidence: dict[str, Any] | None = None
    reason: str = ""
    fatal: bool = False   # the provider failed in a way that is the same for everyone: stop
    budget: bool = False  # the call budget is spent: stop
    unknown: bool = False  # we cannot tell whether a phone rang or how the call went: stop


class Runner:
    def __init__(
        self,
        sweep_id: str,
        *,
        settings: Settings | None = None,
        provider: CallProvider | None = None,
        reconciler: Reconciler | None = None,
    ) -> None:
        self.sweep_id = sweep_id
        self.settings = settings or get_settings()
        self.provider = provider or get_provider(self.settings)
        self.reconciler = reconciler or get_reconciler(self.settings)
        self.budget = CallBudget(self.settings)
        with session_scope() as s:
            sweep = s.get(Sweep, sweep_id)
            if sweep is None:
                raise ValueError(f"unknown sweep {sweep_id}")
            self.hazard_id = sweep.hazard_id

    # ---------------------------------------------------------------- helpers
    def emit(self, type: str, payload: dict[str, Any] | None = None, *, neighbour_id: str | None = None) -> None:
        # Redacted on the way onto the bus, not on the way out of it: the bus feeds SSE directly, so
        # publishing is egress. Note that obs.redact masks phone numbers and credentials only — it
        # does not know about addresses or conditions, so nothing here puts those in a payload.
        bus.publish(
            hazard_id=self.hazard_id,
            sweep_id=self.sweep_id,
            neighbour_id=neighbour_id,
            type=type,
            payload=obs.redact(payload or {}),
        )

    def _set_state(self, nxt: SweepState, payload: dict[str, Any] | None = None) -> None:
        with session_scope() as s:
            sweep = s.get(Sweep, self.sweep_id)
            assert sweep is not None
            current = SweepState(sweep.state)
            assert_sweep_transition(current, nxt)
            prev = current.value
            sweep.state = nxt
            sweep.updated_at = utcnow()
            if nxt in TERMINAL_SWEEP_STATES:
                sweep.is_active = False
                sweep.completed_at = sweep.completed_at or utcnow()
            s.add(sweep)
        self.emit("sweep.state", {"from": prev, "to": nxt.value, **(payload or {})})

    def _force_state(self, st: SweepState) -> None:
        """Resume path only: skips the transition table because the driver is re-entering after a
        restart and the state it left behind is not necessarily adjacent to where it must resume."""
        with session_scope() as s:
            sweep = s.get(Sweep, self.sweep_id)
            assert sweep is not None
            sweep.state = st
            s.add(sweep)
        self.emit("sweep.resumed", {"state": st.value})

    async def _pace(self) -> None:
        if self.settings.STEP_DELAY_S > 0:
            await asyncio.sleep(self.settings.STEP_DELAY_S)

    def _load(self) -> tuple[Sweep, Hazard]:
        with session_scope() as s:
            sweep = s.get(Sweep, self.sweep_id)
            hazard = s.get(Hazard, self.hazard_id)
            assert sweep is not None and hazard is not None
            s.expunge(sweep)
            s.expunge(hazard)
            return sweep, hazard

    def _neighbour(self, neighbour_id: str) -> Neighbour:
        with session_scope() as s:
            nbr = s.get(Neighbour, neighbour_id)
            assert nbr is not None
            s.expunge(nbr)
            return nbr

    # ------------------------------------------------------------------- main
    async def run(self) -> None:
        try:
            sweep, hazard = self._load()
            state = SweepState(sweep.state)
            if state in TERMINAL_SWEEP_STATES:
                return
            if state in {SweepState.CREATED, SweepState.TRIAGING}:
                await self._triage(hazard)
            elif state in {SweepState.ESCALATING, SweepState.AWAITING_HUMAN}:
                # Both have a legal edge back to CALLING; re-enter the loop at the current index.
                self._set_state(SweepState.CALLING, {"note": "resumed"})
            await self._loop()
        except Exception as exc:  # noqa: BLE001
            log.exception("sweep %s failed", self.sweep_id)
            try:
                with session_scope() as s:
                    sweep = s.get(Sweep, self.sweep_id)
                    changed = sweep is not None and SweepState(sweep.state) not in TERMINAL_SWEEP_STATES
                    if changed:
                        sweep.state = SweepState.FAILED  # type: ignore[union-attr]
                        sweep.is_active = False  # type: ignore[union-attr]
                        sweep.completed_at = utcnow()  # type: ignore[union-attr]
                        sweep.error = f"{type(exc).__name__}: {exc}"  # type: ignore[union-attr]
                        s.add(sweep)
                if changed:
                    self.emit("sweep.state", {"to": "FAILED", "error": f"{type(exc).__name__}: {exc}"})
                    # The state is written directly above rather than through `_set_state`, because
                    # the thing that just failed may have been `_set_state` itself. The roster still
                    # gets its accounting: a crash mid-sweep is the case where knowing who was never
                    # reached matters most.
                    self._emit_unaccounted()
                    self._settle_hazard()
            except Exception:  # noqa: BLE001
                log.exception("could not record failure for %s", self.sweep_id)

    # ----------------------------------------------------------------- triage
    async def _triage(self, hazard: Hazard) -> None:
        """Score the whole block against this hazard and fix the order the phone rings in.

        Everybody is scored, including the people BuddyE may not dial: the captain's board shows the
        block, not the call list. `call_order` is the subset with consent, and it is the only thing
        the loop walks.
        """
        if SweepState((self._load()[0]).state) is not SweepState.TRIAGING:
            self._set_state(SweepState.TRIAGING)
        with session_scope() as s:
            roster = load_roster(s)
            assessments = triage(roster, hazard)
            order = [a.neighbour_id for a in assessments if a.may_call]
            sweep = s.get(Sweep, self.sweep_id)
            assert sweep is not None
            sweep.triage = {a.neighbour_id: a.to_dict() for a in assessments}
            sweep.call_order = order
            sweep.current_index = 0
            sweep.updated_at = utcnow()
            s.add(sweep)

        self.emit(
            "sweep.triaged",
            {
                "hazard": {"kind": hazard.kind, "headline": hazard.headline, "severity": hazard.severity},
                "queued": len(order),
                "roster": len(assessments),
                "order": [
                    {
                        "neighbour_id": a.neighbour_id, "name": a.name, "score": a.score, "band": a.band.value,
                        "time_to_harm_h": a.time_to_harm_h, "may_call": a.may_call, "skip_reason": a.skip_reason,
                        "reasons": a.reasons[:3],
                    }
                    for a in assessments
                ],
            },
        )
        for a in assessments:
            if not a.may_call:
                # Said out loud on the stream rather than silently absent from the queue. "We did not
                # ring Gerald" is a thing the captain has to be able to see she knows.
                self.emit(
                    "neighbour.skipped",
                    {"neighbour_id": a.neighbour_id, "name": a.name, "band": a.band.value,
                     "reason": a.skip_reason or "not called", "dialled": False},
                    neighbour_id=a.neighbour_id,
                )
        await self._pace()

    # ------------------------------------------------------------------- loop
    async def _loop(self) -> None:
        while True:
            sweep, hazard = self._load()
            if sweep.current_index >= len(sweep.call_order):
                self._finish(SweepState.COMPLETE)
                return
            neighbour_id = sweep.call_order[sweep.current_index]
            if SweepState(sweep.state) is not SweepState.CALLING:
                self._set_state(SweepState.CALLING, {"neighbour_id": neighbour_id, "index": sweep.current_index})
            keep_going = await self._check(sweep, hazard, neighbour_id)
            if not keep_going:
                return
            self._advance()

    def _advance(self) -> None:
        with session_scope() as s:
            sweep = s.get(Sweep, self.sweep_id)
            assert sweep is not None
            sweep.current_index += 1
            sweep.updated_at = utcnow()
            s.add(sweep)
            nxt, total = sweep.current_index, len(sweep.call_order)
        self.emit("sweep.advanced", {"next_index": nxt, "remaining": max(0, total - nxt)})

    def _finish(self, state: SweepState) -> None:
        self._set_state(state)
        self._emit_unaccounted()
        self._settle_hazard()

    def _halt_unknown(self, neighbour: Neighbour, leg: Leg) -> None:
        """Stop the roster on a call whose outcome cannot be established.

        A create request that timed out or failed with a 5xx, an answer with no call id, a poll that ran
        past its deadline, a restart that finds a dial with no provider id: in each of these CALL-E may
        have created the call and a phone may be ringing. None of them is evidence that nobody answered
        (so no UNREACHABLE and no ladder), and none of them is evidence that nothing was placed.

        So the sweep stops, in FAILED, which is terminal: a restart does not resume it and ring the
        next person. Nobody is escalated off the back of it, and this person is named in
        `sweep.unaccounted` as outcome-unknown rather than "not reached". A human looks at the call in
        CALL-E, and only then decides whether anyone gets rung again.
        """
        note = ("the outcome of this call is unknown: CALL-E may have created it and a phone may have rung. "
                "No outcome was recorded, nothing was escalated, and this sweep will call nobody else. "
                "Check the call in the CALL-E dashboard before calling anyone again. A credit may have been "
                "spent that the local budget ledger could not record.")
        with session_scope() as s:
            sweep = s.get(Sweep, self.sweep_id)
            if sweep is not None:
                sweep.error = f"outcome unknown for a call to {neighbour.name}: {leg.reason}"
                sweep.updated_at = utcnow()
                s.add(sweep)
        self.emit(
            "sweep.halted_outcome_unknown",
            {"call_id": leg.call_id, "neighbour_id": neighbour.id, "name": neighbour.name,
             "reason": leg.reason, "note": note},
            neighbour_id=neighbour.id,
        )
        self._finish(SweepState.FAILED)

    def _emit_unaccounted(self) -> None:
        """The last thing on the stream: who is still nobody's job.

        Called only *after* the terminal transition is persisted, and that ordering is the whole
        point. `unaccounted()` asks the sweep whether it is finished before deciding between "still
        to be called" and "the sweep ended before reaching them" — so computing this a moment too
        early tells a captain whose budget just ran out that eleven people are next in the queue,
        when in fact nobody is going to ring them. A sweep that ends quietly with people unaccounted
        for is exactly the failure this product exists to prevent, and a reassuring lie about it is
        worse than silence.
        """
        with session_scope() as s:
            sweep = s.get(Sweep, self.sweep_id)
            if sweep is None:
                return
            missing = unaccounted(sweep, load_roster(s), outcome_unknown_neighbours(s, self.sweep_id))
        self.emit("sweep.unaccounted", {"count": len(missing), "people": missing})

    def _settle_hazard(self) -> None:
        """Where the hazard lands when the sweep stops.

        CLOSED means what `domain/state.py` says it means — every neighbour has an outcome and every
        escalation is resolved. Anything else goes back to OPEN, which is not a tidy ending and is
        not meant to be: there is still someone on that block nobody has accounted for.
        """
        with session_scope() as s:
            hazard = s.get(Hazard, self.hazard_id)
            sweep = s.get(Sweep, self.sweep_id)
            if hazard is None or sweep is None:
                return
            roster = load_roster(s)
            open_escalations = [
                e for e in s.exec(select(Escalation).where(Escalation.hazard_id == self.hazard_id)).all()
                if str(e.status) not in {"RESOLVED", "CANCELLED"}
            ]
            everyone_accounted = not unaccounted(sweep, roster)
            nxt = HazardStatus.CLOSED if (everyone_accounted and not open_escalations) else HazardStatus.OPEN
            current = HazardStatus(hazard.status)
            if current is nxt:
                return
            try:
                assert_hazard_transition(current, nxt)
            except Exception:  # noqa: BLE001
                return
            hazard.status = nxt
            hazard.closed_at = utcnow() if nxt is HazardStatus.CLOSED else None
            s.add(hazard)
        self.emit("hazard.status", {"status": nxt.value, "open_escalations": len(open_escalations)})

    # ------------------------------------------------------------------ check
    async def _check(self, sweep: Sweep, hazard: Hazard, neighbour_id: str) -> bool:
        """One neighbour, end to end. Returns False only when the whole sweep must stop."""
        nbr = self._neighbour(neighbour_id)
        risk = (sweep.triage or {}).get(neighbour_id)

        # Consent, enforced on the row at the moment of dialling. `risk.call_order` dropped him
        # already; this is the second lock, and it is here because the first one is an index.
        if not nbr.check_in_consent:
            self.emit(
                "call.skipped",
                {"neighbour_id": nbr.id, "name": nbr.name, "dialled": False,
                 "reason": "no consent on file for automated check-in calls"},
                neighbour_id=nbr.id,
            )
            return True

        contract = compile_contract(hazard_view(hazard, self.settings), neighbour_view(nbr))
        leg = await self._place(
            hazard=hazard, neighbour=nbr, contract=contract, callee="neighbour",
            phone=nbr.phone, to_name=nbr.name, risk=risk,
        )
        if leg.unknown:
            # Before the budget, the fatal branch and decide(): nothing below may treat this person
            # as reached, unreached or never dialled, and nobody else may be rung until a human has
            # looked at what happened to this call.
            self._halt_unknown(nbr, leg)
            return False
        if leg.budget:
            self._finish(SweepState.BUDGET_EXHAUSTED)
            return False
        if leg.fatal:
            with session_scope() as s:
                sw = s.get(Sweep, self.sweep_id)
                if sw is not None:
                    sw.error = leg.reason
                    s.add(sw)
            self._finish(SweepState.FAILED)
            return False
        if leg.status == "SKIPPED":
            return True

        # The line ShiftFill did not have. Whatever the provider said — a completed conversation, a
        # phone that rang out, a call that never connected — it goes to the outcome layer with this
        # neighbour's risk attached, and comes back as a finding.
        # `placed` is false only after a definite refusal: CALL-E answered the create request with a 4xx
        # and created no call task. A missing provider_call_id on its own is not proof that no phone
        # rang. An ambiguous create (timeout, 5xx, an answer with no id) or a poll deadline comes back
        # UNKNOWN, and the roster already stopped on it above.
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
            sweep_row = s.get(Sweep, self.sweep_id)
            assert sweep_row is not None
            # Rebind: `outcomes` is a plain Column(JSON) and an in-place update never goes dirty.
            sweep_row.outcomes = {**(sweep_row.outcomes or {}), neighbour_id: d.outcome.value}
            sweep_row.updated_at = utcnow()
            s.add(sweep_row)

        self.emit(
            "check.decided",
            {"call_id": leg.call_id, "neighbour_id": nbr.id, "name": nbr.name, **d.to_dict()},
            neighbour_id=nbr.id,
        )
        await self._pace()
        if d.escalates:
            return await self._escalate(hazard, nbr, leg.call_id, d)
        return True

    # -------------------------------------------------------------------- call
    async def _place(
        self,
        *,
        hazard: Hazard,
        neighbour: Neighbour,
        contract: CallContract,
        callee: str,
        phone: str,
        to_name: str,
        risk: dict[str, Any] | None = None,
        attempt: int = 1,
        extra_metadata: dict[str, Any] | None = None,
    ) -> Leg:
        """Dial one number, persist everything, and hand back what the outcome layer needs.

        The CheckCall row is written *before* the dial, keyed by an idempotency key derived from the
        sweep, the person and the attempt. If the process dies between the write and the provider's
        answer, the resume path finds the row, reuses the key and the provider call id, and asks
        CALL-E about the call that already exists rather than ringing a frail person a second time.
        """
        key = f"{self.sweep_id}:{neighbour.id}:{callee}:{attempt}"
        stored: CallOutcome | None = None

        with session_scope() as s:
            existing = s.exec(select(CheckCall).where(CheckCall.idempotency_key == key)).first()
            if existing is None and unknown_call_for(s, neighbour_id=neighbour.id, callee=callee) is not None:
                # An earlier call to this person has an unknown outcome and may still be live. A new
                # key would be a new call, so nobody rings them again until a human has checked.
                self.emit(
                    "call.skipped",
                    {"neighbour_id": neighbour.id, "name": to_name, "callee": callee, "dialled": False,
                     "reason": OUTCOME_UNKNOWN_REASON},
                    neighbour_id=neighbour.id,
                )
                return Leg(status="SKIPPED", reason=OUTCOME_UNKNOWN_REASON)
            if existing is None:
                try:
                    self.budget.reserve(s, phone=phone, provider=self.provider.name)
                except NumberNotAllowlisted as exc:
                    self.emit(
                        "call.skipped",
                        {"neighbour_id": neighbour.id, "name": to_name, "callee": callee, "dialled": False,
                         "reason": f"not allowlisted: {exc}"},
                        neighbour_id=neighbour.id,
                    )
                    return Leg(status="SKIPPED", reason=str(exc))
                except CallBudgetExhausted as exc:
                    self.emit(
                        "call.skipped",
                        {"neighbour_id": neighbour.id, "name": to_name, "callee": callee, "dialled": False,
                         "reason": str(exc)},
                        neighbour_id=neighbour.id,
                    )
                    return Leg(status="SKIPPED", reason=str(exc), budget=True)
                call = CheckCall(
                    sweep_id=self.sweep_id, hazard_id=self.hazard_id, neighbour_id=neighbour.id, callee=callee,
                    attempt=attempt, idempotency_key=key, provider=self.provider.name, status="DIALING",
                    task=contract.task, result_schema=contract.result_schema,
                    risk_snapshot=risk, help_offered=[o.model_dump() for o in contract.help_offers],
                    started_at=utcnow(),
                )
                s.add(call)
                s.flush()
                call_id, existing_pcid = call.id, None
            else:
                call_id, existing_pcid = existing.id, existing.provider_call_id
                if existing.status in {"PENDING", "DIALING"} and not existing_pcid and self.provider.name != "mock":
                    # A dial was started and no provider id was ever written back: the process died
                    # between our row and CALL-E's answer, or the answer never came. Sending the create
                    # again would be a second call if the first one landed, so this is UNKNOWN, not a retry.
                    stored = CallOutcome(
                        provider_call_id=None, status="UNKNOWN", structured_result=None,
                        failure_code="resume_without_provider_id",
                        failure_message="a dial was in flight with no provider call id recorded; it may have been placed",
                    )
                elif existing.status not in {"PENDING", "DIALING"}:
                    # Already finished before a restart: re-evaluate from what is on the row rather
                    # than dialling again.
                    stored = CallOutcome(
                        provider_call_id=existing.provider_call_id, status=existing.status,  # type: ignore[arg-type]
                        structured_result=existing.structured_result, transcript=existing.transcript,
                        summary=existing.summary, duration_s=existing.duration_s,
                        task_completed=existing.task_completed, completion_confidence=existing.completion_confidence,
                        evidence=existing.evidence,
                    )
                else:
                    self.emit("call.resuming", {"call_id": call_id, "neighbour_id": neighbour.id, "callee": callee},
                              neighbour_id=neighbour.id)

        if stored is not None:
            return await self._evaluate(call_id, neighbour, to_name, callee, contract, stored, resumed=True)

        self.emit(
            "call.started",
            {
                "call_id": call_id, "neighbour_id": neighbour.id, "name": to_name, "callee": callee,
                "phone_masked": obs.mask_phone(phone), "provider": self.provider.name, "idempotency_key": key,
                "locale": contract.locale, "risk": risk,
                "contract": {
                    "task": contract.task, "result_schema": contract.result_schema,
                    "objectives": contract.objectives, "hard_fields": contract.hard_fields,
                    "soft_fields": contract.soft_fields, "must_return": contract.must_return,
                    "help_offers": [o.model_dump() for o in contract.help_offers],
                },
            },
            neighbour_id=neighbour.id,
        )

        webhook_url = None
        if self.settings.PUBLIC_BASE_URL:
            webhook_url = f"{self.settings.PUBLIC_BASE_URL.rstrip('/')}/api/calle/webhook/{self.settings.CALLE_WEBHOOK_SECRET}"
        req = CallRequest(
            phone=phone, region=region_for(phone), locale=contract.locale, task=contract.task,
            result_schema=contract.result_schema, idempotency_key=key,
            # `employee_id` is ShiftFill's spelling, still on CallRequest in app/calls/provider.py.
            # It carries the neighbour id; the mock provider reads either name.
            employee_id=neighbour.id,
            metadata={
                "hazard_id": self.hazard_id, "hazard_kind": hazard.kind, "sweep_id": self.sweep_id,
                "neighbour_id": neighbour.id, "neighbour_name": neighbour.name, "callee": callee,
                "callee_name": to_name, "check_in_consent": bool(neighbour.check_in_consent),
                "call_record_id": call_id, **(extra_metadata or {}),
            },
            webhook_url=webhook_url, existing_provider_call_id=existing_pcid,
        )

        async def on_event(ev: ProviderEvent) -> None:
            if ev.provider_call_id:
                with session_scope() as s2:
                    # The provider has accepted a call task: the credit is spent from this moment,
                    # however the call turns out. Bank it before anything can go wrong downstream.
                    record_spent_call(s2, provider=self.provider.name, provider_call_id=ev.provider_call_id)
                    row = s2.get(CheckCall, call_id)
                    if row is not None and row.provider_call_id != ev.provider_call_id:
                        row.provider_call_id = ev.provider_call_id
                        s2.add(row)
            self.emit(
                "provider." + ev.type,
                {"call_id": call_id, "neighbour_id": neighbour.id, "callee": callee, "message": ev.message,
                 "status": ev.status, "provider_call_id": ev.provider_call_id, "details": ev.details},
                neighbour_id=neighbour.id,
            )

        try:
            with obs.timed("calle.place", provider=self.provider.name, callee=callee, idempotency_key=key) as leg_log:
                outcome = await self.provider.place(req, on_event)
                leg_log["provider_call_id"] = outcome.provider_call_id
                leg_log["status"] = outcome.status
        except CandidateRejectedByProvider as exc:
            # ShiftFill skipped to the next candidate here. BuddyE cannot: "the number we hold for
            # her is unroutable" is a fact about a person nobody has spoken to today, so it is a
            # FAILED call that goes to decide() and comes back UNREACHABLE.
            self._mark_failed(call_id, exc.code, exc.message)
            self.emit(
                "call.failed",
                {"call_id": call_id, "neighbour_id": neighbour.id, "name": to_name, "callee": callee,
                 "code": exc.code, "message": exc.message, "details": getattr(exc, "details", None)},
                neighbour_id=neighbour.id,
            )
            return Leg(status="FAILED", call_id=call_id, reason=f"{exc.code}: {exc.message}")
        except ProviderFatalError as exc:
            self._mark_failed(call_id, exc.code, exc.message)
            self.emit("sweep.provider_error", {
                "call_id": call_id, "code": exc.code, "message": exc.message,
                "details": getattr(exc, "details", None), "fatal": True})
            return Leg(status="FAILED", call_id=call_id, fatal=True, reason=f"{exc.code}: {exc.message}")
        except Exception as exc:  # noqa: BLE001
            if self.provider.name == "mock":
                raise  # the mock's consent tripwire and genuine test failures must stay loud
            # Something escaped the provider mid-dial: a CLI timeout, a bug, a connection error the SDK
            # did not wrap. The create may already have landed, so this is an unknown outcome.
            log.exception("provider raised mid-dial for call %s", call_id)
            outcome = CallOutcome(
                provider_call_id=None, status="UNKNOWN", structured_result=None,
                failure_code=type(exc).__name__, failure_message="the provider raised before reporting an outcome",
            )

        return await self._evaluate(call_id, neighbour, to_name, callee, contract, outcome)

    def _mark_failed(self, call_id: str, code: str, message: str) -> None:
        with session_scope() as s:
            call = s.get(CheckCall, call_id)
            if call is not None:
                call.status = "FAILED"
                call.summary = f"{code}: {message}"
                call.completed_at = utcnow()
                s.add(call)

    def _record_unknown(self, call_id: str, neighbour: Neighbour, to_name: str, callee: str,
                        outcome: CallOutcome, *, resumed: bool = False) -> Leg:
        """Persist a call whose outcome cannot be established, and return a leg that stops the caller.

        No validation, no reconcile, no decide(): there is nothing to read and nothing may be inferred.
        The row keeps whatever provider id is known, so a human can find the call in CALL-E.
        """
        reason = f"{outcome.failure_code or 'unknown'}: {outcome.failure_message or 'outcome could not be established'}"
        with session_scope() as s:
            call = s.get(CheckCall, call_id)
            assert call is not None
            call.status = "UNKNOWN"
            call.provider_call_id = outcome.provider_call_id or call.provider_call_id
            record_spent_call(s, provider=call.provider, provider_call_id=call.provider_call_id)
            call.summary = reason
            call.provider_raw = obs.redact(outcome.raw) or None
            call.poll_count = int(getattr(self.provider, "poll_count", 0) or 0)
            s.add(call)
            provider_call_id = call.provider_call_id
            sweep = s.get(Sweep, self.sweep_id)
            if sweep is not None and not resumed:
                sweep.calls_made += 1  # it may well have been made
                sweep.updated_at = utcnow()
                s.add(sweep)
        self.emit(
            "call.outcome_unknown",
            {"call_id": call_id, "neighbour_id": neighbour.id, "name": to_name, "callee": callee,
             "status": "UNKNOWN", "provider_call_id": provider_call_id,
             "failure_code": outcome.failure_code, "failure_message": outcome.failure_message,
             "note": OUTCOME_UNKNOWN_REASON},
            neighbour_id=neighbour.id,
        )
        return Leg(status="UNKNOWN", call_id=call_id, reason=reason, unknown=True)

    async def _evaluate(
        self, call_id: str, neighbour: Neighbour, to_name: str, callee: str,
        contract: CallContract, outcome: CallOutcome, *, resumed: bool = False,
    ) -> Leg:
        """Persist what came back, reconcile if it is worth reconciling, and hand it on.

        Note what is *not* here: ShiftFill's `if outcome.status in {"NO_ANSWER", "FAILED"}: return`.
        Every status flows on. What is still gated is the reconcile step — a call that never
        connected has no transcript, and asking a language model to recover fifteen required fields
        from an empty conversation is a spend that can only invent things.
        """
        if outcome.status == "UNKNOWN":
            return self._record_unknown(call_id, neighbour, to_name, callee, outcome, resumed=resumed)

        result = outcome.structured_result
        validation_errors = contract.validate_result(result) if outcome.status in {"COMPLETED", "INVALID_RESULT"} else []
        status = "INVALID_RESULT" if (outcome.status == "COMPLETED" and validation_errors) else outcome.status

        with session_scope() as s:
            call = s.get(CheckCall, call_id)
            assert call is not None
            call.status = status
            call.provider_call_id = outcome.provider_call_id or call.provider_call_id
            # Belt and braces: a provider that reports no lifecycle events still spends a credit.
            record_spent_call(s, provider=call.provider, provider_call_id=call.provider_call_id)
            call.structured_result = result
            call.validation_errors = validation_errors
            call.transcript = outcome.transcript
            call.summary = outcome.summary
            call.duration_s = outcome.duration_s
            call.task_completed = outcome.task_completed
            call.completion_confidence = outcome.completion_confidence
            call.evidence = outcome.evidence
            call.provider_raw = obs.redact(outcome.raw) or None
            call.poll_count = int(getattr(self.provider, "poll_count", 0) or 0)
            call.completed_at = utcnow()
            s.add(call)
            sweep = s.get(Sweep, self.sweep_id)
            assert sweep is not None
            # A resumed call was counted when it was placed; counting it again would make a restart
            # look like a second round of dialling in the audit trail.
            if not resumed:
                sweep.calls_made += 1
            sweep.updated_at = utcnow()
            s.add(sweep)

        self.emit(
            "call.completed",
            {"call_id": call_id, "neighbour_id": neighbour.id, "name": to_name, "callee": callee, "status": status,
             "structured_result": result, "validation_errors": validation_errors, "summary": outcome.summary,
             "duration_s": outcome.duration_s, "transcript": outcome.transcript,
             "failure_code": outcome.failure_code, "failure_message": outcome.failure_message,
             "task_completed": outcome.task_completed, "completion_confidence": outcome.completion_confidence,
             "evidence": outcome.evidence},
            neighbour_id=neighbour.id,
        )

        if outcome.status == "COMPLETED" and outcome.transcript:
            failing = failing_fields_for(contract.result_schema, result, validation_errors)
            if failing and self.reconciler.name != "null":
                self.emit("reconcile.started", {"call_id": call_id, "fields": failing, "reconciler": self.reconciler.name},
                          neighbour_id=neighbour.id)
                patch = await self.reconciler.reconcile(
                    schema=contract.result_schema, partial_result=result, failing_fields=failing,
                    transcript=outcome.transcript, summary=outcome.summary,
                    # what the agent was told it could offer: lets the layer tell a declined offer
                    # from one that was never made.
                    help_offered=[o.model_dump() for o in contract.help_offers],
                )
                meta = dict(getattr(self.reconciler, "last_meta", None) or {})
                merged = merge_reconciled(result, patch, outcome.transcript, failing)
                if merged is not None:
                    validation_errors = contract.validate_result(merged)
                    result = merged
                    with session_scope() as s:
                        call = s.get(CheckCall, call_id)
                        assert call is not None
                        call.structured_result = merged
                        call.validation_errors = validation_errors
                        call.reconciled = True
                        call.reconcile_meta = meta or None
                        if not validation_errors:
                            call.status = "COMPLETED"
                            status = "COMPLETED"
                        s.add(call)
                self.emit(
                    "reconcile.finished",
                    {"call_id": call_id, "patched_fields": sorted(set(failing) & set((patch or {}).keys())),
                     "structured_result": result, "validation_errors": validation_errors, "meta": meta},
                    neighbour_id=neighbour.id,
                )
            elif failing:
                self.emit("reconcile.skipped", {"call_id": call_id, "fields": failing,
                                                "reason": "no reconciler configured; unknowns stay unknown"},
                          neighbour_id=neighbour.id)
        await self._pace()
        return Leg(status=status, call_id=call_id, result=result, validation_errors=validation_errors,
                   confidence=outcome.completion_confidence)

    # --------------------------------------------------------------- escalate
    async def _escalate(self, hazard: Hazard, neighbour: Neighbour, call_id: str | None, d: Any) -> bool:
        """Climb the ladder for one neighbour. Every rung is `app.orchestrator.escalate`'s to write.

        Returns False only when the sweep must stop: the emergency-contact call came back with an
        unknown outcome, and the roster has already been halted.

        The ladder is EMERGENCY_CONTACT (BuddyE may call) -> BLOCK_CAPTAIN (BuddyE notifies) ->
        RESPONDER (BuddyE prepares a packet and stops). There is no fourth branch, and the third one
        ends at a document: `build_handoff_packet` leaves `released_at = None`, which means nobody
        has been told anything, and only `POST /api/handoffs/{id}/release` — with a person's name on
        it — can change that.
        """
        self._set_state(SweepState.ESCALATING, {"neighbour_id": neighbour.id, "outcome": d.outcome.value})
        outcome = CheckOutcome(d.outcome)

        # A driver that restarts mid-call re-evaluates the call it was on, which would otherwise open
        # a second escalation for a neighbour who already has one — two ladders climbing for the same
        # person, and a second packet cut about the same house.
        with session_scope() as s:
            existing = [
                e for e in s.exec(select(Escalation).where(
                    Escalation.sweep_id == self.sweep_id, Escalation.neighbour_id == neighbour.id)).all()
                if str(e.status) != "CANCELLED"
            ]
            if existing:
                self.emit(
                    "escalation.exists",
                    {"escalation_id": existing[0].id, "neighbour_id": neighbour.id, "name": neighbour.name,
                     "status": str(existing[0].status), "level": str(existing[0].level),
                     "note": "already escalated in this sweep; not opening a second ladder"},
                    neighbour_id=neighbour.id,
                )
                return True

        with session_scope() as s:
            esc = ladder.open_escalation(
                s, sweep_id=self.sweep_id, hazard_id=self.hazard_id, neighbour=neighbour,
                outcome=outcome, reason=d.reason, trigger_call_id=call_id,
            )
            assert esc is not None  # non-SAFE only ever reaches here
            s.flush()
            esc_id, level = esc.id, EscalationLevel(esc.level)
        self.emit(
            "escalation.opened",
            {"escalation_id": esc_id, "neighbour_id": neighbour.id, "name": neighbour.name,
             "outcome": outcome.value, "level": level.value, "band": d.band.value, "priority": d.priority,
             "reason": d.reason},
            neighbour_id=neighbour.id,
        )

        # ---- rung 1: the person they nominated -------------------------------------------------
        reached_contact = False
        if level is EscalationLevel.EMERGENCY_CONTACT:
            if outcome.value in CONTACT_CALL_OUTCOMES and self.settings.CALL_EMERGENCY_CONTACTS:
                reached_contact = await self._call_contact(hazard, neighbour, esc_id, d)
                if reached_contact is None:
                    return False  # the contact call's outcome is unknown; the roster has been stopped
                if reached_contact:
                    self.emit(
                        "escalation.rung",
                        {"escalation_id": esc_id, "neighbour_id": neighbour.id, "level": level.value,
                         "result": "reached", "note": f"{neighbour.contact_name} is going to look in on them"},
                        neighbour_id=neighbour.id,
                    )
                    return True  # a human with a key is on their way; the ladder stops climbing
            else:
                with session_scope() as s:
                    esc = s.get(Escalation, esc_id)
                    assert esc is not None
                    ladder.record_attempt(
                        s, esc, action="skipped",
                        result=f"not called: {outcome.value} does not warrant telling a third party about them",
                    )

        # ---- rung 2: the block captain ---------------------------------------------------------
        # A notification, never a call. She is the person running this evening; she is looking at
        # the board, and the board is the event stream.
        captain = self.settings.BLOCK_CAPTAIN_NAME or "the block captain"
        with session_scope() as s:
            esc = s.get(Escalation, esc_id)
            assert esc is not None
            if EscalationLevel(esc.level) is EscalationLevel.EMERGENCY_CONTACT:
                ladder.advance(s, esc, neighbour=neighbour, reason=d.reason)
            ladder.record_attempt(
                s, esc, action="notified",
                result=f"{captain} notified on the board", note=d.reason,
            )
            level = EscalationLevel(esc.level)
        self.emit(
            "escalation.notified",
            {"escalation_id": esc_id, "neighbour_id": neighbour.id, "name": neighbour.name,
             "level": level.value, "captain": captain, "outcome": outcome.value, "reason": d.reason,
             "concerns": list(d.concerns), "last_words": d.last_words},
            neighbour_id=neighbour.id,
        )

        # ---- rung 3: prepare a responder handoff, and stop ---------------------------------------
        if outcome not in {CheckOutcome.UNREACHABLE, CheckOutcome.URGENT}:
            return True
        if not band_at_least(d.band, self.settings.HANDOFF_MIN_BAND):
            self.emit(
                "handoff.not_prepared",
                {"escalation_id": esc_id, "neighbour_id": neighbour.id, "band": d.band.value,
                 "reason": f"triage band {d.band.value} is below HANDOFF_MIN_BAND={self.settings.HANDOFF_MIN_BAND}"},
                neighbour_id=neighbour.id,
            )
            return True

        with session_scope() as s:
            esc = s.get(Escalation, esc_id)
            assert esc is not None
            if EscalationLevel(esc.level) is not EscalationLevel.RESPONDER:
                ladder.advance(s, esc, neighbour=neighbour, reason=d.reason)
            calls = calls_for_neighbour(s, sweep_id=self.sweep_id, neighbour_id=neighbour.id)
            packet = ladder.build_handoff_packet(
                s, escalation=esc, neighbour=neighbour, hazard=hazard, calls=calls, concerns=list(d.concerns),
            )
            s.flush()
            packet_id, script, action = packet.id, packet.spoken_script, packet.recommended_action
            released = packet.released_at
        assert released is None  # the invariant this whole module exists to hold

        self._set_state(SweepState.AWAITING_HUMAN, {"neighbour_id": neighbour.id, "packet_id": packet_id})
        self.emit(
            "handoff.prepared",
            {"packet_id": packet_id, "escalation_id": esc_id, "neighbour_id": neighbour.id,
             "name": neighbour.name, "outcome": outcome.value, "band": d.band.value,
             "recommended_action": action, "spoken_script": script, "released": False,
             "note": "prepared only — no emergency service has been contacted and nobody has been sent"},
            neighbour_id=neighbour.id,
        )
        await self._pace()
        return True

    async def _call_contact(self, hazard: Hazard, neighbour: Neighbour, esc_id: str, d: Any) -> bool | None:
        """Ring the person this neighbour nominated. Returns True only if we actually spoke to them,
        and None when that call's outcome is unknown, in which case the sweep has been halted."""
        base = compile_contract(hazard_view(hazard, self.settings), neighbour_view(neighbour))
        contract = contact_contract(
            base, hazard=hazard_view(hazard, self.settings), neighbour=neighbour_view(neighbour),
            contact_name=neighbour.contact_name or "the emergency contact",
            contact_relation=neighbour.contact_relation, outcome=d.outcome.value, finding=d.reason,
        )
        leg = await self._place(
            hazard=hazard, neighbour=neighbour, contract=contract, callee="emergency_contact",
            phone=neighbour.contact_phone, to_name=neighbour.contact_name or "emergency contact",
            risk=None, extra_metadata={"contact_name": neighbour.contact_name,
                                       "contact_relation": neighbour.contact_relation},
        )
        if leg.unknown:
            with session_scope() as s:
                esc = s.get(Escalation, esc_id)
                if esc is not None:
                    ladder.record_attempt(s, esc, action="called", call_id=leg.call_id, reached=False,
                                          result="outcome unknown", note=leg.reason)
            self._halt_unknown(neighbour, leg)
            return None
        if leg.budget or leg.fatal or leg.status == "SKIPPED":
            with session_scope() as s:
                esc = s.get(Escalation, esc_id)
                if esc is not None:
                    ladder.record_attempt(s, esc, action="skipped", result=f"not called: {leg.reason or 'unavailable'}")
            # A budget wall on the contact leg does not end the sweep — the neighbours still to be
            # rung matter more than this second call, and `_place` already recorded the skip.
            return False

        # "Reached" means the same thing here as it does in escalate._reached: the extraction says we
        # spoke to the person we rang. A voicemail is not a contact.
        result = leg.result or {}
        reached = str(result.get("reached_intended_person", "")).strip().lower() == "yes"
        note = str(result.get("notes", "") or "").strip()
        with session_scope() as s:
            esc = s.get(Escalation, esc_id)
            assert esc is not None
            ladder.record_attempt(
                s, esc, action="called", call_id=leg.call_id, reached=reached,
                result=("spoke to them" if reached else f"no answer ({leg.status.lower()})"),
                note=note,
            )
        return reached
