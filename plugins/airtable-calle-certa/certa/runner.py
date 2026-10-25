"""Planning a run, and executing one.

`plan()` has no side effects at all. It reads the table, derives the schema,
authorises what it can, and reports what it would say to whom -- including
every row it would skip and why. A skipped row is information, not an omission,
so it is carried in the report rather than dropped.

`execute()` is the only function in this package that can cause a phone to
ring. Its ordering is the correctness property worth reading:

  1. Re-plan. A plan is never carried over from a previous screen, because the
     table may have changed since the operator looked at it.
  2. Check the caps, before anything dials.
  3. Write `call.authorized` to the audit log and fsync it, before dispatch.
     A crash between the write and the call leaves a record with no call, which
     is recoverable. The other order leaves a call with no record, which is not.
  4. Dispatch concurrently, poll to terminal, interpret, audit the outcome,
     write the answers back.

Cancelling a row prevents future dispatch. This workflow does not send API
cancellation requests; accepted calls must be reconciled by their original ID.
"""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from .airtable import AirtableClient, FieldMap, Row, Scope, answer_columns, scope, to_row
from .audit import AuditLog
from .calle import (
    Disposition,
    Interpretation,
    build_call_payload,
    idempotency_key,
    interpret,
)
from .consent import authorize
from .dialplan import UnsupportedRegion, resolve
from .schema import DerivedSchema, SchemaError, derive_recipient_schema, valid_answer
from .tasks import TASK_SPEC_VERSION, TaskError, build_task
from .transport import Transport
from .types import BoundaryError, ConsentedEmployerContact, Relationship, redact

DEFAULT_MAX_CALLS_PER_RUN = 25
DEFAULT_POLL_FIRST_DELAY = 60.0
DEFAULT_POLL_INTERVAL = 8.0
DEFAULT_POLL_TIMEOUT = 900.0

# Confirm ready answers before writing a consequential disposition.
DEFAULT_SETTLE_DELAY = 12.0


class RunError(Exception):
    """A run could not be planned or executed."""


@dataclass(frozen=True, slots=True)
class Planned:
    row: Row
    contact: ConsentedEmployerContact
    payload: dict[str, Any]
    idempotency: str
    task: str


@dataclass(frozen=True, slots=True)
class Skipped:
    row: Row
    reason: str


@dataclass(frozen=True, slots=True)
class Plan:
    scope: Scope
    derived: DerivedSchema
    planned: tuple[Planned, ...]
    skipped: tuple[Skipped, ...]
    requester_name: str

    @property
    def call_count(self) -> int:
        return len(self.planned)

    @property
    def estimated_cost_usd(self) -> float | None:
        return 0.0 if self.call_count == 0 else None


@dataclass(frozen=True, slots=True)
class Outcome:
    request_id: str
    record_id: str
    call_id: str
    interpretation: Interpretation


