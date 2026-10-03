"""Triage tests.

Two people carry most of this file, because they are the two the product exists for and because
they are the clearest statement of its central claim: **risk belongs to the pairing of a person and
a hazard, never to the person alone.**

  * Rosa Delgado, 75, lives alone, cools a Maryvale house with a swamp cooler. Critical when the
    monsoon puts humidity into the forties on a 108F day, because an evaporative cooler is a
    machine for turning dry air cold and she has neither.
  * Walter Boyd, 68, oxygen concentrator plugged into the wall, no battery. Critical the moment the
    power goes, routine in a heat advisory that his central air handles without comment.

If either of them ever ranks the same under both hazards, the engine has stopped doing the only
thing it was built to do.

These tests deliberately touch no database and no fixtures: triage is a pure function, and it has
to stay one.
"""
from __future__ import annotations

import random

import pytest

from app.domain.hazards import (
    EVAP_DEAD_RH,
    HazardKind,
    Severity,
    evaporative_effectiveness,
    parse_hazard,
    parse_kind,
    parse_severity,
)
from app.domain.risk import (
    RiskBand,
    assess,
    call_order,
    normalize_age_band,
    normalize_condition,
    normalize_cooling,
    normalize_mobility,
    triage,
    triage_dict,
)

# --------------------------------------------------------------------------------------------
# The roster
# --------------------------------------------------------------------------------------------
ROSA = dict(
    id="nbr_rosa", name="Rosa Delgado", phone="+15550101", address="4412 W Osborn Rd",
    age_band="75_plus", lives_alone=True, conditions=["heat_sensitive"],
    cooling="swamp_cooler", heating="wall_furnace", mobility="cane_walker", has_transport=False,
    power_dependent=False, power_backup_hours=0.0, check_in_consent=True,
)
WALTER = dict(
    id="nbr_walter", name="Walter Boyd", phone="+15550102", address="4501 W Osborn Rd",
    age_band="65_74", lives_alone=False, conditions=["copd", "oxygen"],
    cooling="central_ac", heating="central", mobility="independent", has_transport=True,
    power_dependent=True, power_backup_hours=0.0, check_in_consent=True,
)
# A young, well-resourced neighbour: the control. Nothing should ever make him the first call.
DIEGO = dict(
    id="nbr_diego", name="Diego Ruiz", age_band="under_65", lives_alone=False, conditions=[],
    cooling="central_ac", heating="central", mobility="independent", has_transport=True,
    power_dependent=False, check_in_consent=True,
)

HUMID_HEAT = dict(
    id="haz_heat", kind="heat", severity="warning", area="Maryvale, Phoenix",
    headline="Excessive Heat Warning — 108F", facts={"temp_f": 108, "humidity_pct": 42},
)
DRY_HEAT_ADVISORY = dict(
    id="haz_heat_dry", kind="heat", severity="advisory", area="Maryvale, Phoenix",
    headline="Heat Advisory", facts={"temp_f": 102, "humidity_pct": 15},
)
BLACKOUT = dict(
    id="haz_out", kind="power_outage", severity="warning", area="Maryvale, Phoenix",
    headline="Unplanned outage — APS estimates six hours", facts={"outage_eta_h": 6},
)
MILD_OUTAGE = dict(
    id="haz_out_mild", kind="power_outage", severity="advisory", area="Maryvale, Phoenix",
    headline="Brief outage on Osborn", facts={},
)


def _with(base: dict, **over: object) -> dict:
    return {**base, **over}


# --------------------------------------------------------------------------------------------
# The two guarantees
# --------------------------------------------------------------------------------------------
def test_rosa_is_critical_in_humid_heat_and_the_reason_names_the_cooler() -> None:
    a = assess(ROSA, HUMID_HEAT)
    assert a.band is RiskBand.CRITICAL, a.reasons
    top = a.headline_reason.lower()
    assert "swamp cooler" in top
    assert "42" in top and "humid" in top  # the humidity is IN the sentence, not just in the score
    assert "108" in top


