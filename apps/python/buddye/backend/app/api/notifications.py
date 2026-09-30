"""What the console pings about, and where each ping takes you.

The console is one flow, not five dashboards: something happens, it appears on screen, you click it
and you are on the page where you can do something about it. This module is the first half of that
sentence — the feed — and the `route` on every notification is the second half. A notification the
operator cannot act on from one click is a notification that should not have interrupted them.

**Nothing here writes a notification.** There is no notification table and no `notify()` call
sprinkled through the orchestrator. Every ping is *derived* from rows that already exist because
something really happened: an `AgentEvent` published by the sweep driver, the escalation ladder, the
dispatcher or the movement simulator, joined against the `Incident` and `Neighbour` it refers to.
That is a deliberate structural choice rather than a shortcut, and it buys three things:

* **A notification cannot lie.** It has no independent existence, so there is no state to drift out
  of agreement with the record. If the feed says Walter did not answer, there is a `check.decided`
  event and a `CheckCall` row behind it.
* **Replay is free.** The event log already survives a restart and already replays over SSE by id, so
  a laptop that slept catches up on what it missed without a second mechanism.
* **Adding a source is a derivation, not a migration.** `NOTIFY_TYPES` is the whole contract.

Read state is the one thing that is not derivable, and it goes back onto the same event log as a
`notification.read` receipt rather than into a new table — so a captain who dismisses a ping on the
laptop sees it dismissed on the tablet, and the audit trail records that somebody saw it.

Two rules about the words themselves. A headline **names the person**, because "1 new alert" is not
information and this is a product about individuals. And a prepared agency request is never described
as sent: `dispatch.awaiting_authorisation` reads "prepared … nobody has been asked", which is what
`app/domain/state.py::requires_authorisation` actually guarantees.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app import obs
from app.db import session_scope
from app.domain import fleet
from app.domain.state import CheckOutcome
from app.events.bus import bus
from app.models import AgentEvent, Hazard, Incident, Neighbour

log = logging.getLogger("buddye.notifications")

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

#: The event types the console pings about. Everything else on the stream is detail a page renders
#: when it is open; these are the six things worth taking somebody's attention for.
NOTIFY_TYPES: tuple[str, ...] = (
    "hazard.declared",                 # a hazard was declared over the block
    "sweep.triaged",                   # triage flagged people as high risk — one ping per person
    "check.decided",                   # a call finished with a non-safe outcome
    "incident.opened",                 # a deployment case exists for an address
    "dispatch.awaiting_authorisation",  # an agency unit is prepared and unsent, pending a human
    "asset.arrived",                   # somebody is at the door
)

#: The receipt type. Rides the same event log as everything else, so read state replays and is
#: shared between every console watching this hazard.
READ_EVENT = "notification.read"

#: What the bus tap republishes so a notification lands on an open console without a poll.
PUSH_EVENT = "notification"

#: How far back an unread count looks. Fixed rather than tied to the caller's page size, so the
#: badge on the console does not change meaning when a page is asked for ten rows instead of sixty.
UNREAD_WINDOW = 300

#: Triage bands worth interrupting for. ELEVATED and ROUTINE are the board, not a ping.
FLAG_BANDS = {"critical": 1, "high": 2}

#: Severity is what the UI colours by; priority maps onto the p1..p5 incident tokens the console
#: already uses, so a ping and the incident it points at cannot be shown in two different colours.
SEVERITY_BY_PRIORITY = {1: "critical", 2: "critical", 3: "warning", 4: "info", 5: "info"}

_HAZARD_PRIORITY = {"emergency": 1, "warning": 2, "watch": 3, "advisory": 4}

#: How a non-safe check-in reads on a captain's screen, and how loudly. UNREACHABLE sits at the top
#: with URGENT on purpose: a call you answered tells us what is wrong, and silence does not.
_OUTCOME_LINE: dict[str, tuple[str, int]] = {
    CheckOutcome.UNREACHABLE.value: ("{name} did not answer", 1),
    CheckOutcome.URGENT.value: ("{name} needs help right now", 1),
    CheckOutcome.NEEDS_HELP.value: ("{name} accepted help", 3),
    CheckOutcome.HELP_DECLINED.value: ("{name} turned down the help offered", 4),
}


class MarkReadIn(BaseModel):
    """Marking pings read. Either a list of ids, or everything on this hazard up to now."""

    hazard_id: str
    ids: list[str] = Field(default_factory=list)
    all: bool = False
    read_by: str = ""  # optional, and recorded when given: who stopped looking at this


# ------------------------------------------------------------------------------------------------
# Routes into the console
# ------------------------------------------------------------------------------------------------
def route_for(hazard_id: str, *, neighbour_id: str | None = None, incident_id: str | None = None) -> str:
    """Where clicking this ping should land, as a console path.

    Most specific wins: an incident is a decision waiting for a human, a case is a person, and the
    hazard map is what you get when the ping is about the evening rather than about anybody.
    """
    if incident_id:
        return f"/hazards/{hazard_id}/incidents/{incident_id}"
    if neighbour_id:
        return f"/hazards/{hazard_id}/sweep/{neighbour_id}"
    return f"/hazards/{hazard_id}"


def _severity(priority: int) -> str:
    return SEVERITY_BY_PRIORITY.get(int(priority), "info")


def _note(
    event: dict[str, Any],
    *,
    kind: str,
    priority: int,
    headline: str,
    detail: str = "",
    neighbour_id: str | None = None,
    incident_id: str | None = None,
    call_id: str | None = None,
    suffix: str = "",
) -> dict[str, Any]:
    """One notification, in the shape the console consumes.

    `id` is derived from the event id (plus a suffix where one event fans out to several people, as
    `sweep.triaged` does), so it is stable across a GET, a replay and a live push — which is what
    lets a read receipt refer to it and a client dedupe against it.
    """
    hazard_id = str(event.get("hazard_id") or "")
    return {
        "id": f"ntf_{event.get('id')}" + (f"_{suffix}" if suffix else ""),
        "event_id": int(event.get("id") or 0),
        "kind": kind,
        "severity": _severity(priority),
        "priority": int(priority),
        "headline": headline,
        "detail": detail,
        "hazard_id": hazard_id,
        "sweep_id": event.get("sweep_id"),
        "neighbour_id": neighbour_id or event.get("neighbour_id"),
        "incident_id": incident_id,
        "call_id": call_id,
        "at": event.get("created_at"),
        "read": False,  # filled in by the feed; a freshly derived ping has not been seen
        "route": route_for(hazard_id, neighbour_id=neighbour_id or event.get("neighbour_id"),
                           incident_id=incident_id),
    }


# ------------------------------------------------------------------------------------------------
# Derivation
# ------------------------------------------------------------------------------------------------
def _name(session: Session, neighbour_id: str | None, fallback: str = "") -> str:
    if fallback:
        return fallback
    nbr = session.get(Neighbour, neighbour_id) if neighbour_id else None
    return nbr.name if nbr else (neighbour_id or "a neighbour")


def notifications_for_event(session: Session, event: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn one bus event into nought, one, or several notifications.

    Pure with respect to notification state: it reads the record to fill in a name or an address and
    never writes. Shared by the HTTP feed and by the live bus tap precisely so that the ping pushed
    over SSE and the ping a reconnecting client fetches are byte-for-byte the same object.
    """
    kind = str(event.get("type") or "")
    payload: dict[str, Any] = dict(event.get("payload") or {})
    hazard_id = str(event.get("hazard_id") or "")
    if kind not in NOTIFY_TYPES or not hazard_id:
        return []

    if kind == "hazard.declared":
        severity = str(payload.get("severity") or "warning").lower()
        headline = str(payload.get("headline") or payload.get("kind") or "hazard").strip()
        return [_note(event, kind=kind, priority=_HAZARD_PRIORITY.get(severity, 3),
                      headline=f"Hazard declared — {headline}",
                      detail="Nobody has been called yet. Start a sweep, or open a case.")]

    if kind == "sweep.triaged":
        # One event, many people. Only the bands where triage says harm is plausible within hours
        # earn an interruption; the rest of the roster is the board, and the board is a page.
        out: list[dict[str, Any]] = []
        for row in payload.get("order") or []:
            if not isinstance(row, dict):
                continue
            band = str(row.get("band") or "").lower()
            if band not in FLAG_BANDS or not row.get("may_call", True):
                continue
            reasons = [str(r) for r in (row.get("reasons") or []) if str(r).strip()]
            nid = str(row.get("neighbour_id") or "")
            out.append(_note(
                event, kind="case.flagged", priority=FLAG_BANDS[band], neighbour_id=nid, suffix=nid,
                headline=f"{row.get('name') or _name(session, nid)} flagged {band} risk",
                detail=reasons[0] if reasons else "",
            ))
        return out

    if kind == "check.decided":
        outcome = str(payload.get("outcome") or "")
        line = _OUTCOME_LINE.get(outcome)
        if line is None:
            return []  # SAFE, or something we do not have words for: not an interruption
        template, priority = line
        nid = str(payload.get("neighbour_id") or event.get("neighbour_id") or "")
        return [_note(
            event, kind="call.finished", priority=priority, neighbour_id=nid,
            call_id=str(payload.get("call_id") or "") or None,
            headline=template.format(name=_name(session, nid, str(payload.get("name") or ""))),
            detail=str(payload.get("reason") or ""),
        )]

    if kind == "incident.opened":
        incident_id = str(payload.get("incident_id") or "")
        nid = str(payload.get("neighbour_id") or "")
        priority = int(payload.get("priority") or fleet.DEFAULT_PRIORITY)
        label = str(payload.get("priority_label") or fleet.priority_label(priority))
        needs = ", ".join(str(n) for n in (payload.get("needs") or []))
        return [_note(
            event, kind="deployment.opened", priority=priority, neighbour_id=nid,
            incident_id=incident_id, call_id=str(payload.get("source_call_id") or "") or None,
            headline=f"Deployment case for {_name(session, nid)} — {label}",
            detail=needs or str(payload.get("summary") or ""),
        )]

    if kind == "dispatch.awaiting_authorisation":
        incident_id = str(payload.get("incident_id") or "")
        incident = session.get(Incident, incident_id) if incident_id else None
        nid = incident.neighbour_id if incident else str(event.get("neighbour_id") or "")
        priority = int(incident.priority if incident else 1)
        call_sign = str(payload.get("call_sign") or "an agency unit")
        # Written so that no reading of it says anybody was sent. BuddyE prepares an agency request
        # and stops; the send is a person's decision and this ping is that decision arriving.
        return [_note(
            event, kind="deployment.awaiting_authorisation", priority=priority, neighbour_id=nid,
            incident_id=incident_id or None,
            headline=f"{call_sign} prepared for {_name(session, nid)} — awaiting your approval",
            detail="Nobody has been asked and nothing has been sent. Approve or deny.",
        )]

    if kind == "asset.arrived":
        incident_id = str(payload.get("incident_id") or "")
        incident = session.get(Incident, incident_id) if incident_id else None
        nid = incident.neighbour_id if incident else str(event.get("neighbour_id") or "")
        where = incident.address if incident else ""
        return [_note(
            event, kind="asset.arrived", priority=4, neighbour_id=nid,
            incident_id=incident_id or None,
            headline=f"{payload.get('call_sign') or 'A unit'} arrived at {_name(session, nid)}",
            detail=where,
        )]

    return []