@dataclass(slots=True)
class RunReport:
    plan: Plan
    outcomes: list[Outcome] = field(default_factory=list)
    started_at: float = 0.0
    finished_at: float = 0.0

    @property
    def elapsed_seconds(self) -> float:
        return max(self.finished_at - self.started_at, 0.0)

    def by_disposition(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for outcome in self.outcomes:
            key = outcome.interpretation.disposition.value
            counts[key] = counts.get(key, 0) + 1
        return counts


def plan(
    client: AirtableClient,
    *,
    table: str,
    view: str,
    requester_name: str,
    fields: FieldMap | None = None,
) -> Plan:
    """Work out what a run would do. Places no calls and writes nothing."""
    fields = fields or FieldMap()
    schema = client.table_schema(table)
    try:
        derived = derive_recipient_schema(answer_columns(schema, fields))
    except SchemaError as exc:
        raise RunError(f"the table's answer columns cannot produce a schema: {exc}") from exc

    planned: list[Planned] = []
    skipped: list[Skipped] = []

    for record in client.list_view(table, view):
        row = to_row(record, fields)
        try:
            contact = authorize(
                row.request,
                relationship=Relationship.EMPLOYER,
                task_spec_version=TASK_SPEC_VERSION,
                presented_token=row.presented_token,
            )
        except BoundaryError as exc:
            skipped.append(Skipped(row, str(exc)))
            continue

        # The number already says where it dials. Passing that on is not
        # optional: CALL-E accepts a call with no region, dials it, and the
        # carrier refuses it in zero seconds with a bare SIP 404.
        try:
            destination = resolve(contact.number.e164)
        except UnsupportedRegion as exc:
            skipped.append(Skipped(row, f"{row.request.request_id}: {exc}"))
            continue

        try:
            task = build_task(contact, requester_name=requester_name)
            payload = build_call_payload(
                [contact],
                derived=derived,
                requester_name=requester_name,
                region=destination.region,
                locale=destination.locale,
            )
        except (TaskError, Exception) as exc:  # noqa: BLE001 - reported, never raised past here
            skipped.append(Skipped(row, str(exc)))
            continue

        planned.append(
            Planned(
                row=row,
                contact=contact,
                payload=payload,
                idempotency=idempotency_key([contact]),
                task=task,
            )
        )

    return Plan(
        scope=scope(client, table, view),
        derived=derived,
        planned=tuple(planned),
        skipped=tuple(skipped),
        requester_name=requester_name,
    )


def _poll_to_terminal(
    transport: Transport,
    call_id: str,
    derived: DerivedSchema,
    *,
    first_delay: float,
    interval: float,
    timeout: float,
    settle_delay: float,
    sleep: Callable[[float], None],
    now: Callable[[], float],
) -> tuple[dict[str, Any], Interpretation]:
    """Poll one call until it is terminal, then interpret it.

    The initial delay and polling interval are configurable.
    On timeout the call is left pending rather than guessed at: an unknown
    outcome must never become a verified one, and GET /v2/calls/{id} is the
    reconciliation path for a result that arrives later.
    """
    deadline = now() + timeout
    sleep(first_delay)
    call: dict[str, Any] = {}
    while True:
        try:
            call = transport.get_call(call_id)
            if not isinstance(call, dict) or call.get("id") != call_id:
                raise RunError("no matching API Call record")
        except Exception:
            return call, Interpretation(Disposition.NEEDS_REVIEW, "Call read failed; reconcile this API ID before retrying")
        result = interpret(call, derived)
        if result.is_terminal:
            return _confirm(
                transport, call_id, derived, call, result,
                settle_delay=settle_delay, sleep=sleep,
            )
        if now() >= deadline:
            return call, Interpretation(
                Disposition.PENDING,
                f"still not terminal after {timeout:.0f}s; reconcile from the "
                "Call endpoint rather than redialing",
            )
        sleep(interval)


def _confirm(
    transport: Transport,
    call_id: str,
    derived: DerivedSchema,
    call: dict[str, Any],
    result: Interpretation,
    *,
    settle_delay: float,
    sleep: Callable[[float], None],
) -> tuple[dict[str, Any], Interpretation]:
    """Confirm ready business answers agree across two authenticated reads."""
    if settle_delay <= 0:
        return call, result

    sleep(settle_delay)
    try:
        again = transport.get_call(call_id)
        if not isinstance(again, dict) or again.get("id") != call_id:
            raise RunError("no matching API Call record")
    except Exception:  # noqa: BLE001 - a failed confirmation is not a verdict
        return call, result

    confirmed = interpret(again, derived)
    if not confirmed.is_terminal:
        return call, result

    moved = sorted(
        key for key in set(result.answers) | set(confirmed.answers)
        if result.answers.get(key) != confirmed.answers.get(key)
    )
    if not moved:
        return again, confirmed

    changes = ", ".join(
        f"{key} {result.answers.get(key)!r} -> {confirmed.answers.get(key)!r}"
        for key in moved
    )
    return again, Interpretation(
        Disposition.NEEDS_REVIEW,
        f"CALL-E revised the ready result between reads ({changes}); "
        "a person must reconcile the disagreement",
        evidence=confirmed.evidence,
        answers=confirmed.answers,
    )


def execute(
    client: AirtableClient,
    transport: Transport,
    audit: AuditLog,
    *,
    table: str,
    view: str,
    requester_name: str,
    fields: FieldMap | None = None,
    max_calls: int = DEFAULT_MAX_CALLS_PER_RUN,
    max_workers: int = 6,
    first_delay: float = DEFAULT_POLL_FIRST_DELAY,
    interval: float = DEFAULT_POLL_INTERVAL,
    timeout: float = DEFAULT_POLL_TIMEOUT,
    settle_delay: float = DEFAULT_SETTLE_DELAY,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], float] = time.monotonic,
) -> RunReport:
    """Place the calls a fresh plan authorises. This rings real phones."""
    fields = fields or FieldMap()
    current = plan(
        client, table=table, view=view, requester_name=requester_name, fields=fields
    )

    if current.call_count > max_calls:
        raise RunError(
            f"this run would place {current.call_count} calls, over the cap of "
            f"{max_calls}. Narrow the view or raise --max-calls deliberately."
        )

    report = RunReport(plan=current, started_at=now())

    def dispatch(item: Planned) -> Outcome:
        # The plan is a snapshot, and a batch can take minutes. Re-read this
        # row's consent immediately before dialing so a revocation made while
        # the run is in flight still stops calls that have not gone out yet.
        # It cannot recall a call already placed -- CALL-E has no
        # cancel-in-flight operation -- so this narrows the window rather
        # than closing it, and README states that plainly.
        try:
            fresh = client.get_record(table, item.row.record_id)
        except Exception:  # noqa: BLE001 - a failed re-read must not place a call
            return Outcome(
                record_id=item.row.record_id,
                request_id=item.contact.request_id,
                call_id="",
                interpretation=Interpretation(
                    Disposition.NEEDS_REVIEW,
                    "consent could not be re-read immediately before dialing, "
                    "so the call was not placed",
                ),
            )
        current_row = to_row(fresh, fields)
        try:
            authorize(
                current_row.request,
                relationship=Relationship.EMPLOYER,
                task_spec_version=TASK_SPEC_VERSION,
                presented_token=current_row.presented_token,
            )
        except BoundaryError as exc:
            audit.append(
                "call.withheld",
                request_id=item.contact.request_id,
                masked_number=item.contact.masked_number(),
                consent_token=item.contact.consent_token,
                detail={"reason": str(exc)},
            )
            return Outcome(
                record_id=item.row.record_id,
                request_id=item.contact.request_id,
                call_id="",
                interpretation=Interpretation(
                    Disposition.NEEDS_REVIEW,
                    "consent changed after the run started, so no call was "
                    f"placed: {exc}",
                ),
            )

        # Recorded and durable before the phone can ring. A record with no call
        # is recoverable; a call with no record is not.
        audit.append(
            "call.authorized",
            request_id=item.contact.request_id,
            masked_number=item.contact.masked_number(),
            number_source=item.contact.number.source.value,
            consent_token=item.contact.consent_token,
            detail={
                "employer": item.contact.employer_name,
                "task_spec_version": item.contact.task_spec_version,
                "idempotency_key": item.idempotency,
            },
        )
        try:
            created = transport.create_call(item.payload, idempotency_key=item.idempotency)
            call_id = created.get("id")
            if not isinstance(call_id, str) or not call_id:
                raise RunError("no API resource id returned")
        except Exception:
            result = Interpretation(Disposition.NEEDS_REVIEW, "Call acceptance is uncertain; reconcile the original request and key before retrying")
            audit.append("call.uncertain", request_id=item.contact.request_id,
                         detail={"idempotency_key": item.idempotency})
            return Outcome(item.contact.request_id, item.row.record_id, "", result)
        audit.append(
            "call.dispatched",
            request_id=item.contact.request_id,
            masked_number=item.contact.masked_number(),
            call_id=call_id,
            consent_token=item.contact.consent_token,
        )

        call, result = _poll_to_terminal(
            transport,
            call_id,
            current.derived,
            first_delay=first_delay,
            interval=interval,
            timeout=timeout,
            settle_delay=settle_delay,
            sleep=sleep,
            now=now,
        )
        audit.append(
            "call.interpreted",
            request_id=item.contact.request_id,
            masked_number=item.contact.masked_number(),
            call_id=call_id,
            consent_token=item.contact.consent_token,
            detail={
                "disposition": result.disposition.value,
                "reason": result.reason,
                "retryable": result.retryable,
            },
        )
        return Outcome(item.contact.request_id, item.row.record_id, call_id, result)

    if current.planned:
        with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(current.planned)))) as pool:
            report.outcomes = list(pool.map(dispatch, current.planned))

    report.finished_at = now()
    _write_back(client, table, current, report, fields)
    return report


