"""The demo world, pinned.

Two kinds of test live here and they are worth separating in your head:

* **Safety.** Every committed phone number is unroutable, the neighbour who opted out is never
  dialled and has no scene written for her, and the man with no emergency contact still has none.
  These protect people. They must never be relaxed to make a demo work.
* **The demo's argument.** The heat warning puts Rosa first and the outage puts Walter first, over
  the same fourteen rows, with nothing anywhere that says so. That reordering is the single clearest
  statement this product makes, and it is derived — from `app.domain.risk` scoring fields on these
  seed rows — which means a tuning change three modules away could quietly cost it. So it is pinned
  here, in the file that owns the data, and not left to be noticed in a rehearsal.

The end-to-end test at the bottom is the one that catches the expensive mistakes: it compiles the
real CALL-E contract for every neighbour under both hazards, feeds each fixture through the same
projection a real extraction faces, and runs `decide()` on the result. It checks four things at
once — the fixtures validate against the compiled schema, they exercise every outcome, they never
name a help option that was not on the hazard, and nobody is accidentally SAFE.
"""
from __future__ import annotations

import re
from typing import Any

import pytest

from app.calls.contract import HazardView, NeighbourView, compile_contract
from app.calls.mock import (
    CONTACT_FIXTURES,
    DEFAULT_FIXTURE,
    FIXTURES,
    ConsentViolation,
    MockCallProvider,
    _merge_fixture,
    _project,
    make_result,
)
from app.calls.provider import CallRequest
from app.domain.risk import RiskBand, assess, call_order, triage
from app.domain.state import CheckOutcome, HazardStatus
from app.models import Hazard, Neighbour
from app.orchestrator.decide import decide
from app.seed import (
    CAPTAIN,
    DEMO_NAMES,
    FICTIONAL_PREFIX,
    HEAT_HELP,
    NEIGHBOURS,
    OUTAGE_HELP,
    declare_outage,
    heat_hazard_spec,
    outage_hazard_spec,
    seed,
)

PHONE_RE = re.compile(rf"^{re.escape(FICTIONAL_PREFIX)}\d{{2}}$")


@pytest.fixture()
def demo_db(tmp_path, monkeypatch):  # noqa: ANN001, ANN201
    """A database with BuddyE's tables in it.

    Deliberately not conftest's `db` fixture: `app.db.init_db` still creates ShiftFill's
    "one active run per position" index over a `workflowrun` table that no longer exists, so it
    raises before any BuddyE row can be written. This builds the schema straight from the models
    instead. Switch back to `db` once `db.py` is ported — the BuddyE equivalent of that index is one
    active sweep per hazard.
    """
    from sqlmodel import SQLModel

    from app import config, models  # noqa: F401  (models registers the tables)
    from app import db as dbmod

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/seed.db")
    config.get_settings.cache_clear()
    dbmod.reset_engine()
    SQLModel.metadata.create_all(dbmod.get_engine())
    yield
    dbmod.reset_engine()
    config.get_settings.cache_clear()


