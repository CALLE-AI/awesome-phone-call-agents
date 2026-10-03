"""The call contract: what BuddyE says to a frail person, and the typed result it comes back with.

Two of these tests are the product's safety properties written down as assertions — silence must be
a representable finding, and nothing in the brief may promise to summon help — and they are the two
to look at first if a change here goes red.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.calls.contract import (
    ALLOWED_SCHEMA_KEYS,
    CHECK_FIELDS,
    HazardView,
    HelpOffer,
    NeighbourView,
    assert_calle_schema_subset,
    compile_contract,
    get_path,
    iter_schema_fields,
    parse_help_offers,
    set_path,
)
from app.domain.state import CheckOutcome

OFFERS = parse_help_offers([
    {"key": "cooling_center", "label": "Cooling centre", "address": "4141 West Thomas Road", "hours": "open until 8 tonight"},
    {"key": "ride", "label": "Ride", "detail": "A volunteer can drive you there and back this evening"},
    {"key": "water_drop", "label": "Water drop", "detail": "A case of bottled water left at your door tonight"},
    {"key": "wellness_visit", "label": "Wellness visit", "detail": "A neighbour can knock on your door within the hour"},
])

HEAT = HazardView(
    kind="heat", headline="Excessive Heat Warning — 114F through Thursday", area="Maryvale, Phoenix",
    severity="warning", captain_name="Alma Reyes", help_offered=OFFERS,
)
OUTAGE = HazardView(
    kind="power_outage", headline="Power outage across Maryvale, restoration estimated 6 to 10 hours",
    area="Maryvale, Phoenix", severity="emergency", captain_name="Alma Reyes", help_offered=OFFERS,
)
# Rosa: 75+, alone, a swamp cooler that gives up when the humidity climbs.
ROSA = NeighbourView(name="Rosa Delgado", first_name="Rosa", lives_alone=True, cooling="swamp_cooler", mobility="cane_walker")
# Walter: an oxygen concentrator plugged into the wall. In a blackout he has hours, not days.
WALTER = NeighbourView(
    name="Walter Boyd", first_name="Walter", lives_alone=True, power_dependent=True,
    power_backup_hours=4.0, mobility="cane_walker", has_transport=False,
)


def _silence_result(contract) -> dict:  # noqa: ANN001
    """What an unanswered call can honestly return: nothing was established, and that is the finding."""
    out: dict = {}
    for path, spec, required in iter_schema_fields(contract.result_schema):
        if not required:
            continue
        value: object = "unknown" if spec.get("enum") else ([] if spec.get("type") == "array" else "")
        set_path(out, path, value)
    out["reached_intended_person"] = "no"  # the one thing an unanswered call does know
    return out


# ------------------------------------------------------------------ the two properties
def test_silence_is_a_finding_not_a_validation_error() -> None:
    """Nobody answering is often the most important thing a sweep learns. If the schema could only be
    satisfied by a completed conversation, an UNREACHABLE power-dependent neighbour would surface as
    a malformed result instead of an escalation."""
    c = compile_contract(OUTAGE, WALTER)
    assert c.validate_result(_silence_result(c)) == []
    # every required leaf has an honest "nothing was established" value available
    for path, spec, required in iter_schema_fields(c.result_schema):
        if not required:
            continue
        if spec.get("enum"):
            assert "unknown" in spec["enum"], path
        else:
            assert spec.get("type") in {"string", "array"}, path  # "" and [] are both sayable


def test_the_brief_never_promises_to_summon_anyone() -> None:
    """BuddyE may not dial an emergency service, and it may not imply that it has. The ladder is
    emergency contact -> block captain -> a handoff packet a named human releases."""
    task = compile_contract(OUTAGE, WALTER).task
    assert "This call cannot arrange anything and must never suggest it can" in task
    assert "you are checking in, not responding" in task
    assert "dial 911 themselves" in task
    assert "Do not offer to make that call for them" in task
    assert "you will tell Alma Reyes right away" in task  # the true thing it may say instead
    lowered = task.lower()
    for banned in ("transfer you", "connect you", "patch you through", "help is on the way", "on their way",
                   "i'll send", "we'll send", "dispatch", "call 911 for you", "i will call 911"):
        assert banned not in lowered, f"the brief must never say {banned!r}"


# ------------------------------------------------------------------ schema shape
def test_the_hazard_decides_which_checks_the_call_may_not_come_home_without() -> None:
    heat = compile_contract(HEAT, ROSA)
    outage = compile_contract(OUTAGE, WALTER)
    assert "checks.too_hot" in heat.hard_fields and "checks.too_hot" not in outage.hard_fields
    assert "checks.has_power" in outage.hard_fields
    # Walter's concentrator runs off wall power: during an outage its state is not optional
    assert "checks.equipment_working" in outage.hard_fields
    # ... and it is required for him even under a hazard whose own list does not mention equipment
    assert "checks.equipment_working" in compile_contract(HEAT, WALTER).hard_fields
    assert "checks.equipment_working" not in heat.hard_fields  # Rosa has none
    # living alone and not being steady on your feet each pull a check into the required set
    assert {"checks.someone_with_them", "checks.can_evacuate"} <= set(heat.hard_fields)
    assert set(heat.hard_fields) & set(heat.soft_fields) == set()
    assert heat.result_schema["properties"]["checks"]["required"] == [k.split(".")[1] for k in heat.hard_fields if k.startswith("checks.")]


def test_hard_means_the_call_may_not_come_home_without_it_not_that_it_must_be_yes() -> None:
    """`is_safe_now == "no"` is not a gap to gate on, it is the finding the whole ladder exists for.
    So hard_fields carries only tri-states — a ported `all(get_path(r, f) == "yes")` gate would be
    wrong here, and it must at least not be given arrays and quotes to choke on."""
    c = compile_contract(OUTAGE, WALTER)
    specs = {p: spec for p, spec, _ in iter_schema_fields(c.result_schema)}
    for path in c.hard_fields:
        assert specs[path].get("enum") == ["yes", "no", "unknown"], path
    assert set(c.hard_fields) <= set(c.must_return)
    # the required arrays and quotes are things the call must RETURN; empty is a fine answer
    assert {"help_accepted", "help_declined", "concerns", "alarming_quote"} <= set(c.must_return)
    assert not {"help_accepted", "concerns", "alarming_quote"} & set(c.hard_fields)
    assert set(c.hard_fields) | set(c.soft_fields) == set(specs)


def test_a_power_dependent_neighbour_must_come_back_with_the_hours_on_the_battery() -> None:
    """For Walter in a blackout the number IS the escalation input; "the concentrator is on" is not
    the answer that matters. The key may be "" but it may not be silently absent."""
    assert "equipment_hours_remaining" in compile_contract(OUTAGE, WALTER).result_schema["required"]
    assert "equipment_hours_remaining" in compile_contract(HEAT, WALTER).must_return
    assert "equipment_hours_remaining" not in compile_contract(HEAT, ROSA).result_schema["required"]


def test_every_condition_check_from_the_brief_exists() -> None:
    props = compile_contract(HEAT, ROSA).result_schema["properties"]["checks"]["properties"]
    assert set(props) == {"too_hot", "too_cold", "has_power", "has_water", "has_food", "has_medication",
                          "equipment_working", "can_evacuate", "someone_with_them"}
    assert all(p["enum"] == ["yes", "no", "unknown"] for p in props.values())


def test_top_level_fields_the_escalation_layer_and_a_responder_need() -> None:
    c = compile_contract(OUTAGE, WALTER)
    props = c.result_schema["properties"]
    for key in ("reached_intended_person", "is_safe_now", "needs_help_now", "checks", "help_offers_stated",
                "help_accepted", "help_declined", "concerns", "alarming_quote", "sounded_distressed",
                "equipment_hours_remaining", "call_back_requested", "call_back_time", "notes"):
        assert key in props, key
    assert set(c.result_schema["required"]) <= set(props)
    assert props["help_accepted"]["type"] == "array" and props["concerns"]["type"] == "array"
    assert props["alarming_quote"]["type"] == "string"


def test_schema_is_a_plain_draft7_subset() -> None:
    import json

    c = compile_contract(HEAT, ROSA)
    text = json.dumps(c.result_schema)
    for banned in ("$ref", "oneOf", "anyOf", "allOf", "pattern", "format", "minItems"):
        assert banned not in text
    for path, spec, _ in iter_schema_fields(c.result_schema):
        assert spec["type"] in {"string", "array"}, path  # never "null", never a type array
    assert c.result_schema["additionalProperties"] is False
    assert c.result_schema["properties"]["checks"]["additionalProperties"] is False


def test_compiled_schema_stays_inside_the_documented_calle_subset() -> None:
    """CALL-E documents a narrow result_schema subset. This is the offline stand-in for server acceptance."""
    for hazard, nbr in ((HEAT, ROSA), (OUTAGE, WALTER), (HazardView(kind="boil_water"), NeighbourView(name="Ann Poole"))):
        c = compile_contract(hazard, nbr)
        assert_calle_schema_subset(c.result_schema)
        for path, spec, _ in iter_schema_fields(c.result_schema):
            assert set(spec) <= ALLOWED_SCHEMA_KEYS, path
            assert path.count(".") <= 1, path
            assert not isinstance(spec.get("type"), list), f"{path} would be rejected by CALL-E"
            if spec.get("enum"):
                assert "unknown" in spec["enum"], path
            if spec.get("type") == "array":
                assert spec["items"] == {"type": "string"}, path  # no description or enum inside items


@pytest.mark.parametrize("bad", [
    {"type": "object", "additionalProperties": False, "properties": {"a": {"$ref": "#/x"}}},
    {"type": "object", "additionalProperties": False, "properties": {"a": {"type": "string", "format": "date"}}},
    {"type": "object", "additionalProperties": True, "properties": {}},
    {"type": "object", "additionalProperties": False, "properties": {"a": {"type": "array", "items": {"type": "string", "description": "keys"}}}},
    {"type": "object", "additionalProperties": False, "properties": {"a": {"type": "array", "items": {"type": "object", "additionalProperties": False, "properties": {}}}}},
    {"type": "object", "additionalProperties": False, "properties": {"a": {"type": "string", "enum": ["yes", "no"]}}},
    {"type": "object", "additionalProperties": False, "required": ["missing"], "properties": {}},
    {"type": "object", "additionalProperties": False, "properties": {"a": {"type": "object", "additionalProperties": False, "properties": {"b": {"type": "object", "additionalProperties": False, "properties": {}}}}}},
])
def test_unsupported_schema_features_are_refused(bad: dict) -> None:
    with pytest.raises(ValueError):
        assert_calle_schema_subset(bad)


def test_nullable_type_arrays_are_refused_because_the_server_refuses_them() -> None:
    """CALL-E answered a live create with `result_schema_invalid: unsupported JSON Schema type
    ['string','null']`. The offline assertion has to catch that before a call is spent."""
    with pytest.raises(ValueError, match="nullable type arrays"):
        assert_calle_schema_subset({
            "type": "object", "additionalProperties": False,
            "properties": {"alarming_quote": {"type": ["string", "null"]}},
        })


def test_validation_rejects_a_missing_required_field_and_an_invented_one() -> None:
    c = compile_contract(OUTAGE, WALTER)
    r = _silence_result(c)
    r.pop("is_safe_now")
    assert any("is_safe_now" in e for e in c.validate_result(r))
    r2 = _silence_result(c)
    r2["made_up"] = 1
    assert c.validate_result(r2)
    r3 = _silence_result(c)
    r3["checks"].pop("has_power")
    assert any("has_power" in e for e in c.validate_result(r3))
    assert c.validate_result(None) == ["provider returned no schema-valid structured_result"]


# ------------------------------------------------------------------ the schema serves its consumer
def test_the_five_check_outcomes_are_all_distinguishable_from_one_result() -> None:
    """Whatever the escalation layer decides, it decides from these fields. If two outcomes collapse
    into the same answer, a field is missing and the escalation agent has to invent one."""
    c = compile_contract(OUTAGE, WALTER)
    base = _silence_result(c)

    def result(**over: object) -> dict:
        r = {**base, "checks": dict(base["checks"])}
        r.update(over)
        return r

    results = {
        CheckOutcome.SAFE: result(reached_intended_person="yes", is_safe_now="yes", needs_help_now="no",
                                  help_offers_stated="yes"),
        CheckOutcome.NEEDS_HELP: result(reached_intended_person="yes", is_safe_now="yes", needs_help_now="yes",
                                        help_offers_stated="yes", help_accepted=["water_drop"]),
        CheckOutcome.HELP_DECLINED: result(reached_intended_person="yes", is_safe_now="yes", needs_help_now="yes",
                                           help_offers_stated="yes", help_declined=["cooling_center"]),
        CheckOutcome.URGENT: result(reached_intended_person="yes", is_safe_now="no", needs_help_now="yes",
                                    help_offers_stated="yes", alarming_quote="I can't get up and the machine stopped"),
        CheckOutcome.UNREACHABLE: base,
    }
    seen: dict[tuple, CheckOutcome] = {}
    for outcome, r in results.items():
        assert c.validate_result(r) == [], outcome
        key = (r["reached_intended_person"], r["is_safe_now"], r["needs_help_now"],
               bool(r["help_accepted"]), bool(r["help_declined"]))
        assert key not in seen, f"{outcome} is indistinguishable from {seen.get(key)}"
        seen[key] = outcome
    # and the thing a responder is handed comes straight off the call
    assert results[CheckOutcome.URGENT]["alarming_quote"]
    # a real call is often both at once: took the water, would not leave the house for the cooling centre
    mixed = result(reached_intended_person="yes", is_safe_now="yes", needs_help_now="yes", help_offers_stated="yes",
                   help_accepted=["water_drop"], help_declined=["cooling_center", "ride"])
    assert c.validate_result(mixed) == []


# ------------------------------------------------------------------ the task text
def test_the_task_establishes_every_topic_the_brief_requires() -> None:
    task = compile_contract(OUTAGE, WALTER).task.lower()
    for topic in ("are they safe right now", "too hot or too cold", "electricity", "water they can drink",
                  "food for today", "their medicine", "how many hours it would last", "get out of the house",
                  "is anyone there with them", "check on them again"):
        assert topic in task, topic


def test_the_task_identifies_itself_as_a_machine_and_names_the_captain() -> None:
    task = compile_contract(HEAT, ROSA).task
    first = task.split("\n")[0]
    assert "automated check-in call" in first and "neighbourhood check-in programme" in first
    assert "You are not a person and you never pretend to be one." in first
    assert "Alma Reyes asked you to phone everyone on the block" in task
    assert "say plainly that you are an automated voice" in task


def test_the_register_is_warm_and_paced_for_someone_who_may_be_frightened() -> None:
    """A long rigid script produced fragmented speech and dead air on an earlier live call; the same
    pacing rules apply here, and the person on this line may also have been asleep."""
    task = compile_contract(HEAT, ROSA).task
    assert "How to speak. This matters as much as what you say:" in task
    assert "Warm, calm, unhurried" in task
    assert "One idea per turn" in task
    assert "The moment they start talking, stop and listen" in task
    assert "Do not narrate what you are about to do" in task
    assert "Only ask whether they are still there after a long silence" in task
    assert "A request to repeat is never an answer" in task
    assert "Rosa may be elderly, unwell, asleep, or frightened that a machine is calling." in task


def test_the_default_shape_is_short_and_the_exception_is_the_person_in_trouble() -> None:
    """The call is paced to be quick: to the point, safety first, gone in under two minutes when they are
    fine. The whole risk of writing it that way is that a machine told to hurry hurries somebody who is
    crying, so the expansion is stated in the same breath as the default rather than further down where
    it can be skipped.

    It is framed as a routine check-in, not an emergency. A live call was refused outright by CALL-E —
    "this call is framed as an emergency welfare/safety check; revise it into a non-emergency check-in"
    — when the task said "This is an emergency, not a survey." Nobody's phone rang. The pace survives
    the reframe; the word does not."""
    task = compile_contract(HEAT, ROSA).task
    assert "This is a routine neighbourhood check-in, not an emergency service." in task
    assert "This is an emergency" not in task  # CALL-E refuses to create a call task framed this way
    assert "under two minutes" in task
    # safety is the first thing established, before the house, the cooler, or the offers
    lowered = task.lower()
    assert lowered.index("are they safe right now") < lowered.index("too hot or too cold")
    assert lowered.index("are they safe right now") < lowered.index("the help you can offer".lower())
    # ... and the person who is not fine is never rushed
    for expansion in ("confused, frightened, crying, hard of hearing", "slow right down", "be kind",
                      "keep them talking", "take as long as it takes",
                      "Nobody in trouble is hurried off this phone"):
        assert expansion in task, expansion
    # the haste instruction and its exception are one paragraph, not a rule and a distant footnote
    paragraph = next(p for p in task.split("\n\n") if "not an emergency service" in p)
    assert "Nobody in trouble is hurried off this phone" in paragraph


def test_the_task_stays_inside_the_length_budget_on_the_worst_case() -> None:
    """The brief is re-read by the voice engine on every turn, so its length is the latency of every
    turn — this is a performance budget, not tidiness.

    Two budgets, because the worst case is not the shape of a normal call. The floor is set by text
    that may not be shortened: the programme's identity, the pacing block, the topics that decide
    whether somebody is safe, the 911 boundary, the voicemail line, and — the part that is not ours
    at all — the captain's own wording for every offer, which is spoken verbatim and is ~330 chars
    when four exist. What was removed to get here was duplication (the opening paragraph against the
    opening script, the task text against the field descriptions that carry the same guidance to the
    extraction model), never a safety instruction.
    """
    worst = compile_contract(OUTAGE, WALTER)
    assert len(worst.help_offers) == 4 and len(OUTAGE.headline) > 50
    assert len(worst.task) < 3600, f"worst-case task is {len(worst.task)} chars"
    # the shape a normal hazard produces, where the captain has written down one or two things
    plain = compile_contract(HazardView(kind="heat", captain_name="Alma Reyes"), ROSA)
    assert len(plain.task) < 3000, f"no-offer task is {len(plain.task)} chars"
    # and it is decisively shorter than the survey-paced brief it replaced (4311 chars)
    assert len(worst.task) < 4311 * 0.85


def test_only_the_help_that_exists_may_be_offered_and_it_is_stated_word_for_word() -> None:
    c = compile_contract(HEAT, ROSA)
    block = c.task[c.task.index("The help you can offer"):c.task.index("\nRules:\n")]
    for offer in c.help_offers:
        assert offer.text in block, offer.key
    assert "4141 West Thomas Road, open until 8 tonight" in block
    assert "Never invent help, never say when it will arrive" in block
    assert c.offer_keys == ["cooling_center", "ride", "water_drop", "wellness_visit"]
    # the identifiers the extraction model must use are on the array field, never inside `items`
    desc = c.result_schema["properties"]["help_accepted"]["description"]
    assert all(k in desc for k in c.offer_keys)
    assert "items" not in c.result_schema["properties"]["help_accepted"]["description"]
    # a thing never said out loud is unknown, never yes — the same rule, restated for offers of help
    assert "Help you never said out loud was never offered" in c.task
    assert "Never \"yes\" for something you only intended to say" in c.result_schema["properties"]["help_offers_stated"]["description"]


def test_a_hazard_with_no_help_offers_promises_nothing() -> None:
    c = compile_contract(HazardView(kind="heat", captain_name="Alma Reyes"), ROSA)
    assert "You have nothing concrete to offer today. Do not invent anything" in c.task
    assert "The help you can offer" not in c.task
    assert c.offer_keys == []
    assert "no help options were available" in c.result_schema["properties"]["help_accepted"]["description"]


def test_field_descriptions_are_extraction_guidance_that_judges_meaning() -> None:
    """\"I'm fine\" from someone who then says they cannot get out of their chair is not fine, and the
    description is where CALL-E's extraction model is told so."""
    props = compile_contract(HEAT, ROSA).result_schema["properties"]
    assert "Judge by MEANING" in props["is_safe_now"]["description"]
    assert "not been able to get out of their chair" in props["is_safe_now"]["description"]
    checks = props["checks"]["properties"]
    assert "not been able to get out of their chair" in checks["can_evacuate"]["description"]
    assert "the cooler quit yesterday" in checks["too_hot"]["description"]
    assert "even if they turned down the help you offered" in props["needs_help_now"]["description"]
    # a battery that is running down is still "working" — the hours go in their own field
    assert "even on battery" in checks["equipment_working"]["description"]
    assert "equipment_hours_remaining" in checks["equipment_working"]["description"]
    # the verbatim field must not be paraphrased: a HandoffPacket quotes it to a responder
    assert "Never paraphrase" in props["alarming_quote"]["description"]
    assert "word for word in their own voice" in props["alarming_quote"]["description"]
    # every description reaching the extraction model actually says something
    for path, spec, _ in iter_schema_fields(compile_contract(HEAT, ROSA).result_schema):
        assert len(spec.get("description", "")) > 40, path


