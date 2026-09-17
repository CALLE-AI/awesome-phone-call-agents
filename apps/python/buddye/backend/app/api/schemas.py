"""Wire shapes for the API.

Two conventions hold everywhere below. Phones are masked (`phone_masked`) and never returned raw —
the captain knows her neighbours' numbers, a browser tab open on a projector does not need them. And
the health fields that *are* returned — conditions, power_dependent, address — are returned on
purpose: they are the reason the board is useful, and there is no version of this product where a
captain deciding who to drive to first cannot see that Walter runs an oxygen concentrator. What is
not acceptable is those facts leaking into a log or a payload nobody asked for, which is what
`app.obs.redact` at egress and the deliberately thin `NeighbourView` in the call contract are for.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class HazardIn(BaseModel):
    """Declaring a hazard. `facts` is the loose dict `app.domain.hazards` parses — temp_f,
    humidity_pct, outage_eta_h, aqi are computed on and everything else rides along for the UI."""

    kind: str = "heat"
    headline: str = ""
    area: str = ""
    severity: str = "warning"
    starts_at: str = ""
    ends_at: str = ""
    facts: dict[str, Any] = Field(default_factory=dict)
    help_offered: list[dict[str, Any]] = Field(default_factory=list)
    source: str = ""
    declared_by: str = ""


class HazardOut(BaseModel):
    id: str
    kind: str
    headline: str
    area: str
    severity: str
    status: str
    starts_at: str
    ends_at: str
    facts: dict[str, Any]
    help_offered: list[dict[str, Any]]
    source: str
    declared_by: str
    created_at: str
    closed_at: str | None = None
    active_sweep_id: str | None = None
    sweeps: int = 0
    # What triage says about this hazard right now, without having to run one: the label, the
    # speakable facts, and the sentence CALL-E reads out as the reason for the call.
    profile: dict[str, Any] = Field(default_factory=dict)


class SweepAccepted(BaseModel):
    sweep_id: str
    hazard_id: str
    state: str
    created: bool


class NeighbourOut(BaseModel):
    id: str
    name: str
    phone_masked: str
    address: str
    unit: str
    access_notes: str
    lat: float
    lon: float
    age_band: str
    lives_alone: bool
    conditions: list[str]
    power_dependent: bool
    power_backup_hours: float
    cooling: str
    heating: str
    mobility: str
    has_transport: bool
    preferred_language: str
    contact_name: str
    contact_relation: str
    has_contact_phone: bool  # whether the ladder has a first rung to work at all
    check_in_consent: bool
    notes: str
    is_demo: bool
    # Present only when the request named a hazard: triage is about a person *under a hazard*.
    risk: dict[str, Any] | None = None
    outcome: str | None = None
    outcome_reason: str | None = None
    last_call_at: str | None = None


class ResolveIn(BaseModel):
    """Closing an escalation. `resolved_by` is a person, and `escalate.resolve` refuses without one."""

    resolved_by: str
    note: str = ""


class ReleaseIn(BaseModel):
    """Releasing a responder handoff.

    `released_by` is the whole safety property in one field: `escalate.release` refuses an empty
    name and refuses "system", "automation" and their friends, because this is the moment a person
    accepts responsibility for what a stranger is about to be told about a frail neighbour's home.
    """

    released_by: str
    note: str = ""


class DashboardOut(BaseModel):
    neighbours: int
    consenting: int
    hazards_open: int
    active_sweeps: int
    calls_made: int
    outcome_counts: dict[str, int]
    unaccounted: int
    escalations_open: int
    handoffs_prepared: int
    handoffs_released: int
    real_calls_used: int
    real_calls_budget: int
    provider: str
    block_captain: str
    area: str