def test_walter_is_critical_in_a_blackout_with_a_countdown_the_ui_can_show() -> None:
    a = assess(WALTER, BLACKOUT)
    assert a.band is RiskBand.CRITICAL, a.reasons
    top = a.headline_reason.lower()
    assert "oxygen concentrator" in top
    assert "no battery backup" in top
    assert "6h" in top
    # time_to_harm is what the escalation ladder keys urgency on when nobody answers.
    assert a.time_to_harm_h == 0.0


def test_the_same_person_ranks_differently_under_two_hazards() -> None:
    """The claim of the whole engine, stated twice over."""
    walter_dark = assess(WALTER, BLACKOUT)
    walter_hot = assess(WALTER, DRY_HEAT_ADVISORY)
    assert walter_dark.score > walter_hot.score
    assert walter_dark.band is RiskBand.CRITICAL
    assert walter_hot.band is RiskBand.ROUTINE

    rosa_hot = assess(ROSA, HUMID_HEAT)
    rosa_dark = assess(ROSA, MILD_OUTAGE)
    assert rosa_hot.score > rosa_dark.score
    assert rosa_hot.band is RiskBand.CRITICAL


def test_call_order_inverts_between_the_two_hazards() -> None:
    roster = [DIEGO, ROSA, WALTER]
    assert call_order(roster, HUMID_HEAT)[0] == "nbr_rosa"
    assert call_order(roster, BLACKOUT)[0] == "nbr_walter"
    # And the control never leads either sweep.
    assert call_order(roster, HUMID_HEAT)[-1] == "nbr_diego"
    assert call_order(roster, BLACKOUT)[-1] == "nbr_diego"


# --------------------------------------------------------------------------------------------
# Time to harm: a subtraction, not a flag
# --------------------------------------------------------------------------------------------
def test_battery_hours_are_weighed_against_outage_hours_not_just_the_flag() -> None:
    thin = _with(WALTER, id="nbr_thin", name="Thin Margin", power_backup_hours=2.0)
    covered = _with(WALTER, id="nbr_covered", name="Covered", power_backup_hours=8.0)
    a_thin, a_covered = assess(thin, BLACKOUT), assess(covered, BLACKOUT)

    assert a_thin.score > a_covered.score
    assert a_thin.band is RiskBand.CRITICAL      # runs out four hours before the lights return
    assert a_covered.band is not RiskBand.CRITICAL
    assert a_thin.time_to_harm_h == 2.0 and a_covered.time_to_harm_h == 8.0
    # Both are still worth calling: power dependency never scores as routine during an outage.
    assert a_covered.band in (RiskBand.ELEVATED, RiskBand.HIGH)
    assert "4h before the power comes back" in a_thin.headline_reason


def test_a_missing_restoration_estimate_is_assumed_and_said_out_loud() -> None:
    no_eta = dict(id="haz_x", kind="power_outage", severity="warning", facts={})
    a = assess(WALTER, no_eta)
    assert any("no restoration estimate" in r for r in a.reasons)
    assert a.band is RiskBand.CRITICAL  # assuming a typical outage must not soften the finding


def test_power_deficit_holds_critical_even_for_the_least_vulnerable_person() -> None:
    """The band floor: a young man with a full house is still critical if his equipment dies first.

    Without the floor this depends on hand-tuned constants, and a future tweak to a cooling table
    could quietly drop somebody's life support out of the top band.
    """
    young = _with(DIEGO, id="nbr_young", power_dependent=True, power_backup_hours=1.0, conditions=[])
    a = assess(young, BLACKOUT)
    assert a.band is RiskBand.CRITICAL
    assert any(r.startswith("held at critical") for r in a.reasons)


# --------------------------------------------------------------------------------------------
# The swamp cooler
# --------------------------------------------------------------------------------------------
def test_evaporative_effectiveness_never_improves_as_the_air_gets_damper() -> None:
    values = [evaporative_effectiveness(rh) for rh in range(0, 101, 5)]
    assert all(b <= a for a, b in zip(values, values[1:])), values
    assert evaporative_effectiveness(10) == 1.0
    assert evaporative_effectiveness(EVAP_DEAD_RH) < 0.1
    assert evaporative_effectiveness(40) < evaporative_effectiveness(25)
    assert evaporative_effectiveness(None) < 1.0  # no reading is not a guarantee of dry air