class Row:
    """Duck-typed stand-in for a SQLModel row, so the pure-domain tests need no database."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.__dict__.update(data)


def _neighbour(name: str) -> dict[str, Any]:
    return next(n for n in NEIGHBOURS if n["name"] == name)


def _consents(n: dict[str, Any]) -> bool:
    return n.get("check_in_consent", True)


def _fixture(name: str, hazard_kind: str) -> dict[str, Any]:
    fx = dict(FIXTURES.get(name, DEFAULT_FIXTURE))
    overlay = (fx.get("by_hazard") or {}).get(hazard_kind)
    if overlay:
        fx = _merge_fixture(fx, overlay)
    fx.pop("by_hazard", None)
    return fx


def _run_call(name: str, hazard_spec: dict[str, Any]) -> tuple[Any, list[str], dict[str, Any]]:
    """Compile the real contract, project the fixture through it, and decide. Returns
    (DecisionResult, validation errors, the projected result)."""
    nbr = _neighbour(name)
    hazard = HazardView.from_row(Row(hazard_spec), captain_name=CAPTAIN)
    contract = compile_contract(hazard, NeighbourView.from_row(Row(nbr)))
    fx = _fixture(name, hazard_spec["kind"])
    result = _project(fx["result"], contract.result_schema) if fx.get("result") else None
    errors = contract.validate_result(result) if result is not None else []
    decision = decide(
        status=fx["status"],
        result=result,
        risk=assess(nbr, hazard_spec).to_dict(),
        hard_fields=contract.hard_fields,
        validation_errors=errors,
        completion_confidence=fx.get("completion_confidence"),
    )
    return decision, errors, result or {}


# ------------------------------------------------------------------------------------------------
# Safety
# ------------------------------------------------------------------------------------------------
def test_every_seeded_number_is_unroutable(demo_db, monkeypatch) -> None:  # noqa: ANN001
    """With no DEMO_PHONE_* set, every number on every row — neighbours and emergency contacts
    alike — must be a fictional +1 555-01xx one.

    The environment is cleared explicitly rather than assumed. A developer's local .env legitimately
    carries a real DEMO_PHONE_B so a live demo can ring one actual handset, and this test used to
    fail the moment one existed — which reads as "the safety property broke" when the property is
    fine. Clearing it here keeps this test about the seed's own behaviour, and leaves the
    deliberate-injection case to the test below.
    """
    from app import config
    from app.db import session_scope
    from sqlmodel import select

    for slot in ("DEMO_PHONE_A", "DEMO_PHONE_B", "DEMO_PHONE_C"):
        monkeypatch.setenv(slot, "")
    config.get_settings.cache_clear()
    try:
        settings = config.get_settings()
        with session_scope() as s:
            seed(s, settings)
            rows = list(s.exec(select(Neighbour)).all())
            assert len(rows) == len(NEIGHBOURS) == 14
            for row in rows:
                assert PHONE_RE.match(row.phone), f"{row.name} has a non-fictional phone"
                assert row.is_demo is False
                if row.contact_name:
                    assert PHONE_RE.match(row.contact_phone), f"{row.name}'s contact has a non-fictional phone"
    finally:
        config.get_settings.cache_clear()


def test_demo_phone_env_injects_a_real_number_and_flags_the_row(demo_db, monkeypatch) -> None:  # noqa: ANN001
    """Mirrors ShiftFill exactly: a real number arrives only from DEMO_PHONE_*, only onto the named
    row, and the row is flagged so every downstream gate can see it."""
    from app import config
    from app.db import session_scope
    from sqlmodel import select

    monkeypatch.setenv("DEMO_PHONE_A", "+15555550123")
    for slot in ("DEMO_PHONE_B", "DEMO_PHONE_C"):
        monkeypatch.setenv(slot, "")  # a local .env may fill these; this test is about slot A only
    config.get_settings.cache_clear()
    settings = config.get_settings()
    try:
        with session_scope() as s:
            seed(s, settings)
            rows = {r.name: r for r in s.exec(select(Neighbour)).all()}
            assert rows["Rosa Delgado"].phone == "+15555550123"
            assert rows["Rosa Delgado"].is_demo is True
            # Everyone else, and every emergency contact including Rosa's own daughter, stays
            # fictional: the ladder can place a second call by itself and must not be able to spend
            # the free tier on a number nobody agreed to be rung on.
            assert rows["Rosa Delgado"].contact_phone.startswith(FICTIONAL_PREFIX)
            for name, row in rows.items():
                if name != "Rosa Delgado":
                    assert PHONE_RE.match(row.phone), name
                    assert row.is_demo is False
    finally:
        config.get_settings.cache_clear()


def test_demo_names_point_at_real_roster_rows_that_have_scenes() -> None:
    names = {n["name"] for n in NEIGHBOURS}
    for name in DEMO_NAMES:
        assert name in names
        assert _consents(_neighbour(name)), "a live call must never go to an opt-out"
        assert name in FIXTURES


def test_the_opted_out_neighbour_is_never_dialled(demo_db) -> None:  # noqa: ANN001
    """Consent is enforced in `risk.call_order`, which drops him before a sweep can index onto him.
    He still appears in triage, because the captain wants to see her whole block — `may_call` says
    whether BuddyE dials, and it is never a statement about how much danger he is in."""
    from app.config import get_settings
    from app.db import session_scope
    from sqlmodel import select

    assert _neighbour("Gerald Pryce")["check_in_consent"] is False
    with session_scope() as s:
        seed(s, get_settings())
        rows = list(s.exec(select(Neighbour)).all())
        gerald = next(r for r in rows if r.name == "Gerald Pryce")
        for spec in (heat_hazard_spec(), outage_hazard_spec()):
            assessments = {a.name: a for a in triage(rows, spec)}
            assert assessments["Gerald Pryce"].may_call is False
            assert assessments["Gerald Pryce"].skip_reason
            assert assessments["Gerald Pryce"].score > 0, "not dialling him is not the same as being safe"
            order = call_order(rows, spec)
            assert gerald.id not in order
            assert len(order) == 13


def test_no_scene_is_written_for_anyone_who_opted_out() -> None:
    """A fixture for Gerald would be a conversation that must never happen. The only entry he has is
    the tripwire, and it carries no transcript and no result.

    Written as a loop over the roster rather than as a fact about one hand-written entry, so that
    adding a second opt-out later cannot quietly ship a scene for them."""
    opted_out = [n["name"] for n in NEIGHBOURS if not _consents(n)]
    assert opted_out == ["Gerald Pryce"]
    for name in opted_out:
        fx = FIXTURES.get(name)
        if fx is None:  # no entry at all is also a correct answer
            continue
        assert fx.get("never_dial") is True, f"{name} did not consent but has a dialable fixture"
        assert fx["result"] is None
        assert fx["transcript"] == []
    # And nothing in FIXTURES may be a dialable scene for a non-consenting roster row.
    for name, fx in FIXTURES.items():
        row = next((n for n in NEIGHBOURS if n["name"] == name), None)
        if row is not None and not _consents(row):
            assert fx.get("never_dial") is True, name


@pytest.mark.asyncio
async def test_mock_refuses_to_dial_the_opted_out_neighbour() -> None:
    provider = MockCallProvider(delay_s=0)
    req = CallRequest(
        phone="+155501008", task="check in", result_schema={"type": "object", "properties": {}},
        idempotency_key="k1", employee_id="nbr_gerald", metadata={"neighbour_name": "Gerald Pryce"},
    )

    async def sink(_event: Any) -> None:  # pragma: no cover - never reached
        raise AssertionError("no event may be emitted for a refused call")

    with pytest.raises(ConsentViolation):
        await provider.place(req, sink)


@pytest.mark.asyncio
async def test_mock_refuses_a_call_whose_metadata_says_no_consent() -> None:
    """The name-based tripwire only fires for people we wrote a row for. A runner that carries the
    consent flag in metadata gets caught whoever the neighbour is."""
    provider = MockCallProvider(delay_s=0)
    req = CallRequest(
        phone="+155501099", task="check in", result_schema={"type": "object", "properties": {}},
        idempotency_key="k2", employee_id="nbr_x",
        metadata={"neighbour_name": "Someone Not On The List", "check_in_consent": False},
    )
    with pytest.raises(ConsentViolation):
        await provider.place(req, lambda _e: _noop())


async def _noop() -> None:
    return None


def test_walter_has_no_emergency_contact() -> None:
    """The ladder has to be able to skip a rung honestly, and it can only do that if somebody on the
    roster genuinely has nobody nominated. That is Walter, and it must stay that way."""
    walter = _neighbour("Walter Brzezinski")
    assert walter["contact_name"] == ""
    assert walter["contact_phone"] == ""
    assert walter["contact_relation"] == ""


def test_every_other_at_risk_neighbour_does_have_someone() -> None:
    """The counterpart: Walter's empty contact must read as a fact about Walter, not as a seed that
    forgot to fill the column in."""
    missing = [n["name"] for n in NEIGHBOURS if not n["contact_name"]]
    assert missing == ["Walter Brzezinski"]


# ------------------------------------------------------------------------------------------------
# The roster itself
# ------------------------------------------------------------------------------------------------
def test_the_roster_has_genuine_variety() -> None:
    names = [n["name"] for n in NEIGHBOURS]
    assert len(names) == len(set(names)) == 14
    assert "Rosa Delgado" in names and "Walter Brzezinski" in names
    assert sum(1 for n in NEIGHBOURS if n["lives_alone"]) >= 8
    assert sum(1 for n in NEIGHBOURS if n["power_dependent"]) == 2, "one who runs out, one who does not"
    assert len({n["age_band"] for n in NEIGHBOURS}) >= 3
    assert len({n["cooling"] for n in NEIGHBOURS}) >= 4
    assert any(n["preferred_language"] != "en-US" for n in NEIGHBOURS if "preferred_language" in n)
    assert all(n["lat"] and n["lon"] for n in NEIGHBOURS), "every row needs a place on the map"
    # Maryvale, and nowhere else.
    assert all(33.44 < n["lat"] < 33.53 and -112.23 < n["lon"] < -112.13 for n in NEIGHBOURS)


def test_rosa_and_walter_carry_the_facts_the_product_is_about() -> None:
    rosa = _neighbour("Rosa Delgado")
    assert rosa["age_band"] == "75_plus" and rosa["lives_alone"]
    assert rosa["cooling"] == "swamp_cooler"
    assert rosa["has_transport"] is False
    assert rosa["contact_name"] == "Elena Delgado" and rosa["contact_relation"] == "daughter"

    walter = _neighbour("Walter Brzezinski")
    assert walter["power_dependent"] is True
    assert walter["power_backup_hours"] == 4.0
    assert walter["mobility"] == "wheelchair" and walter["lives_alone"]
    assert "oxygen" in [c.lower() for c in walter["conditions"]]


def test_two_power_dependent_neighbours_who_are_nothing_alike() -> None:
    """Same flag, opposite conclusions. This pair is why triage subtracts rather than filters."""
    outage = outage_hazard_spec()
    walter = assess(_neighbour("Walter Brzezinski"), outage)
    yolanda = assess(_neighbour("Yolanda Cruz"), outage)
    assert walter.band is RiskBand.CRITICAL
    assert yolanda.band in (RiskBand.HIGH, RiskBand.ELEVATED)
    assert walter.time_to_harm_h == 4.0 and yolanda.time_to_harm_h == 10.0
    assert walter.score > yolanda.score


# ------------------------------------------------------------------------------------------------
# The hazards, and the reordering that is the whole point
# ------------------------------------------------------------------------------------------------
def test_heat_hazard_carries_the_humidity_that_decides_rosa() -> None:
    spec = heat_hazard_spec()
    assert spec["kind"] == "heat" and spec["severity"] == "warning"
    assert spec["facts"]["temp_f"] == 114
    # Above 35% an evaporative cooler has stopped being a cooling system, which is the fact that
    # moves Rosa above four people whose files look worse than hers.
    assert spec["facts"]["humidity_pct"] > 35
    assert spec["declared_by"] == CAPTAIN
    assert "Maryvale" in spec["area"]


def test_outage_hazard_carries_an_eta_to_subtract_walters_battery_from() -> None:
    spec = outage_hazard_spec()
    assert spec["kind"] == "power_outage"
    eta = spec["facts"]["outage_eta_h"]
    assert eta > _neighbour("Walter Brzezinski")["power_backup_hours"], (
        "the outage must outlast his battery or there is no countdown to show"
    )
    assert spec["facts"]["temp_f"] >= 95, "an outage is only a heat emergency when the weather makes it one"


def test_the_same_roster_reorders_between_the_two_hazards() -> None:
    """The demo's thesis, pinned. Nothing in the seed says who is first; both orders are derived."""
    heat = [a.name for a in triage(NEIGHBOURS, heat_hazard_spec()) if a.may_call]
    outage = [a.name for a in triage(NEIGHBOURS, outage_hazard_spec()) if a.may_call]

    assert heat[0] == "Rosa Delgado"
    assert outage[0] == "Walter Brzezinski"
    # Not a swap of two rows — the whole list moves.
    assert heat != outage
    assert outage.index("Rosa Delgado") >= 2, "Rosa must visibly fall when the hazard is not heat"
    assert heat.index("Walter Brzezinski") >= 2, "Walter must visibly rise when the power goes"
    assert outage.index("Yolanda Cruz") < heat.index("Yolanda Cruz"), "the CPAP user rises with the power out"
    assert outage.index("Trinidad Bustos") > heat.index("Trinidad Bustos"), "heat-only risk falls away"


