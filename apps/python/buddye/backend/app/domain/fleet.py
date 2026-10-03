"""Which resource goes to which address, decided by arithmetic.

This is the deterministic half of the operator layer, and it is deliberately the whole answer on
its own. An AI operator agent sits on top of it and does the thing models are good at — reading a
frightened person's own words and arguing for one unit over another in a sentence a coordinator can
weigh — but it never chooses from the open world: this module hands it a filtered list of legal
candidates, and it hands back a pick that this module validates before anything is committed. When
the gateway is slow, rate-limited, or returns nonsense, `rank()` is what runs, and nobody watching
the board can tell except that the justification is terser. That is the property worth protecting:
**a model outage degrades the prose, never the dispatch.**

Four functions, in the order a dispatch actually happens:

    needs_for(...)        what this incident requires, derived from the call and the triage
    eligible(...)         who could legally take it, and a sentence for everyone who could not
    rank(...)             the order to offer them in, by real ETA over real distance
    validate_choice(...)  the gate every proposal — human or model — passes before it is committed

Three decisions in here are not obvious and are load-bearing:

* **Exclusions are first-class output.** `eligible()` returns why each asset was passed over, by
  name. A coordinator who asks "why didn't you send WV-2?" and gets silence stops using the tool;
  the answer has to be on the screen already. So an exclusion carries a code *and* a sentence.
* **`eligible()` and `validate_choice()` are the same code.** Both call `_evaluate`. A dispatch
  engine whose filter and whose gate can disagree will eventually commit something the filter would
  have refused, and the disagreement will surface at the worst possible moment.
* **Agency units are not merely flagged, they are not offered.** `requires_authorisation()` decides
  whether a human must approve a commitment. This module goes further and refuses to *consider* an
  EMS, fire or police unit at all unless the incident is agency-justified — a life-safety finding,
  or silence from someone triage put hours from harm. An ambulance is faster than a wellness van on
  almost every street in Maryvale, so a pure ETA race would hand every water drop to a rescue unit
  and take it away from someone else's emergency. Speed is not a licence.

Nothing here touches a model, a network or a clock. Given the same rows it returns the same answer,
which is what makes it usable as both the fallback and the referee.

Wiring note for the next phase: `app.seed_assets.seed_assets(session)` is the fleet superset,
idempotent by call sign, and is not yet called from the demo path. It belongs in `app.seed.seed`
immediately after the existing `seed_assets(session)` line, or equivalently in
`app.seed_helpers.reset_demo` inside the same `session_scope`. Until that one line exists the
agency units are in the tests and not on the board.

Call it *qualified*. `app/seed.py` already defines a module-level `def seed_assets(session)`, so
`from app.seed_assets import seed_assets` at the top of that file is rebound by the local `def` and
`seed()` silently keeps planting six community assets — no error, and `tests/test_fleet.py` still
passes because it imports the module directly. Use `from app import seed_assets as fleet_seed` and
call `fleet_seed.seed_assets(session)`.

Privacy: needs are derived from health facts about a named person (an oxygen concentrator, insulin
in a warm fridge). The reasons say so, because that is what makes them useful to a coordinator.
Redact at egress via `app.obs.redact`, never in here.
"""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator

from app.domain.geo import drive_miles, eta_minutes
from app.domain.risk import RiskBand
from app.domain.state import AssetKind, AssetStatus, CheckOutcome, requires_authorisation

# ------------------------------------------------------------------------------------------------
# Capability vocabulary
#
# What an incident can need and what an asset can claim are the same words, so a coordinator reading
# "needs: battery, water" against "PWR-1: battery, power" can do the match in their head.
# ------------------------------------------------------------------------------------------------
MEDICAL = "medical"              # paramedic-level care. Only an agency unit has it, by definition.
BATTERY = "battery"              # portable power for equipment that runs off the wall
MEDICATION = "medication"        # getting a prescription, or keeping one cold
WATER = "water"
ICE = "ice"
TRANSPORT = "transport"          # a ride to a cooling or resource centre
WELFARE_CHECK = "welfare_check"  # somebody physically knocks on the door
ASSESS = "assess"               # eyes on the person: are they alright, and what do they need
FORCED_ENTRY = "forced_entry"    # getting through a locked door. Fire or police only.
WHEELCHAIR = "wheelchair"        # the vehicle has a lift or a ramp

#: Worst first. Fixes the order needs are listed in, so two incidents with the same needs read the
#: same way on the board and in every generated document.
CAPABILITY_ORDER: tuple[str, ...] = (
    MEDICAL, BATTERY, MEDICATION, WATER, ICE, TRANSPORT, WELFARE_CHECK, ASSESS, FORCED_ENTRY, WHEELCHAIR,
)
_ORDER_INDEX = {c: i for i, c in enumerate(CAPABILITY_ORDER)}

