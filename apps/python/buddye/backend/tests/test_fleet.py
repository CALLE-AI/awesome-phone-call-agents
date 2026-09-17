"""The deterministic dispatch engine, tested on the demo's own people and its own fleet.

Three properties are what these tests exist for, and each of them is a way the layer could look
right and be useless:

* **The demo fleet can actually do the job.** Needs are matched through `NEED_SATISFIED_BY`, not by
  string equality, so a door knock in the *seeded* demo is answered by a wellness van rather than by
  a police car. The tests that matter here build the fleet the way `POST /api/demo/reset` does —
  through `app.seed` — and not through `app.seed_assets`, because if the test path and the demo path
  differ, a mismatch between the need vocabulary and the seeded capabilities stays invisible.
* **Numbers are computed.** Every distance and ETA asserted below comes out of `app.domain.geo`
  over real Maryvale coordinates. Nothing here pins a hardcoded mile count as an expectation of the
  engine; where a bound is asserted it is a sanity range on real geography.
* **Speed is not a licence.** An ambulance out of Station 15 genuinely beats a wellness van to
  Ernesto's door. The agency gate is the reason it is not offered for a case of water, and the same
  incident at URGENT shows the gate opening.
"""
from __future__ import annotations

import pytest
from sqlmodel import select

from app.db import session_scope
from app.domain import fleet
from app.domain.geo import drive_miles
from app.domain.risk import RiskBand
from app.domain.state import AssetKind, AssetStatus, CheckOutcome, requires_authorisation
from app.models import Asset, Incident, Neighbour
from app.seed_assets import COMMUNITY_BASE, FLEET, agency_call_signs, seed_assets

# Maryvale, generously bounded. Every seeded coordinate — neighbour, base, fire station, precinct —
# has to fall inside it, or somebody has invented a location.
MARYVALE_BBOX = (33.44, 33.53, -112.22, -112.13)


# ------------------------------------------------------------------------------------------------
# helpers
# ------------------------------------------------------------------------------------------------
def roster() -> dict[str, Neighbour]:
    """The seeded roster by name, detached so a test can read it after the session closes."""
    with session_scope() as s:
        rows = list(s.exec(select(Neighbour)).all())
        for r in rows:
            s.expunge(r)
        return {r.name: r for r in rows}


def demo_fleet() -> list[Asset]:
    """The fleet exactly as `app.seed.seed` leaves it.

    This used to be six community assets with no agency units. `app.seed.seed_assets` now delegates
    to `app.seed_assets`, so the demo plants the agency units too — deliberately, because with no
    EMS row there is nothing for an agent to request and the approvals queue is permanently empty.
    """
    with session_scope() as s:
        rows = list(s.exec(select(Asset)).all())
        for r in rows:
            s.expunge(r)
        return rows


def full_fleet() -> list[Asset]:
    """The seeded fleet plus everything `app.seed_assets` adds, which is what the operator layer
    will see once the reset calls it."""
    with session_scope() as s:
        rows = seed_assets(s)
        for r in rows:
            s.expunge(r)
        return list(rows)


def incident_for(neighbour: Neighbour, outcome: CheckOutcome, **kw) -> Incident:  # noqa: ANN003
    """An incident at this person's real address. Coordinates are copied off the roster row, which
    is the thing the engine refuses to work without."""
    return Incident(hazard_id="haz_test", sweep_id="swp_test", neighbour_id=neighbour.id,
                    outcome=outcome.value, lat=neighbour.lat, lon=neighbour.lon,
                    address=neighbour.address, **kw)


def by_sign(assets: list[Asset]) -> dict[str, Asset]:
    return {a.call_sign: a for a in assets}


def signs(items) -> list[str]:  # noqa: ANN001
    return [i.call_sign for i in items]


def excluded_reason(report: fleet.Eligibility, call_sign: str) -> fleet.Exclusion:
    for e in report.excluded:
        if e.call_sign == call_sign:
            return e
    raise AssertionError(f"{call_sign} was not excluded: {signs(report.candidates)}")


