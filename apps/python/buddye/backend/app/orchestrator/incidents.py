"""Turning a bad check-in into something a coordinator can send a van to.

An `Escalation` is about **reaching a human being**: the daughter, the block captain, eventually a
responder. An `Incident` is about **sending resources to an address**. They are two different jobs
and this module is the join between them: every non-SAFE outcome that opened an escalation gets one
incident, carrying the neighbour's real coordinates, the needs `app.domain.fleet` derives from what
the call actually established, and a priority.

Three decisions here are deliberate.

**Reconciliation, not a callback.** `sync_sweep()` reads the escalations of a sweep and makes the
incident table agree with them. It is idempotent, keyed on `escalation_id`, and it can be run at any
time from anywhere — a poller, an API call, a demo reset, a test that has just awaited a sweep. The
alternative, hooking a listener onto the event bus, would have made "did the sweep produce
incidents?" a timing question, put database work (and possibly a 20-100 s model call) on the event
path that SSE clients read, and left a subscriber holding ids for rows a demo reset had just
deleted. A reconciler has none of those failure modes: run it twice and nothing happens the second
time. It is also why `app/orchestrator/runner.py` did not have to be touched.

**Priority never goes down.** An incident that is re-synced takes the graver of what it already had
and what the current record derives, and its needs are unioned rather than replaced. A coordinator
who raised an incident's priority by hand must not have it quietly lowered by a background pass, and
a need that was true five minutes ago does not stop being true because the second derivation had
less to work with.

**Silence raises its own case.** An escalation is the usual route in, but it is not the only one.
`open_for_call()` opens a deployment case straight off a `CheckCall` — no escalation required —
because the single most important thing this product learns is that a power-dependent neighbour did
not pick up the phone, and that finding must not depend on the ladder having got as far as writing a
row. The two routes cannot produce two vans for one house: `open_for_escalation` adopts an incident a
call already raised rather than opening a rival, and `sync_calls` stands down for any neighbour whose
escalation a human has cancelled, because that is a person saying stop.

**Coordinates are copied, not joined.** `Incident.lat/lon/address` are written from the neighbour
row at open time. Every distance, ETA and route in the operator layer is computed from them, so an
incident whose neighbour is later edited still describes the place a van was sent to. An incident
that somehow has no coordinates is opened anyway and `fleet.eligible` refuses to consider anybody
for it, loudly — better a visible incident nobody can be dispatched to than a silent one.

Privacy: `needs` and the summary are derived from health facts about a named person. They are stored
because that is what makes them useful to a coordinator, and redacted at egress by the API.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Iterable

from sqlmodel import Session, select

from app import obs
from app.domain import fleet
from app.domain.fleet import DEFAULT_PRIORITY
from app.domain.state import (
    CheckOutcome,
    DispatchStatus,
    IllegalTransition,
    IncidentStatus,
    assert_incident_transition,
)
from app.events.bus import bus
from app.models import CheckCall, Escalation, Hazard, Incident, Neighbour, Sweep, utcnow

log = logging.getLogger("buddye.incidents")

#: Escalation statuses that no longer describe an open piece of work. An escalation cancelled before
#: anybody looked at it never becomes an incident.
DEAD_ESCALATIONS: frozenset[str] = frozenset({"CANCELLED"})

#: Incident statuses past which a sync no longer edits the row: a coordinator has closed it, handed
#: it to an agency, or cancelled it, and a background pass must not reopen that decision.
SETTLED: frozenset[IncidentStatus] = frozenset(
    {IncidentStatus.RESOLVED, IncidentStatus.HANDED_OFF, IncidentStatus.CANCELLED}
)


class IncidentRefused(RuntimeError):
    """An incident transition a human asked for that the record does not permit."""


# ------------------------------------------------------------------------------------------------
# Reading the record behind one escalation
# ------------------------------------------------------------------------------------------------
def _trigger_call(session: Session, escalation: Escalation) -> CheckCall | None:
    """The call that produced this finding, or the last call we made to this person on this sweep.

    The trigger id is the honest answer; the fallback exists because a resumed driver can open an
    escalation whose trigger call id was written by a previous process, and an incident with no
    structured result at all would derive a much emptier need set than the record supports.
    """
    if escalation.trigger_call_id:
        call = session.get(CheckCall, escalation.trigger_call_id)
        if call is not None:
            return call
    rows = list(
        session.exec(
            select(CheckCall).where(
                CheckCall.sweep_id == escalation.sweep_id,
                CheckCall.neighbour_id == escalation.neighbour_id,
                CheckCall.callee == "neighbour",
            )
        ).all()
    )
    return rows[-1] if rows else None


def _risk_snapshot(session: Session, escalation: Escalation, call: CheckCall | None) -> dict[str, Any]:
    """What triage concluded about this person under this hazard, as `RiskAssessment.to_dict()`.

    Read off the call first: that is the assessment as it stood when they were dialled, which is the
    one the escalation was opened against. `Sweep.triage` is the same data and is the fallback.
    """
    if call is not None and call.risk_snapshot:
        return dict(call.risk_snapshot)
    sweep = session.get(Sweep, escalation.sweep_id)
    if sweep is not None:
        snapshot = (sweep.triage or {}).get(escalation.neighbour_id)
        if isinstance(snapshot, dict):
            return dict(snapshot)
    return {}


def situation_for(session: Session, incident: Incident) -> dict[str, Any]:
    """Everything the dispatch agent is allowed to reason from, in the record's own words.

    Verbatim quotes and concerns come straight off the `CheckCall`; nothing here is paraphrased and
    nothing is invented. This is the payload that leaves the process, so the caller redacts it.
    """
    nbr = session.get(Neighbour, incident.neighbour_id)
    esc = session.get(Escalation, incident.escalation_id) if incident.escalation_id else None
    call = session.get(CheckCall, incident.source_call_id) if incident.source_call_id else None
    risk = _risk_snapshot(session, esc, call) if esc is not None else {}
    return {
        "name": nbr.name if nbr else incident.neighbour_id,
        "address": incident.address,
        "unit": nbr.unit if nbr else "",
        "access_notes": nbr.access_notes if nbr else "",
        "age_band": nbr.age_band if nbr else "unknown",
        "lives_alone": bool(nbr.lives_alone) if nbr else None,
        "conditions": list(nbr.conditions or []) if nbr else [],
        "power_dependent": bool(nbr.power_dependent) if nbr else None,
        "power_backup_hours": float(nbr.power_backup_hours) if nbr else 0.0,
        "cooling": nbr.cooling if nbr else "unknown",
        "mobility": nbr.mobility if nbr else "unknown",
        "has_transport": bool(nbr.has_transport) if nbr else None,
        "preferred_language": nbr.preferred_language if nbr else "",
        "outcome": incident.outcome,
        "band": str(risk.get("band") or ""),
        "time_to_harm_h": risk.get("time_to_harm_h"),
        "what_they_said": list(call.concerns or []) if call else [],
        "call_summary": (call.summary or "") if call else "",
        "structured_result": dict(call.structured_result or {}) if call and call.structured_result else {},
        "finding": incident.summary,
    }


def risk_reasons_for(session: Session, incident: Incident) -> list[str]:
    """Why triage put this person where it did — the sentences the captain's board already shows."""
    esc = session.get(Escalation, incident.escalation_id) if incident.escalation_id else None
    if esc is None:
        return []
    call = session.get(CheckCall, incident.source_call_id) if incident.source_call_id else None
    return [str(r) for r in (_risk_snapshot(session, esc, call).get("reasons") or [])]


