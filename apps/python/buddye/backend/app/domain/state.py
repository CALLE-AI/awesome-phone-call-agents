"""Hazard, sweep, and escalation state machines. All transitions are validated here and nowhere else.

The shape differs from a hiring or scheduling workflow in one way that drives everything else: a
sweep does not stop at the first success. A heat warning does not become safe because the first
person answered. Every neighbour on the roster is checked, and the sweep ends when the last one has
an outcome — including the ones who never picked up.
"""
from __future__ import annotations

from enum import StrEnum


class HazardStatus(StrEnum):
    OPEN = "OPEN"          # declared, nobody swept yet
    SWEEPING = "SWEEPING"  # a sweep is in flight
    CLOSED = "CLOSED"      # every neighbour has an outcome and every escalation is resolved


class SweepState(StrEnum):
    CREATED = "CREATED"
    TRIAGING = "TRIAGING"      # scoring the roster against this hazard
    CALLING = "CALLING"        # working down the triage order
    ESCALATING = "ESCALATING"  # someone is unreachable or in trouble
    AWAITING_HUMAN = "AWAITING_HUMAN"  # a responder handoff is prepared and needs authorisation
    COMPLETE = "COMPLETE"
    BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"
    FAILED = "FAILED"


class CheckOutcome(StrEnum):
    """What one check-in call established. Ordered worst-last for triage displays."""

    SAFE = "SAFE"                  # reached them, no help needed
    HELP_DECLINED = "HELP_DECLINED"  # reached them, they need something and said no thank you
    NEEDS_HELP = "NEEDS_HELP"      # reached them, they accepted a specific offer of help
    URGENT = "URGENT"              # reached them and something is wrong right now
    UNREACHABLE = "UNREACHABLE"    # nobody answered — for an at-risk person this is a signal, not a gap


class EscalationLevel(StrEnum):
    """The ladder. Each rung is tried before the next, and the last one is not automatic."""

    EMERGENCY_CONTACT = "EMERGENCY_CONTACT"  # the person they nominated; BuddyE may call this
    BLOCK_CAPTAIN = "BLOCK_CAPTAIN"          # the volunteer running the sweep; BuddyE notifies
    RESPONDER = "RESPONDER"                  # 911 / agency — prepared by BuddyE, released by a human


class EscalationStatus(StrEnum):
    OPEN = "OPEN"
    CONTACT_REACHED = "CONTACT_REACHED"
    AWAITING_AUTHORISATION = "AWAITING_AUTHORISATION"  # a handoff packet is ready for a human
    RELEASED = "RELEASED"                              # a human authorised the responder handoff
    RESOLVED = "RESOLVED"
    CANCELLED = "CANCELLED"


TERMINAL_SWEEP_STATES: frozenset[SweepState] = frozenset(
    {SweepState.COMPLETE, SweepState.BUDGET_EXHAUSTED, SweepState.FAILED}
)

SWEEP_TRANSITIONS: dict[SweepState, frozenset[SweepState]] = {
    SweepState.CREATED: frozenset({SweepState.TRIAGING, SweepState.FAILED}),
    SweepState.TRIAGING: frozenset({SweepState.CALLING, SweepState.COMPLETE, SweepState.FAILED}),
    # CALLING self-transitions: the roster is worked one neighbour at a time, not one candidate.
    SweepState.CALLING: frozenset(
        {SweepState.CALLING, SweepState.ESCALATING, SweepState.COMPLETE, SweepState.BUDGET_EXHAUSTED, SweepState.FAILED}
    ),
    SweepState.ESCALATING: frozenset(
        {SweepState.CALLING, SweepState.AWAITING_HUMAN, SweepState.ESCALATING, SweepState.COMPLETE, SweepState.BUDGET_EXHAUSTED, SweepState.FAILED}
    ),
    # A prepared responder handoff never blocks the rest of the roster: the sweep keeps calling.
    SweepState.AWAITING_HUMAN: frozenset(
        {SweepState.CALLING, SweepState.ESCALATING, SweepState.COMPLETE, SweepState.FAILED}
    ),
    SweepState.COMPLETE: frozenset(),
    SweepState.BUDGET_EXHAUSTED: frozenset(),
    SweepState.FAILED: frozenset(),
}

HAZARD_TRANSITIONS: dict[HazardStatus, frozenset[HazardStatus]] = {
    HazardStatus.OPEN: frozenset({HazardStatus.SWEEPING, HazardStatus.CLOSED}),
    HazardStatus.SWEEPING: frozenset({HazardStatus.OPEN, HazardStatus.CLOSED}),
    HazardStatus.CLOSED: frozenset({HazardStatus.SWEEPING}),  # a second wave reopens it
}