def test_walters_place_at_the_top_of_the_outage_is_the_subtraction_and_says_so() -> None:
    a = assess(_neighbour("Walter Brzezinski"), outage_hazard_spec())
    assert a.band is RiskBand.CRITICAL
    assert a.time_to_harm_h == 4.0
    reasons = " ".join(a.reasons).lower()
    assert "battery" in reasons and "oxygen concentrator" in reasons
    assert "before the power comes back" in reasons


def test_rosas_place_at_the_top_of_the_heat_is_the_humidity_and_says_so() -> None:
    a = assess(_neighbour("Rosa Delgado"), heat_hazard_spec())
    assert a.band is RiskBand.CRITICAL
    reasons = " ".join(a.reasons).lower()
    assert "swamp cooler" in reasons and "humidity" in reasons


def test_an_unrecognised_condition_still_scores_and_is_quoted_back() -> None:
    """Rosa's card says "high blood pressure", which the engine has no rule for. Scoring an
    unrecognised health condition as zero is the one failure this product cannot have."""
    a = assess(_neighbour("Rosa Delgado"), heat_hazard_spec())
    unrecognised = [f for f in a.factors if f.key.startswith("condition:unrecognised")]
    assert unrecognised and unrecognised[0].points > 0
    assert "high blood pressure" in unrecognised[0].reason