def test_the_same_heat_is_worse_for_rosa_when_the_air_is_damp() -> None:
    dry = dict(id="h1", kind="heat", severity="warning", facts={"temp_f": 108, "humidity_pct": 12})
    damp = dict(id="h2", kind="heat", severity="warning", facts={"temp_f": 108, "humidity_pct": 45})
    assert assess(ROSA, damp).score > assess(ROSA, dry).score

    # And it is specifically the cooler, not the heat: a neighbour on central air moves far less.
    central = _with(ROSA, id="nbr_c", cooling="central_ac")
    swing_rosa = assess(ROSA, damp).score - assess(ROSA, dry).score
    swing_central = assess(central, damp).score - assess(central, dry).score
    assert swing_rosa > swing_central


def test_hazard_describes_itself_in_words_a_caller_can_say() -> None:
    h = parse_hazard(HUMID_HEAT)
    spoken = h.describe()
    assert "108" in spoken and "42" in spoken
    assert "evaporative cooler" in spoken  # the neighbour is told the thing she needs to know
    assert h.swamp_cooler_compromised is True
    assert parse_hazard(DRY_HEAT_ADVISORY).swamp_cooler_compromised is False


# --------------------------------------------------------------------------------------------
# The matrix: a condition means different things under different hazards
# --------------------------------------------------------------------------------------------
def test_copd_is_priced_differently_by_smoke_and_by_heat() -> None:
    smoke = dict(id="haz_smoke", kind="smoke", severity="warning", facts={"aqi": 212})
    copd_only = _with(DIEGO, id="nbr_copd", conditions=["copd"])
    smoky = assess(copd_only, smoke)
    hot = assess(copd_only, DRY_HEAT_ADVISORY)
    assert smoky.score > hot.score
    assert any("air quality index 212" in r for r in smoky.reasons)


def test_a_boil_water_notice_is_a_treatment_problem_for_a_dialysis_patient() -> None:
    boil = dict(id="haz_water", kind="boil_water", severity="warning", area="Maryvale")
    patient = _with(DIEGO, id="nbr_dia", conditions=["dialysis"])
    a = assess(patient, boil)
    assert a.band in (RiskBand.HIGH, RiskBand.CRITICAL)
    assert any("dialysis" in r for r in a.reasons)


def test_evacuation_hazards_price_mobility_and_a_car() -> None:
    flood = dict(id="haz_flood", kind="flood", severity="warning", area="Maryvale")
    stuck = _with(DIEGO, id="nbr_stuck", mobility="wheelchair", has_transport=False)
    a = assess(stuck, flood)
    assert a.score > assess(DIEGO, flood).score
    assert any("wheelchair" in r for r in a.reasons)
    assert any("no vehicle" in r for r in a.reasons)


def test_living_alone_amplifies_but_never_invents_risk() -> None:
    alone = _with(ROSA, id="nbr_alone", lives_alone=True)
    together = _with(ROSA, id="nbr_together", lives_alone=False)
    assert assess(alone, HUMID_HEAT).score > assess(together, HUMID_HEAT).score
    # An amplifier applied to nothing is nothing: a hazard with no purchase on someone stays routine.
    unaffected = _with(DIEGO, id="nbr_u", lives_alone=True, age_band="75_plus")
    assert assess(unaffected, MILD_OUTAGE).band is RiskBand.ROUTINE


# --------------------------------------------------------------------------------------------
# Robustness: triage must never be the reason nobody got called
# --------------------------------------------------------------------------------------------
def test_an_unrecognised_condition_still_scores_and_is_quoted_back() -> None:
    odd = _with(DIEGO, id="nbr_odd", conditions=["needs a nebuliser twice a day"])
    a = assess(odd, HUMID_HEAT)
    assert a.score > assess(DIEGO, HUMID_HEAT).score  # never silently zero
    assert any("needs a nebuliser twice a day" in r for r in a.reasons)


def test_condition_tokens_are_normalised_the_way_volunteers_type_them() -> None:
    assert normalize_condition("Heat Sensitive") == "heat_sensitive"
    assert normalize_condition("Oxygen-Dependent") == "oxygen"
    assert normalize_condition("CHF") == "cardiac"
    typed = _with(WALTER, id="nbr_typed", conditions=["COPD", "Oxygen Dependent"])
    assert assess(typed, BLACKOUT).score == assess(WALTER, BLACKOUT).score