#: Which asset capabilities actually satisfy a need. This table exists because the fleet's own
#: vocabulary is looser than the need vocabulary and always will be — volunteers wrote it. PWR-1
#: carries `["battery", "power"]`; WV-1 carries `assess` and is exactly who does a door knock. If a
#: need could only be met by a capability spelled identically, a door knock in the seeded demo would
#: match no community asset at all and the only thing left standing would be a police unit, which is
#: precisely backwards.
NEED_SATISFIED_BY: dict[str, frozenset[str]] = {
    MEDICAL: frozenset({MEDICAL}),
    BATTERY: frozenset({BATTERY, "power"}),
    MEDICATION: frozenset({MEDICATION, ASSESS}),  # a nurse carries it; a volunteer can fetch it
    WATER: frozenset({WATER}),
    ICE: frozenset({ICE}),
    TRANSPORT: frozenset({TRANSPORT}),
    WELFARE_CHECK: frozenset({WELFARE_CHECK, ASSESS}),
    ASSESS: frozenset({ASSESS, MEDICAL}),
    FORCED_ENTRY: frozenset({FORCED_ENTRY}),
    WHEELCHAIR: frozenset({WHEELCHAIR}),
}

#: The offer keys CALL-E hands back in `help_accepted` / `help_declined`, mapped to what has to
#: physically arrive. These strings are owned by `app.seed.HEAT_HELP` / `OUTAGE_HELP` and quoted by
#: the mock fixtures; `tests/test_fleet.py` pins every one of them, because a silent typo here means
#: Rosa accepts a ride and no transport need is ever generated.
HELP_TO_CAPABILITY: dict[str, tuple[str, ...]] = {
    "ride": (TRANSPORT,),
    "cooling_center": (TRANSPORT,),
    "resource_center": (TRANSPORT,),
    "water_ice_drop": (WATER, ICE),
    "ice_drop": (ICE,),
    "water_drop": (WATER,),
    "wellness_visit": (WELFARE_CHECK,),
    "power_cart": (BATTERY,),
    "medication_run": (MEDICATION,),
}

# How the condition checks turn into things to send. `(alarming answer, capabilities, sentence)`.
# Polarity is not uniform — for `too_hot` the bad answer is "yes", for `has_power` it is "no" — and
# it is copied from `app.orchestrator.decide.CHECK_ALARM` rather than re-derived, because inverting
# one of these would send water to the people who do not need it and nothing to the people who do.
CHECK_TO_NEEDS: dict[str, tuple[str, tuple[str, ...], str]] = {
    "too_hot": ("yes", (WATER, ICE), "it is dangerously hot inside their home"),
    "too_cold": ("yes", (WELFARE_CHECK,), "it is dangerously cold inside their home"),
    "has_water": ("no", (WATER,), "they have no safe drinking water"),
    "has_food": ("no", (WELFARE_CHECK,), "they have no food they can eat today"),
    "has_medication": ("no", (MEDICATION,), "they do not have the medicine they need"),
    "can_evacuate": ("no", (ASSESS,), "they could not leave the home under their own power"),
}


# ------------------------------------------------------------------------------------------------
# Priority
#
# `Incident.priority` is 1-5 and 1 means life safety. The numbers are written out rather than
# computed so that changing what counts as life safety is a visible edit to a table.
#
# The ordering here must not contradict `app.orchestrator.decide.PRIORITY`, the 0-100 score the
# captain's board already sorts on — two screens disagreeing about who is most urgent is worse than
# either ordering being slightly wrong. This table is that score bucketed at 85 / 60 / 45 / 25, and
# `tests/test_fleet.py` asserts the two stay monotonic with each other. `decide` is deliberately not
# imported: domain code does not depend on the orchestrator.
# ------------------------------------------------------------------------------------------------
INCIDENT_PRIORITY: dict[CheckOutcome, dict[RiskBand, int]] = {
    CheckOutcome.UNREACHABLE:   {RiskBand.CRITICAL: 1, RiskBand.HIGH: 2, RiskBand.ELEVATED: 3, RiskBand.ROUTINE: 4},
    CheckOutcome.URGENT:        {RiskBand.CRITICAL: 1, RiskBand.HIGH: 1, RiskBand.ELEVATED: 2, RiskBand.ROUTINE: 2},
    CheckOutcome.NEEDS_HELP:    {RiskBand.CRITICAL: 2, RiskBand.HIGH: 3, RiskBand.ELEVATED: 4, RiskBand.ROUTINE: 4},
    CheckOutcome.HELP_DECLINED: {RiskBand.CRITICAL: 3, RiskBand.HIGH: 4, RiskBand.ELEVATED: 5, RiskBand.ROUTINE: 5},
    CheckOutcome.SAFE:          {RiskBand.CRITICAL: 5, RiskBand.HIGH: 5, RiskBand.ELEVATED: 5, RiskBand.ROUTINE: 5},
}

PRIORITY_LABEL: dict[int, str] = {
    1: "life safety",
    2: "urgent",
    3: "prompt",
    4: "same evening",
    5: "routine",
}

#: How far out it is still sensible to send someone, by priority, in driving miles. At life safety
#: you take the unit that exists even if it is across the village; at routine you do not send a van
#: forty minutes for a case of water it could have dropped on its own block.
RADIUS_BY_PRIORITY: dict[int, float] = {1: 15.0, 2: 10.0, 3: 6.0, 4: 5.0, 5: 4.0}
DEFAULT_PRIORITY = 3

