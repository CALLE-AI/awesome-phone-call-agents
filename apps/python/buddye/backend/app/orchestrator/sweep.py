"""Sweep lifecycle: opening one, the views a call is compiled from, and reading one back.

Everything here is the part of the sweep that is *not* the driver loop — creation, the two view
objects the contract needs, the second call the ladder is allowed to place, and the summary the API
and the trace both render. `runner.py` imports this; this imports nothing from `runner.py`.

The one idea worth stating out loud is `unaccounted()`. ShiftFill's run ended when somebody said
yes, and the candidates it never got to were simply not interesting. A BuddyE sweep ends when the
list is finished, and the people it did **not** reach are the output: Gerald never opted in, an
allowlist can stop a dial, a budget can run out mid-roster. Those are not gaps to be tidied away —
`unaccounted()` names every one of them with the reason, and the summary carries it next to the
outcomes so a captain closing the board can see who is still nobody's job.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.calls.contract import CallContract, HazardView, NeighbourView
from app.config import Settings
from app.domain.risk import RiskBand
from app.domain.state import (
    HazardStatus,
    SweepState,
    assert_hazard_transition,
)
from app.models import CheckCall, Escalation, HandoffPacket, Hazard, Neighbour, Sweep, utcnow

#: Outcomes that justify ringing the person a neighbour nominated.
#:
#: URGENT and UNREACHABLE only. NEEDS_HELP means we reached them and they accepted a water drop —
#: ringing their daughter about that would be telling a third party about someone's health because
#: the software found it convenient, and it is the sort of thing that gets a check-in programme
#: uninvited from the block. Those escalations open at the captain's board instead.
CONTACT_CALL_OUTCOMES: frozenset[str] = frozenset({"URGENT", "UNREACHABLE"})

_BAND_RANK: dict[RiskBand, int] = {RiskBand.ROUTINE: 0, RiskBand.ELEVATED: 1, RiskBand.HIGH: 2, RiskBand.CRITICAL: 3}


def band_at_least(band: RiskBand | str, minimum: RiskBand | str) -> bool:
    """Is `band` at or above `minimum`? Used for the responder-packet threshold."""
    try:
        return _BAND_RANK[RiskBand(str(band).lower())] >= _BAND_RANK[RiskBand(str(minimum).lower())]
    except (KeyError, ValueError):
        return True  # an unreadable band must not be the reason a packet is quietly not prepared


# ------------------------------------------------------------------------------------------------
# Views
# ------------------------------------------------------------------------------------------------
def hazard_view(hazard: Hazard, settings: Settings) -> HazardView:
    """The hazard as the call sees it. The captain's name comes from settings when the row is silent,
    because "your block captain" is a worse first sentence than "Alma Reyes"."""
    return HazardView.from_row(hazard, captain_name=hazard.declared_by or settings.BLOCK_CAPTAIN_NAME)


def neighbour_view(neighbour: Neighbour) -> NeighbourView:
    return NeighbourView.from_row(neighbour)


def load_roster(session: Session) -> list[Neighbour]:
    """Everyone on the captain's list, consent or no consent: triage scores the whole block and the
    board shows the whole block. `risk.call_order` is what decides who is dialled."""
    return list(session.exec(select(Neighbour).order_by(Neighbour.name)).all())


# ------------------------------------------------------------------------------------------------
# Opening a sweep
# ------------------------------------------------------------------------------------------------
def open_sweep(session: Session, hazard: Hazard, *, provider: str) -> tuple[Sweep, bool]:
    """Create the sweep, or return the one already running. `(sweep, created)`.

    Idempotent twice over: the app checks first, and a unique partial index on
    `sweep(hazard_id) WHERE is_active = 1` catches the double-click that gets past the check. A
    second sweep would dial fourteen people a second time, so this is worth both belts.
    """
    existing = session.exec(select(Sweep).where(Sweep.hazard_id == hazard.id, Sweep.is_active == True)).first()  # noqa: E712
    if existing is not None:
        return existing, False

    sweep = Sweep(hazard_id=hazard.id, provider=provider)
    session.add(sweep)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        existing = session.exec(select(Sweep).where(Sweep.hazard_id == hazard.id, Sweep.is_active == True)).first()  # noqa: E712
        if existing is None:
            raise
        return existing, False

    current = HazardStatus(hazard.status)
    if current is not HazardStatus.SWEEPING:
        assert_hazard_transition(current, HazardStatus.SWEEPING)
        hazard.status = HazardStatus.SWEEPING
        session.add(hazard)
    return sweep, True


# ------------------------------------------------------------------------------------------------
# The second call on the ladder
# ------------------------------------------------------------------------------------------------
def contact_contract(
    base: CallContract,
    *,
    hazard: HazardView,
    neighbour: NeighbourView,
    contact_name: str,
    contact_relation: str,
    outcome: str,
    finding: str,
) -> CallContract:
    """The call to the person a neighbour nominated, built from the neighbour's own contract.

    The schema is reused verbatim rather than invented: it already clears
    `assert_calle_schema_subset`, and the useful answers from a daughter are the same fields —
    did we reach her, is her mother safe, does she need something, what did she say. Only the task
    changes, because what you say to Elena is not what you say to Rosa.

    Three constraints are written into the task text and none of them are stylistic:
      * Say what we actually know and no more. "She hasn't answered twice this evening" is a fact;
        "we think something has happened" is a guess that sends a frightened person driving.
      * Never imply anyone has been dispatched. Nothing has been. Saying otherwise is the failure
        mode where a family stands down because they believe an ambulance is coming.
      * Do not recite the medical file. The contact is being asked to knock on a door, not briefed.
    """
    first = neighbour.first_name or neighbour.name
    relation = (contact_relation or "").strip()
    who = f"{neighbour.name}, their {relation}" if relation else neighbour.name
    headline = hazard.headline or hazard.kind.replace("_", " ")
    reason = {
        "UNREACHABLE": f"{first} has not answered our check-in calls this evening",
        "URGENT": f"{first} spoke to us and told us something that worried us",
    }.get(outcome, f"our check-in call to {first} did not settle that they are alright")

    task = (
        f"You are calling {contact_name} on behalf of the neighbourhood check-in programme run by "
        f"{hazard.captain_name or 'the block captain'} in {hazard.area or 'the neighbourhood'}. "
        f"{contact_name} is listed by {who} as the person to contact.\n\n"
        f"Say who you are in the first sentence and say who you are calling about, then say plainly why: "
        f"{reason}. The relevant hazard is: {headline}.\n\n"
        f"What we established on that call, and the only thing you may state as fact: {finding}\n\n"
        f"Then ask, in this order: (1) whether they have been in touch with {first} today, "
        f"(2) whether they are able to go and look in on {first} in person or send someone who can, and "
        f"(3) whether there is anything they want the block captain to know.\n\n"
        f"Rules you must not break. Do not speculate about what has happened — you know only what is "
        f"written above. Do not say or imply that an ambulance, the fire service, the police, or any "
        f"other emergency service has been called or is on its way: none has been, and nobody has been "
        f"sent. Do not read out {first}'s medical details or conditions; you are asking someone to knock "
        f"on a door, not briefing a clinician. If they ask you to call an ambulance, tell them honestly "
        f"that this programme cannot do that and that they should ring the emergency services themselves. "
        f"Keep it short, let them talk, and thank them."
    )
    objectives = [
        f"tell {contact_name} plainly why we are ringing",
        f"find out whether they have been in touch with {first} today",
        f"find out whether they can look in on {first} in person",
        "leave them with nothing they could mistake for a dispatch",
    ]
    # hard_fields is emptied deliberately: it means "the hazard makes this fact non-negotiable for
    # this person", and this call is not a check on the contact's own welfare. The runner does not
    # route a contact call through decide() at all.
    return base.model_copy(update={"task": task, "objectives": objectives, "hard_fields": []})


# ------------------------------------------------------------------------------------------------
# Reading a sweep back
# ------------------------------------------------------------------------------------------------
#: Why somebody with an UNKNOWN call is not rung again, by a sweep or from the case page.
OUTCOME_UNKNOWN_REASON = (
    "a call to them was attempted and its outcome is unknown (CALL-E may have created it and their phone "
    "may have rung); check the call in the CALL-E dashboard before calling them again"
)


def unknown_call_for(session: Session, *, neighbour_id: str, callee: str) -> CheckCall | None:
    """The call to this person whose outcome we could not establish, if there is one.

    Any hazard, any sweep: a second hazard over the same roster would otherwise ring them again with a
    fresh idempotency key while the first call may still be live.
    """
    return session.exec(select(CheckCall).where(
        CheckCall.neighbour_id == neighbour_id, CheckCall.callee == callee, CheckCall.status == "UNKNOWN",
    )).first()


def outcome_unknown_neighbours(session: Session, sweep_id: str) -> set[str]:
    rows = session.exec(select(CheckCall.neighbour_id).where(
        CheckCall.sweep_id == sweep_id, CheckCall.status == "UNKNOWN")).all()
    return {str(r) for r in rows}


def unaccounted(sweep: Sweep, roster: list[Neighbour],
                outcome_unknown: set[str] | frozenset[str] = frozenset()) -> list[dict[str, str]]:
    """Everyone on the roster this sweep has no outcome for, and why.

    Four reasons exist, and the difference between them matters to whoever picks the list up:
      * no consent — they opted out; nobody should knock either.
      * outcome unknown — we tried to call them and cannot tell whether their phone rang or what was
        said. Not a finding and not a skip: the sweep stopped on it (`outcome_unknown` is the set of
        neighbour ids with an UNKNOWN call; see `outcome_unknown_neighbours`).
      * not dialled — the sweep never got to them (budget, allowlist, or it is still running).
      * still running — the sweep is mid-roster and they are next.
    """
    outcomes = dict(sweep.outcomes or {})
    triage = dict(sweep.triage or {})
    order = list(sweep.call_order or [])
    done = SweepState(sweep.state) in {SweepState.COMPLETE, SweepState.BUDGET_EXHAUSTED, SweepState.FAILED}
    out: list[dict[str, str]] = []
    for nbr in roster:
        if nbr.id in outcomes:
            continue
        assessment = triage.get(nbr.id) or {}
        if not nbr.check_in_consent:
            reason = assessment.get("skip_reason") or "not opted in to automated check-in calls"
            kind = "no_consent"
        elif nbr.id in outcome_unknown:
            reason = OUTCOME_UNKNOWN_REASON
            kind = "outcome_unknown"
        elif nbr.id not in order:
            reason = "not in this sweep's call order"
            kind = "not_dialled"
        elif done:
            reason = "the sweep ended before reaching them"
            kind = "not_dialled"
        else:
            reason = "still to be called"
            kind = "still_running"
        out.append({"neighbour_id": nbr.id, "name": nbr.name, "kind": kind, "reason": reason})
    return out


def sweep_summary(session: Session, sweep: Sweep) -> dict[str, Any]:
    """Counts a captain reads at a glance, plus the people nobody has accounted for.

    Contains health facts by way of `triage`; callers redact at egress.
    """
    roster = load_roster(session)
    outcomes = dict(sweep.outcomes or {})
    tally: dict[str, int] = {}
    for value in outcomes.values():
        tally[str(value)] = tally.get(str(value), 0) + 1
    escalations = list(session.exec(select(Escalation).where(Escalation.sweep_id == sweep.id)).all())
    packets = list(session.exec(
        select(HandoffPacket).where(HandoffPacket.escalation_id.in_([e.id for e in escalations] or [""]))  # type: ignore[attr-defined]
    ).all())
    missing = unaccounted(sweep, roster, outcome_unknown_neighbours(session, sweep.id))
    return {
        "sweep_id": sweep.id,
        "hazard_id": sweep.hazard_id,
        "state": str(sweep.state),
        "is_active": sweep.is_active,
        "provider": sweep.provider,
        "roster_size": len(roster),
        "queued": len(sweep.call_order or []),
        "calls_made": sweep.calls_made,
        "current_index": sweep.current_index,
        "outcomes": outcomes,
        "outcome_counts": tally,
        "unaccounted": missing,
        "escalations_open": sum(1 for e in escalations if str(e.status) not in {"RESOLVED", "CANCELLED"}),
        "escalations": len(escalations),
        "handoffs_prepared": len(packets),
        "handoffs_released": sum(1 for p in packets if p.released_at is not None),
        "error": sweep.error,
        "created_at": sweep.created_at.isoformat() + "Z",
        "updated_at": sweep.updated_at.isoformat() + "Z",
        "completed_at": (sweep.completed_at.isoformat() + "Z") if sweep.completed_at else None,
    }


def calls_for_neighbour(session: Session, *, sweep_id: str, neighbour_id: str) -> list[CheckCall]:
    """Every dial made about this person in this sweep — theirs and their contact's.

    `build_handoff_packet` wants exactly this list: the packet's "we tried four times since two
    o'clock" comes from it, and leaving the contact's call out would understate what was done.
    """
    rows = session.exec(
        select(CheckCall).where(CheckCall.sweep_id == sweep_id, CheckCall.neighbour_id == neighbour_id)
    ).all()
    return sorted(rows, key=lambda c: (c.started_at or c.completed_at or utcnow()))