def findings_for(session: Session, incident: Incident) -> list[str]:
    """What the call established, as sentences. Used as the grounds for an agency request, so it is
    the record and only the record: the escalation's reason, plus the neighbour's own concerns."""
    out: list[str] = []
    if incident.summary:
        out.append(incident.summary)
    call = session.get(CheckCall, incident.source_call_id) if incident.source_call_id else None
    if call is not None:
        out.extend(str(c) for c in (call.concerns or []))
    return [s for s in out if s.strip()]


def needs_for_escalation(session: Session, escalation: Escalation) -> tuple[fleet.NeedSet, CheckCall | None]:
    """The need set for one escalation, derived from the call and the triage behind it."""
    call = _trigger_call(session, escalation)
    nbr = session.get(Neighbour, escalation.neighbour_id)
    risk = _risk_snapshot(session, escalation, call)
    needs = fleet.needs_for(
        outcome=escalation.outcome,
        result=(call.structured_result if call is not None else None),
        risk=risk,
        neighbour=nbr,
    )
    return needs, call


# ------------------------------------------------------------------------------------------------
# Opening and updating
# ------------------------------------------------------------------------------------------------
def incident_for_escalation(session: Session, escalation_id: str) -> Incident | None:
    return session.exec(select(Incident).where(Incident.escalation_id == escalation_id)).first()


