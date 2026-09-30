"""The escalation ladder and the responder handoff. **This module is the safety boundary of BuddyE.**

Everything else in the product decides who to call and what they said. This is where the software
decides to involve someone other than the neighbour, and the whole design exists to make one thing
structurally true rather than merely intended:

    BuddyE never dials emergency services. Not on a timer, not on a critical band, not on a
    transcript containing the word "help". The ladder is
        EMERGENCY_CONTACT   the person they nominated  — BuddyE may call this number
        BLOCK_CAPTAIN       the volunteer running it   — BuddyE notifies her
        RESPONDER           911 / an agency            — BuddyE *prepares a page* and stops
    and the last rung is reached by `build_handoff_packet()`, which writes a `HandoffPacket` with
    `released_at = None`. A packet in that state has told nobody anything. It is a document sitting
    on a screen. The only transition out of it is `release()`, which takes the name of a human being
    and refuses without one, and `require_released()` is the gate any future transmit path must call.

There is no provider import in this file and there must never be one: this module cannot place a
call even by accident, because it has no way to reach one. `tests/test_escalate.py` asserts that at
the source level, along with the fact that `released_at` is assigned in exactly one function.

Two smaller rules that came out of building it:

* **Skip a rung honestly.** A neighbour with no emergency contact on file starts at BLOCK_CAPTAIN,
  and `rungs` carries an explicit "skipped: no emergency contact on file" entry. The audit trail has
  to be able to distinguish "we called her daughter and nobody picked up" from "she never gave us a
  daughter", because a captain standing on a doorstep will ask exactly that.
* **`rungs` is a plain JSON column.** SQLModel/SQLAlchemy will not notice `esc.rungs.append(...)` —
  the attribute never goes dirty and the audit trail silently does not persist. Every mutation here
  rebinds the list (`esc.rungs = [*esc.rungs, entry]`). Same for the packet's list fields.

Privacy note, deliberately the opposite of the usual rule: `build_handoff_packet()` does **not** run
`app.obs.redact`. The packet's entire job is to put an address and a medical dependency in front of
a paramedic in the first sentence; redacting it would produce a document that helps nobody. It is a
stored snapshot, and callers redact at egress like everywhere else. Do not add a redact() here.
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Any

from sqlmodel import Session

from app.domain.state import (
    CheckOutcome,
    EscalationLevel,
    EscalationStatus,
    IllegalTransition,
    assert_escalation_transition,
)
from app.models import CheckCall, Escalation, HandoffPacket, utcnow

LADDER: tuple[EscalationLevel, ...] = (
    EscalationLevel.EMERGENCY_CONTACT,
    EscalationLevel.BLOCK_CAPTAIN,
    EscalationLevel.RESPONDER,
)

# Names that are not a person taking responsibility. A release is a human act and the row is the only
# record that it happened, so "system", "automation" and friends are refused rather than stored.
NON_HUMAN_NAMES = frozenset({
    "system", "automation", "automated", "auto", "bot", "robot", "buddye", "buddy-e", "calle", "call-e",
    "service", "service account", "serviceaccount", "api", "cron", "scheduler", "daemon", "worker",
    "admin", "administrator", "root", "n/a", "na", "none", "null", "unknown", "anonymous", "test",
})

# The speakers in a transcript who are not the neighbour. Anything else is treated as their voice,
# because `last_words` must be theirs and a provider we have not met yet may label them differently.
AGENT_SPEAKERS = frozenset({"bot", "agent", "assistant", "system", "calle", "call-e", "ai", "buddye"})


class ReleaseRefused(RuntimeError):
    """An act that requires a named human was attempted without one — or a packet nobody released
    was about to be sent."""


# ------------------------------------------------------------------------------------------------
# Reading a neighbour: works on a `Neighbour` row, a dict, or a stub with the attributes.
# ------------------------------------------------------------------------------------------------
def _get(obj: Any, key: str, default: Any = None) -> Any:
    value = obj.get(key, default) if isinstance(obj, Mapping) else getattr(obj, key, default)
    return default if value is None else value


def has_emergency_contact(neighbour: Any) -> bool:
    """A contact we can actually ring. A name with no number is not a rung, it is a note."""
    return bool(str(_get(neighbour, "contact_phone", "") or "").strip())


def starting_rung(neighbour: Any) -> EscalationLevel:
    """Where an escalation opens. Never RESPONDER — nothing in this product starts at the top."""
    return EscalationLevel.EMERGENCY_CONTACT if has_emergency_contact(neighbour) else EscalationLevel.BLOCK_CAPTAIN


def next_rung(current: EscalationLevel) -> EscalationLevel | None:
    """The next rung up, or None at the top of the ladder.

    Deliberately a plain successor with no conditions in it. Skipping happens in the two places where
    it is a fact about this neighbour rather than about the ladder: `starting_rung()` picks the first
    rung we can actually work, and `advance()` writes down that the rung it is leaving was never
    tried. Putting a skip rule here as well would make it unclear which one had fired.

    RESPONDER is returned like any other rung — reaching it here is not sending anything. It only
    means the escalation now needs a human, which is `build_handoff_packet()`.
    """
    idx = LADDER.index(EscalationLevel(current))
    return LADDER[idx + 1] if idx + 1 < len(LADDER) else None


def _rung(level: EscalationLevel, action: str, result: str = "", note: str = "", call_id: str | None = None) -> dict[str, Any]:
    return {
        "level": EscalationLevel(level).value,
        "action": action,          # entered | called | notified | skipped | prepared | released
        "result": result,
        "note": note,
        "call_id": call_id,
        "at": utcnow().isoformat(),
    }


def _append_rung(esc: Escalation, entry: dict[str, Any]) -> None:
    # Rebind, never append: `rungs` is a plain Column(JSON) with no MutableList, so an in-place
    # append leaves the attribute clean and the audit entry is dropped on commit without a word.
    esc.rungs = [*(esc.rungs or []), entry]
    esc.updated_at = utcnow()


CLOSED_STATUSES = frozenset({EscalationStatus.RESOLVED, EscalationStatus.CANCELLED})


def _assert_open(esc: Escalation) -> None:
    """A closed escalation does not climb. Somebody decided this neighbour was accounted for, and
    quietly re-escalating them behind that decision would put a stranger at their door on the
    strength of a stale row."""
    if EscalationStatus(esc.status) in CLOSED_STATUSES:
        raise IllegalTransition(f"escalation {esc.id} is {esc.status}; the ladder does not move once it is closed")


def _set_status(esc: Escalation, nxt: EscalationStatus) -> None:
    """Every status change goes through the state machine, which is the only place transitions live."""
    current = EscalationStatus(esc.status)
    if current is nxt:
        return
    assert_escalation_transition(current, nxt)
    esc.status = nxt


# ------------------------------------------------------------------------------------------------
# Opening and climbing
# ------------------------------------------------------------------------------------------------
def open_escalation(
    session: Session,
    *,
    sweep_id: str,
    hazard_id: str,
    neighbour: Any,
    outcome: CheckOutcome | str,
    reason: str = "",
    trigger_call_id: str | None = None,
) -> Escalation | None:
    """Open an escalation for any non-SAFE outcome. Returns None for SAFE so the runner can call it
    unconditionally on every finished call.

    UNREACHABLE opens one exactly like URGENT does. That is the point: the neighbour who did not pick
    up is the one nobody would have chased, and an escalation is how the sweep refuses to forget her.
    """
    outcome = CheckOutcome(outcome)
    if outcome is CheckOutcome.SAFE:
        return None

    level = starting_rung(neighbour)
    esc = Escalation(
        sweep_id=sweep_id,
        hazard_id=hazard_id,
        neighbour_id=str(_get(neighbour, "id", "")),
        trigger_call_id=trigger_call_id,
        outcome=outcome.value,
        level=level,
        status=EscalationStatus.OPEN,
        reason=reason,
    )
    rungs: list[dict[str, Any]] = []
    if level is not EscalationLevel.EMERGENCY_CONTACT:
        # Honest skip. "No daughter on file" and "the daughter did not answer" are different facts and
        # the captain will be asked which one it was.
        contact_name = str(_get(neighbour, "contact_name", "") or "").strip()
        detail = (f"{contact_name} is on file with no phone number" if contact_name
                  else "no emergency contact on file")
        rungs.append(_rung(EscalationLevel.EMERGENCY_CONTACT, "skipped", result=f"skipped: {detail}"))
    rungs.append(_rung(level, "entered", result=f"opened on {outcome.value}", note=reason,
                       call_id=trigger_call_id))
    esc.rungs = rungs
    session.add(esc)
    return esc


def record_attempt(
    session: Session,
    escalation: Escalation,
    *,
    action: str,
    result: str,
    reached: bool = False,
    call_id: str | None = None,
    note: str = "",
) -> Escalation:
    """Write down what happened at the rung the escalation is currently on.

    `reached=True` means a human on that rung actually heard us and moves the escalation to
    CONTACT_REACHED — which is a state about *us reaching a contact*, never about the neighbour being
    safe. Only `resolve()` says the latter.
    """
    _assert_open(escalation)
    _append_rung(escalation, _rung(escalation.level, action, result=result, note=note, call_id=call_id))
    if reached:
        _set_status(escalation, EscalationStatus.CONTACT_REACHED)
    session.add(escalation)
    return escalation


TRIED_ACTIONS = frozenset({"called", "notified", "prepared", "released"})


def _was_tried(escalation: Escalation, level: EscalationLevel) -> bool:
    return any(r.get("level") == EscalationLevel(level).value and r.get("action") in TRIED_ACTIONS
               for r in (escalation.rungs or []))


def advance(
    session: Session,
    escalation: Escalation,
    *,
    neighbour: Any = None,
    reason: str = "",
) -> Escalation:
    """Climb one rung, first writing down honestly whether the rung being left was ever worked.

    An escalation can sit on a rung nobody could work — the model's default level is
    EMERGENCY_CONTACT, and plenty of this roster nominated nobody. Leaving that behind silently would
    put "escalated past the daughter" in an audit trail that should read "there is no daughter".

    Arriving at RESPONDER sets AWAITING_AUTHORISATION and nothing else. No message leaves the process
    here; a human still has to read the packet and put their name to it.
    """
    _assert_open(escalation)
    current = EscalationLevel(escalation.level)
    if not _was_tried(escalation, current):
        if current is EscalationLevel.EMERGENCY_CONTACT and not has_emergency_contact(neighbour):
            detail = "no emergency contact on file"
        else:
            detail = "no attempt was recorded on this rung"
        _append_rung(escalation, _rung(current, "skipped", result=f"skipped: {detail}"))

    nxt = next_rung(current)
    if nxt is None:
        # Already at the top. Say so rather than pretending another rung exists.
        _append_rung(escalation, _rung(current, "entered", result="already at the top of the ladder", note=reason))
        session.add(escalation)
        return escalation

    escalation.level = nxt
    _append_rung(escalation, _rung(nxt, "entered", result=f"escalated from {current.value}", note=reason))
    if nxt is EscalationLevel.RESPONDER:
        _set_status(escalation, EscalationStatus.AWAITING_AUTHORISATION)
    session.add(escalation)
    return escalation


def resolve(session: Session, escalation: Escalation, *, resolved_by: str, note: str = "") -> Escalation:
    """Close an escalation. A person's name, because somebody decided this neighbour is accounted for."""
    who = str(resolved_by or "").strip()
    if not who:
        raise ReleaseRefused("resolving an escalation requires the name of the person who did it")
    _set_status(escalation, EscalationStatus.RESOLVED)
    escalation.resolved_by, escalation.resolved_note = who, note
    escalation.resolved_at = utcnow()
    _append_rung(escalation, _rung(escalation.level, "resolved", result=note or "resolved", note=who))
    session.add(escalation)
    return escalation


