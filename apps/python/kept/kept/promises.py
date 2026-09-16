"""Decide whether each captured promise was kept, and what that earns next.

Aging buckets say how late an invoice is. Promise history says whether this
customer does what they said. The second is the better reason to spend a call,
so escalation here is driven by broken promises rather than by days past due.
"""

from __future__ import annotations

from datetime import date, timedelta

from kept.config import Policy
from kept.models import CallCycle, Promise, PromiseStatus
from kept.reconcile import Settlement


class PromiseLedger:
    def __init__(self, *, policy: Policy) -> None:
        self._policy = policy

    def statuses(
        self, promises: list[Promise], settlement: Settlement, today: date
    ) -> dict[str, PromiseStatus]:
        superseded = _superseded_ids(promises)
        return {
            promise.id: (
                PromiseStatus.SUPERSEDED
                if promise.id in superseded
                else self.status(promise, settlement, today)
            )
            for promise in promises
        }

    def status(self, promise: Promise, settlement: Settlement, today: date) -> PromiseStatus:
        deadline = self.deadline(promise)
        paid = settlement.allocated_between(promise.invoice_id, promise.captured_at.date(), deadline)
        if paid >= promise.amount_minor:
            return PromiseStatus.KEPT
        if today <= deadline:
            return PromiseStatus.OPEN
        return PromiseStatus.PARTIAL if paid > 0 else PromiseStatus.BROKEN

    def deadline(self, promise: Promise) -> date:
        return promise.due_date + timedelta(days=self._policy.promise_grace_days)


def _superseded_ids(promises: list[Promise]) -> set[str]:
    """A later promise for the same invoice replaces the earlier one."""
    latest: dict[str, Promise] = {}
    for promise in promises:
        current = latest.get(promise.invoice_id)
        if current is None or promise.captured_at > current.captured_at:
            latest[promise.invoice_id] = promise
    keep = {promise.id for promise in latest.values()}
    return {promise.id for promise in promises if promise.id not in keep}


def broken_promises(
    promises: list[Promise], statuses: dict[str, PromiseStatus], customer_id: str
) -> list[Promise]:
    broken = {PromiseStatus.BROKEN, PromiseStatus.PARTIAL}
    matching = [
        promise
        for promise in promises
        if promise.customer_id == customer_id and statuses.get(promise.id) in broken
    ]
    return sorted(matching, key=lambda promise: promise.captured_at)


def open_promise(
    promises: list[Promise], statuses: dict[str, PromiseStatus], invoice_id: str
) -> Promise | None:
    for promise in promises:
        if promise.invoice_id == invoice_id and statuses.get(promise.id) is PromiseStatus.OPEN:
            return promise
    return None


def choose_cycle(history: list[Promise], statuses: dict[str, PromiseStatus]) -> CallCycle:
    """Escalate on broken promises, not on age. Never skip a step."""
    if not history:
        return CallCycle.FIRST_CONTACT
    broken = [p for p in history if statuses.get(p.id) in {PromiseStatus.BROKEN, PromiseStatus.PARTIAL}]
    if len(broken) >= 2:
        return CallCycle.FINAL_NOTICE
    if len(broken) == 1:
        return CallCycle.BROKEN_PROMISE
    return CallCycle.REMINDER
