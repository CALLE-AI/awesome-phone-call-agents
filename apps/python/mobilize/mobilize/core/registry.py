"""The registry: the actual people a coordinator can call, loaded from a
CSV they already have, persisted between sessions, and improved by outcomes.

This is what turns `mobilize` from an engine into something a coordinator
can use. The engine works on `Candidate` objects; a real donor coordinator
has a spreadsheet. This module is the bridge, and it is deliberately
forgiving about what that spreadsheet looks like:

    name, phone, timezone                       <- the only required columns
    last_donation, distance_km,                 <- optional, improves ranking
    accept_rate, showup_rate                    <- optional, learned over time

The learned rates are the point. A coordinator loading a fresh list has no
history, so everyone starts at a neutral prior. After each mobilization,
`record_outcomes` updates each person's accept and show-up rates from what
actually happened -- so the ranking gets better the more you use it, without
anyone having to maintain a spreadsheet column by hand.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from mobilize.core.types import Candidate

# A person with no history is assumed neither promising nor hopeless. These
# are deliberately middling so that a fresh registry ranks mostly by
# eligibility and distance until real outcomes accumulate.
DEFAULT_ACCEPT_RATE = 0.5
DEFAULT_SHOWUP_RATE = 0.5
DEFAULT_DISTANCE_KM = 10.0

# How fast learned rates move toward the latest outcome. 0.25 means one
# result shifts the rate a quarter of the way -- responsive enough to be
# useful within a few mobilizations, damped enough that a single unlucky
# no-answer doesn't bury someone permanently.
LEARNING_RATE = 0.25

REQUIRED_COLUMNS = {"name", "phone", "timezone"}


@dataclass
class Person:
    """One member of the registry, as a coordinator thinks of them."""

    id: str
    name: str
    phone: str
    timezone: str
    last_donation: date | None = None
    distance_km: float = DEFAULT_DISTANCE_KM
    accept_rate: float = DEFAULT_ACCEPT_RATE
    showup_rate: float = DEFAULT_SHOWUP_RATE
    times_called: int = 0
    notes: str = ""

    def days_since_last_donation(self, today: date | None = None) -> float:
        if self.last_donation is None:
            # Never recorded a donation with us -- treat as eligible rather
            # than blocking them, but don't claim a specific recency.
            return 999.0
        today = today or datetime.now(timezone.utc).date()
        return float((today - self.last_donation).days)

    def is_eligible(self, min_days_between_donations: int, today: date | None = None) -> bool:
        return self.days_since_last_donation(today) >= min_days_between_donations

    def to_candidate(self, min_days_between_donations: int = 56, today: date | None = None) -> Candidate:
        return Candidate(
            id=self.id,
            phone=self.phone,
            name=self.name,
            days_since_last_action=self.days_since_last_donation(today),
            distance_km=self.distance_km,
            historical_accept_rate=self.accept_rate,
            historical_showup_rate=self.showup_rate,
            eligible=self.is_eligible(min_days_between_donations, today),
            timezone=self.timezone,
        )


@dataclass
class Registry:
    people: dict[str, Person] = field(default_factory=dict)

    def __len__(self) -> int:
        return len(self.people)

    def all(self) -> list[Person]:
        return list(self.people.values())

    def candidates(self, min_days_between_donations: int = 56, today: date | None = None) -> list[Candidate]:
        return [p.to_candidate(min_days_between_donations, today) for p in self.people.values()]

    def get(self, person_id: str) -> Person | None:
        return self.people.get(person_id)


class RegistryError(ValueError):
    """Raised for CSV problems a coordinator can actually act on."""


def load_registry_csv(path: str | Path) -> Registry:
    """Load a coordinator's own CSV. Errors name the row and the problem, so
    a non-technical user can fix their spreadsheet rather than read a
    traceback."""
    path = Path(path)
    if not path.exists():
        raise RegistryError(f"No such file: {path}")

    registry = Registry()
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise RegistryError("The CSV appears to be empty.")

        headers = {h.strip().lower() for h in reader.fieldnames if h}
        missing = REQUIRED_COLUMNS - headers
        if missing:
            raise RegistryError(
                f"Missing required column(s): {', '.join(sorted(missing))}. "
                f"Found: {', '.join(sorted(headers))}. "
                f"A registry CSV needs at least: name, phone, timezone."
            )

        for row_number, raw in enumerate(reader, start=2):  # row 1 is the header
            row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}
            if not any(row.values()):
                continue  # tolerate blank lines

            name = row.get("name", "")
            phone = row.get("phone", "")
            tz = row.get("timezone", "")
            if not name or not phone or not tz:
                raise RegistryError(
                    f"Row {row_number}: name, phone, and timezone are all required "
                    f"(got name={name!r}, phone={phone!r}, timezone={tz!r})."
                )

            person_id = row.get("id") or f"p{row_number - 1:04d}"
            registry.people[person_id] = Person(
                id=person_id,
                name=name,
                phone=phone,
                timezone=tz,
                last_donation=_parse_date(row.get("last_donation"), row_number),
                distance_km=_parse_float(row.get("distance_km"), DEFAULT_DISTANCE_KM, row_number, "distance_km"),
                accept_rate=_parse_float(row.get("accept_rate"), DEFAULT_ACCEPT_RATE, row_number, "accept_rate"),
                showup_rate=_parse_float(row.get("showup_rate"), DEFAULT_SHOWUP_RATE, row_number, "showup_rate"),
                times_called=int(_parse_float(row.get("times_called"), 0, row_number, "times_called")),
                notes=row.get("notes", ""),
            )

    if not registry.people:
        raise RegistryError("The CSV has headers but no rows.")
    return registry


def save_registry_json(registry: Registry, path: str | Path) -> None:
    """Persist the registry, including learned rates, between sessions."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "people": [
            {
                "id": p.id, "name": p.name, "phone": p.phone, "timezone": p.timezone,
                "last_donation": p.last_donation.isoformat() if p.last_donation else None,
                "distance_km": p.distance_km, "accept_rate": p.accept_rate,
                "showup_rate": p.showup_rate, "times_called": p.times_called, "notes": p.notes,
            }
            for p in registry.people.values()
        ]
    }
    path.write_text(json.dumps(payload, indent=2))