#: Two ETAs inside one bucket are a tie, and a tie is broken by fit rather than by seconds. The
#: bucket narrows with priority: for life safety half a minute is worth having, for a routine water
#: drop the better-suited vehicle beats one that is ninety seconds closer.
ETA_TIE_MINUTES: dict[int, float] = {1: 0.25, 2: 0.5, 3: 1.0, 4: 2.0, 5: 2.0}


def incident_priority(outcome: Any, band: Any = None) -> int:
    """Map a check outcome and a triage band onto `Incident.priority` (1 = life safety).

    Unknown inputs degrade toward *more* urgent, never less: not knowing what happened on a call is
    not evidence that nothing did.
    """
    o = _as_outcome(outcome)
    b = _as_band(band)
    if o is None:
        return 2 if b in (RiskBand.CRITICAL, RiskBand.HIGH) else DEFAULT_PRIORITY
    return INCIDENT_PRIORITY[o][b]


def priority_label(priority: int) -> str:
    return PRIORITY_LABEL.get(int(priority), "routine")


# ------------------------------------------------------------------------------------------------
# Needs
# ------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Need:
    """One thing that has to physically arrive, and the sentence that justifies it."""

    capability: str
    reason: str
    life_safety: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {"capability": self.capability, "reason": self.reason, "life_safety": self.life_safety}


@dataclass(frozen=True)
class NeedSet:
    """What one incident requires. Iterates as capability strings so `list(needs)` is what goes
    straight onto `Incident.needs`, and `"water" in needs` reads the way it should."""

    needs: tuple[Need, ...] = ()
    #: Nice to have, never required: a lift for a wheelchair user, a crew that can force a door.
    #: Improves ranking fit; never excludes anybody, because a preference that filters is a
    #: requirement wearing a disguise.
    preferred: tuple[Need, ...] = ()
    #: Things worth saying that nothing in the fleet can fix. A coordinator reads these.
    notes: tuple[str, ...] = ()
    agency_justified: bool = False
    agency_reason: str = ""
    outcome: str = ""
    band: str = ""
    priority: int = DEFAULT_PRIORITY

    @property
    def capabilities(self) -> tuple[str, ...]:
        return tuple(n.capability for n in self.needs)

    @property
    def preferred_capabilities(self) -> tuple[str, ...]:
        return tuple(n.capability for n in self.preferred)

    @property
    def life_safety(self) -> bool:
        return any(n.life_safety for n in self.needs)

    def reason_for(self, capability: str) -> str:
        for n in self.needs + self.preferred:
            if n.capability == capability:
                return n.reason
        return ""

    def __iter__(self) -> Iterator[str]:
        return iter(self.capabilities)

    def __len__(self) -> int:
        return len(self.needs)

    def __contains__(self, capability: object) -> bool:
        return capability in self.capabilities

    def to_dict(self) -> dict[str, Any]:
        return {
            "capabilities": list(self.capabilities),
            "needs": [n.to_dict() for n in self.needs],
            "preferred": [n.to_dict() for n in self.preferred],
            "notes": list(self.notes),
            "agency_justified": self.agency_justified,
            "agency_reason": self.agency_reason,
            "outcome": self.outcome,
            "band": self.band,
            "priority": self.priority,
            "priority_label": priority_label(self.priority),
        }


class _NeedBuilder:
    def __init__(self) -> None:
        self._needs: dict[str, Need] = {}
        self._preferred: dict[str, Need] = {}
        self.notes: list[str] = []

    def add(self, capability: str, reason: str, *, life_safety: bool = False) -> None:
        existing = self._needs.get(capability)
        if existing is None:
            self._needs[capability] = Need(capability, reason, life_safety)
        elif life_safety and not existing.life_safety:
            # A second, graver reason for the same thing upgrades it rather than being dropped.
            self._needs[capability] = Need(capability, existing.reason, True)

    def prefer(self, capability: str, reason: str) -> None:
        self._preferred.setdefault(capability, Need(capability, reason))

    def has(self, capability: str) -> bool:
        return capability in self._needs

    @property
    def empty(self) -> bool:
        return not self._needs

    def note(self, sentence: str) -> None:
        if sentence and sentence not in self.notes:
            self.notes.append(sentence)

    def _sorted(self, items: dict[str, Need]) -> tuple[Need, ...]:
        return tuple(sorted(items.values(), key=lambda n: _ORDER_INDEX.get(n.capability, 99)))

    def build(self, **kwargs: Any) -> NeedSet:
        return NeedSet(needs=self._sorted(self._needs), preferred=self._sorted(self._preferred),
                       notes=tuple(self.notes), **kwargs)