def incident_for_neighbour(session: Session, sweep_id: str, neighbour_id: str) -> Incident | None:
    """The case already standing for this person on this sweep, whatever raised it.

    One address, one incident. Both routes in — the escalation and the unanswered call — look here
    first, because two incidents for one house means two vans and the second one is taken from
    somebody who has none. Prefers a live incident over a settled one: a coordinator who closed
    this evening's case and then got a second bad call should get a new case, not a reopened one.
    """
    rows = list(
        session.exec(
            select(Incident).where(Incident.sweep_id == sweep_id, Incident.neighbour_id == neighbour_id)
            .order_by(Incident.opened_at)
        ).all()
    )
    live = [i for i in rows if IncidentStatus(i.status) not in SETTLED]
    return live[-1] if live else None


def open_for_escalation(session: Session, escalation: Escalation) -> tuple[Incident | None, bool]:
    """Ensure one incident exists for one escalation. Returns `(incident, created)`.

    Idempotent by `escalation_id`. A second call updates the needs and the priority of the row that
    is already there rather than opening a rival incident for the same address — two incidents for
    one house means two vans, and the second one is taken from somebody who has none.
    """
    if str(escalation.status) in DEAD_ESCALATIONS:
        return None, False
    try:
        outcome = CheckOutcome(str(escalation.outcome))
    except ValueError:
        outcome = None
    if outcome is CheckOutcome.SAFE:
        # Nothing to send. An escalation is never opened for SAFE, so this only fires if a row was
        # written by hand, and refusing quietly is better than dispatching a van to somebody fine.
        return None, False

    needs, call = needs_for_escalation(session, escalation)
    nbr = session.get(Neighbour, escalation.neighbour_id)
    existing = incident_for_escalation(session, escalation.id)
    if existing is not None:
        return _refresh(session, existing, needs=needs, call=call), False

    # Adoption, not a second incident. `open_for_call` may already have raised this address from the
    # unanswered call itself, seconds before the ladder finished writing its escalation. Taking that
    # row over — and stamping the escalation onto it — is what keeps "one house, one van" true while
    # still letting silence raise a case without waiting for anybody.
    orphan = incident_for_neighbour(session, escalation.sweep_id, escalation.neighbour_id)
    if orphan is not None and not orphan.escalation_id:
        orphan.escalation_id = escalation.id
        return _refresh(session, orphan, needs=needs, call=call), False

    incident = Incident(
        hazard_id=escalation.hazard_id,
        sweep_id=escalation.sweep_id,
        neighbour_id=escalation.neighbour_id,
        escalation_id=escalation.id,
        source_call_id=call.id if call is not None else None,
        status=IncidentStatus.OPEN,
        priority=needs.priority,
        outcome=str(escalation.outcome),
        summary=escalation.reason or "",
        needs=list(needs),
        # Copied, not joined: what a van was sent to is what was true when it was sent.
        lat=float(nbr.lat) if nbr else 0.0,
        lon=float(nbr.lon) if nbr else 0.0,
        address=(nbr.address if nbr else ""),
    )
    session.add(incident)
    session.flush()
    if not (incident.lat or incident.lon):
        # Visible, not swallowed. fleet.eligible refuses to consider anybody for an unlocated
        # incident, and a coordinator has to be told why rather than shown an empty candidate list.
        log.warning("incident %s opened with no coordinates (neighbour=%s)", incident.id, incident.neighbour_id)
    return incident, True


