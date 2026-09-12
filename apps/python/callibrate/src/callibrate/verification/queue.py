"""What gets called next, and why it is that one.

The queue is a ranking, not a schedule. Every record carries a staleness score
that rises with the volatility of the fields it holds, the number of people sent
to it recently, and any first-hand report that it was wrong, and falls again for
a while after the organization has been contacted.

The last term is the one that stops a resource directory from becoming a
nuisance. A busy queue with no memory of who it just phoned will phone the same
small charity every day.
"""

from __future__ import annotations

from typing import Any

from callibrate.contracts.models import TriggerType
from callibrate.store import Store
from callibrate.verification.triggers import (
    fields_for_failure,
    message_for_failure,
    priority_for,
)

#: Below this, a record is stale enough to notice and not stale enough to phone.
QUEUE_THRESHOLD = 30.0


def refresh(store: Store, actor: str = "scheduler") -> dict[str, int]:
    return store.refresh_queue(actor)


def request_verification(
    store: Store,
    service_id: str,
    *,
    fields: list[str],
    trigger: TriggerType = TriggerType.MANUAL_REQUEST,
    note: str = "",
    actor: str = "public",
) -> tuple[str, bool]:
    """Somebody asked for this record to be checked. One record, one open task."""
    return store.create_verification_task(
        service_id,
        trigger=trigger.value,
        fields=fields,
        priority=priority_for(trigger),
        note=note,
        actor=actor,
    )


def report_failure(
    store: Store, service_id: str, reason: str, details: str, referral_id: str | None
) -> tuple[str, str, str]:
    """A report of a wasted trip, and the call it becomes in the same transaction.

    This is the shortest path in the product between a person being let down and
    a phone ringing, and it is deliberately not a queue, a review step or a
    nightly batch.
    """
    report_id, task_id = store.report_failure(service_id, reason, details, referral_id)
    return report_id, task_id, message_for_failure(reason, details)


def fields_for(reason: str) -> list[str]:
    return fields_for_failure(reason)


def queue_snapshot(store: Store, limit: int = 50) -> list[dict[str, Any]]:
    return store.list_tasks(limit)
