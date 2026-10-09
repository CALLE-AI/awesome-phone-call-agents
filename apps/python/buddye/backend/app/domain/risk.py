"""Deterministic triage: who is in danger from THIS hazard, how much, why, and who we call first.

No model runs here. The block captain has one evening and a phone, and she has to be able to read
a line like "oxygen concentrator with no battery backup, outage expected 6h" and act on it without
asking anyone what the software meant. So every point in the score arrives attached to a sentence,
and the sentences are the product — the number is just how we sort them.

**Risk is hazard-conditioned, not a property of the person.** This is the whole design. There is no
"Walter is a high-risk neighbour" field anywhere, because it would be wrong half the time: Walter,
with an oxygen concentrator on wall power, is critical in a blackout and routine in a heat
advisory; Rosa, 75 and cooling a house with a swamp cooler, is critical in humid heat and routine
in a short outage on a mild evening. The engine is a matrix — (hazard kind, severity) x (neighbour
attributes) -> contributions — and the same roster reorders completely when the hazard changes.

Three properties this module holds:

* **Contributions are unscaled, severity multiplies.** Rules state what a situation is worth in a
  full-blown warning; `SEVERITY_WEIGHT` scales the lot. That way an advisory does not need its own
  hand-tuned constants, and nobody can quietly retune one hazard into another's thresholds.
* **Band floors.** Some situations are critical no matter what the arithmetic says. Life-support
  equipment that fails before the power comes back is the canonical one. A floor is applied as an
  explicit, visible factor so the score still equals the sum of its reasons.
* **Nothing raises.** Unparseable facts, an unrecognised condition token, a neighbour dict missing
  half its keys: all degrade to a conservative score with a reason that names what we did not
  understand. A triage crash means the whole roster goes uncalled, which is the worst outcome
  available to this system.

Privacy note: reasons contain health facts about named people *by design* — that is what the
captain needs. `to_dict()` does not redact, because redacting "oxygen concentrator" would destroy
the product. Callers redact at egress (`app.obs.redact`) before anything reaches a log line.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Callable, Iterable, Mapping

from app.domain.hazards import (
    HazardKind,
    HazardProfile,
    Severity,
    parse_hazard,
)

ENGINE_VERSION = "rules/v1"


class RiskBand(StrEnum):
    ROUTINE = "routine"      # call them, but nothing about tonight is unusual for them
    ELEVATED = "elevated"    # this hazard touches something in their file
    HIGH = "high"            # they are likely to need help before this is over
    CRITICAL = "critical"    # harm is plausible within hours; call first, escalate on silence


# Lower bound of each band. Ordered worst-first so `band_for` can scan.
BAND_MIN_SCORE: list[tuple[RiskBand, int]] = [
    (RiskBand.CRITICAL, 70),
    (RiskBand.HIGH, 45),
    (RiskBand.ELEVATED, 25),
    (RiskBand.ROUTINE, 0),
]
_BAND_ORDER: dict[RiskBand, int] = {b: i for i, (b, _) in enumerate(reversed(BAND_MIN_SCORE))}


def band_for(score: float) -> RiskBand:
    for band, floor in BAND_MIN_SCORE:
        if score >= floor:
            return band
    return RiskBand.ROUTINE


def band_floor_score(band: RiskBand) -> int:
    return dict(BAND_MIN_SCORE)[band]


# --------------------------------------------------------------------------------------------
# Conditions vocabulary
#
# `Neighbour.conditions` is a free list of strings typed by a volunteer, so it arrives as
# "COPD", "heat sensitive", "oxygen-dependent". Everything is normalised to a canonical token, and
# a token we do not recognise still scores — scoring an unrecognised health condition as zero is
# the one failure mode this product cannot have. It gets a small conservative contribution and a
# reason quoting it verbatim so the captain can see what BuddyE did not understand.
# --------------------------------------------------------------------------------------------
CONDITION_SYNONYMS: dict[str, str] = {
    "o2": "oxygen", "on_oxygen": "oxygen", "oxygen_dependent": "oxygen", "oxygen_therapy": "oxygen",
    "oxygen_concentrator": "oxygen", "supplemental_oxygen": "oxygen",
    "emphysema": "copd", "chronic_bronchitis": "copd", "copd_emphysema": "copd",
    "chf": "cardiac", "heart_failure": "cardiac", "heart_condition": "cardiac", "heart_disease": "cardiac",
    "kidney_dialysis": "dialysis", "renal_dialysis": "dialysis", "home_dialysis": "dialysis",
    "insulin": "refrigerated_meds", "refrigerated_medication": "refrigerated_meds",
    "refrigerated_medications": "refrigerated_meds", "fridge_meds": "refrigerated_meds",
    "alzheimers": "dementia", "alzheimer_s": "dementia", "memory_loss": "dementia", "cognitive_impairment": "dementia",
    "heat_sensitivity": "heat_sensitive", "heat_intolerant": "heat_sensitive", "heat_illness": "heat_sensitive",
    "immuno_compromised": "immunocompromised", "immune_compromised": "immunocompromised",
    "cpap_user": "cpap", "sleep_apnea": "cpap",
    "wheelchair_user": "mobility_impaired", "bedbound": "mobility_impaired",
}

CONDITION_LABELS: dict[str, str] = {
    "oxygen": "oxygen therapy",
    "copd": "COPD",
    "asthma": "asthma",
    "cardiac": "a heart condition",
    "dialysis": "home dialysis",
    "refrigerated_meds": "medication that has to stay refrigerated",
    "cpap": "a CPAP machine at night",
    "dementia": "memory loss",
    "heat_sensitive": "heat sensitivity",
    "diabetes": "diabetes",
    "immunocompromised": "a weakened immune system",
    "mobility_impaired": "limited mobility",
    "pregnancy": "pregnancy",
}
KNOWN_CONDITIONS: frozenset[str] = frozenset(CONDITION_LABELS)

# The matrix, condition half: (hazard kind) x (condition) -> unscaled points.
# Read a column and you can see why the same person moves: COPD is 10 in heat and 30 in smoke.
CONDITION_POINTS: dict[HazardKind, dict[str, int]] = {
    HazardKind.HEAT: {
        "heat_sensitive": 14, "copd": 10, "cardiac": 8, "oxygen": 6, "dialysis": 8,
        "dementia": 10, "diabetes": 4, "pregnancy": 6, "mobility_impaired": 6,
    },
    HazardKind.COLD: {
        "copd": 12, "cardiac": 8, "oxygen": 6, "dementia": 10, "mobility_impaired": 6, "diabetes": 4,
    },
    HazardKind.POWER_OUTAGE: {
        # Equipment that runs on wall power is priced by the time-to-harm rule below, not here;
        # these are the conditions that make a dark, still house dangerous on their own.
        "dialysis": 14, "refrigerated_meds": 12, "copd": 10, "cpap": 8, "dementia": 8,
        "oxygen": 6, "heat_sensitive": 6, "cardiac": 6, "diabetes": 4,
    },
    HazardKind.SMOKE: {
        "copd": 30, "asthma": 22, "oxygen": 20, "cardiac": 14, "pregnancy": 8, "dementia": 6,
    },
    HazardKind.FLOOD: {
        "mobility_impaired": 14, "dementia": 12, "oxygen": 10, "dialysis": 10, "cardiac": 6,
    },
    HazardKind.STORM: {
        "oxygen": 10, "dialysis": 10, "dementia": 10, "copd": 6, "refrigerated_meds": 6,
    },
    HazardKind.BOIL_WATER: {
        "dialysis": 26, "immunocompromised": 16, "diabetes": 6, "dementia": 12,
    },
    HazardKind.UNKNOWN: {},
}
UNKNOWN_CONDITION_POINTS = 5
# A condition on file that this hazard has no rule for is still worth a little: being on the list
# at all means a volunteer thought it mattered.
UNLISTED_CONDITION_POINTS = 3

# --------------------------------------------------------------------------------------------
# The enumerated fields are enumerated by a comment in models.py and by nothing else — they are
# typed by volunteers and by whoever wrote the seed. "evaporative cooler", "evap" and "swamp
# cooler" are all the same box on the same roof, and if triage matches only one spelling then
# Rosa's cooler quietly becomes a generic unknown and the single most important fact about her
# house drops out of both her score and her reasons. So every enumerated field is normalised the
# same way `conditions` is, and the canonical vocabularies are exported for seed and the API to
# align against.
# --------------------------------------------------------------------------------------------
COOLING_VALUES: tuple[str, ...] = ("central_ac", "window_unit", "swamp_cooler", "fan_only", "none", "unknown")
HEATING_VALUES: tuple[str, ...] = ("central", "wall_furnace", "space_heater", "none", "unknown")
MOBILITY_VALUES: tuple[str, ...] = ("independent", "cane_walker", "wheelchair", "bedbound", "unknown")
AGE_BANDS: tuple[str, ...] = ("under_65", "65_74", "75_plus", "unknown")

COOLING_SYNONYMS: dict[str, str] = {
    "evap": "swamp_cooler", "evaporative": "swamp_cooler", "evaporative_cooler": "swamp_cooler",
    "swamp": "swamp_cooler", "swamp_box": "swamp_cooler", "cooler": "swamp_cooler",
    "central": "central_ac", "central_air": "central_ac", "ac": "central_ac", "a_c": "central_ac",
    "window_ac": "window_unit", "window": "window_unit", "wall_unit": "window_unit", "mini_split": "window_unit",
    "fan": "fan_only", "fans": "fan_only", "fans_only": "fan_only",
    "no_cooling": "none", "nothing": "none",
}
HEATING_SYNONYMS: dict[str, str] = {
    "central_heat": "central", "central_air": "central", "furnace": "central", "heat_pump": "central",
    "wall_heater": "wall_furnace", "wall": "wall_furnace", "gas_wall_furnace": "wall_furnace",
    "space_heaters": "space_heater", "portable_heater": "space_heater", "electric_heater": "space_heater",
    "no_heat": "none", "no_heating": "none", "nothing": "none", "fan_only": "none",
}
MOBILITY_SYNONYMS: dict[str, str] = {
    "walker": "cane_walker", "cane": "cane_walker", "cane_or_walker": "cane_walker", "uses_a_walker": "cane_walker",
    "wheelchair_user": "wheelchair", "chair": "wheelchair", "power_chair": "wheelchair", "scooter": "wheelchair",
    "bed_bound": "bedbound", "bedridden": "bedbound", "homebound": "bedbound",
    "fine": "independent", "none": "independent", "no_issues": "independent",
}
AGE_BAND_SYNONYMS: dict[str, str] = {
    "75": "75_plus", "75plus": "75_plus", "75_": "75_plus", "over_75": "75_plus", "75_and_over": "75_plus",
    "80_plus": "75_plus", "85_plus": "75_plus", "senior": "75_plus",
    "65": "65_74", "65_74_": "65_74", "65_to_74": "65_74", "65_75": "65_74",
    "under65": "under_65", "under_65_": "under_65", "adult": "under_65",
}


def _normalize_token(raw: Any, synonyms: dict[str, str], default: str) -> str:
    """Canonical token, or the volunteer's own word if we have never seen it.

    Unrecognised values are kept verbatim rather than mapped to "unknown", so the reason can quote
    back what was actually on the card instead of pretending the field was blank.
    """
    token = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_").replace("+", "_plus")
    while "__" in token:
        token = token.replace("__", "_")
    if not token:
        return default
    return synonyms.get(token, token)


def normalize_cooling(raw: Any) -> str:
    return _normalize_token(raw, COOLING_SYNONYMS, "unknown")


def normalize_heating(raw: Any) -> str:
    return _normalize_token(raw, HEATING_SYNONYMS, "unknown")


def normalize_mobility(raw: Any) -> str:
    return _normalize_token(raw, MOBILITY_SYNONYMS, "independent")


def normalize_age_band(raw: Any) -> str:
    return _normalize_token(raw, AGE_BAND_SYNONYMS, "unknown")


# Cooling x heat. A swamp cooler is priced by humidity, not by this table (see `_heat_rule`).
COOLING_HEAT_POINTS: dict[str, int] = {
    "none": 30, "fan_only": 26, "unknown": 12, "window_unit": 8, "central_ac": 2, "swamp_cooler": 0,
}
HEATING_COLD_POINTS: dict[str, int] = {
    "none": 30, "space_heater": 12, "unknown": 10, "wall_furnace": 4, "central": 2,
}
# Mobility x any hazard that could end in leaving the house.
MOBILITY_EVAC_POINTS: dict[str, int] = {
    "bedbound": 32, "wheelchair": 26, "cane_walker": 14, "unknown": 8, "independent": 0,
}
NO_TRANSPORT_EVAC_POINTS = 15
# Getting to a cooling or warming centre is the same problem, smaller: nobody has to leave in
# minutes, but somebody still has to get there.
RELOCATION_SCALE = 0.45

# Amplifiers. Applied to the hazard subtotal, never to a subtotal of zero: living alone is not a
# danger in itself, it is what turns somebody else's bad night into an unwitnessed one.
LIVES_ALONE_AMPLIFIER = 0.25
AGE_AMPLIFIER: dict[str, float] = {"75_plus": 0.20, "65_74": 0.10, "under_65": 0.0, "unknown": 0.05}

# Ceiling on the hazard subtotal used as the amplifier basis. Without it, a long conditions list
# would multiply through the amplifiers and land half the roster at an undifferentiated 100, which
# tells the captain nothing about who to ring first.
SUBTOTAL_CAP = 85.0
MAX_SCORE = 100.0
# Everyone on the roster is worth a call; a zero would read as "no need to ring her".
BASE_POINTS = 4.0


def normalize_condition(raw: str) -> str:
    token = str(raw or "").strip().lower().replace(" ", "_").replace("-", "_").replace("'", "_")
    while "__" in token:
        token = token.replace("__", "_")
    return CONDITION_SYNONYMS.get(token, token)


def condition_label(token: str, raw: str = "") -> str:
    return CONDITION_LABELS.get(token, (raw or token).replace("_", " "))


@dataclass(frozen=True)
class RiskFactor:
    """One contribution and the sentence that justifies it. Points may be 0: a factor with no
    points but a reason is how the engine says "I had to assume something here"."""

    key: str
    points: float
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {"key": self.key, "points": round(self.points, 1), "reason": self.reason}


@dataclass
class RiskAssessment:
    """What triage concluded about one person under one hazard.

    `to_dict()` is what lands in `Sweep.triage[neighbour_id]` and `CheckCall.risk_snapshot`, so the
    call record says why this person was called when they were. Contains health facts: redact at
    egress, never in here.
    """

    neighbour_id: str
    name: str
    hazard_id: str
    hazard_kind: HazardKind
    severity: Severity
    score: int
    band: RiskBand
    factors: list[RiskFactor] = field(default_factory=list)
    time_to_harm_h: float | None = None  # hours until this person is actually in trouble; None = no clock, NOT no risk
    may_call: bool = True                # consent gate; a False here never means "low risk"
    skip_reason: str = ""

    @property
    def reasons(self) -> list[str]:
        """The sentences, biggest contribution first. This is what the UI shows and the captain reads."""
        return [f.reason for f in sorted(self.factors, key=lambda f: -f.points)]

    @property
    def headline_reason(self) -> str:
        return self.reasons[0] if self.reasons else ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "neighbour_id": self.neighbour_id,
            "name": self.name,
            "hazard_id": self.hazard_id,
            "hazard_kind": self.hazard_kind.value,
            "severity": self.severity.value,
            "score": self.score,
            "band": self.band.value,
            "reasons": self.reasons,
            "factors": [f.to_dict() for f in sorted(self.factors, key=lambda f: -f.points)],
            "time_to_harm_h": self.time_to_harm_h,
            "may_call": self.may_call,
            "skip_reason": self.skip_reason,
            "engine": ENGINE_VERSION,
        }


# --------------------------------------------------------------------------------------------
# Neighbour view: works on a SQLModel row, a dict, or anything with the attributes.
# --------------------------------------------------------------------------------------------
_MISSING = object()


def _raw(obj: Any, key: str) -> Any:
    """The value exactly as stored, with a sentinel for "the field is not there at all"."""
    return obj.get(key, _MISSING) if isinstance(obj, Mapping) else getattr(obj, key, _MISSING)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    value = _raw(obj, key)
    return default if value is _MISSING or value is None else value


class _NeighbourView:
    def __init__(self, neighbour: Any) -> None:
        self.raw = neighbour
        self.id: str = str(_get(neighbour, "id", ""))
        self.name: str = str(_get(neighbour, "name", "")) or "(unnamed)"
        self.age_band: str = normalize_age_band(_get(neighbour, "age_band", "unknown"))
        self.lives_alone: bool = bool(_get(neighbour, "lives_alone", False))
        self.power_dependent: bool = bool(_get(neighbour, "power_dependent", False))
        self.power_backup_hours: float = _float(_get(neighbour, "power_backup_hours", 0.0))
        # Keep the volunteer's own words alongside the canonical token: when we do not recognise a
        # value the reason quotes the card, not our mangled version of it.
        self.cooling_raw: str = str(_get(neighbour, "cooling", "unknown"))
        self.heating_raw: str = str(_get(neighbour, "heating", "unknown"))
        self.mobility_raw: str = str(_get(neighbour, "mobility", "independent"))
        self.cooling: str = normalize_cooling(self.cooling_raw)
        self.heating: str = normalize_heating(self.heating_raw)
        self.mobility: str = normalize_mobility(self.mobility_raw)
        self.has_transport: bool = bool(_get(neighbour, "has_transport", True))
        # Consent fails CLOSED. Every other field here defaults generously because a missing value
        # must never lower someone's risk; consent is the opposite. An absent field takes the model
        # default (True — the roster column is opt-out), but a field that is present and is not a
        # real boolean true — None, "", 0, or the string "yes" out of some import — is not a
        # consent record, and BuddyE does not ring a stranger's phone on a maybe.
        consent_raw = _raw(neighbour, "check_in_consent")
        self.consent: bool = True if consent_raw is _MISSING else (consent_raw is True or consent_raw == 1)
        raw_conditions = _get(neighbour, "conditions", []) or []
        if isinstance(raw_conditions, str):  # a volunteer typed "copd, oxygen" into one box
            raw_conditions = [p for p in raw_conditions.replace(";", ",").split(",") if p.strip()]
        self.conditions: list[tuple[str, str]] = [(normalize_condition(c), str(c)) for c in raw_conditions]

    def has(self, token: str) -> bool:
        return any(t == token for t, _ in self.conditions)

    @property
    def household(self) -> str:
        return "lives alone" if self.lives_alone else "has someone at home"


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _fmt(value: float) -> str:
    return f"{value:.0f}" if float(value).is_integer() else f"{value:.1f}"


# --------------------------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------------------------
class _Ctx:
    """Accumulator handed to each hazard rule. Rules append unscaled points and sentences."""

    def __init__(self, n: _NeighbourView, h: HazardProfile) -> None:
        self.n = n
        self.h = h
        self.factors: list[RiskFactor] = []
        self.floor: RiskBand | None = None
        self.floor_reason: str = ""
        self.time_to_harm_h: float | None = None

    def add(self, key: str, points: float, reason: str) -> None:
        if reason:
            self.factors.append(RiskFactor(key=key, points=float(points), reason=reason))

    def hold_at(self, band: RiskBand, reason: str) -> None:
        """Pin a minimum band regardless of arithmetic. Retuning a cooling constant next week must
        not be able to drop a man on an oxygen concentrator out of critical."""
        if self.floor is None or _BAND_ORDER[band] > _BAND_ORDER[self.floor]:
            self.floor, self.floor_reason = band, reason


def _equipment_label(n: _NeighbourView) -> str:
    """Name the machine, not the flag. "power-dependent" means nothing to a captain at 9pm."""
    if n.has("oxygen"):
        return "oxygen concentrator"
    if n.has("dialysis"):
        return "home dialysis machine"
    if n.has("cpap"):
        return "CPAP machine"
    if n.has("refrigerated_meds"):
        return "refrigerated medication"
    return "power-dependent medical equipment"


def _conditions_rule(c: _Ctx) -> None:
    table = CONDITION_POINTS.get(c.h.kind, {})
    hazard_words = c.h.label()
    for token, raw in c.n.conditions:
        label = condition_label(token, raw)
        if token in table:
            c.add(f"condition:{token}", table[token], f"{label}, which a {hazard_words} makes worse")
        elif token in KNOWN_CONDITIONS:
            c.add(f"condition:{token}", UNLISTED_CONDITION_POINTS, f"{label} on file")
        else:
            # Never zero. We do not know what this is, so we say so and score it conservatively.
            c.add(
                f"condition:unrecognised:{token}",
                UNKNOWN_CONDITION_POINTS,
                f'"{raw}" on file — BuddyE has no rule for that one, so it is scored conservatively '
                f"and left for you to read",
            )


def _relocation_rule(c: _Ctx, *, scale: float, destination: str) -> None:
    """Could this person get themselves somewhere safer? Same question as evacuation, gentler clock."""
    pts = MOBILITY_EVAC_POINTS.get(c.n.mobility, MOBILITY_EVAC_POINTS["unknown"]) * scale
    if pts:
        mobility_words = {
            "bedbound": "is bedbound", "wheelchair": "uses a wheelchair",
            "cane_walker": "gets around with a cane or walker", "unknown": "has no mobility noted on file",
        }.get(c.n.mobility, f'mobility recorded as "{c.n.mobility_raw}"')
        c.add("mobility", pts, f"{mobility_words} — getting to {destination} is not simple")
    if not c.n.has_transport:
        c.add("transport", NO_TRANSPORT_EVAC_POINTS * scale, f"no vehicle — no way to get to {destination} alone")


def _power_dependency_rule(c: _Ctx) -> None:
    """The time-to-harm calculation. This is the sharpest thing the engine knows.

    Not "is this person power dependent" (a flag) but "how long does their equipment last against
    how long the power is out" (a subtraction). Eight hours of battery against a two-hour outage is
    a phone call. Two hours of battery against a six-hour outage is a countdown.
    """
    n, h = c.n, c.h
    if not n.power_dependent:
        return
    eta, assumed = h.outage_eta_h()
    equip = _equipment_label(n)
    backup = max(0.0, n.power_backup_hours)
    c.time_to_harm_h = backup
    if backup <= 0:
        c.add("power:no_backup", 55, f"{equip} with no battery backup, outage expected {_fmt(eta)}h")
        c.hold_at(RiskBand.CRITICAL, f"{equip} is dead the moment the power is")
    elif backup < eta:
        deficit = eta - backup
        c.add(
            "power:deficit",
            48,
            f"{equip} runs {_fmt(backup)}h on battery against an outage expected to last "
            f"{_fmt(eta)}h — it stops about {_fmt(deficit)}h before the power comes back",
        )
        c.hold_at(RiskBand.CRITICAL, f"{equip} fails before the power returns")
    elif backup < eta + 2:
        c.add(
            "power:thin_margin",
            30,
            f"{equip} runs {_fmt(backup)}h on battery against a {_fmt(eta)}h outage — "
            f"barely covered, and outage estimates slip",
        )
        c.hold_at(RiskBand.HIGH, "battery margin is under two hours")
    else:
        c.add(
            "power:covered",
            16,
            f"{equip}, but {_fmt(backup)}h of battery comfortably covers the expected {_fmt(eta)}h outage",
        )
        c.hold_at(RiskBand.ELEVATED, "on life-support equipment during an outage")
    if assumed:
        # Zero points, but it goes in the list: the captain must see which numbers were ours.
        c.add(
            "power:eta_assumed",
            0,
            f"the utility gave no restoration estimate; scored against a typical {_fmt(eta)}h "
            f"{h.severity.value}",
        )


def _heat_rule(c: _Ctx) -> None:
    n, h, f = c.n, c.h, c.h.facts
    temp = f.temp_f
    temp_words = f"{_fmt(temp)}F" if temp is not None else "this heat"

    if n.cooling == "swamp_cooler":
        # The Rosa case. An evaporative cooler is not an air conditioner; it trades on dry air, and
        # Maryvale's worst heat arrives with monsoon humidity. Price it on the curve, not the label.
        eff = h.evaporative_effectiveness
        pts = 8 + (1.0 - eff) * 26
        if h.swamp_cooler_compromised:
            reason = (
                f"cools with a swamp cooler and humidity is {_fmt(f.humidity_pct or 0)}% — an "
                f"evaporative cooler loses most of its cooling in damp air, so at {temp_words} that "
                f"house may only be a few degrees below outside"
            )
        elif f.humidity_pct is None:
            reason = (
                f"cools with a swamp cooler and the hazard gave no humidity reading — if the air is "
                f"damp it will not hold {temp_words}"
            )
        else:
            reason = f"cools with a swamp cooler; at {_fmt(f.humidity_pct)}% humidity it should still be working"
        c.add("cooling:swamp_cooler", pts, reason)
    else:
        pts = COOLING_HEAT_POINTS.get(n.cooling, COOLING_HEAT_POINTS["unknown"])
        words = {
            "none": f"no cooling of any kind at {temp_words}",
            "fan_only": f"a fan and nothing else at {temp_words} — moving hot air is not cooling",
            "unknown": "no cooling recorded on file, so we do not know what is in that house",
            "window_unit": "one window unit — cools a room, not a house",
            "central_ac": "central air conditioning",
        }.get(n.cooling, f"cooling recorded as \"{n.cooling_raw}\"")
        c.add("cooling", pts, words)

    if temp is None:
        c.add("heat:no_temp", 4, "the hazard carried no temperature, so this is scored on the alert alone")
    elif temp >= 110:
        c.add("heat:temp", 14, f"{_fmt(temp)}F is dangerous for anyone, indoors or out")
    elif temp >= 105:
        c.add("heat:temp", 10, f"{_fmt(temp)}F")
    elif temp >= 100:
        c.add("heat:temp", 6, f"{_fmt(temp)}F")
    elif temp >= 95:
        c.add("heat:temp", 3, f"{_fmt(temp)}F")

    if n.power_dependent and h.severity in (Severity.WARNING, Severity.EMERGENCY):
        c.add(
            "heat:grid_strain",
            5,
            f"{_equipment_label(n)} on wall power, and heat this heavy is when the grid drops circuits",
        )

    _conditions_rule(c)
    _relocation_rule(c, scale=RELOCATION_SCALE, destination="a cooling centre")


def _cold_rule(c: _Ctx) -> None:
    n, h, f = c.n, c.h, c.h.facts
    temp = f.temp_f
    pts = HEATING_COLD_POINTS.get(n.heating, HEATING_COLD_POINTS["unknown"])
    words = {
        "none": "no working heat in the house",
        "space_heater": "heats with a space heater — which is also a fire and carbon-monoxide risk overnight",
        "unknown": "no heating recorded on file",
        "wall_furnace": "a wall furnace",
        "central": "central heating",
    }.get(n.heating, f"heating recorded as \"{n.heating_raw}\"")
    c.add("heating", pts, words + (f" with {_fmt(temp)}F overnight" if temp is not None else ""))

    if temp is not None:
        if temp <= 25:
            c.add("cold:temp", 14, f"{_fmt(temp)}F is a hard freeze")
        elif temp <= 32:
            c.add("cold:temp", 10, f"{_fmt(temp)}F, below freezing")
        elif temp <= 40:
            c.add("cold:temp", 5, f"{_fmt(temp)}F overnight")

    if n.power_dependent and h.severity in (Severity.WARNING, Severity.EMERGENCY):
        c.add("cold:grid_strain", 5, f"{_equipment_label(n)} on wall power in weather that brings lines down")

    _conditions_rule(c)
    _relocation_rule(c, scale=RELOCATION_SCALE, destination="a warming centre")


def _power_outage_rule(c: _Ctx) -> None:
    n, h, f = c.n, c.h, c.h.facts
    _power_dependency_rule(c)

    # An outage is only a temperature hazard when the weather makes it one. A two-hour cut on a
    # mild evening is an inconvenience; the same cut at 108F is a heat emergency indoors. This is
    # why the same person is routine in one outage and critical in another.
    temp = f.temp_f
    if temp is not None and temp >= 95:
        cooling_words = "swamp cooler" if n.cooling == "swamp_cooler" else "air conditioning"
        c.add("outage:cooling_lost", 20, f"{_fmt(temp)}F outside and the {cooling_words} is off with the power")
    elif temp is not None and temp <= 40:
        c.add("outage:heating_lost", 20, f"{_fmt(temp)}F outside and the heating is off with the power")

    _conditions_rule(c)
    if h.severity in (Severity.WARNING, Severity.EMERGENCY):
        _relocation_rule(c, scale=RELOCATION_SCALE, destination="somewhere with power")


def _evacuation_family_rule(c: _Ctx) -> None:
    """Flood, smoke, storm: hazards that can end with somebody needing to leave, or needing to be
    got to. Mobility and a car are the risk here, not a diagnosis."""
    n, h, f = c.n, c.h, c.h.facts
    _relocation_rule(c, scale=1.0, destination="somewhere safer")

    if h.kind is HazardKind.SMOKE and f.aqi is not None:
        aqi = f.aqi
        if aqi >= 300:
            c.add("smoke:aqi", 20, f"air quality index {_fmt(aqi)} — hazardous for everyone")
        elif aqi >= 200:
            c.add("smoke:aqi", 14, f"air quality index {_fmt(aqi)} — very unhealthy")
        elif aqi >= 150:
            c.add("smoke:aqi", 9, f"air quality index {_fmt(aqi)}")
        elif aqi >= 100:
            c.add("smoke:aqi", 4, f"air quality index {_fmt(aqi)}")

    if n.power_dependent and h.cuts_power:
        eta, assumed = h.outage_eta_h()
        backup = max(0.0, n.power_backup_hours)
        c.time_to_harm_h = backup
        equip = _equipment_label(n)
        if backup < eta:
            c.add(
                "power:storm_risk",
                30,
                f"{equip} with {_fmt(backup)}h of battery, and weather like this takes the power out "
                f"for {_fmt(eta)}h at a time",
            )
            c.hold_at(RiskBand.HIGH, "life-support equipment against a likely outage")
        else:
            c.add("power:storm_risk", 12, f"{equip}, though {_fmt(backup)}h of battery covers a typical outage here")

    _conditions_rule(c)


def _boil_water_rule(c: _Ctx) -> None:
    n = c.n
    if n.has("dialysis"):
        # Home dialysis needs treated water. A boil-water notice is a treatment-stopping event.
        c.hold_at(RiskBand.HIGH, "home dialysis against a boil-water notice")
    if not n.has_transport:
        c.add("transport", 12, "no vehicle — cannot go and buy bottled water")
    if n.mobility in ("wheelchair", "bedbound"):
        c.add("mobility", 12, "cannot easily carry water home or stand at a stove to boil it")
    _conditions_rule(c)


def _generic_rule(c: _Ctx) -> None:
    """A hazard kind we have no matrix for. Score the durable vulnerabilities and say so."""
    c.add(
        "hazard:unknown_kind",
        6,
        f'hazard kind "{c.h.kind.value}" has no specific rules — scored on general vulnerability only',
    )
    if c.n.power_dependent:
        c.add("power:dependent", 14, f"{_equipment_label(c.n)} on wall power")
    _relocation_rule(c, scale=RELOCATION_SCALE, destination="somewhere safer")
    _conditions_rule(c)


# The matrix's dispatch half: (hazard kind) -> the rule that prices this kind.
RULES: dict[HazardKind, Callable[[_Ctx], None]] = {
    HazardKind.HEAT: _heat_rule,
    HazardKind.COLD: _cold_rule,
    HazardKind.POWER_OUTAGE: _power_outage_rule,
    HazardKind.FLOOD: _evacuation_family_rule,
    HazardKind.SMOKE: _evacuation_family_rule,
    HazardKind.STORM: _evacuation_family_rule,
    HazardKind.BOIL_WATER: _boil_water_rule,
    HazardKind.UNKNOWN: _generic_rule,
}


def assess(neighbour: Any, hazard: Any) -> RiskAssessment:
    """Score one neighbour against one hazard. Pure, total, and repeatable: same inputs, same
    output, every time — a triage that reshuffles between two runs is a triage nobody trusts."""
    n = _NeighbourView(neighbour)
    h = parse_hazard(hazard)
    c = _Ctx(n, h)
    RULES.get(h.kind, _generic_rule)(c)

    weight = h.severity_weight
    scaled = [RiskFactor(key=f.key, points=round(f.points * weight, 1), reason=f.reason) for f in c.factors]
    subtotal = min(SUBTOTAL_CAP, sum(f.points for f in scaled))

    factors = list(scaled)
    if subtotal > 0:
        if n.lives_alone:
            factors.append(
                RiskFactor(
                    key="amplifier:lives_alone",
                    points=round(subtotal * LIVES_ALONE_AMPLIFIER, 1),
                    reason="lives alone — nobody in the house to notice if this goes wrong",
                )
            )
        age_mult = AGE_AMPLIFIER.get(n.age_band, AGE_AMPLIFIER["unknown"])
        if age_mult:
            age_words = {
                "75_plus": "75 or older", "65_74": "between 65 and 74",
                "unknown": "of unrecorded age",
            }.get(n.age_band, n.age_band)
            factors.append(
                RiskFactor(
                    key="amplifier:age",
                    points=round(subtotal * age_mult, 1),
                    reason=f"{age_words} — older bodies lose their margin fastest in exactly this kind of hazard",
                )
            )

    factors.append(
        RiskFactor(
            key="base",
            points=round(BASE_POINTS * weight, 1),
            reason=f"on the roster for a {h.label()}{' in ' + h.area if h.area else ''}",
        )
    )

    raw_total = sum(f.points for f in factors)
    if raw_total > MAX_SCORE:
        # The ceiling is itself a visible factor. The invariant that the score equals the sum of
        # its reasons is what makes the breakdown auditable, and a silent clamp would break it.
        factors.append(
            RiskFactor(
                key="ceiling",
                points=round(MAX_SCORE - raw_total, 1),
                reason="capped at 100 — past this point the reasons matter and the number does not",
            )
        )
    score = min(MAX_SCORE, max(0.0, raw_total))
    band = band_for(score)

    # Floors last: a named situation that must not be sortable below its band, applied as a visible
    # factor so the score still equals the sum of its reasons.
    if c.floor is not None and _BAND_ORDER[c.floor] > _BAND_ORDER[band]:
        target = float(band_floor_score(c.floor))
        factors.append(
            RiskFactor(
                key=f"floor:{c.floor.value}",
                points=round(target - score, 1),
                reason=f"held at {c.floor.value}: {c.floor_reason}",
            )
        )
        score, band = target, c.floor

    consent = n.consent
    return RiskAssessment(
        neighbour_id=n.id,
        name=n.name,
        hazard_id=h.hazard_id,
        hazard_kind=h.kind,
        severity=h.severity,
        score=int(round(score)),
        band=band,
        factors=factors,
        time_to_harm_h=c.time_to_harm_h,
        may_call=consent,
        skip_reason="" if consent else "not opted in to automated check-in calls",
    )


def _sort_key(a: RiskAssessment) -> tuple[Any, ...]:
    # Deterministic to the last field. Score first, then the clock (a two-hour battery outranks an
    # eight-hour one at the same score), then name and id so a shuffled roster cannot reorder.
    return (-a.score, a.time_to_harm_h if a.time_to_harm_h is not None else float("inf"), a.name.lower(), a.neighbour_id)


def triage(neighbours: Iterable[Any], hazard: Any) -> list[RiskAssessment]:
    """Score the whole roster against one hazard, worst first. Includes people we may not call —
    the captain still needs to see them; `may_call` says whether BuddyE dials."""
    h = parse_hazard(hazard)  # parse once: every neighbour is scored against the same picture
    return sorted((assess(n, h) for n in neighbours), key=_sort_key)


def call_order(neighbours: Iterable[Any], hazard: Any) -> list[str]:
    """Neighbour ids in the order the sweep should dial them.

    Order is the part of this system that survives contact with reality. The signup credit allowance is limited,
    a volunteer's evening is shorter than her list, and a sweep can die halfway through on a flat
    phone battery. Whatever fraction of the roster actually gets called, it has to be the *right*
    fraction: the man whose oxygen concentrator has two hours of battery is dialled before the
    neighbour with central air and a full house, because if only six calls happen tonight, those
    six should be the six where a call changes the outcome. Sorting is cheap; being wrong about
    who came first is not.

    People who never opted in are dropped here rather than being sorted to the bottom, so no code
    path downstream can dial them by walking one index too far.
    """
    return [a.neighbour_id for a in triage(neighbours, hazard) if a.may_call]


def triage_dict(neighbours: Iterable[Any], hazard: Any) -> dict[str, dict[str, Any]]:
    """`Sweep.triage` shape: neighbour id -> assessment dict. Health facts inside; redact at egress."""
    return {a.neighbour_id: a.to_dict() for a in triage(neighbours, hazard)}