def _write_back(
    client: AirtableClient,
    table: str,
    current: Plan,
    report: RunReport,
    fields: FieldMap,
) -> None:
    """Push dispositions and answers into the operator's table."""
    updates: list[dict[str, Any]] = []
    for outcome in report.outcomes:
        values: dict[str, Any] = {
            fields.status: outcome.interpretation.disposition.value,
            fields.reason: outcome.interpretation.reason,
            fields.call_id: outcome.call_id,
        }
        for key, value in (outcome.interpretation.answers or {}).items():
            column = current.derived.field_names.get(key)
            if not column or not valid_answer(current.derived.schema["properties"][key], value):
                continue
            displayed = current.derived.choice_labels.get((key, value), value)
            values[column] = redact(displayed) if isinstance(displayed, str) else displayed
        updates.append({"id": outcome.record_id, "fields": values})

    for skipped in current.skipped:
        updates.append(
            {
                "id": skipped.row.record_id,
                "fields": {
                    fields.status: "skipped",
                    fields.reason: skipped.reason,
                },
            }
        )

    if updates:
        client.update_records(table, updates)


def reconcile(
    transport: Transport,
    audit: AuditLog,
    call_id: str,
    derived: DerivedSchema,
) -> Interpretation:
    """Read the authenticated v2 Call; lifecycle events are not result snapshots."""
    call = transport.get_call(call_id)
    if not isinstance(call, dict) or call.get("id") != call_id:
        raise RunError("no matching API Call record")
    result = interpret(call, derived)
    audit.append(
        "call.reconciled",
        call_id=call_id,
        detail={"disposition": result.disposition.value, "reason": result.reason},
    )
    return result
