"""What the hazard *is*, in a form triage can compute on and a caller can say out loud.

A Hazard row carries a loose `facts` dict because it comes from wherever the captain got it — an
NWS product, a utility outage map, or her own eyes. This module is the one place that dict is
turned into typed, tolerant values. Nothing here raises: a missing temperature, a `"114"` string
from a form post, or a hand-typed `outage_eta_h: "about six"` degrades to `None`, and triage says
so out loud in its reasons. A crash in hazard parsing would mean nobody on the roster gets called
at all, which is a far worse failure than an imprecise score.

The one piece of physics that lives here is the evaporative-cooler curve. Half of Maryvale cools
with a swamp cooler, and a swamp cooler is not an air conditioner: it cools by evaporating water
into the airstream, so its output tracks the wet-bulb temperature. In dry Phoenix air it can drop a
room 25F. When the monsoon pushes humidity into the forties it drops the room a few degrees and
adds damp. That is why "108F at 15% humidity" and "108F at 45% humidity" are not the same hazard
for Rosa, and why the humidity field is not decoration.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Mapping


class HazardKind(StrEnum):
    HEAT = "heat"
    COLD = "cold"
    POWER_OUTAGE = "power_outage"
    FLOOD = "flood"
    SMOKE = "smoke"
    STORM = "storm"
    BOIL_WATER = "boil_water"
    UNKNOWN = "unknown"  # a kind we have no rules for: still swept, scored conservatively


class Severity(StrEnum):
    ADVISORY = "advisory"
    WATCH = "watch"
    WARNING = "warning"
    EMERGENCY = "emergency"


# Severity does not add danger of its own; it scales the danger a person's own situation already
# carries. Walter's oxygen concentrator is the same machine in an advisory and in an emergency —
# what changes is how likely and how long the thing that unplugs it is.
SEVERITY_WEIGHT: dict[Severity, float] = {
    Severity.ADVISORY: 0.6,
    Severity.WATCH: 0.8,
    Severity.WARNING: 1.0,
    Severity.EMERGENCY: 1.25,
}

# What a utility outage of this severity typically runs, used only when the hazard did not say.
# Assumed values are always surfaced as a reason — the captain must be able to see that a number
# in the score was our guess and not the utility's estimate.
DEFAULT_OUTAGE_ETA_H: dict[Severity, float] = {
    Severity.ADVISORY: 1.0,
    Severity.WATCH: 2.0,
    Severity.WARNING: 6.0,
    Severity.EMERGENCY: 12.0,
}

_KIND_SYNONYMS: dict[str, HazardKind] = {
    "excessive_heat": HazardKind.HEAT, "heat_advisory": HazardKind.HEAT, "heat_warning": HazardKind.HEAT,
    "extreme_heat": HazardKind.HEAT, "hot": HazardKind.HEAT,
    "freeze": HazardKind.COLD, "hard_freeze": HazardKind.COLD, "extreme_cold": HazardKind.COLD,
    "cold_snap": HazardKind.COLD, "winter_storm": HazardKind.COLD,
    "outage": HazardKind.POWER_OUTAGE, "blackout": HazardKind.POWER_OUTAGE, "power": HazardKind.POWER_OUTAGE,
    "power_cut": HazardKind.POWER_OUTAGE, "grid_outage": HazardKind.POWER_OUTAGE,
    "flooding": HazardKind.FLOOD, "flash_flood": HazardKind.FLOOD,
    "wildfire": HazardKind.SMOKE, "wildfire_smoke": HazardKind.SMOKE, "air_quality": HazardKind.SMOKE,
    "smoke_advisory": HazardKind.SMOKE, "dust_storm": HazardKind.SMOKE, "haboob": HazardKind.SMOKE,
    "thunderstorm": HazardKind.STORM, "severe_storm": HazardKind.STORM, "monsoon": HazardKind.STORM,
    "boil_water_notice": HazardKind.BOIL_WATER, "water_advisory": HazardKind.BOIL_WATER,
}

_SEVERITY_SYNONYMS: dict[str, Severity] = {
    "minor": Severity.ADVISORY, "info": Severity.ADVISORY, "statement": Severity.ADVISORY,
    "moderate": Severity.WATCH, "watch": Severity.WATCH,
    "severe": Severity.WARNING, "warning": Severity.WARNING,
    "extreme": Severity.EMERGENCY, "emergency": Severity.EMERGENCY, "critical": Severity.EMERGENCY,
}

# Hazards that can end with somebody having to leave the house. Mobility and a car stop being
# quality-of-life details and become the whole question.
EVACUATION_KINDS: frozenset[HazardKind] = frozenset({HazardKind.FLOOD, HazardKind.SMOKE, HazardKind.STORM})

# Hazards where the power is already out, or is the sort of weather that takes it out.
POWER_AT_RISK_KINDS: frozenset[HazardKind] = frozenset(
    {HazardKind.POWER_OUTAGE, HazardKind.STORM, HazardKind.FLOOD}
)

# Evaporative cooling curve. Effectiveness is 1.0 in genuinely dry air and all but gone in damp
# air; the endpoints are the rule of thumb swamp-cooler manufacturers publish (good below ~20% RH,
# not worth running above ~60%), linear in between because we have humidity to one decimal and no
# business pretending to more precision than that.
EVAP_FULL_RH = 20.0
EVAP_DEAD_RH = 60.0
EVAP_FLOOR = 0.05
# Above this humidity a swamp cooler has stopped being a cooling system and triage says so.
SWAMP_COOLER_COMPROMISED_RH = 35.0
# With no humidity reading at all, assume typical dry Phoenix air rather than inventing a crisis —
# but do not assume perfection either.
EVAP_UNKNOWN_RH_EFFECTIVENESS = 0.8


def evaporative_effectiveness(humidity_pct: float | None) -> float:
    """How much of a swamp cooler's rated cooling is actually available at this humidity, 0..1.

    Monotonically non-increasing in humidity: damper air can never make an evaporative cooler work
    better. `None` means the hazard gave no humidity reading.
    """
    if humidity_pct is None:
        return EVAP_UNKNOWN_RH_EFFECTIVENESS
    rh = max(0.0, min(100.0, float(humidity_pct)))
    if rh <= EVAP_FULL_RH:
        return 1.0
    if rh >= EVAP_DEAD_RH:
        return EVAP_FLOOR
    span = EVAP_DEAD_RH - EVAP_FULL_RH
    return round(1.0 - (1.0 - EVAP_FLOOR) * (rh - EVAP_FULL_RH) / span, 4)


def parse_kind(value: Any) -> HazardKind:
    raw = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    try:
        return HazardKind(raw)
    except ValueError:
        return _KIND_SYNONYMS.get(raw, HazardKind.UNKNOWN)


def parse_severity(value: Any) -> Severity:
    raw = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    try:
        return Severity(raw)
    except ValueError:
        # An unreadable severity must not silently become the mildest one.
        return _SEVERITY_SYNONYMS.get(raw, Severity.WARNING)


def _as_float(value: Any) -> float | None:
    """Tolerant numeric read: numbers, numeric strings, "42%", "6 h" all work; anything else None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().lower()
    for junk in ("%", "f", "°", "h", "hr", "hrs", "hours", "deg", " "):
        text = text.replace(junk, "")
    text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