# ------------------------------------------------------------------ health data never leaves
def test_health_details_never_reach_the_task_text() -> None:
    """`CheckCall.task` is persisted and the task rides along on the event stream, and app.obs.redact
    masks phone numbers and credentials — not health text. So the brief is built from derived facts
    and never from the roster card itself."""
    row = SimpleNamespace(
        name="Rosa Delgado", phone="+15550101", address="2118 North 51st Avenue", unit="B",
        conditions=["copd", "heat_sensitive"], power_dependent=False, power_backup_hours=0.0,
        cooling="swamp_cooler", heating="gas", mobility="cane_walker", has_transport=False,
        lives_alone=True, preferred_language="en-US", notes="takes furosemide, keeps insulin in the fridge",
    )
    view = NeighbourView.from_row(row)
    assert view.first_name == "Rosa" and view.name == "Rosa Delgado"
    # ... and a view built by hand, without a first name, is just as safe
    assert NeighbourView(name="Rosa Delgado").first_name == "Rosa"
    assert "Delgado" not in compile_contract(HEAT, NeighbourView(name="Rosa Delgado")).task
    assert not hasattr(view, "conditions") and not hasattr(view, "address") and not hasattr(view, "phone")
    task = compile_contract(HEAT, view).task
    for secret in ("copd", "furosemide", "insulin", "2118 North 51st Avenue", "+15550101", "Delgado"):
        assert secret.lower() not in task.lower(), secret
    # the equipment question survives without naming the device
    assert "anything they rely on that needs electricity" in task
    assert "the equipment they rely on that needs electricity" in compile_contract(HEAT, WALTER).task