# ------------------------------------------------------------------------------------------------
# Help offers
# ------------------------------------------------------------------------------------------------
def test_help_offers_are_concrete_finite_and_speakable() -> None:
    for offers in (HEAT_HELP, OUTAGE_HELP):
        assert 3 <= len(offers) <= 5
        keys = [o["key"] for o in offers]
        assert len(keys) == len(set(keys))
        for offer in offers:
            assert offer["label"] and offer["text"].strip().endswith((".", "?"))
            assert len(offer["text"]) > 40, "the text is spoken verbatim; a label is not a sentence"
    heat_keys = {o["key"] for o in HEAT_HELP}
    assert {"cooling_center", "ride", "water_ice_drop", "wellness_visit"} <= heat_keys
    # A place and an hour may only come from this text, so they have to be in it.
    cooling = next(o for o in HEAT_HELP if o["key"] == "cooling_center")
    assert "51st Avenue" in cooling["text"] and "eight at night" in cooling["text"]


def test_no_offer_promises_something_only_an_agency_could_do() -> None:
    forbidden = ("ambulance", "paramedic", "911", "fire depart", "police")
    for offers in (HEAT_HELP, OUTAGE_HELP):
        for offer in offers:
            assert not any(word in offer["text"].lower() for word in forbidden), offer["key"]