# ------------------------------------------------------------------------------------------------
# The handoff packet
# ------------------------------------------------------------------------------------------------
# Snapshot defaults are conservative on purpose: a roster row missing `power_dependent` must not read
# to a paramedic as "no equipment", it reads as a field that was blank, so the safe default for the
# flags a responder acts on is the one that keeps the caution in the packet.
NEIGHBOUR_SNAPSHOT_FIELDS: dict[str, Any] = {
    "id": "", "name": "", "phone": "", "address": "", "unit": "", "access_notes": "",
    "age_band": "unknown", "lives_alone": False, "conditions": [], "power_dependent": False,
    "power_backup_hours": 0.0, "cooling": "unknown", "heating": "unknown", "mobility": "independent",
    "has_transport": True, "preferred_language": "en-US", "contact_name": "", "contact_phone": "",
    "contact_relation": "", "notes": "",
}


def _neighbour_snapshot(neighbour: Any) -> dict[str, Any]:
    return {k: _get(neighbour, k, default) for k, default in NEIGHBOUR_SNAPSHOT_FIELDS.items()}


def _hazard_snapshot(hazard: Any) -> dict[str, Any]:
    keys = ("id", "kind", "headline", "area", "severity", "starts_at", "ends_at", "facts", "source", "declared_by")
    return {k: _get(hazard, k, {} if k == "facts" else "") for k in keys}