def _refresh(session: Session, incident: Incident, *, needs: fleet.NeedSet, call: CheckCall | None,
             relink: bool = False) -> Incident:
    """Bring a stored incident up to date with the record, without ever making it less urgent.

    `relink` re-points `source_call_id` at a call that is newer than the one on the row. Off by
    default, because the escalation route's call is the one the incident was opened against; on when
    a fresh call to the same person is itself the reason we are here, so that an open case always
    quotes the last thing we actually know.
    """
    if IncidentStatus(incident.status) in SETTLED:
        return incident
    merged = list(dict.fromkeys([*(incident.needs or []), *needs.capabilities]))
    incident.needs = sorted(merged, key=lambda c: fleet.CAPABILITY_ORDER.index(c)
                            if c in fleet.CAPABILITY_ORDER else 99)
    incident.priority = min(int(incident.priority or fleet.DEFAULT_PRIORITY), needs.priority)
    if call is not None and (relink or not incident.source_call_id):
        incident.source_call_id = call.id
    session.add(incident)
    return incident


def open_for_call(session: Session, call: CheckCall) -> tuple[Incident | None, bool]:
    """Raise a deployment case from one finished call, with no escalation in the loop.

    This is the path that makes silence actionable on its own. A `CheckCall` that ended UNREACHABLE
    is, for a neighbour whose oxygen concentrator is plugged into a wall socket during a blackout,
    the most important thing this system will learn all evening — and it must become an address
    somebody can be sent to whether or not the ladder got as far as opening an escalation, whether
    or not the sweep driver survived the next second, and whether or not anybody is watching.

    Returns `(incident, created)`. Idempotent by neighbour and sweep, like every other route in.
    Refuses SAFE, and refuses a call to an emergency contact: what a daughter said about her mother
    is not a welfare finding about the daughter, and it is the neighbour's own call that carries the
    outcome and the risk snapshot this is derived from.
    """
    if call.callee != "neighbour":
        return None, False
    try:
        outcome = CheckOutcome(str(call.outcome))
    except ValueError:
        return None, False  # a call with no decision yet is not a finding
    if outcome is CheckOutcome.SAFE:
        return None, False

    nbr = session.get(Neighbour, call.neighbour_id)
    needs = fleet.needs_for(
        outcome=outcome.value,
        result=call.structured_result,
        risk=dict(call.risk_snapshot or {}),
        neighbour=nbr,
    )
    existing = incident_for_neighbour(session, call.sweep_id, call.neighbour_id)
    if existing is not None:
        return _refresh(session, existing, needs=needs, call=call, relink=True), False

    incident = Incident(
        hazard_id=call.hazard_id,
        sweep_id=call.sweep_id,
        neighbour_id=call.neighbour_id,
        escalation_id=None,  # stamped later if the ladder catches up; see open_for_escalation
        source_call_id=call.id,
        status=IncidentStatus.OPEN,
        priority=needs.priority,
        outcome=outcome.value,
        summary=call.outcome_reason or _summary_for(outcome, nbr),
        needs=list(needs),
        lat=float(nbr.lat) if nbr else 0.0,
        lon=float(nbr.lon) if nbr else 0.0,
        address=(nbr.address if nbr else ""),
    )
    session.add(incident)
    session.flush()
    if not (incident.lat or incident.lon):
        log.warning("incident %s opened with no coordinates (neighbour=%s)", incident.id, incident.neighbour_id)
    return incident, True