# ------------------------------------------------------------------------------------------------
# Read state
# ------------------------------------------------------------------------------------------------
def _read_state(session: Session, hazard_id: str) -> tuple[set[str], int]:
    """Which pings have been seen: explicit ids, and a watermark from "mark everything read".

    The watermark exists so that dismissing a full feed costs one small row rather than one id per
    ping, and so that a notification derived from an event *older* than the watermark — which can
    happen when a client replays — comes back already read instead of re-interrupting somebody.
    """
    ids: set[str] = set()
    watermark = 0
    rows = session.exec(
        select(AgentEvent).where(AgentEvent.hazard_id == hazard_id, AgentEvent.type == READ_EVENT)
    ).all()
    for row in rows:
        payload = dict(row.payload or {})
        ids.update(str(i) for i in (payload.get("ids") or []))
        if payload.get("all"):
            watermark = max(watermark, int(payload.get("through_event_id") or 0))
    return ids, watermark


def _mark(notes: Iterable[dict[str, Any]], read_ids: set[str], watermark: int) -> list[dict[str, Any]]:
    out = []
    for n in notes:
        out.append({**n, "read": n["id"] in read_ids or int(n["event_id"]) <= watermark})
    return out


# ------------------------------------------------------------------------------------------------
# The feed
# ------------------------------------------------------------------------------------------------
def feed(hazard_id: str, *, limit: int = 60, unread_only: bool = False) -> list[dict[str, Any]]:
    """The console's notification list for one hazard, newest first.

    Bounded and type-filtered in SQL rather than by walking the event log: a console left open for
    an evening accumulates thousands of events, and a feed that scans all of them gets slower every
    minute it is useful.
    """
    with session_scope() as s:
        rows = list(
            s.exec(
                select(AgentEvent)
                .where(AgentEvent.hazard_id == hazard_id, AgentEvent.type.in_(NOTIFY_TYPES))  # type: ignore[attr-defined]
                .order_by(AgentEvent.id.desc())  # type: ignore[attr-defined]
                .limit(limit)
            ).all()
        )
        read_ids, watermark = _read_state(s, hazard_id)
        notes: list[dict[str, Any]] = []
        for row in rows:
            notes.extend(notifications_for_event(s, _serialize(row)))
    notes = _mark(notes, read_ids, watermark)
    notes.sort(key=lambda n: (-int(n["event_id"]), n["id"]))
    if unread_only:
        notes = [n for n in notes if not n["read"]]
    return [obs.redact(n) for n in notes[:limit]]


