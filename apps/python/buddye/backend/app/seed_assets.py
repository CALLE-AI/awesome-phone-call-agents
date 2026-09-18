"""The fleet: what a Maryvale coordinator can actually put on a street tonight.

Two rules govern every coordinate in this file.

**The places are real.** A community centre, a school district bus yard, two Phoenix fire stations
and a police precinct, all of them findable on a map, all of them in or on the edge of Maryvale.
The crews are fictional and the vehicles are not really moving, but every distance, every ETA and
every minute of drive time the product quotes is computed from these numbers by `app.domain.geo`.
A coordinator has to be able to check the screen against the world, and a made-up staging point
would make the first number they check wrong.

  Maryvale Community Center / Palo Verde Library campus  4420 N 51st Ave  (51st Ave & Campbell)
  Cartwright Elementary School District #83 yard          5220 W Indian School Rd
  Phoenix Fire Station 15                                 4730 N 43rd Ave
  Phoenix Fire Station 25                                 4010 N 63rd Ave
  Phoenix PD Maryvale Estrella Mountain Precinct          6180 W Encanto Blvd

Latitudes are anchored on the Phoenix mile grid (Campbell 33.5020, Indian School 33.4948, Osborn
33.4874, Thomas 33.4802, Encanto 33.4730) and longitudes on the avenue spacing the roster already
uses, so these sit on the same coordinate system as the neighbours in `app.seed` and are accurate
to the block rather than the doorstep — the same honesty the roster claims for itself.

**Agency units are seeded, and seeding them is not the same as being able to send them.** The
safety property is `app.domain.state.requires_authorisation` plus `DispatchStatus.PROPOSED`: an
EMS, fire or police unit can be proposed, routed, and fully prepared by an agent, and it stays
PROPOSED with nothing sent until a named human clicks approve. Leaving the rows out would have hid
that mechanism rather than enforced it — a coordinator would see no ambulance on the board and
learn nothing about who is allowed to spend one. `app.domain.fleet` additionally refuses to
*consider* an agency unit unless the incident is agency-justified, so nobody's ambulance is offered
for a case of water.

**Idempotence is by call sign, not by "are there any assets".** `app.seed.seed_assets` plants the
six community units as part of a demo reset and short-circuits on the first existing row; this
module is the superset and must be safe to run before it, after it, or twice. So it adds only the
call signs that are missing and never touches a row that exists — an asset that is mid-dispatch
does not get teleported back to base by a second call.
"""
from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from app.domain.state import AssetKind, AssetStatus, requires_authorisation
from app.models import Asset

# ------------------------------------------------------------------------------------------------
# Staging points. Every one is a real place; the comment is the address you can look up.
# ------------------------------------------------------------------------------------------------

#: Maryvale Community Center / Palo Verde Branch Library campus, 4420 N 51st Ave (51st & Campbell).
#: Also the cooling centre named in `app.seed.HEAT_HELP`, and deliberately the same pair of numbers
#: as `app.seed.BASE_LAT/BASE_LON` — the two seeders must not disagree about where base is.
COMMUNITY_BASE = (33.5020, -112.1697)

#: Cartwright Elementary School District #83, 5220 W Indian School Rd. The district lends activity
#: buses and their drivers for heat relief runs, which is where a cooling shuttle really comes from.
CARTWRIGHT_YARD = (33.4948, -112.1714)

#: Phoenix Fire Station 15, 4730 N 43rd Ave — the closest staffed station to the east half of this
#: roster. Engine and rescue both run out of it.
STATION_15 = (33.5060, -112.1494)

#: Phoenix Fire Station 25, 4010 N 63rd Ave — covers the west half.
STATION_25 = (33.4973, -112.1938)

#: Phoenix Police Maryvale Estrella Mountain Precinct, 6180 W Encanto Blvd.
MARYVALE_PRECINCT = (33.4730, -112.1920)