def load_registry_json(path: str | Path) -> Registry:
    path = Path(path)
    if not path.exists():
        return Registry()
    payload = json.loads(path.read_text())
    registry = Registry()
    for raw in payload.get("people", []):
        registry.people[raw["id"]] = Person(
            id=raw["id"], name=raw["name"], phone=raw["phone"], timezone=raw["timezone"],
            last_donation=date.fromisoformat(raw["last_donation"]) if raw.get("last_donation") else None,
            distance_km=raw.get("distance_km", DEFAULT_DISTANCE_KM),
            accept_rate=raw.get("accept_rate", DEFAULT_ACCEPT_RATE),
            showup_rate=raw.get("showup_rate", DEFAULT_SHOWUP_RATE),
            times_called=raw.get("times_called", 0),
            notes=raw.get("notes", ""),
        )
    return registry


def record_outcomes(registry: Registry, results: list, *, learning_rate: float = LEARNING_RATE) -> list[str]:
    """Update learned accept/show-up rates from what actually happened.

    `results` is a list of CallResult. Returns the ids that were updated.

    Note on what's actually learnable here: whether someone *accepted* is
    directly observable from the call. Whether they *showed up* is not --
    the call ends before that's known. So show-up rate is nudged using the
    calibrated commitment score as a proxy, which is the best signal
    available at call time. A production deployment with real attendance
    data should feed that in instead; see `record_attendance`.
    """
    from mobilize.core.types import CallOutcome

    updated: list[str] = []
    for result in results:
        person = registry.people.get(result.candidate_id)
        if person is None:
            continue

        accepted = result.outcome in (CallOutcome.FIRM_YES, CallOutcome.SOFT_YES)
        reached = result.outcome not in (CallOutcome.NO_ANSWER, CallOutcome.FAILED)

        if reached:
            person.accept_rate = _nudge(person.accept_rate, 1.0 if accepted else 0.0, learning_rate)
            if accepted:
                person.showup_rate = _nudge(person.showup_rate, result.commitment_score, learning_rate)
        person.times_called += 1
        updated.append(person.id)
    return updated


def record_attendance(registry: Registry, person_id: str, showed_up: bool, *, learning_rate: float = LEARNING_RATE) -> None:
    """Ground truth, when the coordinator later knows who actually arrived.

    This is the signal that makes the show-up model genuinely accurate
    rather than self-referential -- `record_outcomes` can only use the
    commitment score as a proxy, but this is the real thing.
    """
    person = registry.people.get(person_id)
    if person is None:
        return
    person.showup_rate = _nudge(person.showup_rate, 1.0 if showed_up else 0.0, learning_rate)


def _nudge(current: float, observed: float, rate: float) -> float:
    return max(0.02, min(0.98, current + rate * (observed - current)))


def _parse_date(value: str | None, row_number: int) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise RegistryError(
            f"Row {row_number}: last_donation must be a date like 2026-05-14, got {value!r}."
        ) from None


def _parse_float(value: str | None, default: float, row_number: int, column: str) -> float:
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        raise RegistryError(f"Row {row_number}: {column} must be a number, got {value!r}.") from None