def test_the_voicemail_line_tells_a_stranger_nothing() -> None:
    """Whoever picks up an answering machine is not necessarily the person on the roster."""
    task = compile_contract(OUTAGE, WALTER).task
    line = next(l for l in task.split("\n") if l.startswith("- Voicemail"))
    assert "called about the power outage and will try again" in line
    assert "Do not say why they are on the list" in line
    assert "never mention health, medicine, or equipment" in line
    assert OUTAGE.headline not in line  # the short phrase, not the captain's headline


def test_no_phone_number_is_stated_unless_the_hazard_carries_one() -> None:
    assert "the number is" not in compile_contract(HEAT, ROSA).task
    with_number = HazardView(kind="heat", captain_name="Alma Reyes", callback_number="+1 555-0199")
    assert "If they ask how to reach a person, the number is +1 555-0199." in compile_contract(with_number, ROSA).task


# ------------------------------------------------------------------ helpers other modules import
def test_help_offers_are_parsed_from_whatever_the_captain_wrote_down() -> None:
    offers = parse_help_offers([
        {"key": "cooling_center", "label": "Cooling centre", "address": "4141 West Thomas Road", "hours": "open until 8 tonight"},
        {"label": "Water drop", "detail": "A case of bottled water left at your door tonight"},
        HelpOffer(key="ride", label="Ride", text="A volunteer can drive you there and back."),
        "A neighbour can knock on your door within the hour",
    ])
    assert offers[0].text == "Cooling centre at 4141 West Thomas Road, open until 8 tonight."
    assert offers[1].key == "water_drop"  # derived from the label when no key was written
    assert offers[1].text == "A case of bottled water left at your door tonight."  # not "Water drop. Water drop..."
    assert offers[2].text == "A volunteer can drive you there and back."
    assert offers[3].label.startswith("A neighbour can knock")