def test_every_fixture_only_names_help_that_was_actually_on_offer() -> None:
    """A `cooling_center` / `cooling_centre` slip would silently break offer resolution, and both
    sides of it live in these two files."""
    by_kind = {"heat": {o["key"] for o in HEAT_HELP}, "power_outage": {o["key"] for o in OUTAGE_HELP}}
    for kind, keys in by_kind.items():
        for name in FIXTURES:
            fx = _fixture(name, kind)
            result = fx.get("result") or {}
            for field in ("help_accepted", "help_declined"):
                for key in result.get(field, []):
                    assert key in keys, f"{name} ({kind}) {field}: {key!r} is not an offer on that hazard"


# ------------------------------------------------------------------------------------------------
# The fixtures
# ------------------------------------------------------------------------------------------------
def test_every_consenting_neighbour_has_a_scene() -> None:
    for n in NEIGHBOURS:
        if not _consents(n):
            continue
        assert n["name"] in FIXTURES, f"{n['name']} would fall through to the generic fixture"


def test_transcripts_sound_like_people_on_a_phone() -> None:
    for name, fx in FIXTURES.items():
        if fx["status"] == "NO_ANSWER" or fx.get("never_dial"):
            continue
        turns = fx["transcript"]
        assert len(turns) >= 6, f"{name}'s call is too short to be a conversation"
        assert turns[0][0] == "bot" and any(s == "user" for s, _ in turns)
        # Nobody answers a question in a full sentence with no hesitation. If a whole call reads
        # like a form being filled in, it will look like one on camera.
        said = " ".join(t for s, t in turns if s == "user").lower()
        assert any(word in said for word in ("yeah", "well", "oh", "sorry", "hang on", "sí", "pues", "no,")), name


def test_the_high_risk_neighbour_who_never_answers() -> None:
    """The outcome this whole product exists to surface. Hazel is bedbound, has insulin in a
    refrigerator, sits at the critical band under both hazards, and does not pick up."""
    fx = FIXTURES["Hazel Nakamura"]
    assert fx["status"] == "NO_ANSWER"
    assert fx["result"] is None
    assert fx["duration_s"] > 0, "a phone that rang out still took time; the timeline shows it"
    for spec in (heat_hazard_spec(), outage_hazard_spec()):
        assert assess(_neighbour("Hazel Nakamura"), spec).band is RiskBand.CRITICAL
        decision, _errors, _result = _run_call("Hazel Nakamura", spec)
        assert decision.outcome is CheckOutcome.UNREACHABLE
        assert decision.escalates
        # Above every answered call in the sweep, including the urgent ones.
        assert decision.priority == 100


