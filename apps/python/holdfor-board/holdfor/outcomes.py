from __future__ import annotations

from .models import ReviewStatus

DECLINED = frozenset({"DECLINED"})
UNREACHED = frozenset({"NO_ANSWER", "VOICEMAIL", "BUSY", "EXPIRED"})
CONNECTED = frozenset({"COMPLETED"})

RETRYABLE = frozenset()


def connected(outcome: str | None) -> bool:
    return outcome is None or outcome in CONNECTED


def review_status_for(outcome: str | None) -> ReviewStatus:
    if connected(outcome):
        return ReviewStatus.NEEDS_REVIEW
    if outcome in DECLINED:
        return ReviewStatus.DECLINED
    if outcome in UNREACHED:
        return ReviewStatus.NOT_REACHED
    return ReviewStatus.NEEDS_REVIEW


def may_redial(outcome: str | None) -> bool:
    return outcome in RETRYABLE