def _summary_for(outcome: CheckOutcome, nbr: Neighbour | None) -> str:
    """The one line a coordinator reads when the decision layer left no reason on the row.

    Only ever states what the record supports: that nobody answered, and — because it changes what
    the silence means and how fast somebody has to go — that this person's equipment runs off wall
    power. Never a diagnosis, never a guess about why.
    """
    who = nbr.name if nbr else "this neighbour"
    if outcome is CheckOutcome.UNREACHABLE:
        if nbr is not None and nbr.power_dependent:
            return f"{who} did not answer, and depends on equipment that runs on wall power"
        return f"{who} did not answer the check-in call"
    return f"the check-in call to {who} ended {outcome.value}"


def sync_calls(session: Session, sweep_id: str) -> list[Incident]:
    """Open a case for every finished call this sweep has no incident for. Returns the new ones.

    The safety net under the escalation reconciler, and it is written to defer rather than to
    duplicate. Two neighbours are deliberately skipped:

      * anyone who already has a live escalation — that is `open_for_escalation`'s row to write, and
        it runs first, so by the time this pass looks there is nothing to do;
      * anyone whose every escalation has been CANCELLED. A human looked at that finding and said
        stop, and a background pass that raises the same address again two seconds later is not
        persistence, it is overruling the person in charge.

    What is left is the case this exists for: a call that ended badly and that nothing has picked up.
    """
    calls = list(
        session.exec(
            select(CheckCall).where(CheckCall.sweep_id == sweep_id, CheckCall.callee == "neighbour")
            .order_by(CheckCall.started_at)  # type: ignore[arg-type]
        ).all()
    )
    escalations: dict[str, list[Escalation]] = {}
    for esc in session.exec(select(Escalation).where(Escalation.sweep_id == sweep_id)).all():
        escalations.setdefault(esc.neighbour_id, []).append(esc)

    opened: list[Incident] = []
    for call in calls:
        theirs = escalations.get(call.neighbour_id, [])
        if theirs:
            continue  # live or cancelled, the escalation record owns this person
        incident, created = open_for_call(session, call)
        if created and incident is not None:
            opened.append(incident)
    session.flush()
    return opened


def sync_sweep(session: Session, sweep_id: str) -> list[Incident]:
    """Make the incident table agree with the escalations of one sweep. Returns the ones it opened.

    The correctness path for the whole operator layer, and safe to call from anywhere at any time.
    """
    escalations = list(
        session.exec(select(Escalation).where(Escalation.sweep_id == sweep_id).order_by(Escalation.created_at)).all()
    )
    opened: list[Incident] = []
    for esc in escalations:
        incident, created = open_for_escalation(session, esc)
        if created and incident is not None:
            opened.append(incident)
    session.flush()
    # Escalations first, then the calls nothing picked up. That order is what makes the two routes
    # agree: by the time `sync_calls` looks, every escalation already has its incident, so the only
    # thing left for it to open is a finding the ladder never wrote down.
    opened.extend(sync_calls(session, sweep_id))
    session.flush()
    return opened


def sync_hazard(session: Session, hazard_id: str) -> list[Incident]:
    escalations = list(
        session.exec(select(Escalation).where(Escalation.hazard_id == hazard_id).order_by(Escalation.created_at)).all()
    )
    opened: list[Incident] = []
    for esc in escalations:
        incident, created = open_for_escalation(session, esc)
        if created and incident is not None:
            opened.append(incident)
    session.flush()
    for sweep in session.exec(select(Sweep).where(Sweep.hazard_id == hazard_id)).all():
        opened.extend(sync_calls(session, sweep.id))
    session.flush()
    return opened