def test_rosa_under_reports_and_the_result_reads_what_she_meant() -> None:
    fx = FIXTURES["Rosa Delgado"]
    said = " ".join(t for s, t in fx["transcript"] if s == "user").lower()
    assert said.count("fine") >= 3, "the whole scene is that she keeps saying she is fine"
    assert "cooler quit" in said and "chair" in said
    result = fx["result"]
    assert result["is_safe_now"] == "no", "judge by meaning, not by the word 'fine'"
    assert result["checks"]["too_hot"] == "yes"
    assert any(result["alarming_quote"] in t for _s, t in fx["transcript"]), "the quote must be verbatim"
    assert any("cooler" in c for c in result["concerns"])


def test_walter_states_the_number_that_matters() -> None:
    for kind in ("heat", "power_outage"):
        fx = _fixture("Walter Brzezinski", kind)
        assert "hour" in fx["result"]["equipment_hours_remaining"]
        assert fx["result"]["checks"]["equipment_working"] == "yes"
    outage = _fixture("Walter Brzezinski", "power_outage")
    assert "battery" in " ".join(outage["result"]["concerns"]).lower()


def test_the_adult_child_and_the_wrong_number_are_both_honest_about_who_answered() -> None:
    benny = FIXTURES["Benny Okonkwo"]["result"]
    assert benny["reached_intended_person"] == "no"
    assert benny["checks"]["someone_with_them"] == "yes"
    assert benny["concerns"], "what she told us is kept even though he was not reached"

    faye = FIXTURES["Faye Lindqvist"]["result"]
    assert faye["reached_intended_person"] == "no"
    assert faye["is_safe_now"] == "unknown" and faye["needs_help_now"] == "unknown"
    assert faye["help_offers_stated"] == "no", "you do not offer a stranger a ride to a cooling center"


def test_contact_fixtures_never_reach_an_agency() -> None:
    """Rung one of the ladder is a person the neighbour nominated. Nothing here may be a service."""
    assert set(CONTACT_FIXTURES) <= {n["contact_name"] for n in NEIGHBOURS}
    for name, fx in CONTACT_FIXTURES.items():
        text = " ".join(t for _s, t in fx["transcript"]).lower() + " " + (fx.get("summary") or "").lower()
        assert "911" not in text and "ambulance" not in text and "dispatch" not in text, name
    assert CONTACT_FIXTURES["Rafael Salgado"]["status"] == "NO_ANSWER", (
        "the ladder has to be seen climbing past a rung, so one contact must not answer"
    )


# ------------------------------------------------------------------------------------------------
# End to end: the contract, the projection, and the decision, for everybody, twice
# ------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("hazard_spec", [heat_hazard_spec(), outage_hazard_spec()], ids=["heat", "outage"])
def test_every_fixture_validates_against_the_compiled_contract(hazard_spec: dict[str, Any]) -> None:
    for n in NEIGHBOURS:
        if not _consents(n):
            continue
        decision, errors, _result = _run_call(n["name"], hazard_spec)
        assert errors == [], f"{n['name']}: {errors}"
        assert decision.outcome in set(CheckOutcome)


def test_the_heat_sweep_produces_a_board_worth_looking_at() -> None:
    """Every outcome the product has, in one sweep, with the right people carrying each one."""
    outcomes = {
        n["name"]: _run_call(n["name"], heat_hazard_spec())[0].outcome
        for n in NEIGHBOURS
        if _consents(n)
    }
    # A superset check, not equality: `CheckOutcome` belongs to another module, and a sixth outcome
    # added there should not fail as though this seed had lost a scenario.
    assert {
        CheckOutcome.SAFE, CheckOutcome.URGENT, CheckOutcome.NEEDS_HELP,
        CheckOutcome.HELP_DECLINED, CheckOutcome.UNREACHABLE,
    } <= set(outcomes.values()), "all five outcomes must appear in the demo"
    assert outcomes["Hazel Nakamura"] is CheckOutcome.UNREACHABLE
    assert outcomes["Rosa Delgado"] is CheckOutcome.URGENT
    assert outcomes["Ernesto Salgado"] is CheckOutcome.URGENT
    assert outcomes["Dorothy Whitfield"] is CheckOutcome.HELP_DECLINED
    assert outcomes["Benny Okonkwo"] is CheckOutcome.UNREACHABLE, "his daughter answered, not him"
    assert outcomes["Faye Lindqvist"] is CheckOutcome.UNREACHABLE, "wrong number"
    # Some people really are fine, and a board where nobody is fine tells a captain nothing.
    assert sum(1 for o in outcomes.values() if o is CheckOutcome.SAFE) >= 3