@pytest.mark.parametrize("spelling", ["swamp_cooler", "evaporative cooler", "Evaporative", "evap", "Swamp Cooler"])
def test_rosas_cooler_is_recognised_however_it_was_typed_on_the_card(spelling: str) -> None:
    """The roster's "enumerated" fields are enumerated by a comment and nothing else.

    If triage only matches the one spelling we happened to pick, the single most important fact
    about Rosa's house silently becomes a generic "unknown" and she drops out of critical — with no
    error anywhere. This is the failure this normalisation exists to prevent.
    """
    rosa = _with(ROSA, id="nbr_rosa_alt", cooling=spelling)
    a = assess(rosa, HUMID_HEAT)
    assert a.band is RiskBand.CRITICAL, (spelling, a.reasons)
    assert "swamp cooler" in a.headline_reason and "42" in a.headline_reason


@pytest.mark.parametrize("spelling", ["75_plus", "75+", "over 75", "85_plus"])
def test_age_bands_survive_the_ways_people_write_them(spelling: str) -> None:
    assert normalize_age_band(spelling) == "75_plus"
    older = _with(DIEGO, id="nbr_old", age_band=spelling, cooling="fan_only", conditions=["heat_sensitive"])
    younger = _with(older, id="nbr_young2", age_band="under_65")
    assert assess(older, HUMID_HEAT).score > assess(younger, HUMID_HEAT).score


def test_unrecognised_enumerated_values_are_quoted_back_not_dropped() -> None:
    assert normalize_cooling("misting system") == "misting_system"
    assert normalize_mobility("uses a walker") == "cane_walker"
    odd = _with(ROSA, id="nbr_odd_mob", cooling="misting system", mobility="scoots on a stool")
    a = assess(odd, HUMID_HEAT)
    reasons = " | ".join(a.reasons)
    assert "misting system" in reasons
    assert "scoots on a stool" in reasons
    # No headless sentences: nothing shown to the captain may start with a dash.
    assert not any(r.strip().startswith("—") or r.strip().startswith("-") for r in a.reasons), a.reasons


def test_consent_fails_closed_when_the_field_is_missing_or_junk() -> None:
    """Every other field defaults generously. Permission to ring a stranger's phone does not."""
    for value in (None, "", 0, "yes"):
        row = _with(ROSA, id="nbr_c", check_in_consent=value)
        assert assess(row, HUMID_HEAT).may_call is False, value
    assert assess(_with(ROSA, id="nbr_c2", check_in_consent=True), HUMID_HEAT).may_call is True


def test_junk_facts_and_unknown_hazards_degrade_instead_of_raising() -> None:
    junk = dict(id="haz_junk", kind="meteor", severity="???",
                facts={"temp_f": "about a hundred", "humidity_pct": None, "outage_eta_h": []})
    a = assess(ROSA, junk)
    assert a.score >= 0 and a.reasons
    assert parse_kind("meteor") is HazardKind.UNKNOWN
    assert parse_severity("???") is Severity.WARNING  # an unreadable severity is not the mildest one
    # A neighbour row missing nearly every field must still produce an assessment.
    sparse = assess({"id": "nbr_sparse"}, HUMID_HEAT)
    assert sparse.name == "(unnamed)" and sparse.reasons


def test_facts_survive_the_shapes_a_form_post_produces() -> None:
    a = assess(WALTER, dict(id="h", kind="blackout", severity="Warning", facts={"outage_eta_h": "6 h"}))
    assert "6h" in a.headline_reason


# --------------------------------------------------------------------------------------------
# Determinism and the sweep contract
# --------------------------------------------------------------------------------------------
def test_assessing_twice_gives_byte_identical_output() -> None:
    assert assess(ROSA, HUMID_HEAT).to_dict() == assess(ROSA, HUMID_HEAT).to_dict()