def test_views_can_be_built_straight_off_the_rows() -> None:
    hazard_row = SimpleNamespace(
        kind="power_outage", headline="Power outage across Maryvale", area="Maryvale, Phoenix", severity="emergency",
        help_offered=[{"key": "water_drop", "label": "Water drop", "detail": "A case of water at your door tonight"}],
        declared_by="Alma Reyes", facts={"outage_eta_h": 8},
    )
    view = HazardView.from_row(hazard_row)
    assert view.captain_name == "Alma Reyes" and view.callback_number == ""
    assert view.help_offered[0].key == "water_drop"
    assert HazardView.from_row(hazard_row, captain_name="Dee Nguyen").captain_name == "Dee Nguyen"
    nbr = NeighbourView.from_row(SimpleNamespace(name="Walter Boyd", power_dependent=True, power_backup_hours=4.0))
    assert nbr.first_name == "Walter" and nbr.power_dependent and nbr.mobility == "independent"


def test_get_path_and_set_path_walk_the_nested_checks() -> None:
    r: dict = {}
    set_path(r, "checks.has_power", "no")
    assert r == {"checks": {"has_power": "no"}}
    assert get_path(r, "checks.has_power") == "no"
    assert get_path(r, "checks.has_water", "unknown") == "unknown"
    assert get_path(None, "checks.has_power", "unknown") == "unknown"


def test_iter_schema_fields_walks_one_level_and_marks_required() -> None:
    c = compile_contract(OUTAGE, WALTER)
    paths = {p: req for p, _, req in iter_schema_fields(c.result_schema)}
    assert "checks" not in paths and paths["checks.has_power"] is True
    assert paths["notes"] is False
    assert set(CHECK_FIELDS) == {p.split(".")[1] for p in paths if p.startswith("checks.")}


def test_a_neighbour_who_does_not_speak_english_gets_the_language_and_the_locale() -> None:
    rosa_es = NeighbourView(name="Rosa Delgado", first_name="Rosa", preferred_language="es-US", lives_alone=True)
    c = compile_contract(HEAT, rosa_es)
    assert c.locale == "es-US" and "Speak the whole call in Spanish." in c.task
    assert "Speak the whole call in" not in compile_contract(HEAT, ROSA).task