# ------------------------------------------------------------------------------------------------
# The vocabulary contracts. Both of these are strings owned by another module.
# ------------------------------------------------------------------------------------------------
def test_every_help_offer_the_demo_makes_maps_to_something_the_fleet_can_carry() -> None:
    """`help_accepted` comes back from CALL-E keyed by the hazard's own offer keys. A typo here is
    silent: Rosa accepts a ride and no transport need is ever generated."""
    from app.seed import HEAT_HELP, OUTAGE_HELP

    for offer in HEAT_HELP + OUTAGE_HELP:
        caps = fleet.HELP_TO_CAPABILITY.get(offer["key"])
        assert caps, f"offer {offer['key']!r} ({offer['label']}) maps to no capability"
        for cap in caps:
            assert cap in fleet.CAPABILITY_ORDER


def test_every_need_can_be_met_by_something_in_the_seeded_demo_fleet() -> None:
    """Every capability the engine can ask for, except the two that are agency-only by design, has
    somebody on the community fleet who can do it. A need nothing can fill is a dead end that only
    shows up in front of an audience."""
    community = [s for s in FLEET if not requires_authorisation(s["kind"])]
    for need in fleet.CAPABILITY_ORDER:
        if need in {fleet.MEDICAL, fleet.FORCED_ENTRY}:
            continue  # deliberately agency-only: a volunteer is not a paramedic and does not force doors
        satisfied = fleet.NEED_SATISFIED_BY[need]
        assert any(satisfied & set(spec["capabilities"]) for spec in community), \
            f"nothing on the community fleet can satisfy {need!r}"


# ------------------------------------------------------------------------------------------------
# Ernesto Salgado — the door knock, and the agency gate
# ------------------------------------------------------------------------------------------------
def test_ernesto_unreachable_is_a_door_knock_the_demo_fleet_can_answer(seeded: str) -> None:
    """Silence from someone in the critical band is answered by a person at the door.

    Built through the seed path on purpose: the community assets carry `assess`, not
    `welfare_check`, and if needs were matched by string equality the only unit left standing for a
    door knock would be a police car — exactly backwards.
    """
    ernesto = roster()["Ernesto Salgado"]
    needs = fleet.needs_for(outcome=CheckOutcome.UNREACHABLE, risk={"band": "critical"}, neighbour=ernesto)

    assert fleet.WELFARE_CHECK in needs
    assert needs.priority == 1, "unreachable in the critical band is life safety"
    assert needs.agency_justified and "critical band" in needs.agency_reason

    report = fleet.eligible(demo_fleet(), incident_for(ernesto, CheckOutcome.UNREACHABLE, priority=1), needs)
    assert set(signs(report.candidates)) >= {"WV-1", "WV-2", "NURSE-1"}, \
        f"community units must be able to knock on a door: {[e.reason for e in report.excluded]}"
    # and the fleet's own words are quoted back, so the coordinator can see the match
    wv1 = next(c for c in report.candidates if c.call_sign == "WV-1")
    assert fleet.WELFARE_CHECK in wv1.matched


def test_an_ambulance_is_faster_than_the_van_and_still_not_offered_for_water(seeded: str) -> None:
    """The whole argument for the agency gate, on real distances.

    Rescue 15 is further from Ernesto than the community base is, but it drives 32 mph to a
    volunteer van's 20 and genuinely wins the ETA race. A pure-speed ranking would hand a water drop
    to an ambulance and take it off somebody else's emergency.
    """
    ernesto = roster()["Ernesto Salgado"]
    assets = by_sign(full_fleet())
    to_ernesto = lambda a: drive_miles(a.lat, a.lon, ernesto.lat, ernesto.lon)  # noqa: E731
    eta = lambda a: to_ernesto(a) / a.speed_mph * 60  # noqa: E731
    assert to_ernesto(assets["R-15"]) > to_ernesto(assets["WV-1"]), "R-15 really is further away"
    assert eta(assets["R-15"]) < eta(assets["WV-1"]), "and really would get there first"

    water = fleet.needs_for(
        outcome=CheckOutcome.NEEDS_HELP,
        decision={"outcome": "NEEDS_HELP", "help_accepted": ["water_ice_drop"], "band": "high"},
        neighbour=ernesto,
    )
    report = fleet.eligible(list(assets.values()), incident_for(ernesto, CheckOutcome.NEEDS_HELP, priority=3), water)
    assert not report.needs.agency_justified
    for sign in agency_call_signs():
        exc = excluded_reason(report, sign)
        assert exc.code == "authorisation"
        assert "somebody else's emergency" in exc.reason
    best = report.best()
    assert best is not None and not best.requires_authorisation
    assert best.call_sign in {"WATER-1", "WV-1"}