def unread_count(hazard_id: str) -> int:
    """How many pings nobody has looked at, over a fixed window.

    Deliberately not "unread in the page you asked for": a badge that says 10 on one screen and 28
    on another because the two asked for different page sizes is a badge nobody trusts.
    """
    return sum(1 for n in feed(hazard_id, limit=UNREAD_WINDOW) if not n["read"])


def _serialize(row: AgentEvent) -> dict[str, Any]:
    return {
        "id": row.id, "hazard_id": row.hazard_id, "sweep_id": row.sweep_id,
        "neighbour_id": row.neighbour_id, "type": row.type, "payload": dict(row.payload or {}),
        "created_at": row.created_at.isoformat() + "Z",
    }


@router.get("")
def list_notifications(
    hazard_id: str = Query(...),
    limit: int = Query(default=60, ge=1, le=200),
    unread_only: bool = Query(default=False),
) -> dict[str, Any]:
    with session_scope() as s:
        if s.get(Hazard, hazard_id) is None:
            raise HTTPException(404, "hazard not found")
    notes = feed(hazard_id, limit=limit, unread_only=unread_only)
    return {
        "hazard_id": hazard_id,
        "notifications": notes,
        # The badge, over the whole window rather than over this page.
        "unread": unread_count(hazard_id),
        "returned": len(notes),
    }