def event_payload(incident: Incident) -> dict[str, Any]:
    """The announcement for one incident, as plain data.

    Built inside the session that holds the row and handed to `announce` afterwards, because a
    SQLModel row read after its session has committed has expired attributes.
    """
    return {
        "hazard_id": incident.hazard_id,
        "sweep_id": incident.sweep_id,
        "neighbour_id": incident.neighbour_id,
        "incident_id": incident.id,
        "escalation_id": incident.escalation_id,
        # The call this case came from. It is what lets a notification about a deployment take a
        # coordinator back to the conversation (or the silence) that produced it.
        "source_call_id": incident.source_call_id,
        "outcome": incident.outcome,
        "priority": incident.priority,
        "priority_label": fleet.priority_label(incident.priority),
        "needs": list(incident.needs or []),
        "address": incident.address,
        "lat": incident.lat,
        "lon": incident.lon,
        "summary": incident.summary,
        "status": str(incident.status),
    }


def announce(payloads: Iterable[dict[str, Any]]) -> None:
    """Put newly opened incidents on the event bus, so a board already watching sees them appear.

    Called after the session that created them has committed: an event announcing a row that a
    rollback then removed is worse than an event that arrives a moment late.
    """
    for payload in payloads:
        bus.publish(
            hazard_id=payload["hazard_id"],
            sweep_id=payload.get("sweep_id"),
            neighbour_id=payload.get("neighbour_id"),
            type="incident.opened",
            payload=obs.redact(dict(payload)),
        )


# ------------------------------------------------------------------------------------------------
# Transitions a human drives
# ------------------------------------------------------------------------------------------------
def mark_triaged(session: Session, incident: Incident) -> Incident:
    """OPEN -> TRIAGED. Called the moment needs and a priority have been put against the incident.

    `INCIDENT_TRANSITIONS` has no OPEN -> DISPATCHED edge, and that is correct rather than an
    oversight: nothing is committed to an address that nobody has decided what to send to.
    """
    if IncidentStatus(incident.status) is IncidentStatus.OPEN:
        assert_incident_transition(IncidentStatus.OPEN, IncidentStatus.TRIAGED)
        incident.status = IncidentStatus.TRIAGED
        session.add(incident)
    return incident


def mark_dispatched(session: Session, incident: Incident) -> Incident:
    """TRIAGED -> DISPATCHED, stepping through TRIAGED when the caller has not already."""
    mark_triaged(session, incident)
    if IncidentStatus(incident.status) is IncidentStatus.TRIAGED:
        assert_incident_transition(IncidentStatus.TRIAGED, IncidentStatus.DISPATCHED)
        incident.status = IncidentStatus.DISPATCHED
        session.add(incident)
    return incident


def resolve(session: Session, incident: Incident, *, resolved_by: str, resolution: str = "") -> Incident:
    """Close an incident. Requires the name of the person who decided this address is accounted for.

    The same rule as `escalate.resolve` and for the same reason: "resolved" with nobody's name on it
    is a row that says somebody checked when nobody did.
    """
    who = " ".join(str(resolved_by or "").split())
    if not who or not any(ch.isalpha() for ch in who):
        raise IncidentRefused("resolving an incident requires the name of the person closing it")
    current = IncidentStatus(incident.status)
    if current is IncidentStatus.RESOLVED:
        return incident
    try:
        assert_incident_transition(current, IncidentStatus.RESOLVED)
    except IllegalTransition as exc:
        raise IncidentRefused(str(exc)) from exc
    incident.status = IncidentStatus.RESOLVED
    incident.resolved_at = utcnow()
    incident.resolution = f"{resolution.strip()} — closed by {who}".strip(" —") if resolution.strip() else f"closed by {who}"
    session.add(incident)
    return incident


# ------------------------------------------------------------------------------------------------
# Liveness
# ------------------------------------------------------------------------------------------------
def hazard_of(session: Session, incident: Incident) -> Hazard | None:
    return session.get(Hazard, incident.hazard_id)