def _reached(call: CheckCall) -> bool:
    return str((call.structured_result or {}).get("reached_intended_person", "")).strip().lower() == "yes"


def last_successful_contact(calls: list[CheckCall]) -> datetime | None:
    """When we last actually spoke to *them* — not when we last dialled.

    "Last heard from: 4:05 this afternoon" and "last dialled: four minutes ago" are different facts,
    and the second one is worthless to somebody deciding whether to force a door.
    """
    stamps = [c.completed_at or c.started_at for c in calls
              if c.callee == "neighbour" and _reached(c) and (c.completed_at or c.started_at)]
    return max(stamps) if stamps else None


def last_words(calls: list[CheckCall]) -> str:
    """Their own voice, verbatim. Never `CheckCall.summary` — that is CALL-E's paraphrase, and a
    paraphrase read out to a paramedic as if the person had said it is a lie with a badge on."""
    for call in sorted(calls, key=lambda c: (c.completed_at or c.started_at or datetime.min), reverse=True):
        if call.callee != "neighbour":
            continue
        quote = str((call.structured_result or {}).get("alarming_quote", "") or "").strip()
        if quote:
            return quote
        for turn in reversed(call.transcript or []):
            speaker = str(turn.get("speaker") or turn.get("role") or "").strip().lower()
            text = str(turn.get("text") or turn.get("content") or "").strip()
            if text and speaker not in AGENT_SPEAKERS:
                return text
    return ""


