from __future__ import annotations

from .models import CallKind, ReviewStatus

DECLINED = frozenset({"DECLINED"})
UNREACHED = frozenset({"NO_ANSWER", "VOICEMAIL", "BUSY", "EXPIRED"})
CONNECTED = frozenset({"COMPLETED"})

RETRYABLE = frozenset()


def connected(outcome: str | None) -> bool:
    return outcome is None or outcome in CONNECTED


def review_status_for(outcome: str | None, kind: CallKind) -> ReviewStatus:
    """Map one provider outcome onto a board status, for one kind of call.

    The kind is not decoration. DECLINED on a Check-in Call is the Patient hanging up,
    and ADR 0006 rests on that meaning. DECLINED on a Rebooking Call is the Practice's
    own switchboard rejecting us, which says nothing about the Patient at all: filing it
    as `declined` would tell staff she does not want these calls, about a call she was
    never on. Required rather than defaulted, so a new caller cannot silently inherit
    the Check-in Call's meaning. See docs/adr/0010.
    """
    if connected(outcome):
        return ReviewStatus.NEEDS_REVIEW
    if outcome in DECLINED:
        if kind is CallKind.REBOOKING:
            return ReviewStatus.NOT_REACHED
        return ReviewStatus.DECLINED
    if outcome in UNREACHED:
        return ReviewStatus.NOT_REACHED
    return ReviewStatus.NEEDS_REVIEW


def may_redial(outcome: str | None) -> bool:
    return outcome in RETRYABLE
