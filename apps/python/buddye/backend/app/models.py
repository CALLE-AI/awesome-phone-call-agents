"""BuddyE persistence model.

The shape to hold in mind: a **hazard** (heat warning, blackout) triggers a **sweep** over a
roster of **neighbours**. Every neighbour gets a **check call**, ordered by how much danger this
particular hazard puts *them* in — an oxygen concentrator matters during a power cut and not much
during a heat advisory. Each call ends in an outcome, and the outcomes that are not "safe" open an
**escalation**, which climbs a ladder and can end in a **handoff packet**: the page a first
responder actually needs, prepared by the machine and released by a human.

Two things here are deliberate and load-bearing:

* **Silence is a finding.** `CheckOutcome.UNREACHABLE` is a real outcome stored on the call, not an
  error swallowed by a retry. For a person whose life support is plugged into the wall, nobody
  answering is the most important thing the system can learn all day.
* **The last rung is not automatic.** A `HandoffPacket` is prepared, stored, and shown, and it sits
  at `AWAITING_AUTHORISATION` until a named human releases it. Nothing in this schema lets software
  dial an emergency service by itself.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

from app.domain.state import (
    AssetKind,
    AssetStatus,
    DispatchStatus,
    EscalationLevel,
    EscalationStatus,
    HazardStatus,
    IncidentStatus,
    SweepState,
)


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Neighbour(SQLModel, table=True):
    """A person on the block captain's list.

    Everything here is what a volunteer would already have written on a card, plus the few facts
    that decide urgency. `conditions` and `power_dependent` are health information about a named
    person at a known address: treat every read as sensitive and route it through app.obs.redact
    before it reaches a log, an event payload, or an API response.
    """

    id: str = Field(default_factory=lambda: _id("nbr"), primary_key=True)
    name: str
    phone: str  # E.164; seeded rows use fictional +1555-01xx numbers
    address: str
    unit: str = ""
    access_notes: str = ""  # "side gate, dog in yard", "key under the third pot" — for a responder
    # Real Maryvale coordinates. Distance, ETA and every asset movement are computed from these,
    # so a wrong one is a van sent to the wrong street rather than a cosmetic glitch.
    lat: float = 0.0
    lon: float = 0.0
    age_band: str = "unknown"  # under_65 | 65_74 | 75_plus | unknown
    lives_alone: bool = False
    conditions: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # heat_sensitive, copd, ...
    power_dependent: bool = False  # oxygen concentrator, dialysis, powered bed, refrigerated medication
    power_backup_hours: float = 0.0  # how long their equipment lasts unplugged; 0 = none
    cooling: str = "unknown"  # central_ac | window_unit | swamp_cooler | fan_only | none | unknown
    heating: str = "unknown"
    mobility: str = "independent"  # independent | cane_walker | wheelchair | bedbound
    has_transport: bool = True
    preferred_language: str = "en-US"  # BCP 47; passed to CALL-E as recipient.locale
    contact_name: str = ""    # who they nominated; BuddyE may call this person
    contact_phone: str = ""
    contact_relation: str = ""
    check_in_consent: bool = True  # opted in to automated welfare calls; no consent, no call
    notes: str = ""
    is_demo: bool = False  # true only for rows whose phone came from DEMO_PHONE_* env


class Hazard(SQLModel, table=True):
    """The thing that puts people in danger. Scoped to an area, with the facts triage needs."""

    id: str = Field(default_factory=lambda: _id("haz"), primary_key=True)
    kind: str  # heat | cold | power_outage | flood | smoke | storm | boil_water
    headline: str  # "Excessive Heat Warning — 114F" as a human would say it
    area: str  # "Maryvale, Phoenix"
    severity: str = "warning"  # advisory | watch | warning | emergency
    starts_at: str = ""  # ISO datetime, as issued
    ends_at: str = ""
    status: HazardStatus = HazardStatus.OPEN
    facts: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))  # temp_f, humidity_pct, outage_eta_h
    help_offered: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))  # what we can actually give
    source: str = ""  # "NWS AZZ537", or the captain who declared it
    declared_by: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    closed_at: datetime | None = None


class Sweep(SQLModel, table=True):
    """One pass over the roster for one hazard.

    Unlike a hiring cascade this does not stop at the first success: `call_order` is worked to the
    end, because the point is that nobody is missed.
    """

    id: str = Field(default_factory=lambda: _id("swp"), primary_key=True)
    hazard_id: str = Field(foreign_key="hazard.id", index=True)
    state: SweepState = SweepState.CREATED
    is_active: bool = True  # at most one active sweep per hazard
    provider: str = "mock"
    call_order: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # neighbour ids, most at risk first
    triage: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))  # neighbour id -> RiskAssessment
    current_index: int = 0
    calls_made: int = 0
    outcomes: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))  # neighbour id -> CheckOutcome
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    completed_at: datetime | None = None


class CheckCall(SQLModel, table=True):
    """One welfare call to one neighbour, and everything CALL-E gave back about it."""

    id: str = Field(default_factory=lambda: _id("call"), primary_key=True)
    sweep_id: str = Field(foreign_key="sweep.id", index=True)
    hazard_id: str = Field(index=True)
    neighbour_id: str = Field(index=True)
    callee: str = "neighbour"  # neighbour | emergency_contact — the ladder reuses this table
    attempt: int = 1
    idempotency_key: str = Field(unique=True)
    provider: str
    provider_call_id: str | None = Field(default=None, index=True)
    status: str = "PENDING"  # PENDING | DIALING | COMPLETED | NO_ANSWER | FAILED | INVALID_RESULT
    task: str
    result_schema: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    structured_result: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    validation_errors: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    transcript: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    summary: str | None = None
    task_completed: bool | None = None  # CALL-E's own post-call judgment
    completion_confidence: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))  # {score, label}
    evidence: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    risk_snapshot: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))  # why they were called when they were
    help_offered: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))  # what this call could give
    provider_raw: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))  # CALL-E's call object, redacted
    reconcile_meta: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))  # model, latency, usage
    poll_count: int = 0
    webhook_received: bool = False
    reconciled: bool = False
    outcome: str | None = None  # CheckOutcome
    outcome_reason: str | None = None
    concerns: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # what the call surfaced, in their words
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_s: int | None = None


class Escalation(SQLModel, table=True):
    """Opened whenever a check ends anywhere but SAFE, and climbed one rung at a time."""

    id: str = Field(default_factory=lambda: _id("esc"), primary_key=True)
    sweep_id: str = Field(index=True)
    hazard_id: str = Field(index=True)
    neighbour_id: str = Field(index=True)
    trigger_call_id: str | None = None
    outcome: str  # the CheckOutcome that opened it
    level: EscalationLevel = EscalationLevel.EMERGENCY_CONTACT
    status: EscalationStatus = EscalationStatus.OPEN
    reason: str = ""
    rungs: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))  # audit: level, at, result
    resolved_note: str = ""
    resolved_by: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    resolved_at: datetime | None = None


class HandoffPacket(SQLModel, table=True):
    """What a first responder is actually given, and the record of who authorised sending it.

    Prepared automatically; released only by a named human. `released_at` being null is the whole
    safety property — an unreleased packet has told nobody anything.
    """

    id: str = Field(default_factory=lambda: _id("pkt"), primary_key=True)
    escalation_id: str = Field(foreign_key="escalation.id", index=True)
    neighbour_id: str = Field(index=True)
    hazard_id: str = Field(index=True)
    # A snapshot, not a join: what was true when the packet was cut is what the responder was told.
    neighbour_snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    hazard_snapshot: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    last_contact_at: datetime | None = None
    last_words: str = ""  # verbatim, from a neighbour turn — never a paraphrase
    concerns: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    attempts_summary: list[dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    recommended_action: str = ""
    spoken_script: str = ""  # what a human would read out, or BuddyE would say once released
    prepared_at: datetime = Field(default_factory=utcnow)
    released_at: datetime | None = None
    released_by: str = ""      # a person's name. Never a service account, never empty when released.
    release_note: str = ""


class AgentEvent(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    hazard_id: str = Field(index=True)
    sweep_id: str | None = Field(default=None, index=True)
    neighbour_id: str | None = Field(default=None, index=True)
    type: str
    payload: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=utcnow)


class WebhookReceipt(SQLModel, table=True):
    event_id: str = Field(primary_key=True)
    call_id: str
    event_type: str
    received_at: datetime = Field(default_factory=utcnow)


class SpentCall(SQLModel, table=True):
    """One row per real call the provider accepted. Deliberately outside the demo data.

    Counting the budget from CheckCall would mean a demo reset silently handed the whole free tier
    back, because a reset wipes the demo tables. This one is never wiped.
    """

    provider_call_id: str = Field(primary_key=True)
    provider: str
    spent_at: datetime = Field(default_factory=utcnow)


# ---------------------------------------------------------------- dispatch side
# Real coordinates, because a map that cannot be checked against reality is decoration. Seeded
# neighbours sit at genuine Maryvale, Phoenix locations; the people are fictional, the streets
# are not, and every distance and ETA in this system is computed from these numbers.


class Asset(SQLModel, table=True):
    """Something a coordinator can actually move: a volunteer with a car, a water truck, a nurse.

    `lat`/`lon` are live position, advanced by the movement simulator on a real clock at
    `speed_mph`. Nothing here is a cosmetic animation — the position is server state, it is
    persisted, and every client watching the map is reading the same row.
    """

    id: str = Field(default_factory=lambda: _id("ast"), primary_key=True)
    call_sign: str  # "WV-2", "WATER-1" — what a coordinator says out loud
    kind: AssetKind
    status: AssetStatus = AssetStatus.AVAILABLE
    operator_name: str = ""  # the volunteer crewing it
    capabilities: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # water, ice, transport, battery, assess
    capacity: int = 1  # how many households it can serve before returning to base
    served_this_shift: int = 0
    speed_mph: float = 22.0  # surface streets, Phoenix, with stops
    base_lat: float = 0.0
    base_lon: float = 0.0
    lat: float = 0.0
    lon: float = 0.0
    heading_deg: float | None = None
    current_dispatch_id: str | None = Field(default=None, index=True)
    last_moved_at: datetime | None = None
    notes: str = ""


class Incident(SQLModel, table=True):
    """A check-in that ended badly enough to need something done about it.

    This is the operator's object, distinct from the Escalation that raised it: an escalation is
    about reaching a human being, an incident is about sending resources to an address.
    """

    id: str = Field(default_factory=lambda: _id("inc"), primary_key=True)
    hazard_id: str = Field(index=True)
    sweep_id: str = Field(index=True)
    neighbour_id: str = Field(index=True)
    escalation_id: str | None = Field(default=None, index=True)
    source_call_id: str | None = None
    status: IncidentStatus = IncidentStatus.OPEN
    priority: int = 3  # 1 = life safety, 5 = routine welfare. Set by triage, not by the caller.
    outcome: str = ""  # the CheckOutcome that opened it
    summary: str = ""
    needs: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # water, transport, power, assess
    lat: float = 0.0
    lon: float = 0.0
    address: str = ""
    opened_at: datetime = Field(default_factory=utcnow)
    resolved_at: datetime | None = None
    resolution: str = ""


class Dispatch(SQLModel, table=True):
    """One asset committed to one incident, with the route and clock a coordinator is judged on."""

    id: str = Field(default_factory=lambda: _id("dsp"), primary_key=True)
    incident_id: str = Field(foreign_key="incident.id", index=True)
    asset_id: str = Field(foreign_key="asset.id", index=True)
    status: DispatchStatus = DispatchStatus.PROPOSED
    reason: str = ""  # why THIS asset: distance, capability, capacity. Shown to the coordinator.
    proposed_by: str = "agent"  # agent | coordinator — provenance is never inferred later
    committed_by: str = ""
    # True for EMS/fire/police. Set from domain.state.requires_authorisation at proposal time and
    # never recomputed, so a later edit to the policy cannot retroactively un-authorise a dispatch
    # that a human already approved, nor silently authorise one they did not.
    requires_authorisation: bool = False
    authorised_by: str = ""      # a person's name. Never a service account, never blank once committed.
    authorised_at: datetime | None = None
    decline_reason: str = ""     # when a human says no, why — it is part of the incident record
    distance_miles: float = 0.0
    eta_minutes: float = 0.0
    route: list[list[float]] = Field(default_factory=list, sa_column=Column(JSON))  # [[lat, lon], ...]
    progress: float = 0.0  # 0..1 along the route; the simulator's cursor
    proposed_at: datetime = Field(default_factory=utcnow)
    committed_at: datetime | None = None
    arrived_at: datetime | None = None
    completed_at: datetime | None = None


class OperatorAction(SQLModel, table=True):
    """Anything an AI operator agent did, with enough provenance to argue with afterwards.

    Emergency management runs on being able to say who decided what, when, on what basis. An agent
    that assigns a truck without leaving that trail is not usable in this domain, so every agent
    call lands here: the model, the prompt's inputs, what it proposed, and whether a human
    accepted it.
    """

    id: str = Field(default_factory=lambda: _id("act"), primary_key=True)
    hazard_id: str = Field(index=True)
    incident_id: str | None = Field(default=None, index=True)
    kind: str  # dispatch_proposal | documentation | correspondence | triage_note
    agent: str  # which operator agent
    model: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    output: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    rationale: str = ""
    accepted: bool | None = None  # None = not yet reviewed
    accepted_by: str = ""
    latency_ms: int | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=utcnow)


class IncidentDocument(SQLModel, table=True):
    """Generated paperwork. Real incident management is largely paperwork, so BuddyE writes it.

    `form` follows the ICS forms a US emergency operations centre actually uses (ICS-214 activity
    log, ICS-213 general message), because a document a coordinator already knows how to read is
    worth more than a prettier one they do not.
    """

    id: str = Field(default_factory=lambda: _id("doc"), primary_key=True)
    hazard_id: str = Field(index=True)
    incident_id: str | None = Field(default=None, index=True)
    form: str  # ICS-214 | ICS-213 | after_action | situation_report
    title: str = ""
    body: str = ""
    fields: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    generated_by: str = ""  # agent name and model
    approved_by: str = ""   # blank until a human signs it
    created_at: datetime = Field(default_factory=utcnow)


class Correspondence(SQLModel, table=True):
    """A drafted message to a family member, a contact, or an agency.

    Drafted automatically, sent only on a human's say-so — the same boundary as the handoff packet.
    `sent_at` null means nobody has been contacted, whatever the draft says.
    """

    id: str = Field(default_factory=lambda: _id("msg"), primary_key=True)
    hazard_id: str = Field(index=True)
    incident_id: str | None = Field(default=None, index=True)
    neighbour_id: str | None = Field(default=None, index=True)
    channel: str = "sms"  # sms | email | call_script
    to_name: str = ""
    to_ref: str = ""  # phone or email, redacted on the way out
    subject: str = ""
    body: str = ""
    drafted_by: str = ""
    approved_by: str = ""
    sent_at: datetime | None = None
    created_at: datetime = Field(default_factory=utcnow)