def needs_for(
    incident: Any = None,
    *,
    outcome: Any = None,
    decision: Any = None,
    result: Any = None,
    risk: Any = None,
    neighbour: Any = None,
) -> NeedSet:
    """What this incident actually requires, and why.

    Accepts whatever the caller happens to hold: an `Incident` row, a `DecisionResult` (or its
    `to_dict()`), the raw CALL-E `structured_result`, a `RiskAssessment` or the dict form stored in
    `Sweep.triage`, and the `Neighbour` row. Everything is optional and everything degrades — an
    incident that arrives with nothing but an outcome still comes out with a defensible need set,
    because a dispatch layer that raises on a half-filled row sends nobody at all.

    The three inputs that carry the most weight, in order: what they *accepted* (a person asking for
    a ride is the least ambiguous signal in this product), what the condition checks established,
    and what triage already knew about the machine plugged into their wall.
    """
    b = _NeedBuilder()

    o = _as_outcome(outcome) or _as_outcome(_get(decision, "outcome")) or _as_outcome(_get(incident, "outcome"))
    band = _as_band(risk if risk is not None else _get(decision, "band"))
    hours = _hours_to_harm(risk)
    checks = _checks(decision, result)
    accepted = _string_list(_get(decision, "help_accepted") or _get(result, "help_accepted"))

    # 1. What they said yes to. `help_accepted` is a key from the hazard's own offer list.
    for key in accepted:
        caps = HELP_TO_CAPABILITY.get(_slug(key))
        if caps:
            for cap in caps:
                b.add(cap, f"they accepted the offer of {_offer_phrase(key)} on the call")
        else:
            # An offer we do not recognise is never dropped: somebody said yes to something.
            b.add(ASSESS, f"they accepted {key!r}, which is not an offer this fleet knows how to "
                          f"fill — send someone to find out what they were promised")

    # 2. What the call established about the house.
    for name, (alarm, caps, sentence) in CHECK_TO_NEEDS.items():
        if checks.get(name) == alarm:
            for cap in caps:
                b.add(cap, sentence)

    # 3. Power, equipment, and the clock triage put on it. This is the one place where a need is
    #    life safety on its own: equipment that has stopped is not a delivery, it is an emergency.
    power_dependent = bool(_get(neighbour, "power_dependent", False))
    if checks.get("equipment_working") == "no":
        b.add(MEDICAL, "the powered medical equipment they depend on has stopped", life_safety=True)
        b.add(BATTERY, "their equipment has stopped and needs power now, not when the utility says so",
              life_safety=True)
    elif checks.get("has_power") == "no":
        if power_dependent:
            clock = f" and triage put them about {hours:g}h from harm" if hours is not None else ""
            b.add(BATTERY, f"the power is off in a home that runs medical equipment off the wall{clock}",
                  life_safety=hours is not None and hours <= 2.0)
        if _has_condition(neighbour, "refrigerated_meds", "insulin"):
            b.add(ICE, "the power is off and there is medication in the refrigerator that has to stay cold")
        if not power_dependent:
            b.add(WELFARE_CHECK, "the power is off in the home and nobody has laid eyes on them since")
    elif power_dependent and hours is not None and hours <= 4.0:
        b.add(BATTERY, f"their equipment runs on wall power and triage put them about {hours:g}h from harm")

    if checks.get("is_safe_now") == "no" or o is CheckOutcome.URGENT:
        b.add(MEDICAL, "they told us something is wrong right now", life_safety=True)
        b.add(ASSESS, "somebody has to lay eyes on them and say what is actually happening",
              life_safety=True)

    # 4. Silence. An unanswered call to somebody triage put hours from harm is the strongest signal
    #    in a sweep, and the only thing that resolves it is a person at the door.
    if o is CheckOutcome.UNREACHABLE:
        if band is RiskBand.CRITICAL:
            b.add(WELFARE_CHECK, "nobody answered, and triage put them in the critical band: "
                                 "silence here is the finding, not a gap in the data", life_safety=True)
            b.prefer(FORCED_ENTRY, "if there is no answer at the door, getting in is the next question "
                                   "and a volunteer cannot answer it")
        else:
            b.add(WELFARE_CHECK, f"nobody answered the phone and triage has them in the {band.value} band")

    # 5. Nothing on this call to derive from — the caller handed us a stored incident rather than a
    #    conversation. Fall back to what was written down when it was triaged, so re-reading an
    #    incident never produces a different, emptier answer than the one a coordinator approved.
    #    Placed after the derivation rules so a derived sentence always wins over "as recorded".
    if not checks and not accepted:
        for cap in _string_list(_get(incident, "needs")):
            b.add(cap, "recorded on this incident when it was triaged")

    # 6. They accepted help but the call never recorded which. Somebody goes and asks.
    if o is CheckOutcome.NEEDS_HELP and b.empty:
        b.add(WELFARE_CHECK, "they said they needed something and the call did not establish what")

    if o is CheckOutcome.HELP_DECLINED and b.empty:
        b.note("they were offered help and turned it all down; nothing is sent unless a coordinator "
               "decides otherwise, and that decision is theirs to make")

    if o is CheckOutcome.SAFE and b.empty:
        b.note("the call ended safe and nothing needs to be sent")

    # 7. Mobility. Never a filter — the fleet must not refuse to take a wheelchair user anywhere
    #    because no lift is on shift — but it decides which of two equal drivers goes.
    mobility = str(_get(neighbour, "mobility", "") or "").strip().lower()
    if b.has(TRANSPORT) and mobility in {"wheelchair", "bedbound", "wheelchair_user"}:
        b.prefer(WHEELCHAIR, "they use a wheelchair, so a car without a lift cannot take them")
        b.note("a driver without a lift cannot move this person on their own")

    agency, agency_reason = _agency_justification(o, band, checks)
    return b.build(
        agency_justified=agency,
        agency_reason=agency_reason,
        outcome=o.value if o else "",
        band=band.value,
        # Derived first, and urgency never goes down by being read back. `Incident.priority`
        # defaults to 3 on a fresh row, so trusting the stored value would quietly file Walter —
        # unreachable in the critical band — as "prompt" and then look for help inside six miles
        # instead of fifteen. Deriving is also the non-circular direction: this function is what
        # the column is supposed to be computed *by*. But a coordinator (or an earlier triage that
        # had the risk band this call does not) may have written something graver on the row, and
        # that must not be undone, so the more urgent of the two wins.
        priority=_most_urgent(incident_priority(o, band) if o is not None else None,
                              int(_get(incident, "priority", 0) or 0)),
    )