ESCALATION_TRANSITIONS: dict[EscalationStatus, frozenset[EscalationStatus]] = {
    EscalationStatus.OPEN: frozenset(
        {EscalationStatus.CONTACT_REACHED, EscalationStatus.AWAITING_AUTHORISATION, EscalationStatus.RESOLVED, EscalationStatus.CANCELLED}
    ),
    EscalationStatus.CONTACT_REACHED: frozenset(
        {EscalationStatus.RESOLVED, EscalationStatus.AWAITING_AUTHORISATION, EscalationStatus.CANCELLED}
    ),
    EscalationStatus.AWAITING_AUTHORISATION: frozenset(
        {EscalationStatus.RELEASED, EscalationStatus.RESOLVED, EscalationStatus.CANCELLED}
    ),
    EscalationStatus.RELEASED: frozenset({EscalationStatus.RESOLVED}),
    EscalationStatus.RESOLVED: frozenset(),
    EscalationStatus.CANCELLED: frozenset(),
}


class IllegalTransition(RuntimeError):
    pass


def assert_sweep_transition(current: SweepState, nxt: SweepState) -> None:
    if nxt not in SWEEP_TRANSITIONS[current]:
        raise IllegalTransition(f"sweep: {current} -> {nxt} is not allowed")


def assert_hazard_transition(current: HazardStatus, nxt: HazardStatus) -> None:
    if nxt not in HAZARD_TRANSITIONS[current]:
        raise IllegalTransition(f"hazard: {current} -> {nxt} is not allowed")


def assert_escalation_transition(current: EscalationStatus, nxt: EscalationStatus) -> None:
    if nxt not in ESCALATION_TRANSITIONS[current]:
        raise IllegalTransition(f"escalation: {current} -> {nxt} is not allowed")


# ---------------------------------------------------------------- dispatch side
# Everything above concerns finding out who is in trouble. Everything below concerns doing
# something about it: the resources a coordinator can actually move, and where they are.
#
# The boundary from the escalation ladder holds here too, and it is the reason AssetKind lists
# what it lists. BuddyE dispatches COMMUNITY resources — volunteers, water, rides, wellness
# visits — automatically, because sending a neighbour with a case of water to a hot house is a
# recoverable mistake. It does not dispatch ambulances or fire crews: that is what a
# HandoffPacket is for, and a named human releases it.


class AssetKind(StrEnum):
    # Community resources. An agent commits these on its own: sending a volunteer with a case of
    # water to a hot house is a recoverable mistake, and waiting for a human costs more than it saves.
    VOLUNTEER_DRIVER = "VOLUNTEER_DRIVER"    # a car and a person, for rides to a cooling centre
    WELLNESS_VAN = "WELLNESS_VAN"            # two volunteers, does door knocks
    WATER_ICE_TRUCK = "WATER_ICE_TRUCK"      # bulk water and ice drops
    COOLING_SHUTTLE = "COOLING_SHUTTLE"      # scheduled run to the cooling centre
    POWER_CART = "POWER_CART"                # portable battery for a power-dependent household
    NURSE_OUTREACH = "NURSE_OUTREACH"        # a clinician who can assess, not a paramedic

    # Agency resources. An agent may REQUEST these and prepare everything the crew needs, but the
    # request sits visible and unsent until a named human approves it. A false ambulance call takes
    # a unit away from someone else's emergency, which is not a recoverable mistake, so the decision
    # to spend one belongs to a person. The agent's job is to make that decision a single informed
    # click rather than a form to fill in.
    EMS_UNIT = "EMS_UNIT"
    FIRE_UNIT = "FIRE_UNIT"
    POLICE_WELFARE = "POLICE_WELFARE"        # a welfare check by law enforcement; a serious ask


#: Kinds that may never leave PROPOSED without a named human authorising them.
AUTHORISATION_REQUIRED: frozenset[AssetKind] = frozenset(
    {AssetKind.EMS_UNIT, AssetKind.FIRE_UNIT, AssetKind.POLICE_WELFARE}
)


def requires_authorisation(kind: AssetKind | str) -> bool:
    """Does committing this kind of asset need a person to say yes?

    The single place that answers this question. Callers must not re-derive it from a list of
    kinds, or a kind added later will quietly become auto-dispatchable.
    """
    return AssetKind(kind) in AUTHORISATION_REQUIRED


class AssetStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    ASSIGNED = "ASSIGNED"        # committed to an incident, not yet moving
    EN_ROUTE = "EN_ROUTE"
    ON_SCENE = "ON_SCENE"
    RETURNING = "RETURNING"
    OUT_OF_SERVICE = "OUT_OF_SERVICE"


