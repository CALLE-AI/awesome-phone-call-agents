from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from ringdown.calls import CallSnapshot, Turn
from ringdown.extract import Extraction, normalise, recipient_turns
from ringdown.incident import Contact, Policy, first_name

Verdict = Literal["acknowledged", "declined", "not_acknowledged", "unknown"]


@dataclass(frozen=True)
class Grounded:
    disposition: bool
    owner: bool
    eta: bool


@dataclass(frozen=True)
class Assessment:
    verdict: Verdict
    reason: str


def ground_span(span: str, turns: Sequence[Turn]) -> bool:
    if not span:
        return False
    spoken = normalise(span)
    return any(spoken in normalise(turn.text) for turn in recipient_turns(turns))


def ground(extraction: Extraction, turns: Sequence[Turn]) -> Grounded:
    return Grounded(
        disposition=ground_span(extraction.disposition_span, turns),
        owner=ground_span(extraction.owner_span, turns),
        eta=ground_span(extraction.eta_span, turns),
    )


def confident(snapshot: CallSnapshot, policy: Policy) -> bool:
    return (
        snapshot.confidence_score is not None
        and snapshot.confidence_score >= policy.min_confidence
        and snapshot.confidence_label in policy.accepted_confidence_labels
    )


def classify(
    snapshot: CallSnapshot,
    extraction: Extraction,
    grounded: Grounded,
    contact: Contact,
    policy: Policy,
) -> Assessment:
    if snapshot.status != "completed":
        return Assessment("not_acknowledged", snapshot.failure_code or snapshot.status)
    if not confident(snapshot, policy):
        return Assessment("not_acknowledged", "low_confidence")
    if extraction.disposition == "declined" and grounded.disposition:
        return Assessment("declined", "")
    if snapshot.task_completed is not True:
        return Assessment("not_acknowledged", "task_not_completed")
    if extraction.disposition in ("unreachable", "wrong_person"):
        return Assessment("not_acknowledged", extraction.disposition)
    if extraction.eta_minutes is None:
        return Assessment("not_acknowledged", "no_eta")
    if not 1 <= extraction.eta_minutes <= policy.max_eta_minutes:
        return Assessment("not_acknowledged", "eta_out_of_range")
    if not grounded.eta:
        return Assessment("not_acknowledged", "ungrounded_eta")
    if extraction.disposition != "acknowledged":
        return Assessment("not_acknowledged", "unclear")
    if not grounded.disposition:
        return Assessment("not_acknowledged", "ungrounded_disposition")
    if extraction.owner_confirmed != first_name(contact):
        return Assessment("not_acknowledged", "owner_not_confirmed")
    if not grounded.owner:
        return Assessment("not_acknowledged", "ungrounded_owner")
    return Assessment("acknowledged", "")