def test_the_gate_opens_when_the_call_comes_back_urgent(seeded: str) -> None:
    """Same person, same street, same fleet — the finding is what changes who may be considered."""
    ernesto = roster()["Ernesto Salgado"]
    needs = fleet.needs_for(
        outcome=CheckOutcome.URGENT,
        decision={"outcome": "URGENT", "checks": {"is_safe_now": "no"}, "band": "high"},
        neighbour=ernesto,
    )
    assert needs.agency_justified
    assert fleet.MEDICAL in needs and needs.life_safety
    assert needs.priority == 1

    report = fleet.eligible(full_fleet(), incident_for(ernesto, CheckOutcome.URGENT, priority=1), needs)
    ranked = fleet.rank(report.candidates, priority=1)
    assert "R-15" in signs(ranked)
    # It wins because it is the only unit that covers `medical` — NURSE-1 arrives at the same
    # minute and can assess, but a nurse is not a paramedic, and the fleet says so.
    assert ranked[0].call_sign == "R-15" and fleet.MEDICAL in ranked[0].matched
    assert ranked[0].requires_authorisation, "and it stays PROPOSED until a person approves it"
    nurse = next(c for c in ranked if c.call_sign == "NURSE-1")
    assert fleet.MEDICAL not in nurse.matched


# ------------------------------------------------------------------------------------------------
# Rosa Delgado — what she accepted is what gets sent
# ------------------------------------------------------------------------------------------------
def test_rosa_accepting_a_ride_and_a_water_drop_produces_transport_water_and_ice(seeded: str) -> None:
    rosa = roster()["Rosa Delgado"]
    needs = fleet.needs_for(
        outcome=CheckOutcome.NEEDS_HELP,
        decision={"outcome": "NEEDS_HELP", "help_accepted": ["ride", "water_ice_drop"],
                  "checks": {"checks.too_hot": "yes"}, "band": "high"},
        risk={"band": "high"},
        neighbour=rosa,
    )
    assert set(needs.capabilities) == {fleet.WATER, fleet.ICE, fleet.TRANSPORT}
    assert "accepted the offer of ride" in needs.reason_for(fleet.TRANSPORT)
    assert needs.priority == 3  # NEEDS_HELP at high; not life safety, but not routine either

    # list(NeedSet) is exactly what goes onto Incident.needs, and reading it back gives the same set
    incident = incident_for(rosa, CheckOutcome.NEEDS_HELP, priority=3, needs=list(needs))
    assert incident.needs == [fleet.WATER, fleet.ICE, fleet.TRANSPORT]
    assert set(fleet.needs_for(incident).capabilities) == set(needs.capabilities)

    report = fleet.eligible(full_fleet(), incident)  # needs=None -> read off the incident
    assert "WATER-1" in signs(report.candidates), "the truck carries both water and ice"
    water_1 = next(c for c in report.candidates if c.call_sign == "WATER-1")
    assert set(water_1.matched) == {fleet.WATER, fleet.ICE} and water_1.unmet == (fleet.TRANSPORT,)