def _most_urgent(derived: int | None, stored: int) -> int:
    """The graver of a derived and a stored priority. 1 is gravest; 0 means "nothing stored"."""
    candidates = [p for p in (derived, stored if 1 <= stored <= 5 else None) if p is not None]
    return min(candidates) if candidates else DEFAULT_PRIORITY


def _agency_justification(o: CheckOutcome | None, band: RiskBand, checks: Mapping[str, str]) -> tuple[bool, str]:
    """May an agency unit even be considered for this incident?

    Deliberately narrow. Everything this answers `True` for still needs a named human to approve the
    dispatch — this only decides whether the request is worth putting in front of them at all.
    """
    if checks.get("equipment_working") == "no":
        return True, "powered medical equipment they depend on has stopped"
    if checks.get("is_safe_now") == "no":
        return True, "they told us something is wrong right now"
    if o is CheckOutcome.URGENT:
        return True, "the check-in came back urgent"
    if o is CheckOutcome.UNREACHABLE and band is RiskBand.CRITICAL:
        return True, ("nobody answered and triage put them in the critical band; if a volunteer gets "
                      "no answer at the door, a welfare check is the next rung")
    return False, ""


# ------------------------------------------------------------------------------------------------
# Eligibility
# ------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Exclusion:
    """Why one asset was not offered. Named, coded and written out — a coordinator asking "why not
    WV-2?" gets the sentence off the screen instead of off a developer."""

    asset_id: str
    call_sign: str
    kind: str
    code: str  # status | committed | capacity | authorisation | capability | radius | speed | no_needs | no_location
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {"asset_id": self.asset_id, "call_sign": self.call_sign, "kind": self.kind,
                "code": self.code, "reason": self.reason}


@dataclass(frozen=True)
class Candidate:
    """An asset that could legally take this incident, with the numbers that decide the order."""

    asset_id: str
    call_sign: str
    kind: str
    matched: tuple[str, ...]
    preferred_matched: tuple[str, ...]
    unmet: tuple[str, ...]
    distance_miles: float
    eta_minutes: float
    spare_capacity: int
    capacity: int
    requires_authorisation: bool
    asset: Any = field(default=None, compare=False, repr=False)

    @property
    def fit(self) -> int:
        """How well this unit suits the job: every need met counts double a nice-to-have."""
        return 2 * len(self.matched) + len(self.preferred_matched)

    @property
    def reason(self) -> str:
        """The sentence shown next to the proposal. Distance and ETA are the computed ones."""
        carries = ", ".join(self.matched)
        gap = f"; cannot cover {', '.join(self.unmet)}" if self.unmet else ""
        auth = " — agency unit: stays proposed until a named human approves it" if self.requires_authorisation else ""
        return (f"{self.call_sign} covers {carries}, {self.distance_miles:.1f} mi out, "
                f"about {self.eta_minutes:.0f} min, {self.spare_capacity} of {self.capacity} "
                f"stops left this shift{gap}{auth}")

    def to_dict(self) -> dict[str, Any]:
        return {"asset_id": self.asset_id, "call_sign": self.call_sign, "kind": self.kind,
                "matched": list(self.matched), "preferred_matched": list(self.preferred_matched),
                "unmet": list(self.unmet), "distance_miles": round(self.distance_miles, 2),
                "eta_minutes": round(self.eta_minutes, 1), "spare_capacity": self.spare_capacity,
                "capacity": self.capacity, "requires_authorisation": self.requires_authorisation,
                "fit": self.fit, "reason": self.reason}