def _attempts(calls: list[CheckCall]) -> list[dict[str, Any]]:
    """Every dial, in order, neighbour and emergency-contact alike — the ladder reuses CheckCall."""
    out = []
    for call in sorted(calls, key=lambda c: (c.started_at or c.completed_at or datetime.min)):
        out.append({
            "call_id": call.id,
            "callee": call.callee,
            "attempt": call.attempt,
            "status": call.status,
            "outcome": call.outcome,
            "reached": _reached(call),
            "at": (call.completed_at or call.started_at).isoformat() if (call.completed_at or call.started_at) else "",
            "note": call.outcome_reason or call.summary or "",
        })
    return out


def _medical_sentence(snapshot: Mapping[str, Any]) -> str:
    """The fact a responder needs in the first breath, or "" if there genuinely is not one."""
    if snapshot.get("power_dependent"):
        hours = float(snapshot.get("power_backup_hours") or 0.0)
        backup = f"about {hours:g} hours of battery backup" if hours > 0 else "NO battery backup"
        return f"depends on mains-powered medical equipment with {backup}"
    conditions = [str(c).replace("_", " ") for c in (snapshot.get("conditions") or []) if str(c).strip()]
    return f"medical: {', '.join(conditions)}" if conditions else ""


def _where(snapshot: Mapping[str, Any]) -> str:
    address = str(snapshot.get("address") or "").strip() or "address not on file"
    unit = str(snapshot.get("unit") or "").strip()
    return f"{address}, unit {unit}" if unit else address