def test_rosa_declining_everything_sends_nobody(seeded: str) -> None:
    """Turning help down is a recorded decision, not an error, and it is hers to make."""
    rosa = roster()["Rosa Delgado"]
    needs = fleet.needs_for(outcome=CheckOutcome.HELP_DECLINED, risk={"band": "high"}, neighbour=rosa)
    assert list(needs) == []
    assert any("turned it all down" in n for n in needs.notes)

    report = fleet.eligible(full_fleet(), incident_for(rosa, CheckOutcome.HELP_DECLINED, priority=4), needs)
    assert report.candidates == ()
    assert excluded_reason(report, "WV-1").code == "no_needs"


def test_an_offer_key_the_fleet_does_not_know_is_never_silently_dropped() -> None:
    needs = fleet.needs_for(outcome=CheckOutcome.NEEDS_HELP,
                            decision={"help_accepted": ["generator_loan"], "band": "elevated"})
    assert fleet.ASSESS in needs
    assert "generator_loan" in needs.reason_for(fleet.ASSESS)


# ------------------------------------------------------------------------------------------------
# Walter Brzezinski — the machine plugged into the wall
# ------------------------------------------------------------------------------------------------
def test_walter_in_a_blackout_needs_a_battery_and_gets_the_power_cart(seeded: str) -> None:
    walter = roster()["Walter Brzezinski"]
    assert walter.power_dependent and walter.power_backup_hours == 4.0

    needs = fleet.needs_for(
        outcome=CheckOutcome.NEEDS_HELP,
        decision={"checks": {"checks.has_power": "no", "checks.equipment_working": "yes"}},
        risk={"band": "critical", "time_to_harm_h": 1.5},
        neighbour=walter,
    )
    assert fleet.BATTERY in needs and needs.life_safety, "1.5h of battery against an outage is life safety"
    assert "1.5h from harm" in needs.reason_for(fleet.BATTERY)

    incident = incident_for(walter, CheckOutcome.NEEDS_HELP, priority=needs.priority, needs=list(needs))
    report = fleet.eligible(full_fleet(), incident, needs)
    best = report.best()
    assert best is not None and best.call_sign == "PWR-1", "the only thing on the board with a battery"
    assert best.distance_miles == pytest.approx(
        drive_miles(*COMMUNITY_BASE, walter.lat, walter.lon), rel=1e-6), "distance is computed, not stored"
    assert 0 < best.eta_minutes < 20

    # The truck is a mile from him and still wrong, and the exclusion says why in the fleet's words.
    truck = excluded_reason(report, "WATER-1")
    assert truck.code == "capability"
    assert "water, ice" in truck.reason and "battery" in truck.reason
    # This incident is not agency-justified: nobody's equipment has stopped yet.
    assert excluded_reason(report, "R-15").code == "authorisation"


def test_walters_wheelchair_decides_which_driver_without_blocking_the_ride(seeded: str) -> None:
    """A lift is a preference, never a filter: if no accessible vehicle is on shift the ride still
    gets offered, with the problem written down. But when one is free, it goes."""
    walter = roster()["Walter Brzezinski"]
    needs = fleet.needs_for(
        outcome=CheckOutcome.NEEDS_HELP,
        decision={"help_accepted": ["ride"], "band": "high"},
        neighbour=walter,
    )
    assert list(needs) == [fleet.TRANSPORT]
    assert fleet.WHEELCHAIR in needs.preferred_capabilities
    assert any("lift" in n for n in needs.notes)

    assets = by_sign(full_fleet())
    # Park the accessible van and the minivan on the same corner so only fit can separate them.
    assets["RIDE-5"].lat, assets["RIDE-5"].lon = assets["RIDE-3"].lat, assets["RIDE-3"].lon
    incident = incident_for(walter, CheckOutcome.NEEDS_HELP, priority=3)
    ranked = fleet.rank(fleet.eligible(list(assets.values()), incident, needs).candidates, priority=3)
    order = signs(ranked)
    assert order.index("RIDE-5") < order.index("RIDE-3"), \
        "same corner, same speed: the lift is the only thing left to choose on"
    assert fleet.WHEELCHAIR in ranked[0].preferred_matched, f"{ranked[0].call_sign} has no lift"
    assert "RIDE-3" in order, "a van without a lift is still a legal ride"
    # The bus wins outright here, and it should: it is parked at the district yard half a mile from
    # him while both drivers are up at the community center. Fit breaks ties, it does not beat ETA.
    assert ranked[0].call_sign == "SHUTTLE-1"
    assert ranked[0].eta_minutes < next(c for c in ranked if c.call_sign == "RIDE-5").eta_minutes