@dataclass(frozen=True)
class Eligibility:
    candidates: tuple[Candidate, ...]
    excluded: tuple[Exclusion, ...]
    needs: NeedSet
    radius_miles: float
    error: str = ""  # set when the incident itself made the question unanswerable

    def best(self) -> Candidate | None:
        """The deterministic pick. This is what runs when the model is unavailable."""
        ranked = rank(self.candidates, priority=self.needs.priority)
        return ranked[0] if ranked else None

    def to_dict(self) -> dict[str, Any]:
        return {"candidates": [c.to_dict() for c in rank(self.candidates, priority=self.needs.priority)],
                "excluded": [e.to_dict() for e in self.excluded],
                "needs": self.needs.to_dict(), "radius_miles": self.radius_miles, "error": self.error}


@dataclass(frozen=True)
class ValidationResult:
    """The gate. Truthy when the pick is legal; the reason is written either way."""

    ok: bool
    reason: str
    code: str = ""
    requires_authorisation: bool = False
    distance_miles: float | None = None
    eta_minutes: float | None = None

    def __bool__(self) -> bool:
        return self.ok

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "reason": self.reason, "code": self.code,
                "requires_authorisation": self.requires_authorisation,
                "distance_miles": None if self.distance_miles is None else round(self.distance_miles, 2),
                "eta_minutes": None if self.eta_minutes is None else round(self.eta_minutes, 1)}


def eligible(
    assets: Iterable[Any],
    incident: Any,
    needs: NeedSet | Sequence[str] | None = None,
    *,
    radius_miles: float | None = None,
) -> Eligibility:
    """Filter the fleet to the units that could legally take this incident.

    Legal means all five at once: AVAILABLE and not already committed, carrying at least one
    capability this incident needs, with capacity left this shift, inside a sane radius, and —
    for EMS, fire and police — attached to an incident that justifies an agency unit at all.

    Everything that fails comes back in `excluded` with a sentence naming the asset.
    """
    need_set = _as_needset(needs, incident)
    priority = need_set.priority
    radius = radius_miles if radius_miles is not None else RADIUS_BY_PRIORITY.get(priority, 6.0)
    inc = _IncidentView(incident, priority)

    candidates: list[Candidate] = []
    excluded: list[Exclusion] = []
    for asset in assets:
        cand, exc = _evaluate(asset, inc, need_set, radius)
        if cand is not None:
            candidates.append(cand)
        elif exc is not None:
            excluded.append(exc)
    error = "" if inc.located else (
        "this incident has no coordinates, so no distance, ETA or route can be computed; copy "
        "lat/lon from the neighbour before dispatching anything"
    )
    return Eligibility(candidates=tuple(candidates), excluded=tuple(excluded), needs=need_set,
                       radius_miles=radius, error=error)


def rank(candidates: Iterable[Candidate], incident: Any = None, *, priority: int | None = None) -> list[Candidate]:
    """Deterministic order: real ETA first, then how well the unit fits, then how much it has left.

    ETA is quantised into fixed bins before it is compared, so units arriving within the same bin
    are a tie and the tie is won by the vehicle that can actually do the job rather than by
    floating-point noise. (Fixed bins, not "within N minutes of each other": 2.9 and 3.1 fall either
    side of a one-minute boundary while 2.1 and 2.9 tie. The order stays total and deterministic
    either way, and the primary rule — closest capable unit wins — is unaffected.) The bin narrows
    as priority rises, because at life safety half a minute is worth having and on a routine water
    drop it is not. Everything after that is a total order
    down to the call sign, so the same fleet always produces the same list — the model on top can be
    diffed against it, and a coordinator can learn what the machine will say next.

    Agency units lose an otherwise exact tie: they cannot move until a human clicks, and that click
    is time the ETA does not show.
    """
    cands = list(candidates)
    p = priority if priority is not None else int(_get(incident, "priority", DEFAULT_PRIORITY) or DEFAULT_PRIORITY)
    bucket = ETA_TIE_MINUTES.get(p, 1.0)

    def key(c: Candidate) -> tuple[Any, ...]:
        eta_bucket = math.inf if math.isinf(c.eta_minutes) else math.floor(c.eta_minutes / bucket)
        return (eta_bucket, -c.fit, -c.spare_capacity, c.requires_authorisation, c.call_sign)

    return sorted(cands, key=key)


def validate_choice(
    asset: Any,
    incident: Any,
    needs: NeedSet | Sequence[str] | None = None,
    *,
    radius_miles: float | None = None,
) -> ValidationResult:
    """Is committing this asset to this incident legal? The gate every proposal passes.

    A model proposal, a coordinator's manual override and the deterministic pick all come through
    here, and it runs the *same* `_evaluate` that built the candidate list — a filter and a gate
    that can disagree will eventually commit something the filter would have refused.

    `ok` True with `requires_authorisation` True is the interesting case: the dispatch is legal to
    prepare and illegal to send. The caller writes it as PROPOSED and waits for a name.
    """
    need_set = _as_needset(needs, incident)
    radius = radius_miles if radius_miles is not None else RADIUS_BY_PRIORITY.get(need_set.priority, 6.0)
    inc = _IncidentView(incident, need_set.priority)
    cand, exc = _evaluate(asset, inc, need_set, radius)
    if cand is None:
        return ValidationResult(False, exc.reason if exc else "asset could not be evaluated",
                                code=exc.code if exc else "unknown")
    return ValidationResult(True, cand.reason, code="ok",
                            requires_authorisation=cand.requires_authorisation,
                            distance_miles=cand.distance_miles, eta_minutes=cand.eta_minutes)