def recommended_action(outcome: CheckOutcome | str, snapshot: Mapping[str, Any], since: datetime | None) -> str:
    """What a human should do. Phrased as a request to a person, never as something already done —
    no "dispatched", no "units en route", nothing that implies anybody is on their way. Nobody is."""
    outcome = CheckOutcome(outcome)
    who = str(snapshot.get("name") or "this neighbour").strip()
    heard = f"last heard from at {since.strftime('%H:%M on %d %b')}" if since else "not reached at all today"
    if outcome is CheckOutcome.UNREACHABLE:
        base = f"Request an in-person welfare check at the address. {who} has not answered and was {heard}."
    elif outcome is CheckOutcome.URGENT:
        base = f"Request an in-person welfare check now. {who} reported a situation that needs someone there; {heard}."
    else:
        base = f"Request someone look in on {who} in person; {heard}."
    if snapshot.get("power_dependent"):
        base += " Life-safety equipment depends on mains power — treat the clock as running."
    if str(snapshot.get("mobility") or "independent") != "independent":
        base += f" Mobility: {str(snapshot['mobility']).replace('_', ' ')} — they may not be able to come to the door."
    return base


def spoken_script(
    *,
    neighbour_snapshot: Mapping[str, Any],
    hazard_snapshot: Mapping[str, Any],
    last_contact_at: datetime | None,
    words: str,
    attempts: list[dict[str, Any]],
    action: str,
    concerns: list[str] | None = None,
) -> str:
    """What a human reads out loud, composed to be read by somebody under pressure.

    The first sentence carries the address and the medical fact and nothing else: a person reading
    this aloud at 11pm may not get to the second sentence before being interrupted, and if they only
    manage one line it has to be the line that gets someone to the right door prepared for what is
    behind it. Everything after that is detail, in the order it would be asked for.
    """
    name = str(neighbour_snapshot.get("name") or "a neighbour").strip()
    medical = _medical_sentence(neighbour_snapshot)
    lead = f"Welfare check at {_where(neighbour_snapshot)}: {name}"
    if medical:
        lead += f", who {medical}" if medical.startswith("depends") else f" — {medical}"
    lines = [lead + "."]

    headline = str(hazard_snapshot.get("headline") or hazard_snapshot.get("kind") or "").strip()
    area = str(hazard_snapshot.get("area") or "").strip()
    if headline:
        lines.append(f"Hazard: {headline}{f' in {area}' if area else ''}.")

    tried = len(attempts)
    if last_contact_at:
        lines.append(f"Last actually spoken to at {last_contact_at.strftime('%H:%M on %d %b')};"
                     f" {tried} call attempt{'s' if tried != 1 else ''} since then have been logged.")
    else:
        lines.append(f"Never reached today: {tried} call attempt{'s' if tried != 1 else ''}, no answer.")

    access = str(neighbour_snapshot.get("access_notes") or "").strip()
    if access:
        lines.append(f"Access: {access}.")
    if neighbour_snapshot.get("lives_alone"):
        lines.append("Lives alone.")
    if words:
        lines.append(f"Their own words, verbatim: \"{words}\"")
    for concern in (concerns or [])[:4]:
        lines.append(f"Reported: {concern}")
    lines.append(action)
    # Said out loud, every time. The person reading this must not leave anyone with the impression
    # that a dispatch has already happened, because nothing in BuddyE has dispatched anything.
    lines.append("This is a neighbourhood check-in programme passing on information. "
                 "No emergency service has been contacted by the system; nobody has been sent.")
    return "\n".join(lines)


