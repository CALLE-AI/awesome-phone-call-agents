"""Run one collection cycle: plan, call, capture, record.

The order here matters. The idempotency key is derived from how many calls the
ledger already shows for this invoice, so a process that dies between placing a
call and writing the ledger will rebuild the same key on the next run and CALL-E
will hand back the original call rather than dialling the customer twice.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from kept.calls.port import (
    CallPlacementError,
    CallPort,
    CallRequest,
    PlacedCall,
    idempotency_key,
    payload_digest,
    task_digest,
)
from kept.calls.schema import assert_supported, promise_result_schema
from kept.calls.scripts import ScriptWriter
from kept.capture import CallBinding, CaptureResult, CaptureVerdict, PromiseCapture
from kept.clock import Clock
from kept.config import Organisation, Policy
from kept.ledger import Ledger
from kept.models import (
    CallCycle,
    CallPlan,
    CallTarget,
    Dispute,
    Promise,
    Suppression,
    is_e164,
    mask_phone,
    redact_phone_like,
)
from kept.policy import CallPlanner
from kept.store import (
    EVENT_CALL_DISPATCHED,
    EVENT_CALL_FAILED,
    EVENT_CALL_PLACED,
    EVENT_CALL_SUPPRESSED,
    EVENT_CAPTURE_REJECTED,
    EVENT_DISPUTE_RECORDED,
    EVENT_PROMISE_RECORDED,
    EVENT_RUN_STARTED,
    AccountBook,
)


@dataclass(frozen=True, slots=True)
class Runtime:
    port: CallPort
    ledger: Ledger
    clock: Clock
    policy: Policy
    organisation: Organisation
    authorized_phones: frozenset[str] | None = None
    """Numbers a human signed off on for this data set. `None` outside live runs."""


@dataclass(slots=True)
class RunSummary:
    run_id: str
    plan: CallPlan
    calls_placed: int = 0
    promises: list[Promise] = field(default_factory=list)
    disputes: list[Dispute] = field(default_factory=list)
    rejections: list[tuple[str, str]] = field(default_factory=list)
    failures: list[tuple[str, str]] = field(default_factory=list)
    aborted: str | None = None
    """Set when an outcome was ambiguous, which stops the run where it stands."""

    @property
    def suppressions(self) -> tuple[Suppression, ...]:
        return self.plan.suppressions


class CollectionRun:
    def __init__(self, runtime: Runtime) -> None:
        self._runtime = runtime
        self._planner = CallPlanner(
            policy=runtime.policy, authorized_phones=runtime.authorized_phones
        )
        self._writer = ScriptWriter(organisation=runtime.organisation)
        self._capture = PromiseCapture(policy=runtime.policy)

    def execute(self, book: AccountBook, budget: int) -> RunSummary:
        now = self._runtime.clock.now()
        plan = self._planner.plan(book, now, budget)
        summary = RunSummary(run_id=f"run_{now:%Y%m%dT%H%M%SZ}", plan=plan)
        self._record_plan(summary, now)
        for target in plan.targets:
            self._process(target, book, summary, now)
            if summary.aborted is not None:
                break
        return summary

    def recover(self, book: AccountBook) -> RunSummary:
        """Finish calls that were dialled but whose outcome was never recorded.

        A run killed between dispatch and the terminal poll leaves a customer
        who was called and a ledger that does not know it. Their id is on disk,
        so the outcome is fetched rather than the call being placed again. The
        dispatch record's task digest binds that outcome to the instructions
        actually sent; a record without one is closed out as `result_not_bound`.
        """
        now = self._runtime.clock.now()
        summary = RunSummary(run_id=f"recover_{now:%Y%m%dT%H%M%SZ}", plan=CallPlan())
        for orphan in orphaned_calls(self._runtime.ledger):
            target = _rebuild_target(orphan, book)
            if target is None:
                continue
            self._collect(
                target,
                orphan["call_id"],
                summary,
                now,
                bound_task=str(orphan.get("task_digest", "")),
            )
            if summary.aborted is not None:
                break
        return summary

    def _record_plan(self, summary: RunSummary, now: datetime) -> None:
        self._append(
            EVENT_RUN_STARTED,
            {
                "run_id": summary.run_id,
                "planned_calls": summary.plan.calls_required,
                "suppressed": len(summary.plan.suppressions),
            },
            now,
        )
        for suppression in summary.plan.suppressions:
            self._append(
                EVENT_CALL_SUPPRESSED,
                {
                    "run_id": summary.run_id,
                    "invoice_id": suppression.invoice_id,
                    "customer_id": suppression.customer_id,
                    "reason": suppression.reason.value,
                    "detail": suppression.detail,
                },
                now,
            )

    def _process(
        self, target: CallTarget, book: AccountBook, summary: RunSummary, now: datetime
    ) -> None:
        try:
            request = self._build_request(target, book, summary.run_id, now)
            call_id = self._runtime.port.dispatch(request)
        except CallPlacementError as exc:
            self._record_failure(target, exc, summary, now)
            return
        digest = task_digest(request.task)
        self._append(
            EVENT_CALL_DISPATCHED,
            _dispatch_payload(target, call_id, run_id=summary.run_id, bound_task=digest),
            now,
        )
        summary.calls_placed += 1
        self._collect(target, call_id, summary, now, bound_task=digest)

    def _collect(
        self,
        target: CallTarget,
        call_id: str,
        summary: RunSummary,
        now: datetime,
        *,
        bound_task: str,
    ) -> None:
        try:
            placed = self._runtime.port.await_result(call_id)
        except CallPlacementError as exc:
            self._record_failure(target, exc, summary, now)
            return
        binding = CallBinding(
            call_id=call_id,
            phone=target.customer.primary_phone or "",
            metadata=_binding_metadata(target),
            task_digest=bound_task,
        )
        result = self._capture.capture(placed, target, now, binding)
        self._record_call(target, placed, result, summary, now)

    def _record_failure(
        self, target: CallTarget, exc: CallPlacementError, summary: RunSummary, now: datetime
    ) -> None:
        summary.failures.append((target.invoice.id, exc.code))
        if exc.is_ambiguous:
            summary.aborted = exc.code
        self._append(
            EVENT_CALL_FAILED,
            {
                "run_id": summary.run_id,
                "invoice_id": target.invoice.id,
                "customer_id": target.customer.id,
                "cycle": target.cycle.value,
                "code": exc.code,
                "message": redact_phone_like(str(exc)),
                "ambiguous": exc.is_ambiguous,
            },
            now,
        )

    def _build_request(
        self, target: CallTarget, book: AccountBook, run_id: str, now: datetime
    ) -> CallRequest:
        schema = promise_result_schema()
        assert_supported(schema)
        attempt = keys_consumed(self._runtime.ledger, target.invoice.id, target.cycle)
        phone = self._authorized_phone(target)
        task = self._writer.write(target, now.date())
        metadata = {"run_id": run_id, **_binding_metadata(target)}
        return CallRequest(
            task=task,
            phone=phone,
            region=target.customer.region,
            locale=target.customer.locale,
            result_schema=schema,
            idempotency_key=idempotency_key(
                invoice_id=target.invoice.id,
                cycle=target.cycle,
                attempt=attempt,
                payload_digest=payload_digest(
                    task=task,
                    phone=phone,
                    region=target.customer.region,
                    locale=target.customer.locale,
                    result_schema=schema,
                    metadata=metadata,
                ),
            ),
            metadata=metadata,
        )

    def _authorized_phone(self, target: CallTarget) -> str:
        """The last gate before a request exists, after the planner has had its say.

        The planner already suppresses an unauthorized recipient, so reaching
        here means a target was built some other way. It fails rather than
        dialling a number nobody signed off on.
        """
        phone = target.customer.primary_phone
        if phone is None or not is_e164(phone):
            raise CallPlacementError(
                "Planner produced a target without a dialable E.164 number.",
                code="invalid_phone",
            )
        authorized = self._runtime.authorized_phones
        if authorized is not None and phone not in authorized:
            raise CallPlacementError(
                f"{mask_phone(phone)} is not on the authorized recipient list.",
                code="recipient_not_authorized",
            )
        return phone

    def _record_call(
        self,
        target: CallTarget,
        placed: PlacedCall,
        result: CaptureResult,
        summary: RunSummary,
        now: datetime,
    ) -> None:
        self._append(
            EVENT_CALL_PLACED,
            {
                "run_id": summary.run_id,
                "invoice_id": target.invoice.id,
                "customer_id": target.customer.id,
                "call_id": placed.call_id,
                "cycle": target.cycle.value,
                "occurred_at": now.isoformat(),
                "outcome": result.answer.outcome.value if result.answer else None,
                "phone": mask_phone(target.customer.primary_phone or ""),
                "confidence": placed.confidence,
            },
            now,
        )
        self._record_capture(result, summary, target, now)

    def _record_capture(
        self, result: CaptureResult, summary: RunSummary, target: CallTarget, now: datetime
    ) -> None:
        if result.verdict is CaptureVerdict.PROMISE_RECORDED and result.promise is not None:
            summary.promises.append(result.promise)
            self._append(
                EVENT_PROMISE_RECORDED, _promise_payload(result.promise, result, summary.run_id), now
            )
            return
        if result.verdict is CaptureVerdict.DISPUTE_RECORDED and result.dispute is not None:
            summary.disputes.append(result.dispute)
            self._append(EVENT_DISPUTE_RECORDED, _dispute_payload(result.dispute, summary.run_id), now)
            return
        reason = result.rejection.value if result.rejection else "unknown"
        summary.rejections.append((target.invoice.id, reason))
        self._append(
            EVENT_CAPTURE_REJECTED,
            {
                "run_id": summary.run_id,
                "invoice_id": target.invoice.id,
                "customer_id": target.customer.id,
                "reason": reason,
                "evidence": result.answer.evidence_quote if result.answer else "",
            },
            now,
        )

    def _append(self, event_type: str, payload: dict, at: datetime) -> None:
        self._runtime.ledger.append(event_type=event_type, payload=payload, at=at)


def keys_consumed(ledger: Ledger, invoice_id: str, cycle: CallCycle) -> int:
    """How many idempotency keys this invoice and cycle have already spent.

    A key is burned the moment CALL-E accepts it, not when the outcome is
    finally recorded. Counting only completed calls regenerated a spent key
    after a crash and earned an `idempotency_conflict`, so a dispatched call and
    a refused duplicate both count here.

    Entries written before the cycle was recorded are counted rather than
    skipped. Over-counting only skips a key number; under-counting regenerates
    a spent one, which is the failure this exists to prevent.
    """
    accepted = {
        payload["call_id"]
        for event in (EVENT_CALL_DISPATCHED, EVENT_CALL_PLACED)
        for payload in ledger.of_type(event)
        if payload.get("invoice_id") == invoice_id and payload.get("cycle") == cycle.value
    }
    conflicts = sum(
        1
        for payload in ledger.of_type(EVENT_CALL_FAILED)
        if payload.get("invoice_id") == invoice_id
        and payload.get("code") == "idempotency_conflict"
        and payload.get("cycle") in (cycle.value, None)
    )
    return len(accepted) + conflicts


def orphaned_calls(ledger: Ledger) -> list[dict]:
    """Calls the ledger shows as dialled but never as answered."""
    collected = {payload["call_id"] for payload in ledger.of_type(EVENT_CALL_PLACED)}
    return [
        payload
        for payload in ledger.of_type(EVENT_CALL_DISPATCHED)
        if payload["call_id"] not in collected
    ]


def _binding_metadata(target: CallTarget) -> dict[str, str]:
    """The identity a returned result must agree with before it means anything."""
    return {
        "invoice_id": target.invoice.id,
        "customer_id": target.customer.id,
        "cycle": target.cycle.value,
    }


def _dispatch_payload(
    target: CallTarget, call_id: str, *, run_id: str, bound_task: str
) -> dict:
    return {
        "run_id": run_id,
        "call_id": call_id,
        "task_digest": bound_task,
        "invoice_id": target.invoice.id,
        "customer_id": target.customer.id,
        "cycle": target.cycle.value,
        "outstanding_minor": target.outstanding_minor,
        "phone": mask_phone(target.customer.primary_phone or ""),
    }


def _rebuild_target(orphan: dict, book: AccountBook) -> CallTarget | None:
    """Reconstruct the target from the dispatch record, not from a fresh plan.

    The plan has moved on since the call was placed, so the clamp must use the
    balance as it stood when the customer was actually asked.
    """
    invoice = next((i for i in book.invoices if i.id == orphan["invoice_id"]), None)
    customer = book.customers.get(orphan["customer_id"])
    if invoice is None or customer is None:
        return None
    return CallTarget(
        invoice=invoice,
        customer=customer,
        cycle=CallCycle(orphan["cycle"]),
        outstanding_minor=int(orphan["outstanding_minor"]),
        broken_promise_count=0,
    )


def _promise_payload(promise: Promise, result: CaptureResult, run_id: str) -> dict:
    return {
        "run_id": run_id,
        "id": promise.id,
        "invoice_id": promise.invoice_id,
        "customer_id": promise.customer_id,
        "call_id": promise.call_id,
        "amount_minor": promise.amount_minor,
        "spoken_amount_minor": result.spoken_amount_minor,
        "clamped_to_outstanding": result.was_clamped,
        "due_date": promise.due_date.isoformat(),
        "method": promise.method,
        "captured_at": promise.captured_at.isoformat(),
        "confidence": promise.confidence,
        "evidence": promise.evidence,
    }


def _dispute_payload(dispute: Dispute, run_id: str) -> dict:
    return {
        "run_id": run_id,
        "invoice_id": dispute.invoice_id,
        "customer_id": dispute.customer_id,
        "call_id": dispute.call_id,
        "reason": dispute.reason,
        "raised_at": dispute.raised_at.isoformat(),
    }