@router.post("/read")
def mark_read(body: MarkReadIn) -> dict[str, Any]:
    """Mark pings seen. Published as a receipt, so every console watching this hazard agrees.

    `all` records a watermark rather than the ids it covers: it is one row instead of sixty, and it
    keeps working for pings derived later from events older than the moment somebody cleared the
    feed — a replay after a reconnection must not re-interrupt a person who already looked.
    """
    with session_scope() as s:
        if s.get(Hazard, body.hazard_id) is None:
            raise HTTPException(404, "hazard not found")
        latest = s.exec(select(AgentEvent).where(AgentEvent.hazard_id == body.hazard_id)
                        .order_by(AgentEvent.id.desc())).first()  # type: ignore[attr-defined]
        watermark = int(latest.id or 0) if latest is not None else 0
    if not body.ids and not body.all:
        raise HTTPException(400, "pass ids to mark read, or all: true")
    payload: dict[str, Any] = {"ids": list(body.ids)}
    if body.all:
        payload["all"] = True
        payload["through_event_id"] = watermark
    if body.read_by.strip():
        payload["read_by"] = body.read_by.strip()
    bus.publish(hazard_id=body.hazard_id, type=READ_EVENT, payload=obs.redact(payload))
    return {"hazard_id": body.hazard_id, "unread": unread_count(body.hazard_id),
            "notifications": feed(body.hazard_id)}


