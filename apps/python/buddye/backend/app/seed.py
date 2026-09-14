"""The demo world: one block captain's roster in Maryvale, and the two hazards that reorder it.

Ported from ShiftFill's seed, which had one job — make the demo look like a real Tuesday rather
than like test data — and keeps its two rules exactly:

* every phone number is a fictional, unroutable +1 555-01xx number, and
* a neighbour gets a **real** number only if `DEMO_PHONE_A/B/C` is set in the environment at seed
  time, in which case the row is flagged `is_demo` and the number must ALSO appear in
  `DIALABLE_NUMBERS` before any real provider will dial it.

What is new here is that the roster exists to be *reordered*. Two hazards are declarable over the
same fourteen people:

    HEAT     114F, 41% humidity     -> Rosa Delgado is first. Her swamp cooler is not an air
                                       conditioner and at 41% humidity it has stopped being a
                                       cooling system at all.
    OUTAGE   6h estimate, 108F      -> Walter Brzezinski is first. Four hours of concentrator
                                       battery against a six-hour outage is a subtraction, and it
                                       comes out negative two hours before the power returns.

Neither ordering is written down anywhere. `app.domain.risk` derives both from the same fields on
the same rows, which is the entire argument of the product: the roster does not change, the danger
does, and the phone list has to follow the danger. `tests/test_seed.py` pins both orders so a
tuning change in the risk engine cannot quietly cost the demo its point.

The people are fictional. The streets, the avenues, the library and the community center are real
Maryvale, because a coordinator has to be able to check a map against the world. Coordinates are
accurate to the block, not the doorstep.

Health facts live on these rows: conditions, medications, power dependency, addresses. Nothing in
this module logs or prints them; everything that leaves the process goes through `app.obs.redact`
at the boundary that emits it.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import delete
from sqlmodel import Session, select

from app.config import Settings
from app.domain.state import AssetKind, AssetStatus, HazardStatus
from app.models import (
    AgentEvent,
    Asset,
    CheckCall,
    Correspondence,
    Dispatch,
    Escalation,
    HandoffPacket,
    Hazard,
    Incident,
    IncidentDocument,
    Neighbour,
    OperatorAction,
    Sweep,
    WebhookReceipt,
)

# The volunteer who runs this block. Named on every call ("Alma asked me to phone everyone"), so a
# neighbour hears a person's name and not a brand.
CAPTAIN = "Alma Reyes"
AREA = "Maryvale, Phoenix"

# ------------------------------------------------------------------------------------------------
# What we can actually give tonight.
#
# `text` is spoken verbatim by the CALL-E agent and is the ONLY place an address, an hour, or any
# other promise may come from — the task text forbids the agent from inventing one. So each offer is
# written out here as a sentence a neighbour would understand, rather than left for
# `contract.parse_help_offers` to compose from parts. Four offers, all of which exist: a real
# building with real hours, a volunteer with a car, a truck with water and ice on it, and two people
# who will knock on a door. Nothing that would need an agency to show up.
#
# `key` is the identifier CALL-E returns in help_accepted / help_declined, so it is also what the
# mock fixtures quote. Keep the two in step: `tests/test_seed.py` asserts every key a fixture
# accepts or declines is an offer that was actually on the hazard.
# ------------------------------------------------------------------------------------------------
HEAT_HELP: list[dict[str, Any]] = [
    {
        "key": "cooling_center",
        "label": "Cooling center",
        "text": (
            "There's a cooling center open at the Maryvale Community Center, 4420 North 51st Avenue, "
            "from ten in the morning until eight at night. It's air conditioned, there's cold water, "
            "and you can stay as long as you like."
        ),
    },
    {
        "key": "ride",
        "label": "Volunteer ride",
        "text": (
            "One of our volunteer drivers can pick you up and take you over to the cooling center, "
            "and bring you home again after. Would you like me to put you on the list for a ride?"
        ),
    },
    {
        "key": "water_ice_drop",
        "label": "Water and ice drop",
        "text": (
            "We've got a truck going round the block this evening with drinking water and bags of "
            "ice. They can leave a case of water and some ice at your door."
        ),
    },
    {
        "key": "wellness_visit",
        "label": "Wellness visit",
        "text": (
            "Two of our volunteers are doing door knocks tonight. They can stop by, say hello, and "
            "make sure you're alright. Would you like them to come round?"
        ),
    },
]

# The outage list is deliberately NOT the heat list with the words changed. A cooling center with no
# power is not a cooling center; the community center runs on a generator and is where people go to
# charge things, and ice matters because it is what keeps insulin viable for another day.
OUTAGE_HELP: list[dict[str, Any]] = [
    {
        "key": "resource_center",
        "label": "Resource center",
        "text": (
            "The Maryvale Community Center, 4420 North 51st Avenue, is on a generator and open until "
            "ten tonight. There's air conditioning, water, and outlets to charge a phone or medical "
            "equipment."
        ),
    },
    {
        "key": "ride",
        "label": "Volunteer ride",
        "text": (
            "A volunteer driver can come and take you over to the community center while the power "
            "is out, and bring you back once it's on. Would you like a ride?"
        ),
    },
    {
        "key": "ice_drop",
        "label": "Ice drop",
        "text": (
            "We've got a truck bringing bags of ice round the block. If you've got medicine in the "
            "fridge, they can leave ice at your door to keep it cold."
        ),
    },
    {
        "key": "wellness_visit",
        "label": "Wellness visit",
        "text": (
            "Two of our volunteers are knocking on doors while the power is out. They can stop by "
            "and check you're alright. Shall I ask them to come to you?"
        ),
    },
]

# ------------------------------------------------------------------------------------------------
# The roster. Fourteen people, and the variety is the point: two of them are in real danger tonight,
# several are perfectly fine, one will turn us down, one has a daughter who answers his phone, one
# number on the spreadsheet no longer belongs to the person written next to it, and one asked to be
# taken off the call list and must therefore never be dialled.
#
# Field vocabularies (cooling, heating, mobility, age_band, conditions) are the canonical tokens
# exported by `app.domain.risk`. Where a volunteer would have written something looser — "insulin",
# "high blood pressure" — it is left loose on purpose: the risk engine normalises what it knows and
# scores what it does not conservatively, quoting the card back at the captain. That path is worth
# demonstrating with real data rather than only in a unit test.
# ------------------------------------------------------------------------------------------------
NEIGHBOURS: list[dict[str, Any]] = [
    dict(
        name="Rosa Delgado",
        address="5137 W Osborn Rd", unit="", lat=33.4874, lon=-112.1706,
        access_notes="Side gate is unlatched. The doorbell hasn't worked in years — knock on the kitchen window.",
        age_band="75_plus", lives_alone=True,
        conditions=["heat sensitive", "high blood pressure"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="swamp_cooler", heating="wall_furnace", mobility="cane_walker", has_transport=False,
        contact_name="Elena Delgado", contact_phone="", contact_relation="daughter",
        notes="Widowed. Daughter Elena is in Glendale, about forty minutes out. Plays everything down on the phone.",
    ),
    dict(
        name="Walter Brzezinski",
        address="4713 N 55th Ave", unit="", lat=33.4931, lon=-112.1779,
        access_notes="Ramp at the carport side. Front door sticks; push at the bottom. Two cats — don't let them out.",
        age_band="65_74", lives_alone=True,
        conditions=["COPD", "oxygen"],
        # The number that matters. Four hours of battery is not a property of the man, it is a
        # property of the machine, and it is what triage subtracts the outage estimate from.
        power_dependent=True, power_backup_hours=4.0,
        cooling="window_unit", heating="wall_furnace", mobility="wheelchair", has_transport=False,
        # Deliberately blank, and the demo depends on it staying blank: with nobody nominated, the
        # escalation ladder skips EMERGENCY_CONTACT and says in the audit trail that it skipped it,
        # rather than quietly starting at the block captain as though that were the first rung.
        contact_name="", contact_phone="", contact_relation="",
        notes="Retired machinist. No family on file — he says his brother passed and he never got round to naming anyone else.",
    ),
    dict(
        name="Hazel Nakamura",
        address="5031 W Campbell Ave", unit="", lat=33.5020, lon=-112.1685,
        access_notes="Son Dennis has a key. Hazel cannot get to the door — go in and call out from the hallway.",
        age_band="75_plus", lives_alone=True,
        conditions=["insulin", "dementia"],
        # Her insulin is in the refrigerator, not in a machine with a battery. That is a real
        # distinction and the roster keeps it: she has no life-support equipment to run down, so
        # triage scores the medication and gives her no clock. Flagging her power_dependent would
        # invent a countdown she does not have.
        power_dependent=False, power_backup_hours=0.0,
        cooling="window_unit", heating="central", mobility="bedbound", has_transport=False,
        contact_name="Dennis Nakamura", contact_phone="", contact_relation="son",
        notes="Bedbound since her fall in March. A carer comes Mondays and Thursdays. Doesn't always hear the phone.",
    ),
    dict(
        name="Ruth Ann Beecham",
        address="5210 W Berkeley Rd", unit="", lat=33.5020, lon=-112.1723,
        access_notes="Grace, her carer, lives in and answers the door.",
        age_band="75_plus", lives_alone=False,
        conditions=[],
        power_dependent=False, power_backup_hours=0.0,
        cooling="central_ac", heating="central", mobility="bedbound", has_transport=False,
        contact_name="Grace Amadi", contact_phone="", contact_relation="live-in carer",
        notes="91 and sharp as a tack. Grace is with her round the clock. On the list because of the fall risk, not the heat.",
    ),
    dict(
        name="Ernesto Salgado",
        address="4402 N 47th Ave", unit="", lat=33.4911, lon=-112.1607,
        access_notes="Screen door on the carport side is the one that opens.",
        age_band="65_74", lives_alone=True,
        conditions=["diabetes", "heart condition"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="fan_only", heating="space_heater", mobility="cane_walker", has_transport=False,
        contact_name="Rafael Salgado", contact_phone="", contact_relation="son",
        notes="Sold the car in the spring. The swamp cooler on the roof stopped last summer and was never replaced.",
    ),
    dict(
        name="Dorothy Whitfield",
        address="5544 W Clarendon Ave", unit="", lat=33.4911, lon=-112.1780,
        access_notes="Do not go round the back — the dog is not friendly with strangers.",
        age_band="75_plus", lives_alone=True,
        conditions=["arthritis"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="central_ac", heating="central", mobility="cane_walker", has_transport=False,
        contact_name="Pastor Jim Whitlow", contact_phone="", contact_relation="her church",
        notes="Proud, and does not care to be fussed over. Asked for the church to be called rather than her nephew.",
    ),
    dict(
        name="Benny Okonkwo",
        address="4126 N 51st Ave", unit="Apt 2", lat=33.4874, lon=-112.1697,
        access_notes="Buzzer is broken; his daughter's number is on the card by the mailbox.",
        age_band="75_plus", lives_alone=False,
        conditions=["memory loss"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="swamp_cooler", heating="wall_furnace", mobility="cane_walker", has_transport=True,
        contact_name="Adaeze Okonkwo", contact_phone="", contact_relation="daughter",
        notes="His daughter Adaeze moved in last year and usually picks up his phone.",
    ),
    dict(
        name="Faye Lindqvist",
        address="5825 W Osborn Rd", unit="", lat=33.4874, lon=-112.1855,
        access_notes="",
        age_band="75_plus", lives_alone=True,
        conditions=[],
        power_dependent=False, power_backup_hours=0.0,
        cooling="window_unit", heating="central", mobility="independent", has_transport=True,
        contact_name="Marta Lindqvist", contact_phone="", contact_relation="sister",
        notes="Number on the list is two years old and may have been reassigned — nobody has reached her on it since June.",
    ),
    dict(
        name="Gerald Pryce",
        address="5906 W Roma Ave", unit="", lat=33.5057, lon=-112.1874,
        access_notes="",
        age_band="65_74", lives_alone=True,
        conditions=["COPD"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="central_ac", heating="central", mobility="independent", has_transport=True,
        contact_name="Trish Pryce", contact_phone="", contact_relation="daughter",
        # The one row in the seed that exists to prove a negative. He stays on the captain's board —
        # she still wants to see him — but `risk.call_order` drops him before any dialling can
        # happen, and the mock provider refuses him outright if a bug ever gets that far.
        check_in_consent=False,
        notes="Asked at the September block meeting to be taken off the automated calls. Wants a knock on the door instead.",
    ),
    dict(
        name="Lupe Ibarra",
        address="4507 N 59th Ave", unit="", lat=33.4948, lon=-112.1855,
        access_notes="Husband Chuy is usually home in the afternoons.",
        age_band="65_74", lives_alone=False,
        conditions=["diabetes"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="swamp_cooler", heating="wall_furnace", mobility="independent", has_transport=True,
        preferred_language="es-US",
        contact_name="Chuy Ibarra", contact_phone="", contact_relation="husband",
        notes="Prefers Spanish. Runs the food bank van on Saturdays and knows everyone on this list.",
    ),
    dict(
        name="Yolanda Cruz",
        address="4830 N 43rd Ave", unit="", lat=33.4983, lon=-112.1494,
        access_notes="",
        age_band="65_74", lives_alone=True,
        conditions=["sleep apnea"],
        # The same flag as Walter, and nothing like the same situation: ten hours of battery against
        # a six-hour outage is covered, and triage says so in as many words. Two power-dependent
        # neighbours who sort ten bands apart is the clearest way to show that the flag is not the
        # answer — the subtraction is.
        power_dependent=True, power_backup_hours=10.0,
        cooling="central_ac", heating="central", mobility="independent", has_transport=True,
        contact_name="Deja Cruz", contact_phone="", contact_relation="daughter",
        notes="Uses a CPAP at night. Bought a battery pack for it after the outage two summers ago.",
    ),
    dict(
        name="Marisol Vega",
        address="4318 N 47th Ave", unit="", lat=33.4911, lon=-112.1607,
        access_notes="",
        age_band="under_65", lives_alone=False,
        conditions=[],
        power_dependent=False, power_backup_hours=0.0,
        cooling="window_unit", heating="central", mobility="independent", has_transport=True,
        contact_name="Hector Vega", contact_phone="", contact_relation="husband",
        notes="34, two small children, one of them a baby. On the list for the infant, and she keeps an eye on Ernesto across the street.",
    ),
    dict(
        name="Charlie Dunn",
        address="5619 W Thomas Rd", unit="Apt 14", lat=33.4802, lon=-112.1817,
        access_notes="Apartment is upstairs at the back of the building.",
        age_band="under_65", lives_alone=True,
        conditions=["dialysis"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="central_ac", heating="central", mobility="independent", has_transport=True,
        contact_name="Renata Dunn", contact_phone="", contact_relation="sister",
        notes="Dialysis at the clinic on 35th Avenue, Tuesdays Thursdays Saturdays. Drives himself. Likes to talk.",
    ),
    dict(
        name="Trinidad Bustos",
        address="5142 W Encanto Blvd", unit="", lat=33.4730, lon=-112.1706,
        access_notes="Goes by Trini. Hard of hearing — the phone has to ring a good while.",
        age_band="75_plus", lives_alone=True,
        conditions=["heat sensitive"],
        power_dependent=False, power_backup_hours=0.0,
        cooling="window_unit", heating="wall_furnace", mobility="independent", has_transport=True,
        contact_name="Soledad Bustos-Ramirez", contact_phone="", contact_relation="granddaughter",
        notes="84. One window unit in the front room and nothing in the rest of the house. Drives to the store but not much further.",
    ),
]

# Which seeded neighbours may receive a REAL number. Rosa and Walter carry the two scenes the demo
# is built around; Ernesto is the third because his call is the one that ends in an escalation.
# Emergency contacts are never given a real number, whatever the environment says: the ladder can
# place a second call on its own and a live demo must not spend the free tier on a number nobody
# agreed to be rung on.
DEMO_NAMES: dict[str, str] = {
    "Rosa Delgado": "DEMO_PHONE_A",
    "Walter Brzezinski": "DEMO_PHONE_B",
    "Ernesto Salgado": "DEMO_PHONE_C",
}

#: Every committed number is in this block. `tests/test_seed.py` asserts it of every row.
FICTIONAL_PREFIX = "+1555010"


def fictional_phone(n: int) -> str:
    """A number that cannot be dialled. Neighbours take 00-49, emergency contacts 50-99."""
    return f"{FICTIONAL_PREFIX}{n:02d}"


# ------------------------------------------------------------------------------------------------
# The hazards.
#
# `facts` is the loose dict `app.domain.hazards` parses; only temp_f, humidity_pct, outage_eta_h and
# aqi are computed on, and everything else rides along for the UI. There is deliberately no
# `callback_number`: the contract will read one out on the call if it is set, and an unroutable
# number spoken to a frightened person is worse than saying nothing.
# ------------------------------------------------------------------------------------------------
def _iso(day: date, at: time) -> str:
    return datetime.combine(day, at).isoformat(timespec="minutes")


def heat_hazard_spec(today: date | None = None) -> dict[str, Any]:
    """The Excessive Heat Warning the demo opens on.

    41% humidity is the fact that does the work. In dry Phoenix air a swamp cooler drops a room
    twenty-five degrees; at 41% it drops it a few and adds damp, which is why Rosa sorts above four
    people whose files look worse than hers.
    """
    day = today or date.today()
    return dict(
        kind="heat",
        headline="Excessive Heat Warning — 114F, monsoon humidity",
        area=AREA,
        severity="warning",
        starts_at=_iso(day, time(10, 0)),
        ends_at=_iso(day + timedelta(days=1), time(20, 0)),
        status=HazardStatus.OPEN,
        facts={
            "temp_f": 114,
            "humidity_pct": 41,
            "overnight_low_f": 93,
            "issued": "NWS Phoenix",
            "note": "Monsoon moisture pushed dewpoints up overnight; evaporative coolers will not keep up.",
        },
        help_offered=HEAT_HELP,
        source="NWS Phoenix AZZ537",
        declared_by=CAPTAIN,
    )


def outage_hazard_spec(today: date | None = None) -> dict[str, Any]:
    """The second hazard, declared live in the demo over the same fourteen people.

    Six hours is the number Walter's four hours of battery is subtracted from. It comes from the
    utility rather than from us, which matters: with no estimate at all the risk engine has to
    assume one, and it says so out loud in the reasons.
    """
    day = today or date.today()
    return dict(
        kind="power_outage",
        headline="Power outage — 6,100 customers out across Maryvale",
        area=AREA,
        severity="warning",
        starts_at=_iso(day, time(16, 20)),
        ends_at="",
        status=HazardStatus.OPEN,
        facts={
            "outage_eta_h": 6,
            "temp_f": 108,
            "humidity_pct": 38,
            "customers_out": 6100,
            "cause": "Substation fault at 51st Avenue during peak load",
            "note": "Utility estimate is six hours and utility estimates slip.",
        },
        help_offered=OUTAGE_HELP,
        source="APS outage map, 16:20",
        declared_by=CAPTAIN,
    )


# ------------------------------------------------------------------------------------------------
# The things a coordinator can move. Community resources only: a van, a driver, water and ice, a
# power cart, a nurse who can assess. There is deliberately no EMS or fire unit in the seed — those
# kinds exist in the model precisely so that committing one requires a named human, and seeding one
# as "available" would suggest BuddyE has an ambulance to spend.
#
# Bases are the Maryvale Community Center campus at 51st Avenue and Campbell, which is also where
# the cooling center in `HEAT_HELP` is.
# ------------------------------------------------------------------------------------------------
BASE_LAT, BASE_LON = 33.5020, -112.1697

ASSETS: list[dict[str, Any]] = [
    dict(call_sign="WV-1", kind=AssetKind.WELLNESS_VAN, operator_name="Marco and Dee",
         capabilities=["assess", "water", "transport"], capacity=8, speed_mph=20.0,
         notes="Two volunteers doing door knocks. Radio call sign on the captain's board."),
    dict(call_sign="WV-2", kind=AssetKind.WELLNESS_VAN, operator_name="Priscilla and Ray",
         capabilities=["assess", "water"], capacity=8, speed_mph=20.0, notes=""),
    dict(call_sign="RIDE-3", kind=AssetKind.VOLUNTEER_DRIVER, operator_name="Hector Vega",
         capabilities=["transport"], capacity=4, speed_mph=25.0,
         notes="Minivan; can take a walker but not a wheelchair."),
    dict(call_sign="WATER-1", kind=AssetKind.WATER_ICE_TRUCK, operator_name="Lupe Ibarra",
         capabilities=["water", "ice"], capacity=20, speed_mph=18.0,
         notes="The food bank van, out on loan for the duration of the warning."),
    dict(call_sign="PWR-1", kind=AssetKind.POWER_CART, operator_name="Danny Ruelas",
         capabilities=["battery", "power"], capacity=2, speed_mph=18.0,
         notes="Portable battery on a trailer. Will run a concentrator for about ten hours."),
    dict(call_sign="NURSE-1", kind=AssetKind.NURSE_OUTREACH, operator_name="Ana Whitfield RN",
         capabilities=["assess", "medication"], capacity=6, speed_mph=24.0,
         notes="Clinic nurse, volunteers evenings. Can assess; cannot transport and is not a paramedic."),
]


# ------------------------------------------------------------------------------------------------
def wipe(session: Session) -> None:
    """Clear the demo data.

    `SpentCall` is deliberately absent, exactly as in ShiftFill: it is the ledger of real calls
    already billed against the free tier, and a demo reset that handed twenty calls back would be a
    reset that lets the next demo place them again for real.
    """
    for model in (
        AgentEvent,
        WebhookReceipt,
        Correspondence,
        IncidentDocument,
        OperatorAction,
        Dispatch,
        Incident,
        Asset,
        HandoffPacket,
        Escalation,
        CheckCall,
        Sweep,
        Hazard,
        Neighbour,
    ):
        session.exec(delete(model))  # type: ignore[call-overload]


def seed_neighbours(session: Session, settings: Settings) -> list[Neighbour]:
    rows: list[Neighbour] = []
    for i, spec in enumerate(NEIGHBOURS):
        spec = dict(spec)
        env_key = DEMO_NAMES.get(spec["name"])
        real = str(getattr(settings, env_key, "") or "") if env_key else ""
        # A real number arrives only from the environment, is flagged on the row, and still has to
        # clear DIALABLE_NUMBERS in the provider before anything is dialled.
        phone = real or fictional_phone(i)
        if spec.get("contact_name") and not spec.get("contact_phone"):
            spec["contact_phone"] = fictional_phone(50 + i)
        rows.append(Neighbour(phone=phone, is_demo=bool(real), **spec))
    for row in rows:
        session.add(row)
    return rows


def seed_assets(session: Session) -> list[Asset]:
    """The full fleet: community assets AND the agency units an overseer can be asked to approve.

    Delegates to `app.seed_assets`, which carries the same six community specs plus the staged
    EMS/fire/police units at real Phoenix station coordinates, and is idempotent by call sign.

    The import is qualified deliberately. `from app.seed_assets import seed_assets` would rebind
    this very name inside this module: the demo would keep planting only the six community rows,
    no agency unit would ever exist, the approvals queue would be permanently empty — and every
    test would still pass, because the tests build the fleet from the other module directly. That
    failure has already happened once here.
    """
    from app import seed_assets as fleet_seed

    return fleet_seed.seed_assets(session)


def seed(session: Session, settings: Settings) -> Hazard:
    """Wipe, plant the roster and the fleet, declare the heat warning, and return it.

    Returns the heat hazard because that is what the demo opens on and what the API hands back from
    `POST /api/demo/reset`. The outage is not seeded — it is *declared*, by `declare_outage`, while
    the audience is watching, so that the reordering happens on screen rather than in a fixture.
    """
    wipe(session)
    seed_neighbours(session, settings)
    seed_assets(session)
    hazard = Hazard(**heat_hazard_spec())
    session.add(hazard)
    session.flush()
    return hazard


def declare_outage(session: Session, *, today: date | None = None) -> Hazard:
    """Declare the power outage over the same roster, and return it.

    Idempotent by kind: pressing the demo button twice returns the outage already on the board
    rather than stacking a second one. What happens to the heat warning is the caller's decision,
    not this module's — a real evening can have both, and `HazardStatus` allows it.
    """
    existing = session.exec(
        select(Hazard).where(Hazard.kind == "power_outage", Hazard.status != HazardStatus.CLOSED)
    ).first()
    if existing is not None:
        return existing
    hazard = Hazard(**outage_hazard_spec(today))
    session.add(hazard)
    session.flush()
    return hazard


def ensure_seeded(session: Session, settings: Settings) -> None:
    if session.exec(select(Neighbour)).first() is None:
        seed(session, settings)