# ------------------------------------------------------------------------------------------------
# The fleet.
#
# `capabilities` is the vocabulary `app.domain.fleet` matches needs against, and it is written from
# what the vehicle can honestly do: RIDE-3 is a minivan and cannot take a wheelchair, so it does not
# claim `wheelchair`; NURSE-1 can assess and can carry medication but is not a paramedic, so it does
# not claim `medical`; E-15 is a fire engine and does not claim `water`, because the water on it is
# for fires and a coordinator who saw an engine win a water drop would stop trusting the board.
#
# The first six entries are byte-identical to `app.seed.ASSETS` — same kind, capabilities, capacity,
# speed, operator, notes and base. That is what makes this module a drop-in superset of the seed
# rather than a second, competing fleet.
# ------------------------------------------------------------------------------------------------
COMMUNITY_ASSETS: list[dict[str, Any]] = [
    dict(call_sign="WV-1", kind=AssetKind.WELLNESS_VAN, operator_name="Marco and Dee",
         capabilities=["assess", "water", "transport"], capacity=8, speed_mph=20.0,
         base=COMMUNITY_BASE,
         notes="Two volunteers doing door knocks. Radio call sign on the captain's board."),
    dict(call_sign="WV-2", kind=AssetKind.WELLNESS_VAN, operator_name="Priscilla and Ray",
         capabilities=["assess", "water"], capacity=8, speed_mph=20.0,
         base=COMMUNITY_BASE, notes=""),
    dict(call_sign="RIDE-3", kind=AssetKind.VOLUNTEER_DRIVER, operator_name="Hector Vega",
         capabilities=["transport"], capacity=4, speed_mph=25.0,
         base=COMMUNITY_BASE,
         notes="Minivan; can take a walker but not a wheelchair."),
    dict(call_sign="WATER-1", kind=AssetKind.WATER_ICE_TRUCK, operator_name="Lupe Ibarra",
         capabilities=["water", "ice"], capacity=20, speed_mph=18.0,
         base=COMMUNITY_BASE,
         notes="The food bank van, out on loan for the duration of the warning."),
    dict(call_sign="PWR-1", kind=AssetKind.POWER_CART, operator_name="Danny Ruelas",
         capabilities=["battery", "power"], capacity=2, speed_mph=18.0,
         base=COMMUNITY_BASE,
         notes="Portable battery on a trailer. Will run a concentrator for about ten hours."),
    dict(call_sign="NURSE-1", kind=AssetKind.NURSE_OUTREACH, operator_name="Ana Whitfield RN",
         capabilities=["assess", "medication"], capacity=6, speed_mph=24.0,
         base=COMMUNITY_BASE,
         notes="Clinic nurse, volunteers evenings. Can assess; cannot transport and is not a paramedic."),

    # --- added by this module -------------------------------------------------------------------
    # The two assets that make "we can move somebody who cannot walk out" true. Without a lift on
    # the board, every wheelchair user on the roster has a transport need nothing can fill, and the
    # engine would happily rank a minivan first for Walter.
    dict(call_sign="SHUTTLE-1", kind=AssetKind.COOLING_SHUTTLE, operator_name="Yolanda Prieto",
         capabilities=["transport", "wheelchair"], capacity=12, speed_mph=18.0,
         base=CARTWRIGHT_YARD,
         notes="Cartwright District activity bus, lent for the warning. Lift at the rear door, "
               "twelve seats. Runs a loop to the cooling center rather than one address at a time."),
    dict(call_sign="RIDE-5", kind=AssetKind.VOLUNTEER_DRIVER, operator_name="Yesenia Marquez",
         capabilities=["transport", "wheelchair"], capacity=4, speed_mph=25.0,
         base=CARTWRIGHT_YARD,
         notes="Accessible van with a ramp — the one to send when a walker is not the problem."),
]