def build_handoff_packet(
    session: Session,
    *,
    escalation: Escalation,
    neighbour: Any,
    hazard: Any,
    calls: list[CheckCall] | None = None,
    concerns: list[str] | None = None,
) -> HandoffPacket:
    """Assemble the page a responder actually wants, and leave it unreleased.

    The packet is a *snapshot*: what was true when it was cut is what a responder would be told, and
    it stays that way even if the roster row is edited afterwards. It is deliberately not redacted —
    see the module docstring. The escalation ends this call at AWAITING_AUTHORISATION and the packet
    at `released_at = None`, which together mean the system has told nobody anything.
    """
    _assert_open(escalation)
    calls = list(calls or [])
    nbr = _neighbour_snapshot(neighbour)
    haz = _hazard_snapshot(hazard)
    since = last_successful_contact(calls)
    words = last_words(calls)
    attempts = _attempts(calls)
    action = recommended_action(escalation.outcome, nbr, since)

    packet = HandoffPacket(
        escalation_id=escalation.id,
        neighbour_id=escalation.neighbour_id,
        hazard_id=escalation.hazard_id,
        neighbour_snapshot=nbr,
        hazard_snapshot=haz,
        last_contact_at=since,
        last_words=words,
        concerns=list(concerns or []),
        attempts_summary=attempts,
        recommended_action=action,
        spoken_script=spoken_script(
            neighbour_snapshot=nbr, hazard_snapshot=haz, last_contact_at=since, words=words,
            attempts=attempts, action=action, concerns=list(concerns or []),
        ),
    )
    session.add(packet)

    if EscalationLevel(escalation.level) is not EscalationLevel.RESPONDER:
        escalation.level = EscalationLevel.RESPONDER
    _set_status(escalation, EscalationStatus.AWAITING_AUTHORISATION)
    _append_rung(escalation, _rung(EscalationLevel.RESPONDER, "prepared",
                                   result="handoff packet prepared; awaiting release by a named human"))
    session.add(escalation)
    return packet


def is_released(packet: HandoffPacket) -> bool:
    return packet.released_at is not None and bool(str(packet.released_by or "").strip())


def require_released(packet: HandoffPacket) -> HandoffPacket:
    """The gate. Anything that would transmit a packet to anyone calls this first and lives with the
    exception. Kept as a function so that a future send path has one obvious thing to call and one
    obvious thing to have failed to call in review."""
    if not is_released(packet):
        raise ReleaseRefused(
            f"handoff packet {packet.id} has not been released by a named human; it may not be sent to anyone")
    return packet


def _validate_releaser(name: str) -> str:
    who = " ".join(str(name or "").split())
    if not who:
        raise ReleaseRefused("release requires the name of the person authorising it; refusing an unnamed release")
    if not any(ch.isalpha() for ch in who):
        raise ReleaseRefused(f"{name!r} is not a person's name")
    if who.lower() in NON_HUMAN_NAMES or who.lower().replace(" ", "") in NON_HUMAN_NAMES:
        # A service account is not a person, and a release is somebody accepting responsibility for
        # what a stranger is about to be told about a frail person's home.
        raise ReleaseRefused(f"{who!r} is not a person; a handoff must be released by a named human")
    return who


def release(
    session: Session,
    packet: HandoffPacket,
    *,
    escalation: Escalation,
    released_by: str,
    note: str = "",
) -> HandoffPacket:
    """The one and only path from prepared to sent. Requires a named human and refuses otherwise.

    Everything above this line is BuddyE preparing information. This function is the moment a person
    decides that a responder should be told, and the row records who they were. It is the only place
    in the codebase that assigns `released_at`, which `tests/test_escalate.py` pins at source level.
    """
    who = _validate_releaser(released_by)
    if packet.released_at is not None:
        raise ReleaseRefused(f"handoff packet {packet.id} was already released by {packet.released_by!r}")
    if EscalationStatus(escalation.status) is not EscalationStatus.AWAITING_AUTHORISATION:
        raise ReleaseRefused(
            f"escalation {escalation.id} is {escalation.status}, not AWAITING_AUTHORISATION;"
            " a packet may only be released for an escalation that reached the responder rung")

    packet.released_at = utcnow()
    packet.released_by = who
    packet.release_note = note
    _set_status(escalation, EscalationStatus.RELEASED)
    _append_rung(escalation, _rung(EscalationLevel.RESPONDER, "released",
                                   result=f"released to a responder by {who}", note=note))
    session.add(packet)
    session.add(escalation)
    return packet