def sync_all_active() -> list[str]:
    """Reconcile every sweep that is still live. Returns the ids of the incidents it opened.

    Worst first. The order matters more than it looks: the fleet is finite, and whoever is offered
    a proposal first gets first pick of it. Reconciling in the order escalations happened to be
    written would hand the nearest nurse to a routine water drop because that call finished a few
    seconds earlier.
    """
    from app.db import session_scope

    with session_scope() as s:
        sweeps = list(s.exec(select(Sweep).where(Sweep.is_active == True)).all())  # noqa: E712
        opened: list[Incident] = []
        for sweep in sweeps:
            opened.extend(sync_sweep(s, sweep.id))
        s.flush()
        opened.sort(key=lambda i: (int(i.priority or DEFAULT_PRIORITY), i.opened_at))
        payloads = [event_payload(i) for i in opened]
    announce(payloads)
    return [p["incident_id"] for p in payloads]


def stalled_incidents() -> list[str]:
    """Open incidents that nothing has been sent to, and for which somebody could now go.

    An incident that arrived when every van was out gets no proposal, and without this it would
    stay that way for the rest of the evening — the coordinator would be looking at an address with
    "no unit available" written against it while two units sat idle back at base. The fleet check
    here is the deterministic one and costs nothing, so an incident nobody can serve is retried for
    free and never reaches a model; one that has become servable is picked up on the next pass.

    Worst first, for the same reason `sync_all_active` is.
    """
    from app.db import session_scope
    from app.models import Dispatch
    from app.orchestrator import dispatch as dispatcher  # lazy: dispatch imports this module

    live = {DispatchStatus.PROPOSED, DispatchStatus.COMMITTED, DispatchStatus.EN_ROUTE,
            DispatchStatus.ARRIVED, DispatchStatus.COMPLETED}
    with session_scope() as s:
        busy: set[str] = set()
        for d in s.exec(select(Dispatch)).all():
            # A declined dispatch settles the incident as far as the autopilot is concerned. A human
            # said no; asking again two seconds later is not persistence, it is nagging somebody who
            # has already made a decision, and it would make the decline button useless. A
            # coordinator who changes their mind proposes again from the incident page.
            if DispatchStatus(d.status) in live or d.decline_reason:
                busy.add(d.incident_id)
        waiting = [
            i for i in s.exec(select(Incident)).all()
            if IncidentStatus(i.status) in {IncidentStatus.OPEN, IncidentStatus.TRIAGED}
            and i.id not in busy
        ]
        waiting.sort(key=lambda i: (int(i.priority or DEFAULT_PRIORITY), i.opened_at))
        return [i.id for i in waiting if dispatcher.eligibility_for(s, i).candidates]


async def sync_loop(*, interval_s: float = 2.0, auto_dispatch: bool = True) -> None:
    """The liveness path: reconcile active sweeps, and start the operator layer on what it finds.

    A loop rather than a subscription because the incident table is derived state — running it again
    is free, and a missed tick costs a couple of seconds rather than an incident that never existed.
    A fault here must never stop the loop: the calls are the product, and this is a view of them.
    """
    from app.orchestrator import dispatch as dispatcher

    while True:
        try:
            for incident_id in await asyncio.to_thread(sync_all_active):
                # Serialised on purpose. With a model configured each of these is a 20-100 s call on
                # a free tier, and firing fourteen at once would rate-limit every one of them; a
                # coordinator would rather have proposals arrive in priority order.
                if auto_dispatch:
                    await dispatcher.auto_dispatch(incident_id)
            if auto_dispatch:
                # And the backlog: an address that got nothing because the fleet was out, now that a
                # van has finished somewhere else. Free when nothing is available — the check is the
                # deterministic filter, and a model is only asked once somebody can actually go.
                for incident_id in await asyncio.to_thread(stalled_incidents):
                    await dispatcher.auto_dispatch(incident_id)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("incident sync failed")
        await asyncio.sleep(interval_s)