@dataclass(frozen=True)
class HazardFacts:
    """The four numbers triage actually computes on, plus whatever else came along."""

    temp_f: float | None = None
    humidity_pct: float | None = None
    outage_eta_h: float | None = None
    aqi: float | None = None
    raw: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def parse(cls, facts: Mapping[str, Any] | None) -> "HazardFacts":
        f = dict(facts or {})
        return cls(
            temp_f=_as_float(f.get("temp_f", f.get("temperature_f"))),
            humidity_pct=_as_float(f.get("humidity_pct", f.get("humidity"))),
            outage_eta_h=_as_float(f.get("outage_eta_h", f.get("eta_hours"))),
            aqi=_as_float(f.get("aqi", f.get("air_quality_index"))),
            raw=f,
        )


def _fmt(value: float | None, unit: str = "") -> str:
    if value is None:
        return ""
    text = f"{value:.0f}" if float(value).is_integer() else f"{value:.1f}"
    return f"{text}{unit}"


@dataclass(frozen=True)
class HazardProfile:
    """A parsed hazard: typed facts, derived physics, and language for a caller.

    Immutable on purpose — triage runs this over the whole roster and every neighbour must be
    scored against exactly the same picture of the hazard.
    """

    kind: HazardKind
    severity: Severity
    headline: str = ""
    area: str = ""
    facts: HazardFacts = field(default_factory=HazardFacts)
    hazard_id: str = ""

    # --- derived ---------------------------------------------------------------------------
    @property
    def severity_weight(self) -> float:
        return SEVERITY_WEIGHT[self.severity]

    @property
    def cuts_power(self) -> bool:
        """Is the power out, or likely to go out, because of this?"""
        return self.kind is HazardKind.POWER_OUTAGE or (
            self.kind in POWER_AT_RISK_KINDS and self.severity in (Severity.WARNING, Severity.EMERGENCY)
        )

    @property
    def may_evacuate(self) -> bool:
        return self.kind in EVACUATION_KINDS

    def outage_eta_h(self) -> tuple[float, bool]:
        """(hours until power is expected back, whether we had to assume it).

        Returned for every hazard, not just outages, because a storm warning is a future outage.
        """
        if self.facts.outage_eta_h is not None:
            return max(0.0, self.facts.outage_eta_h), False
        return DEFAULT_OUTAGE_ETA_H[self.severity], True

    @property
    def evaporative_effectiveness(self) -> float:
        return evaporative_effectiveness(self.facts.humidity_pct)

    @property
    def swamp_cooler_compromised(self) -> bool:
        """True when the air is damp enough that an evaporative cooler is not really cooling."""
        rh = self.facts.humidity_pct
        return rh is not None and rh >= SWAMP_COOLER_COMPROMISED_RH

    @property
    def apparent_temp_f(self) -> float | None:
        """Roughly what the air feels like: the dry-bulb reading with a humidity penalty.

        Deliberately not the full Rothfusz regression — a pile of magic constants buys a prettier
        sentence and nothing triage acts on. Above 80F, damp air adds up to about 12F of felt heat.
        """
        t = self.facts.temp_f
        if t is None:
            return None
        rh = self.facts.humidity_pct
        if rh is None or t < 80:
            return round(t, 1)
        return round(t + max(0.0, (rh - 20.0) / 80.0) * 12.0, 1)

    # --- language --------------------------------------------------------------------------
    def label(self) -> str:
        """Short human label: "heat warning", "power outage (emergency)"."""
        kind = self.kind.value.replace("_", " ")
        if self.severity is Severity.EMERGENCY:
            return f"{kind} emergency"
        return f"{kind} {self.severity.value}"

    def speakable_facts(self) -> list[str]:
        """The facts as clauses a caller can read aloud, most important first."""
        out: list[str] = []
        f = self.facts
        if self.kind is HazardKind.HEAT:
            if f.temp_f is not None:
                out.append(f"it's forecast to hit {_fmt(f.temp_f)} degrees")
            if f.humidity_pct is not None:
                damp = _fmt(f.humidity_pct)
                # The swamp-cooler consequence is said in the same breath as the number, because a
                # lot of people do not know this about the box on their own roof.
                out.append(
                    f"humidity is around {damp} percent, high enough that an evaporative cooler "
                    "won't cool the way it usually does"
                    if self.swamp_cooler_compromised
                    else f"humidity is around {damp} percent"
                )
        elif self.kind is HazardKind.COLD:
            if f.temp_f is not None:
                out.append(f"it's expected to drop to {_fmt(f.temp_f)} degrees")
        elif self.kind is HazardKind.POWER_OUTAGE:
            eta, assumed = self.outage_eta_h()
            out.append(
                f"the power is expected back in about {_fmt(eta)} hours"
                if not assumed
                else "there's no firm estimate yet for when the power comes back"
            )
            if f.temp_f is not None:
                out.append(f"it's {_fmt(f.temp_f)} degrees out")
        elif self.kind is HazardKind.SMOKE:
            if f.aqi is not None:
                out.append(f"the air quality index is {_fmt(f.aqi)}")
        elif self.kind is HazardKind.BOIL_WATER:
            out.append("tap water needs to be boiled before drinking or cooking")
        return out

    def describe(self) -> str:
        """One or two sentences a CALL-E agent can speak as the reason for the call."""
        where = f" in {self.area}" if self.area else ""
        head = self.headline.strip()
        body = f"{head}{where}." if head else f"There's a {self.label()}{where}."
        clauses = self.speakable_facts()
        if clauses:
            joined = _join(clauses)
            body += " " + joined[:1].upper() + joined[1:] + "."
        return body

    def to_dict(self) -> dict[str, Any]:
        eta, eta_assumed = self.outage_eta_h()
        return {
            "hazard_id": self.hazard_id,
            "kind": self.kind.value,
            "severity": self.severity.value,
            "headline": self.headline,
            "area": self.area,
            "facts": {
                "temp_f": self.facts.temp_f,
                "humidity_pct": self.facts.humidity_pct,
                "outage_eta_h": self.facts.outage_eta_h,
                "aqi": self.facts.aqi,
            },
            "derived": {
                "severity_weight": self.severity_weight,
                "apparent_temp_f": self.apparent_temp_f,
                "evaporative_effectiveness": self.evaporative_effectiveness,
                "swamp_cooler_compromised": self.swamp_cooler_compromised,
                "outage_eta_h_effective": eta,
                "outage_eta_h_assumed": eta_assumed,
                "cuts_power": self.cuts_power,
                "may_evacuate": self.may_evacuate,
            },
            "description": self.describe(),
        }


def _join(parts: list[str]) -> str:
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]}, and {parts[1]}"
    return ", ".join(parts[:-1]) + f", and {parts[-1]}"


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


def parse_hazard(hazard: Any) -> HazardProfile:
    """Accepts a Hazard row, a plain dict, or an already-parsed HazardProfile.

    Duck-typed on purpose: the API layer holds dicts, the orchestrator holds SQLModel rows, and
    tests hold neither. One parser for all three means triage cannot disagree with itself.
    """
    if isinstance(hazard, HazardProfile):
        return hazard
    return HazardProfile(
        kind=parse_kind(_get(hazard, "kind")),
        severity=parse_severity(_get(hazard, "severity", "warning")),
        headline=str(_get(hazard, "headline", "") or ""),
        area=str(_get(hazard, "area", "") or ""),
        facts=HazardFacts.parse(_get(hazard, "facts") or {}),
        hazard_id=str(_get(hazard, "id", "") or ""),
    )