# ------------------------------------------------------------------------------------------------
# The live path
# ------------------------------------------------------------------------------------------------
def install(bus_obj: Any = bus) -> Any:
    """Tap the event bus so a notification-worthy event publishes its derived ping immediately.

    The console already holds one SSE connection per hazard, so a ping should arrive on that
    connection rather than through a second transport or a poll. The mechanism is one composition at
    startup: every `bus.publish` still does exactly what it did, and then — synchronously, on the
    same call stack — the derived notifications for that event are published too.

    Synchronous rather than a background relay reading a queue, and that is the important part. A
    relay is a second producer writing into the shared event log at a time nobody controls, which
    makes the log's contents a function of scheduling: "everything that has happened" stops being a
    stable answer, and `since_event_id` replay stops being reproducible. Doing it inline means a
    notification row lands immediately after the event it was derived from, always, and the log is
    quiescent the moment the thing that caused it is finished.

    Returns the uninstall callable. Idempotent, and a failure in derivation can never take down the
    publisher: the calls are the product, and this is a view of them.
    """
    original = bus_obj.publish
    if getattr(original, "_buddye_notify_tap", False):
        return lambda: None

    def publish(**kwargs: Any) -> dict[str, Any]:
        data = original(**kwargs)
        try:
            publish_for_event(data, publish=original)
        except Exception:  # noqa: BLE001
            log.exception("notification tap failed on event %s", data.get("id"))
        return data

    publish._buddye_notify_tap = True  # type: ignore[attr-defined]
    bus_obj.publish = publish  # type: ignore[method-assign]

    def uninstall() -> None:
        bus_obj.publish = original  # type: ignore[method-assign]

    return uninstall


def publish_for_event(event: dict[str, Any], *, publish: Any = None) -> list[dict[str, Any]]:
    """Derive and publish the notifications for one event. Returns what it published.

    A plain function rather than a method on the tap, so the push path can be driven directly by a
    test instead of only by a live app — an untested push path is one that ships broken.

    `publish` is the untapped publisher when this is called from inside the tap: a notification is
    not itself a notification source (`PUSH_EVENT` is not in `NOTIFY_TYPES`, which is what bounds the
    recursion), and going straight to the original keeps it from being re-examined at all.
    """
    if str(event.get("type") or "") not in NOTIFY_TYPES:
        return []
    emit = publish or bus.publish
    with session_scope() as s:
        notes = notifications_for_event(s, event)
    for note in notes:
        emit(
            hazard_id=note["hazard_id"],
            sweep_id=note.get("sweep_id"),
            neighbour_id=note.get("neighbour_id"),
            type=PUSH_EVENT,
            payload=obs.redact(dict(note)),
        )
    return notes