def deterministic_choice(
    assets: Iterable[Any],
    incident: Any,
    needs: NeedSet | Sequence[str] | None = None,
) -> tuple[Candidate | None, Eligibility]:
    """The whole pipeline with no model in it: filter, rank, take the top.

    This is the answer the system falls back to whenever the operator agent is slow, rate-limited,
    or returns something that does not survive `validate_choice`.
    """
    report = eligible(assets, incident, needs)
    return report.best(), report


# ------------------------------------------------------------------------------------------------
# The single evaluation path shared by eligible() and validate_choice().
# ------------------------------------------------------------------------------------------------
def _evaluate(asset: Any, inc: "_IncidentView", needs: NeedSet, radius: float) -> tuple[Candidate | None, Exclusion | None]:
    a = _AssetView(asset)

    def no(code: str, reason: str) -> tuple[None, Exclusion]:
        return None, Exclusion(asset_id=a.id, call_sign=a.call_sign, kind=a.kind, code=code, reason=reason)

    if not inc.located:
        return no("no_location", f"{a.call_sign} was not considered: the incident has no coordinates, "
                                 f"so nothing about distance or arrival can be computed")
    if not needs.capabilities:
        return no("no_needs", f"{a.call_sign} was not considered: this incident does not record "
                              f"anything that needs to be delivered or done at the address")
    if a.status is not AssetStatus.AVAILABLE:
        return no("status", f"{a.call_sign} is {a.status.value.lower().replace('_', ' ')}, not available")
    if a.current_dispatch_id:
        return no("committed", f"{a.call_sign} is already committed to another incident "
                               f"({a.current_dispatch_id})")
    if a.spare <= 0:
        return no("capacity", f"{a.call_sign} has served {a.served} of {a.capacity} stops this shift "
                              f"and has no capacity left")
    if a.requires_authorisation and not needs.agency_justified:
        return no("authorisation", f"{a.call_sign} is an agency unit and this incident does not "
                                   f"justify one: it needs {_join(needs.capabilities)}, and taking a "
                                   f"crew off the street for that removes them from somebody else's "
                                   f"emergency")

    matched = tuple(c for c in needs.capabilities if a.can(c))
    if not matched:
        return no("capability", f"{a.call_sign} carries {_join(a.capabilities) or 'nothing on file'} "
                                f"and this incident needs {_join(needs.capabilities)}")
    if a.speed_mph <= 0:
        return no("speed", f"{a.call_sign} has no road speed on file, so it has no arrival time and "
                           f"cannot be promised to anybody")

    distance = drive_miles(a.lat, a.lon, inc.lat, inc.lon)
    if distance > radius:
        return no("radius", f"{a.call_sign} is {distance:.1f} mi away by road, past the {radius:.0f} mi "
                            f"limit for a {priority_label(inc.priority)} incident")

    eta = eta_minutes(distance, a.speed_mph)
    preferred = tuple(c for c in needs.preferred_capabilities if a.can(c))
    unmet = tuple(c for c in needs.capabilities if c not in matched)
    return Candidate(
        asset_id=a.id, call_sign=a.call_sign, kind=a.kind, matched=matched,
        preferred_matched=preferred, unmet=unmet, distance_miles=distance, eta_minutes=eta,
        spare_capacity=a.spare, capacity=a.capacity, requires_authorisation=a.requires_authorisation,
        asset=asset,
    ), None


# ------------------------------------------------------------------------------------------------
# Views. Everything reads a SQLModel row, a dict, or anything with the attributes, the same way
# `app.domain.risk` does — the callers hold whichever of those is nearest to hand.
# ------------------------------------------------------------------------------------------------
class _AssetView:
    def __init__(self, asset: Any) -> None:
        self.raw = asset
        self.id = str(_get(asset, "id", "") or "")
        self.call_sign = str(_get(asset, "call_sign", "") or self.id or "(unnamed asset)")
        raw_kind = _get(asset, "kind", "")
        self.kind = raw_kind.value if isinstance(raw_kind, AssetKind) else str(raw_kind or "")
        raw_status = _get(asset, "status", AssetStatus.AVAILABLE)
        try:
            self.status = AssetStatus(raw_status)
        except ValueError:
            self.status = AssetStatus.OUT_OF_SERVICE  # an unreadable status is never dispatchable
        self.capabilities = tuple(str(c).strip().lower() for c in (_get(asset, "capabilities", []) or []))
        self.capacity = int(_get(asset, "capacity", 1) or 0)
        self.served = int(_get(asset, "served_this_shift", 0) or 0)
        self.speed_mph = float(_get(asset, "speed_mph", 0.0) or 0.0)
        self.lat = float(_get(asset, "lat", 0.0) or 0.0)
        self.lon = float(_get(asset, "lon", 0.0) or 0.0)
        self.current_dispatch_id = str(_get(asset, "current_dispatch_id", "") or "")
        try:
            self.requires_authorisation = requires_authorisation(self.kind)
        except ValueError:
            # A kind this build does not know is treated as needing a human. Failing closed here
            # costs a click; failing open sends an unknown vehicle on its own authority.
            self.requires_authorisation = True

    @property
    def spare(self) -> int:
        return self.capacity - self.served

    def can(self, need: str) -> bool:
        return bool(NEED_SATISFIED_BY.get(need, frozenset({need})) & set(self.capabilities))