def test_nobody_is_safe_with_the_power_off() -> None:
    """The outage takes the whole block's power, so `has_power: no` is a need for everyone who
    answered. A SAFE row in that sweep would mean a fixture claiming the lights were on."""
    for n in NEIGHBOURS:
        if not _consents(n):
            continue
        decision, _errors, result = _run_call(n["name"], outage_hazard_spec())
        if decision.outcome is CheckOutcome.SAFE:  # pragma: no cover - the assertion below is the test
            pytest.fail(f"{n['name']} came out SAFE during a blackout: {result}")


def test_declining_help_is_recorded_as_a_refusal_and_not_as_a_need_met() -> None:
    decision, _errors, result = _run_call("Dorothy Whitfield", heat_hazard_spec())
    assert decision.outcome is CheckOutcome.HELP_DECLINED
    assert decision.help_accepted == []
    assert set(decision.help_declined) == {o["key"] for o in HEAT_HELP}
    assert decision.escalates, "a refusal is still not a closed case"
    assert result["checks"]["has_food"] == "no"


# ------------------------------------------------------------------------------------------------
# Wiring
# ------------------------------------------------------------------------------------------------
def test_seed_returns_the_heat_hazard_open_and_ready_to_sweep(demo_db) -> None:  # noqa: ANN001
    from app.config import get_settings
    from app.db import session_scope
    from sqlmodel import select

    with session_scope() as s:
        hazard = seed(s, get_settings())
        assert isinstance(hazard, Hazard)
        assert hazard.kind == "heat"
        assert hazard.status is HazardStatus.OPEN
        assert hazard.help_offered and hazard.declared_by == CAPTAIN
        assert len(list(s.exec(select(Hazard)).all())) == 1, "the outage is declared live, not seeded"


def test_declare_outage_is_idempotent(demo_db) -> None:  # noqa: ANN001
    from app.config import get_settings
    from app.db import session_scope
    from sqlmodel import select

    with session_scope() as s:
        seed(s, get_settings())
        first = declare_outage(s)
        second = declare_outage(s)
        assert first.id == second.id, "a demo button pressed twice must not stack two outages"
        assert first.kind == "power_outage"
        assert {o["key"] for o in first.help_offered} == {o["key"] for o in OUTAGE_HELP}
        hazards = list(s.exec(select(Hazard)).all())
        assert {h.kind for h in hazards} == {"heat", "power_outage"}


def test_seed_is_repeatable_and_does_not_multiply_the_roster(demo_db) -> None:  # noqa: ANN001
    from app.config import get_settings
    from app.db import session_scope
    from sqlmodel import select

    from app.models import Asset

    with session_scope() as s:
        seed(s, get_settings())
        seed(s, get_settings())
        assert len(list(s.exec(select(Neighbour)).all())) == 14
        assert len(list(s.exec(select(Hazard)).all())) == 1
        assert len(list(s.exec(select(Asset)).all())) == 12  # 8 community + 4 agency


def test_agency_assets_are_requestable_but_never_spendable(demo_db) -> None:  # noqa: ANN001
    """An earlier version of this test asserted the seed contained NO agency units, reasoning that
    an EMS unit parked as "available" would suggest BuddyE has an ambulance to spend.

    The reasoning is right; the remedy was wrong. With no EMS row seeded there is nothing for an
    agent to request and nothing for the overseer to approve — the approvals queue, the entire point
    of the human gate, is permanently empty, and the boundary looks enforced only because the
    feature is missing. So the units exist, staged at their real stations, and the property is
    asserted where it actually lives: committing one is impossible without a named human.
    """
    from app.config import get_settings
    from app.db import session_scope
    from app.domain.state import AssetKind, requires_authorisation
    from sqlmodel import select

    from app.models import Asset

    with session_scope() as s:
        seed(s, get_settings())
        assets = list(s.exec(select(Asset)).all())

        # every asset is somewhere real, whoever owns it
        for asset in assets:
            assert asset.lat and asset.lon, asset.call_sign

        community = [a for a in assets if not requires_authorisation(a.kind)]
        agency = [a for a in assets if requires_authorisation(a.kind)]

        assert community, "no community resources: nothing could ever be auto-dispatched"
        assert agency, "no agency resources: the overseer would have nothing to approve"

        # and the kinds are exactly the ones the policy names, so adding a kind cannot quietly
        # make it auto-dispatchable
        assert {AssetKind(a.kind) for a in agency} <= {
            AssetKind.EMS_UNIT, AssetKind.FIRE_UNIT, AssetKind.POLICE_WELFARE
        }
        for a in community:
            assert AssetKind(a.kind) not in {AssetKind.EMS_UNIT, AssetKind.FIRE_UNIT, AssetKind.POLICE_WELFARE}