class IncidentStatus(StrEnum):
    OPEN = "OPEN"                # created from a non-safe check outcome, nothing sent yet
    TRIAGED = "TRIAGED"          # a coordinator (human or agent) has set priority and needs
    DISPATCHED = "DISPATCHED"    # at least one asset is committed
    ON_SCENE = "ON_SCENE"
    RESOLVED = "RESOLVED"
    HANDED_OFF = "HANDED_OFF"    # released to a responder agency by a named human
    CANCELLED = "CANCELLED"


class DispatchStatus(StrEnum):
    PROPOSED = "PROPOSED"        # an agent suggested it; not yet committed
    COMMITTED = "COMMITTED"
    EN_ROUTE = "EN_ROUTE"
    ARRIVED = "ARRIVED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


ASSET_TRANSITIONS: dict[AssetStatus, frozenset[AssetStatus]] = {
    AssetStatus.AVAILABLE: frozenset({AssetStatus.ASSIGNED, AssetStatus.OUT_OF_SERVICE}),
    AssetStatus.ASSIGNED: frozenset({AssetStatus.EN_ROUTE, AssetStatus.AVAILABLE, AssetStatus.OUT_OF_SERVICE}),
    AssetStatus.EN_ROUTE: frozenset({AssetStatus.ON_SCENE, AssetStatus.RETURNING, AssetStatus.OUT_OF_SERVICE}),
    AssetStatus.ON_SCENE: frozenset({AssetStatus.RETURNING, AssetStatus.OUT_OF_SERVICE}),
    AssetStatus.RETURNING: frozenset({AssetStatus.AVAILABLE, AssetStatus.OUT_OF_SERVICE}),
    AssetStatus.OUT_OF_SERVICE: frozenset({AssetStatus.AVAILABLE}),
}

INCIDENT_TRANSITIONS: dict[IncidentStatus, frozenset[IncidentStatus]] = {
    IncidentStatus.OPEN: frozenset({IncidentStatus.TRIAGED, IncidentStatus.HANDED_OFF, IncidentStatus.RESOLVED, IncidentStatus.CANCELLED}),
    IncidentStatus.TRIAGED: frozenset({IncidentStatus.DISPATCHED, IncidentStatus.HANDED_OFF, IncidentStatus.RESOLVED, IncidentStatus.CANCELLED}),
    IncidentStatus.DISPATCHED: frozenset({IncidentStatus.ON_SCENE, IncidentStatus.HANDED_OFF, IncidentStatus.RESOLVED, IncidentStatus.CANCELLED}),
    IncidentStatus.ON_SCENE: frozenset({IncidentStatus.RESOLVED, IncidentStatus.HANDED_OFF}),
    # A resolved incident can still be handed off: someone got worse after the water arrived.
    IncidentStatus.RESOLVED: frozenset({IncidentStatus.HANDED_OFF}),
    IncidentStatus.HANDED_OFF: frozenset({IncidentStatus.RESOLVED}),
    IncidentStatus.CANCELLED: frozenset(),
}

DISPATCH_TRANSITIONS: dict[DispatchStatus, frozenset[DispatchStatus]] = {
    DispatchStatus.PROPOSED: frozenset({DispatchStatus.COMMITTED, DispatchStatus.CANCELLED}),
    DispatchStatus.COMMITTED: frozenset({DispatchStatus.EN_ROUTE, DispatchStatus.CANCELLED}),
    DispatchStatus.EN_ROUTE: frozenset({DispatchStatus.ARRIVED, DispatchStatus.CANCELLED}),
    DispatchStatus.ARRIVED: frozenset({DispatchStatus.COMPLETED, DispatchStatus.CANCELLED}),
    DispatchStatus.COMPLETED: frozenset(),
    DispatchStatus.CANCELLED: frozenset(),
}


def assert_asset_transition(current: AssetStatus, nxt: AssetStatus) -> None:
    if nxt not in ASSET_TRANSITIONS[current]:
        raise IllegalTransition(f"asset: {current} -> {nxt} is not allowed")


def assert_incident_transition(current: IncidentStatus, nxt: IncidentStatus) -> None:
    if nxt not in INCIDENT_TRANSITIONS[current]:
        raise IllegalTransition(f"incident: {current} -> {nxt} is not allowed")


def assert_dispatch_transition(current: DispatchStatus, nxt: DispatchStatus) -> None:
    if nxt not in DISPATCH_TRANSITIONS[current]:
        raise IllegalTransition(f"dispatch: {current} -> {nxt} is not allowed")