# ------------------------------------------------------------------------------------------------
# Ranking
# ------------------------------------------------------------------------------------------------
def test_ranking_prefers_the_genuinely_closest_capable_unit(seeded: str) -> None:
    rosa = roster()["Rosa Delgado"]
    assets = by_sign(full_fleet())
    # 55th Ave & Osborn — a real corner, two blocks from her house and two miles from base.
    assets["WV-2"].lat, assets["WV-2"].lon = 33.4874, -112.1780
    needs = fleet.needs_for(outcome=CheckOutcome.NEEDS_HELP,
                            decision={"help_accepted": ["water_drop"], "band": "elevated"}, neighbour=rosa)

    report = fleet.eligible([assets["WV-1"], assets["WV-2"]], incident_for(rosa, CheckOutcome.NEEDS_HELP), needs)
    ranked = fleet.rank(report.candidates, priority=4)
    near = next(c for c in ranked if c.call_sign == "WV-2")
    far = next(c for c in ranked if c.call_sign == "WV-1")
    assert near.distance_miles < far.distance_miles
    assert near.eta_minutes < far.eta_minutes
    assert ranked[0].call_sign == "WV-2"
    assert f"{near.distance_miles:.1f} mi out" in near.reason  # the number a coordinator reads


def test_ranking_is_a_total_order_and_breaks_ties_on_fit_then_capacity(seeded: str) -> None:
    rosa = roster()["Rosa Delgado"]
    assets = by_sign(full_fleet())
    # Same corner, same speed: the only differences left are what they carry and what they have left.
    for sign in ("WV-1", "WV-2", "WATER-1"):
        assets[sign].lat, assets[sign].lon = 33.4874, -112.1780
        assets[sign].speed_mph = 20.0
    assets["WV-2"].served_this_shift = 6  # 2 of 8 left; WV-1 still has all 8
    needs = fleet.needs_for(outcome=CheckOutcome.NEEDS_HELP,
                            decision={"help_accepted": ["water_ice_drop"], "band": "elevated"}, neighbour=rosa)

    ranked = fleet.rank(
        fleet.eligible([assets[s] for s in ("WV-2", "WV-1", "WATER-1")],
                       incident_for(rosa, CheckOutcome.NEEDS_HELP), needs).candidates,
        priority=4,
    )
    assert signs(ranked) == ["WATER-1", "WV-1", "WV-2"], "water+ice beats water; then spare capacity"
    # deterministic: the same inputs in another order produce the same list
    again = fleet.rank(list(reversed(ranked)), priority=4)
    assert signs(again) == signs(ranked)


def test_a_stopped_asset_is_never_promised_to_anybody(seeded: str) -> None:
    rosa = roster()["Rosa Delgado"]
    assets = by_sign(full_fleet())
    assets["WV-1"].speed_mph = 0.0
    needs = fleet.needs_for(outcome=CheckOutcome.NEEDS_HELP,
                            decision={"help_accepted": ["water_drop"], "band": "elevated"}, neighbour=rosa)
    report = fleet.eligible([assets["WV-1"]], incident_for(rosa, CheckOutcome.NEEDS_HELP), needs)
    assert report.candidates == ()
    assert excluded_reason(report, "WV-1").code == "speed"


