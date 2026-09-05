"""Running a case: one hop at a time, persisted after each.

The runner is the only place that both talks to a call placer and writes the
case file. Everything it decides comes from :mod:`runaround.chain`, so the
decision logic stays testable without a placer at all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from runaround import chain, schema
from runaround.calle_client import (
    CallEClient,
    build_create_call_body,
    extract_structured_result,
    idempotency_key,
)
from runaround.case import Case, Hop, save_case
from runaround.prompt import build_task_text

RUNNABLE_STATES = frozenset({"open", chain.CHAIN_CONTINUE})


class RunRefused(RuntimeError):
    """Raised when the case may not place a call right now."""


class CallPlacer(Protocol):
    """Places one call and returns a CALL-E call task object."""

    def place(
        self, *, body: dict[str, Any], key: str, destination: str
    ) -> dict[str, Any]: ...


@dataclass
class FixturePlacer:
    """Returns scripted call tasks. Places no call and needs no credential.

    The fixture file maps an E.164 destination to a CALL-E call task object.
    This is the default mode: a run that has not been explicitly asked to
    call a person does not call a person.
    """

    scripts: dict[str, Any]

    @staticmethod
    def from_file(path: Path) -> FixturePlacer:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return FixturePlacer(scripts=data.get("calls", data))

    def place(
        self, *, body: dict[str, Any], key: str, destination: str
    ) -> dict[str, Any]:
        if destination not in self.scripts:
            return {
                "id": f"call_fixture_missing_{key[-8:]}",
                "status": "failed",
                "failure_code": "no_fixture",
                "failure_message": (
                    f"no scripted call for {destination}; the fixture does not "
                    "claim to know what this desk would say"
                ),
                "structured_result": None,
                "recipients": [],
            }
        call = dict(self.scripts[destination])
        call.setdefault("id", f"call_fixture_{key[-8:]}")
        return call


@dataclass
class LivePlacer:
    """Places a real CALL-E call. Every use of this rings a real telephone."""

    client: CallEClient

    def place(
        self, *, body: dict[str, Any], key: str, destination: str
    ) -> dict[str, Any]:
        return self.client.place_hop(body=body, key=key)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def plan_hop(case: Case) -> dict[str, Any]:
    """Return the exact request that the next hop would send. Sends nothing."""
    desk = case.next_desk()
    if desk is None:
        raise RunRefused(
            f"case {case.case_id} is {case.status}: {case.status_reason}"
        )
    task_text = build_task_text(
        desk=desk,
        subject=case.subject,
        question=case.question,
        requester_name=case.requester_name,
        history=case.history(),
    )
    body = build_create_call_body(
        task_text=task_text,
        desk_phone=desk.phone,
        region=desk.region or case.region,
        locale=case.locale,
        metadata={"case_id": case.case_id, "hop_index": case.hops_used() + 1},
    )
    key = idempotency_key(
        case_id=case.case_id,
        hop_index=case.hops_used() + 1,
        destination=desk.phone,
    )
    # Only the destination is masked. The result schema carries its own
    # example number in a field description, and blanket string replacement
    # would rewrite that too, making the preview disagree with the request
    # that is actually sent.
    masked_body = dict(body)
    masked_body["task"] = body["task"].replace(desk.phone, desk.masked())
    masked_body["recipients"] = [
        {**recipient, "phones": [desk.masked()]}
        for recipient in body["recipients"]
    ]
    return {
        "destination": desk.masked(),
        "desk_name": desk.name,
        "idempotency_key": key,
        "method": "POST",
        "path": "/v1/calls",
        "body": masked_body,
    }


def run_hop(
    *,
    case: Case,
    placer: CallPlacer,
    data_dir: Path,
) -> Hop:
    """Place exactly one call, record it, and set the case status.

    Returns the hop that was recorded. Raises :class:`RunRefused` when the
    case is in a state that may not call anyone.
    """
    if case.status not in RUNNABLE_STATES:
        raise RunRefused(
            f"case {case.case_id} is {case.status}: {case.status_reason}"
        )
    desk = case.next_desk()
    if desk is None:
        raise RunRefused(f"case {case.case_id} has no authorized next desk")

    hop_index = case.hops_used() + 1
    if hop_index > case.hop_budget:
        case.status = chain.CHAIN_BUDGET_EXHAUSTED
        case.status_reason = (
            f"the hop budget of {case.hop_budget} is spent before this call"
        )
        save_case(data_dir, case)
        raise RunRefused(case.status_reason)

    authorized_by = (
        "intake" if desk.identity() in set(case.intake_identities) else "approval"
    )
    hop = Hop(
        index=hop_index,
        desk=desk,
        authorized_by=authorized_by,
        started_at=_now(),
    )
    # The hop is written before the call so an interrupted run shows a call
    # that may have happened, rather than no record at all.
    case.hops.append(hop)
    case.pending_desk = None
    save_case(data_dir, case)

    task_text = build_task_text(
        desk=desk,
        subject=case.subject,
        question=case.question,
        requester_name=case.requester_name,
        history=case.history()[:-1],
    )
    body = build_create_call_body(
        task_text=task_text,
        desk_phone=desk.phone,
        region=desk.region or case.region,
        locale=case.locale,
        metadata={"case_id": case.case_id, "hop_index": hop_index},
    )
    key = idempotency_key(
        case_id=case.case_id, hop_index=hop_index, destination=desk.phone
    )

    call = placer.place(body=body, key=key, destination=desk.phone)
    hop.call_id = call.get("id")
    hop.call_status = str(call.get("status", "failed"))

    raw_result = extract_structured_result(call)
    rejection: str | None = None
    normalized: dict[str, Any] | None = None
    if hop.call_status == "completed":
        try:
            normalized = schema.validate_hop_result(raw_result)
        except schema.ResultRejected as error:
            rejection = str(error)

    verdict = chain.classify_hop(
        call_status=hop.call_status,
        result=normalized,
        rejection=rejection,
    )
    hop.outcome = verdict.outcome
    hop.reason = verdict.reason
    hop.answer = verdict.answer
    hop.reference_number = verdict.reference_number
    hop.referral = verdict.referral.to_dict() if verdict.referral else None

    decision = chain.decide_next(
        verdict=verdict,
        current=desk,
        visited=case.visited_desks(),
        requester_phone=case.requester_phone,
        hop_budget=case.hop_budget,
        hops_used=case.hops_used(),
        authorized_identities=case.authorized_identities(),
        auto_dial_referrals=False,
    )
    case.status = decision.state
    case.status_reason = decision.reason
    case.pending_desk = decision.next_desk
    case.loop_path = decision.loop_path
    save_case(data_dir, case)
    return hop


def run_chain(
    *,
    case: Case,
    placer: CallPlacer,
    data_dir: Path,
    max_hops: int | None = None,
) -> list[Hop]:
    """Run hops until the chain stops asking for another call.

    The loop ends on a terminal state, on an approval gate, on a suspected
    loop, or on the hop budget. It never ends because it ran out of patience.
    """
    placed: list[Hop] = []
    limit = max_hops if max_hops is not None else case.hop_budget
    while len(placed) < limit and case.status in RUNNABLE_STATES:
        placed.append(run_hop(case=case, placer=placer, data_dir=data_dir))
    return placed