# Agency units. Present so a human can be shown exactly what they are approving; never committed by
# software. `app.domain.fleet.eligible` will not even consider one unless the incident is
# agency-justified, and `Dispatch.requires_authorisation` is stamped from
# `app.domain.state.requires_authorisation` at proposal time.
AGENCY_ASSETS: list[dict[str, Any]] = [
    dict(call_sign="R-15", kind=AssetKind.EMS_UNIT, operator_name="Phoenix Fire Rescue 15",
         capabilities=["medical", "assess", "transport"], capacity=1, speed_mph=32.0,
         base=STATION_15,
         notes="Ambulance out of Station 15, 4730 N 43rd Ave. Mutual aid: BuddyE prepares the "
               "request and a named human releases it. One patient, then it is gone to hospital."),
    dict(call_sign="R-25", kind=AssetKind.EMS_UNIT, operator_name="Phoenix Fire Rescue 25",
         capabilities=["medical", "assess", "transport"], capacity=1, speed_mph=32.0,
         base=STATION_25,
         notes="Ambulance out of Station 25, 4010 N 63rd Ave — the west-side unit."),
    dict(call_sign="E-15", kind=AssetKind.FIRE_UNIT, operator_name="Phoenix Fire Engine 15",
         capabilities=["medical", "assess", "forced_entry"], capacity=1, speed_mph=30.0,
         base=STATION_15,
         notes="Engine company, Station 15. Four on board, can force a door and can start care "
               "before a rescue arrives. Not a delivery vehicle."),
    dict(call_sign="812A", kind=AssetKind.POLICE_WELFARE, operator_name="Maryvale precinct, beat 812",
         capabilities=["welfare_check", "forced_entry"], capacity=2, speed_mph=30.0,
         base=MARYVALE_PRECINCT,
         notes="Patrol unit out of 6180 W Encanto Blvd. A police welfare check is a serious ask and "
               "the last thing on the ladder: a knock from a marked car frightens people, and it is "
               "requested only when nobody has been able to lay eyes on someone who may be in danger."),
]

FLEET: list[dict[str, Any]] = COMMUNITY_ASSETS + AGENCY_ASSETS


def fleet_specs(*, include_agency: bool = True) -> list[dict[str, Any]]:
    """The specs this module would plant, without touching a database."""
    return list(COMMUNITY_ASSETS) + (list(AGENCY_ASSETS) if include_agency else [])


def _to_asset(spec: dict[str, Any]) -> Asset:
    spec = dict(spec)
    base_lat, base_lon = spec.pop("base")
    # Copy the capability list: handing the module constant to a row would let a later edit to that
    # row rewrite the fleet definition for the rest of the process.
    spec["capabilities"] = list(spec["capabilities"])
    # Position starts at base and is server state from then on: the movement simulator advances it
    # on a wall clock, so an asset is wherever the last tick left it, not wherever a browser thinks.
    return Asset(status=AssetStatus.AVAILABLE, base_lat=base_lat, base_lon=base_lon,
                 lat=base_lat, lon=base_lon, **spec)


def seed_assets(session: Session, *, include_agency: bool = True) -> list[Asset]:
    """Plant every missing call sign and return the whole fleet, in the order declared above.

    Idempotent by call sign. Runs correctly before `app.seed.seed_assets`, after it, or twice in a
    row: an existing row is never rewritten, never duplicated and never moved back to base, because
    a second call during a live sweep would otherwise teleport a van that is halfway to a house.

    Callable from the demo reset — see the note in the module docstring in `app/domain/fleet.py`
    about where the wiring belongs.
    """
    existing = {a.call_sign: a for a in session.exec(select(Asset)).all()}
    planted: list[Asset] = []
    for spec in fleet_specs(include_agency=include_agency):
        row = existing.get(spec["call_sign"])
        if row is None:
            row = _to_asset(spec)
            session.add(row)
            existing[row.call_sign] = row
        planted.append(row)
    session.flush()  # ids exist before the caller starts proposing dispatches against them
    return planted


def agency_call_signs() -> set[str]:
    """The call signs a human has to authorise. Derived from the policy, never hand-listed."""
    return {s["call_sign"] for s in FLEET if requires_authorisation(s["kind"])}