# ------------------------------------------------------------------------------------------------
# Exclusions and the gate
# ------------------------------------------------------------------------------------------------
def test_busy_full_and_distant_units_are_excluded_with_a_sentence_each(seeded: str) -> None:
    rosa = roster()["Rosa Delgado"]
    assets = by_sign(full_fleet())
    assets["WV-1"].status = AssetStatus.EN_ROUTE
    assets["WV-2"].served_this_shift = assets["WV-2"].capacity
    assets["NURSE-1"].current_dispatch_id = "dsp_elsewhere"
    assets["WATER-1"].lat, assets["WATER-1"].lon = 33.4500, -112.0700  # downtown Phoenix, miles off

    needs = fleet.needs_for(outcome=CheckOutcome.NEEDS_HELP,
                            decision={"help_accepted": ["water_drop"], "band": "elevated"}, neighbour=rosa)
    report = fleet.eligible(list(assets.values()), incident_for(rosa, CheckOutcome.NEEDS_HELP, priority=4), needs)

    assert excluded_reason(report, "WV-1").code == "status"
    assert "en route" in excluded_reason(report, "WV-1").reason
    assert excluded_reason(report, "WV-2").code == "capacity"
    assert "8 of 8" in excluded_reason(report, "WV-2").reason
    assert excluded_reason(report, "NURSE-1").code == "committed"
    assert "dsp_elsewhere" in excluded_reason(report, "NURSE-1").reason
    radius = excluded_reason(report, "WATER-1")
    assert radius.code == "radius" and "mi away by road" in radius.reason
    # every asset is accounted for, one way or the other — nothing vanishes from the board
    assert len(report.candidates) + len(report.excluded) == len(assets)


def test_an_incident_with_no_coordinates_fails_honestly_rather_than_confidently(seeded: str) -> None:
    """Incident.lat/lon default to 0.0, which is in the Atlantic. Quoting an 8,400 mile exclusion
    would be worse than useless: it looks like an answer."""
    blank = Incident(hazard_id="haz_test", sweep_id="swp_test", neighbour_id="nbr_x",
                     outcome=CheckOutcome.NEEDS_HELP.value, needs=[fleet.WATER])
    report = fleet.eligible(full_fleet(), blank)
    assert report.candidates == ()
    assert "no coordinates" in report.error
    assert all(e.code == "no_location" for e in report.excluded)
    assert not fleet.validate_choice(by_sign(full_fleet())["WV-1"], blank).ok


def test_validate_choice_refuses_every_illegal_pick(seeded: str) -> None:
    walter = roster()["Walter Brzezinski"]
    assets = by_sign(full_fleet())
    needs = fleet.needs_for(
        outcome=CheckOutcome.NEEDS_HELP,
        decision={"checks": {"checks.has_power": "no"}},
        risk={"band": "critical", "time_to_harm_h": 1.5},
        neighbour=walter,
    )
    incident = incident_for(walter, CheckOutcome.NEEDS_HELP, priority=needs.priority)

    ok = fleet.validate_choice(assets["PWR-1"], incident, needs)
    assert ok and ok.code == "ok" and not ok.requires_authorisation
    assert ok.distance_miles is not None and ok.eta_minutes is not None

    wrong_capability = fleet.validate_choice(assets["WATER-1"], incident, needs)
    assert not wrong_capability and wrong_capability.code == "capability"

    assets["PWR-1"].status = AssetStatus.ON_SCENE
    assert fleet.validate_choice(assets["PWR-1"], incident, needs).code == "status"
    assets["PWR-1"].status = AssetStatus.AVAILABLE
    assets["PWR-1"].served_this_shift = assets["PWR-1"].capacity
    assert fleet.validate_choice(assets["PWR-1"], incident, needs).code == "capacity"

    # An agency unit on an incident that does not justify one: refused outright, not merely flagged.
    unauthorised = fleet.validate_choice(assets["R-15"], incident, needs)
    assert not unauthorised and unauthorised.code == "authorisation"


def test_an_authorised_agency_pick_is_legal_to_prepare_and_still_needs_a_name(seeded: str) -> None:
    ernesto = roster()["Ernesto Salgado"]
    assets = by_sign(full_fleet())
    needs = fleet.needs_for(outcome=CheckOutcome.URGENT,
                            decision={"checks": {"checks.equipment_working": "no"}}, neighbour=ernesto)
    result = fleet.validate_choice(assets["R-15"], incident_for(ernesto, CheckOutcome.URGENT, priority=1), needs)
    assert result.ok, result.reason
    assert result.requires_authorisation is True
    assert requires_authorisation(AssetKind.EMS_UNIT) is True
    assert "until a named human approves it" in result.reason