class _IncidentView:
    def __init__(self, incident: Any, priority: int) -> None:
        self.raw = incident
        self.id = str(_get(incident, "id", "") or "")
        self.lat = float(_get(incident, "lat", 0.0) or 0.0)
        self.lon = float(_get(incident, "lon", 0.0) or 0.0)
        self.priority = priority
        self.address = str(_get(incident, "address", "") or "")

    @property
    def located(self) -> bool:
        """(0, 0) is in the Atlantic. An incident row is created before its coordinates are copied
        off the neighbour, and treating that default as a real place would put every asset ~8,400
        miles away and produce twelve confident, absurd exclusions."""
        return not (self.lat == 0.0 and self.lon == 0.0)


# ------------------------------------------------------------------------------------------------
# Coercions. All of them degrade; none of them raise.
# ------------------------------------------------------------------------------------------------
def _get(obj: Any, key: str, default: Any = None) -> Any:
    if obj is None:
        return default
    value = obj.get(key, default) if isinstance(obj, Mapping) else getattr(obj, key, default)
    return default if value is None else value


def _as_outcome(value: Any) -> CheckOutcome | None:
    if value is None or value == "":
        return None
    if isinstance(value, CheckOutcome):
        return value
    try:
        return CheckOutcome(str(value).strip().upper())
    except ValueError:
        return None


def _as_band(value: Any) -> RiskBand:
    """A band we cannot read becomes ELEVATED, never ROUTINE — the same rule `decide.read_risk`
    holds: not having scored somebody is not evidence that they are fine."""
    if isinstance(value, RiskBand):
        return value
    raw = value
    if isinstance(value, Mapping):
        raw = value.get("band")
    elif value is not None and not isinstance(value, str):
        raw = getattr(value, "band", None)
    try:
        return RiskBand(str(raw).strip().lower())
    except (ValueError, TypeError):
        return RiskBand.ELEVATED


def _hours_to_harm(risk: Any) -> float | None:
    hours = _get(risk, "time_to_harm_h") if risk is not None else None
    return float(hours) if isinstance(hours, (int, float)) and not isinstance(hours, bool) else None


def _checks(decision: Any, result: Any) -> dict[str, str]:
    """Condition checks as `{name: yes|no|unknown}`, from whichever shape the caller has.

    `DecisionResult.checks` is keyed by dotted path ("checks.has_power") and CALL-E's raw
    structured result nests them under "checks"; both, plus a flat dict, are read here so the
    caller never has to reshape anything on the way in.
    """
    out: dict[str, str] = {}
    for source in (decision, result):
        if source is None:
            continue
        raw = _get(source, "checks", {}) or {}
        pairs: list[tuple[str, Any]] = list(raw.items()) if isinstance(raw, Mapping) else []
        for key in ("reached_intended_person", "is_safe_now", "needs_help_now", "sounded_distressed"):
            if (v := _get(source, key)) is not None:
                pairs.append((key, v))
        for key, value in pairs:
            name = str(key).split(".")[-1]
            text = str(value).strip().lower()
            if text in {"yes", "no", "unknown"}:
                out.setdefault(name, text)
    return out


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return []


def _has_condition(neighbour: Any, *tokens: str) -> bool:
    raw = _get(neighbour, "conditions", []) or []
    items = _string_list(raw)
    normalised = {_slug(i) for i in items}
    return any(t in normalised for t in tokens) or any(
        t in n for n in normalised for t in tokens
    )


def _slug(text: Any) -> str:
    return str(text).strip().lower().replace(" ", "_").replace("-", "_")


def _offer_phrase(key: str) -> str:
    return _slug(key).replace("_", " ")


def _join(items: Iterable[str]) -> str:
    return ", ".join(items)


def _as_needset(needs: NeedSet | Sequence[str] | None, incident: Any) -> NeedSet:
    """Whatever the caller passed, as a NeedSet. `None` means "read it off the incident", because
    the next phase is holding a database row and not a domain object."""
    if isinstance(needs, NeedSet):
        return needs
    if needs is None:
        return needs_for(incident)
    b = _NeedBuilder()
    for cap in _string_list(list(needs)):
        b.add(cap, "requested by the coordinator")
    # The capabilities are the caller's, but the priority, the band and whether an agency unit may
    # be considered are never theirs to assert: they come from what the call and the triage said.
    derived = needs_for(incident)
    return b.build(agency_justified=derived.agency_justified, agency_reason=derived.agency_reason,
                   outcome=derived.outcome, band=derived.band, priority=derived.priority)