@pytest.mark.asyncio
async def test_mock_replays_the_right_scene_for_the_right_hazard() -> None:
    """The integration this is most likely to lose: the metadata key the runner sends. If the name
    never arrives, every call quietly becomes DEFAULT_FIXTURE and the demo is one conversation
    fourteen times over."""
    provider = MockCallProvider(delay_s=0)
    events: list[Any] = []

    async def sink(event: Any) -> None:
        events.append(event)

    hazard = HazardView.from_row(Row(outage_hazard_spec()), captain_name=CAPTAIN)
    contract = compile_contract(hazard, NeighbourView.from_row(Row(_neighbour("Walter Brzezinski"))))
    req = CallRequest(
        phone="+155501001", task=contract.task, result_schema=contract.result_schema,
        idempotency_key="swp1:nbr1:1", employee_id="nbr1",
        metadata={"neighbour_name": "Walter Brzezinski", "hazard_kind": "power_outage", "callee": "neighbour"},
    )
    outcome = await provider.place(req, sink)
    assert outcome.status == "COMPLETED"
    assert outcome.structured_result is not None
    assert contract.validate_result(outcome.structured_result) == []
    assert "battery" in (outcome.summary or "").lower()
    assert any(e.type == "call.transcript_turn" for e in events)
    assert any("half four" in (e.message or "") for e in events), "the outage scene, not the heat one"


@pytest.mark.asyncio
async def test_mock_emits_a_no_answer_outcome_rather_than_an_error() -> None:
    provider = MockCallProvider(delay_s=0)
    events: list[Any] = []

    async def sink(event: Any) -> None:
        events.append(event)

    req = CallRequest(
        phone="+155501002", task="check in", result_schema={"type": "object", "properties": {}, "required": []},
        idempotency_key="swp1:nbr2:1", employee_id="nbr2",
        metadata={"neighbour_name": "Hazel Nakamura", "hazard_kind": "heat"},
    )
    outcome = await provider.place(req, sink)
    assert outcome.status == "NO_ANSWER"
    assert outcome.structured_result is None
    assert outcome.failure_code == "no_answer"
    assert outcome.duration_s and outcome.summary
    assert [e.type for e in events][-1] == "call.no_answer"


@pytest.mark.asyncio
async def test_mock_serves_the_emergency_contact_a_contact_scene() -> None:
    """Rung one calls a different person entirely. Without the callee split it would replay the
    neighbour's own fixture and Dennis would answer as his mother."""
    provider = MockCallProvider(delay_s=0)
    req = CallRequest(
        phone="+155501052", task="tell them", result_schema={"type": "object", "properties": {}, "required": []},
        idempotency_key="esc1:nbr3:1", employee_id="nbr3",
        metadata={"neighbour_name": "Hazel Nakamura", "callee": "emergency_contact", "contact_name": "Dennis Nakamura"},
    )
    outcome = await provider.place(req, lambda _e: _noop())
    assert "son" in (outcome.summary or "").lower()
    assert "key" in " ".join(t["text"] for t in outcome.transcript).lower()


def test_make_result_is_a_complete_answer_not_a_pile_of_unknowns() -> None:
    """If the base were unknowns, no fixture could ever come out SAFE — `decide()` treats a
    hazard-required unknown as a fact the call failed to establish."""
    result = make_result()
    for key in ("reached_intended_person", "is_safe_now", "needs_help_now", "help_offers_stated", "call_back_requested"):
        assert result[key] in {"yes", "no"}, key
    assert result["checks"]["too_hot"] == "no" and result["checks"]["has_power"] == "yes"
    # The one honest exception: somebody with no powered equipment cannot answer this one.
    assert result["checks"]["equipment_working"] == "unknown"
    merged = make_result(checks={"too_hot": "yes"})
    assert merged["checks"]["too_hot"] == "yes" and merged["checks"]["has_water"] == "yes"