def test_call_order_is_stable_under_a_shuffled_roster() -> None:
    roster = [ROSA, WALTER, DIEGO,
              _with(DIEGO, id="nbr_tie1", name="Ana Tie"), _with(DIEGO, id="nbr_tie2", name="Bo Tie")]
    expected = call_order(roster, HUMID_HEAT)
    rng = random.Random(7)
    for _ in range(10):
        shuffled = roster[:]
        rng.shuffle(shuffled)
        assert call_order(shuffled, HUMID_HEAT) == expected


def test_the_score_is_the_sum_of_its_reasons() -> None:
    """No hidden term. Every point on screen has a sentence next to it, or the number is a lie."""
    for neighbour in (ROSA, WALTER, DIEGO):
        for hazard in (HUMID_HEAT, BLACKOUT, MILD_OUTAGE, DRY_HEAT_ADVISORY):
            a = assess(neighbour, hazard)
            assert a.score == int(round(sum(f.points for f in a.factors))), (a.name, a.to_dict())


def test_the_ceiling_is_a_visible_factor_not_a_silent_clamp() -> None:
    """Someone can be loaded enough to blow past 100. The breakdown still has to add up."""
    worst = _with(
        ROSA, id="nbr_worst", power_dependent=True, power_backup_hours=0.0, cooling="none",
        mobility="bedbound", has_transport=False,
        conditions=["copd", "oxygen", "dialysis", "cardiac", "dementia", "heat_sensitive", "diabetes"],
    )
    a = assess(worst, dict(id="h", kind="heat", severity="emergency", facts={"temp_f": 118, "humidity_pct": 55}))
    assert a.score == 100
    assert a.score == int(round(sum(f.points for f in a.factors)))
    assert any("capped at 100" in r for r in a.reasons)


def test_no_consent_means_no_call_but_still_a_visible_assessment() -> None:
    private = _with(ROSA, id="nbr_private", name="Private Person", check_in_consent=False)
    roster = [private, WALTER]
    assert "nbr_private" not in call_order(roster, HUMID_HEAT)
    seen = triage_dict(roster, HUMID_HEAT)
    assert seen["nbr_private"]["may_call"] is False
    assert seen["nbr_private"]["band"] == RiskBand.CRITICAL.value  # not called is not the same as not at risk
    assert seen["nbr_private"]["skip_reason"]


def test_triage_sorts_worst_first_and_keeps_everyone() -> None:
    roster = [DIEGO, WALTER, ROSA]
    ranked = triage(roster, BLACKOUT)
    assert [a.neighbour_id for a in ranked] == ["nbr_walter", "nbr_rosa", "nbr_diego"]
    assert [a.score for a in ranked] == sorted((a.score for a in ranked), reverse=True)
    assert len(ranked) == len(roster)  # a sweep does not stop at the first success


def test_it_works_on_a_real_neighbour_row_as_well_as_a_dict() -> None:
    """The orchestrator holds SQLModel rows, the API holds dicts, tests hold neither."""
    from app.models import Neighbour

    row = Neighbour(**{k: v for k, v in WALTER.items() if k != "id"}, id="nbr_walter")
    assert assess(row, BLACKOUT).to_dict() == assess(WALTER, BLACKOUT).to_dict()


def test_the_snapshot_a_sweep_stores_carries_the_why() -> None:
    snap = assess(ROSA, HUMID_HEAT).to_dict()
    assert snap["hazard_kind"] == "heat" and snap["severity"] == "warning"
    assert snap["engine"].startswith("rules/")
    assert snap["reasons"] and snap["reasons"][0] == snap["factors"][0]["reason"]
    assert snap["factors"][0]["points"] >= snap["factors"][-1]["points"]


@pytest.mark.parametrize("kind", [k for k in HazardKind])
def test_every_hazard_kind_scores_the_whole_roster_without_raising(kind: HazardKind) -> None:
    hazard = dict(id="h", kind=kind.value, severity="warning", area="Maryvale",
                  facts={"temp_f": 99, "humidity_pct": 38, "outage_eta_h": 5, "aqi": 160})
    ranked = triage([ROSA, WALTER, DIEGO], hazard)
    assert len(ranked) == 3
    assert all(a.reasons for a in ranked)
    assert all(0 <= a.score <= 100 for a in ranked)