def test_the_filter_and_the_gate_can_never_disagree(seeded: str) -> None:
    """`eligible` and `validate_choice` run the same evaluation. If they could diverge, the system
    would eventually commit something the filter had already refused."""
    rosa = roster()["Rosa Delgado"]
    assets = full_fleet()
    by = by_sign(assets)
    by["WV-1"].status = AssetStatus.RETURNING
    by["RIDE-3"].served_this_shift = by["RIDE-3"].capacity
    needs = fleet.needs_for(outcome=CheckOutcome.NEEDS_HELP,
                            decision={"help_accepted": ["ride", "water_drop"], "band": "high"}, neighbour=rosa)
    incident = incident_for(rosa, CheckOutcome.NEEDS_HELP, priority=3)

    report = fleet.eligible(assets, incident, needs)
    accepted = set(signs(report.candidates))
    for asset in assets:
        assert fleet.validate_choice(asset, incident, needs).ok == (asset.call_sign in accepted), asset.call_sign


# ------------------------------------------------------------------------------------------------
# Priority
# ------------------------------------------------------------------------------------------------
def test_priority_one_is_reserved_for_life_safety() -> None:
    assert fleet.incident_priority(CheckOutcome.UNREACHABLE, RiskBand.CRITICAL) == 1
    assert fleet.incident_priority(CheckOutcome.URGENT, RiskBand.CRITICAL) == 1
    assert fleet.incident_priority(CheckOutcome.URGENT, RiskBand.HIGH) == 1
    assert fleet.incident_priority(CheckOutcome.NEEDS_HELP, RiskBand.CRITICAL) > 1
    assert fleet.incident_priority(CheckOutcome.SAFE, RiskBand.CRITICAL) == 5
    # an unreadable outcome is not permission to relax
    assert fleet.incident_priority("nonsense", RiskBand.CRITICAL) == 2
    assert fleet.incident_priority(CheckOutcome.UNREACHABLE, "nonsense") == 3  # unreadable band -> elevated


def test_incident_priority_never_contradicts_the_captains_board() -> None:
    """The board sorts on `decide.PRIORITY` (0-100). If a pair of situations is ranked one way there
    and the other way here, a coordinator has two screens telling them different things about who is
    most urgent."""
    from app.orchestrator.decide import PRIORITY

    pairs = [(o, b) for o in PRIORITY for b in PRIORITY[o]]
    for a in pairs:
        for c in pairs:
            if PRIORITY[a[0]][a[1]] > PRIORITY[c[0]][c[1]]:
                assert fleet.incident_priority(*a) <= fleet.incident_priority(*c), f"{a} vs {c}"


def test_priority_is_derived_from_the_finding_not_read_back_off_the_row(seeded: str) -> None:
    """`Incident.priority` defaults to 3. An incident that arrives carrying nothing but an outcome
    and an address must still come out as life safety — reading the column back would file Walter,
    unreachable in the critical band, as "prompt", and then send at a six-mile radius instead of
    fifteen."""
    walter = roster()["Walter Brzezinski"]
    fresh = Incident(hazard_id="haz_test", sweep_id="swp_test", neighbour_id=walter.id,
                     outcome=CheckOutcome.UNREACHABLE.value, lat=walter.lat, lon=walter.lon)
    assert fresh.priority == 3, "the model default is what makes this test worth having"

    needs = fleet.needs_for(fresh, risk={"band": "critical"}, neighbour=walter)
    assert needs.priority == 1
    report = fleet.eligible(full_fleet(), fresh, needs)
    assert report.radius_miles == fleet.RADIUS_BY_PRIORITY[1]
    # Handing in bare capability strings loses the triage band — the row does not carry one — so
    # the derivation falls back to elevated. What must survive is a graver priority somebody already
    # wrote on the incident: urgency never goes down by being read back.
    assert fleet.eligible(full_fleet(), fresh, [fleet.WELFARE_CHECK]).needs.priority == 3
    fresh.priority = 1
    assert fleet.eligible(full_fleet(), fresh, [fleet.WELFARE_CHECK]).needs.priority == 1
    assert fleet.needs_for(fresh, risk={"band": "routine"}).priority == 1


def test_radius_widens_for_life_safety_and_narrows_for_routine() -> None:
    assert fleet.RADIUS_BY_PRIORITY[1] > fleet.RADIUS_BY_PRIORITY[3] > fleet.RADIUS_BY_PRIORITY[5]


# ------------------------------------------------------------------------------------------------
# The seeded fleet itself
# ------------------------------------------------------------------------------------------------
def test_seed_assets_is_idempotent_and_never_moves_a_van_that_is_out(seeded: str) -> None:
    first = full_fleet()
    call_signs = [a.call_sign for a in first]
    assert len(call_signs) == len(set(call_signs)) == len(FLEET)

    with session_scope() as s:
        moved = s.exec(select(Asset).where(Asset.call_sign == "WV-1")).one()
        moved.lat, moved.lon, moved.status = 33.4874, -112.1780, AssetStatus.EN_ROUTE
        s.add(moved)

    second = by_sign(full_fleet())
    assert len(second) == len(FLEET), "a second run adds nothing"
    assert (second["WV-1"].lat, second["WV-1"].status) == (33.4874, AssetStatus.EN_ROUTE), \
        "a second run must not teleport an asset that is mid-dispatch back to base"


def test_the_seeded_fleet_carries_both_kinds_and_keeps_them_apart(seeded: str) -> None:
    """The demo seeds community resources an agent may send on its own, AND the agency units it may
    only ask for. Both must be present — a fleet with no ambulance cannot demonstrate the human
    gate, and a fleet with no volunteers cannot demonstrate anything else — and no asset may sit on
    the wrong side of the line."""
    before = by_sign(demo_fleet())
    after = by_sign(full_fleet())
    assert set(before) <= set(after), "re-seeding never drops an asset the demo already planted"
    assert agency_call_signs() == {"R-15", "R-25", "E-15", "812A"}

    community = {sign for sign, a in after.items() if not requires_authorisation(a.kind)}
    agency = {sign for sign, a in after.items() if requires_authorisation(a.kind)}

    assert agency == agency_call_signs(), "the units needing a human are exactly the agency ones"
    assert community and community.isdisjoint(agency)
    # the six the demo shipped with are still there and still auto-dispatchable
    assert {"WV-1", "WV-2", "RIDE-3", "WATER-1", "PWR-1", "NURSE-1"} <= community


def test_every_asset_is_parked_somewhere_real_in_maryvale(seeded: str) -> None:
    lat_lo, lat_hi, lon_lo, lon_hi = MARYVALE_BBOX
    for asset in full_fleet():
        assert lat_lo < asset.lat < lat_hi and lon_lo < asset.lon < lon_hi, asset.call_sign
        assert (asset.lat, asset.lon) == (asset.base_lat, asset.base_lon)
        assert asset.status == AssetStatus.AVAILABLE
        assert asset.speed_mph > 0 and asset.capacity >= 1
        assert asset.capabilities, f"{asset.call_sign} claims no capability"
        assert asset.operator_name, f"{asset.call_sign} has nobody crewing it"

    # And the fleet is spread over more than one staging point: a map with every unit under one pin
    # is a map that cannot show a dispatch going anywhere.
    positions = {(a.base_lat, a.base_lon) for a in full_fleet()}
    assert len(positions) >= 4


def test_no_community_asset_claims_something_only_an_agency_can_do() -> None:
    for spec in FLEET:
        if requires_authorisation(spec["kind"]):
            continue
        assert fleet.MEDICAL not in spec["capabilities"], f"{spec['call_sign']} is not a paramedic"
        assert fleet.FORCED_ENTRY not in spec["capabilities"], f"{spec['call_sign']} does not force doors"
