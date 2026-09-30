"""Model-output fixtures exercise semantic decisions, not hardcoded action words."""
import asyncio
import copy
from contextlib import closing
import pytest
import app as relay
from coordinator import Coordinator
from intake import validate_review, rule_review
from intake_semantics import APPLICATION_SCOPE

REPORT = {"summary": "A dog is stuck behind a locked fence beside Blue Shop.",
          "location": "Blue Shop", "animal_type": "dog", "expected_outcome": ""}
WORDS = "Once she is no longer stuck behind that fence, that is enough."
GOAL = "Arrange qualified help to free the dog from behind the locked fence; no clinic trip is requested."


def data(text=WORDS, goal="", **changes):
    return {"report": {**REPORT, "expected_outcome": goal}, "new_reply": True,
            "messages": [{"role": "user", "text": text}], **changes}


def semantic(d, goal=GOAL, **assessment):
    return {"understanding": "You want the dog freed from behind the fence, without adding a clinic trip.",
            "location": d["report"]["location"], "animal_type": "dog", "expected_outcome": goal,
            "location_quote": "", "animal_quote": "", "outcome_quote": d["messages"][-1]["text"],
            "questions": [], "goal_options": [], "goal_assessment": {
                "status": "actionable", "source": "explicit", "source_quotes": [d["messages"][-1]["text"]],
                "matches_report": True, "within_scope": True, "preserves_constraints": True,
                "updates_goal": False, "rationale": "Safe release addresses the reported entrapment.",
                "required_capabilities": ["specialist_access", "safe_containment"], **assessment}}


def test_nonimperative_definition_of_success_is_a_goal_without_service_menu():
    d = data(); d["goal_clarification"] = {"kind": "missing", "goal": "", "question": "What would a successful rescue mean to you?"}
    raw = semantic(d)
    raw["questions"] = [{"field": "expected_outcome", "question": "What would a successful rescue mean to you?"}]
    r = validate_review(raw, d)
    assert r["ready"] and r["expected_outcome"] == GOAL
    assert r["goal_clarification"] is None and not r["questions"]
    assert r["goal_choices"] == [{"label": GOAL if len(GOAL) <= 100 else "Select this rescue goal", "reply": GOAL, "kind": "goal"}]
    assert "without adding a clinic trip" in r["understanding"]


@pytest.mark.parametrize("words,goal", [
    ("Success is her back with her owner.", "Coordinate safe reunification of the dog with her verified owner."),
    ("I'd call it done once that fishing line is no longer wrapped around its leg.", "Arrange qualified animal-welfare help to release the dog from the fishing line."),
    ("A temporary safe place until the owner is found would be enough.", "Arrange temporary safe foster care while the dog's owner is located."),
])
def test_semantic_outcomes_are_not_rejected_by_an_action_word_whitelist(words, goal):
    d = data(words)
    r = validate_review(semantic(d, goal), d)
    assert r["ready"] and r["expected_outcome"] == goal


def test_scope_and_report_alignment_are_separate_decisions():
    d = data("Success is mac and cheese for the dog.")
    d["report"]["summary"] = "The dog wants a burger."
    raw = semantic(d, "Get the dog mac and cheese.", status="out_of_scope", within_scope=False,
                   rationale="Restaurant orders are not animal-welfare rescue services.")
    r = validate_review(raw, d)
    assert not r["ready"] and not r["expected_outcome"] and not r["goal_choices"]
    assert r["goal_assessment"]["matches_report"] is True
    assert "Restaurant" in r["understanding"]


def test_model_cannot_greenlight_the_specific_restaurant_errand():
    d = data("Get the dog a burger.")
    r = validate_review(semantic(d, "Get the dog a burger."), d)
    assert not r["ready"] and r["goal_assessment"]["status"] == "out_of_scope"


def test_unrelated_goal_explains_mismatch_not_a_fixed_rescue_menu():
    d = data("Reunite a different cat with its owner.")
    r = validate_review(semantic(d, "Reunite the cat with its owner.", status="problem_mismatch", matches_report=False,
                                rationale="That concerns a different animal, not the dog trapped in this report."), d)
    assert not r["ready"] and not r["expected_outcome"]
    assert "different animal" in r["understanding"]


def test_unavailable_capability_is_not_out_of_scope():
    d = data()
    r = validate_review(semantic(d, capability_note="No saved responder currently lists safe fence access."), d)
    assert r["ready"] and "No saved responder" in r["scope_note"]


def test_missing_location_does_not_reopen_a_resolved_goal():
    d = data(); d["report"]["location"] = ""
    r = validate_review(semantic(d), d)
    assert not r["ready"] and r["expected_outcome"] == GOAL
    assert [q["field"] for q in r["questions"]] == ["location"]
    assert r["goal_choices"][0]["reply"] == GOAL


def test_model_needs_an_actual_user_quote_and_cannot_invent_a_goal_from_yes():
    d = data(); raw = semantic(d); raw["goal_assessment"]["source_quotes"] = ["Invented user consent"]
    with pytest.raises(ValueError): validate_review(raw, d)
    d = data("yes")
    with pytest.raises(ValueError): validate_review(semantic(d), d)


def test_status_cannot_replace_settled_goal_even_with_a_bad_semantic_update_flag():
    d = data("I am watching the dog.", goal=GOAL)
    raw = semantic(d, "Arrange a clinic trip.", updates_goal=True)
    raw["goal_assessment"]["source_quotes"] = [GOAL]
    raw["outcome_quote"] = GOAL
    r = validate_review(raw, d)
    assert r["ready"] and r["expected_outcome"] == GOAL


def test_constraints_cannot_be_dropped_by_semantic_paraphrase():
    d = data("Please assess the dog and take it to a vet only if the assessment finds it necessary.")
    with pytest.raises(ValueError):
        validate_review(semantic(d, "Take the dog to a vet now."), d)


def test_optional_custom_suggestions_are_grounded_and_not_fixed_labels():
    d = data(); raw = semantic(d, status="needs_clarification")
    raw["questions"] = [{"field": "expected_outcome", "question": "Should the qualified helper arrange access with the property owner?"}]
    raw["goal_options"] = [{"label": "Coordinate safe access", "reply": "Arrange qualified access with the property owner to free the dog.",
                            "source_quote": WORDS, "matches_report": True, "within_scope": True}]
    r = validate_review(raw, d)
    assert not r["ready"] and r["goal_choices"][0]["label"] == "Coordinate safe access"
    assert r["goal_clarification"]["question"] == raw["questions"][0]["question"]


def test_semantic_api_receives_capabilities_without_contact_numbers_and_has_no_side_effects(client, monkeypatch):
    model = Coordinator(); model.enabled = True
    async def fixture(phase, instruction, payload):
        assert payload["application_scope"] == APPLICATION_SCOPE
        assert payload["responder_services"]
        assert all(set(s) == {"capabilities", "description"} for s in payload["responder_services"])
        assert "not a rescue" in instruction and "source_quotes" in instruction
        return semantic(payload)
    monkeypatch.setattr(model, "_json", fixture); monkeypatch.setattr(relay, "planner", model)
    r = client.post('/api/intake/review', json=data())
    assert r.status_code == 200, r.text
    assert r.json()["ready"] and r.json()["_meta"]["engine"] == "llm"
    with closing(relay.connect()) as db:
        assert db.execute("SELECT COUNT(*) FROM incidents").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM calls").fetchone()[0] == 0


def test_rule_fallback_and_direct_api_reject_restaurant_goals(client):
    d = data("Get the dog a burger.")
    r = validate_review(rule_review(d), d)
    assert not r["ready"] and not r["expected_outcome"] and not r["goal_choices"]
    assert "outside" in r["understanding"]
    response = client.post('/api/incidents', json={**REPORT, "expected_outcome": "Get the dog mac and cheese.", "goal_confirmed": True})
    assert response.status_code == 422


def test_fallback_is_not_presented_as_semantic_reasoning(monkeypatch):
    model = Coordinator(); model.enabled = True
    async def broken(*args): raise RuntimeError("Fixture model failure")
    monkeypatch.setattr(model, "_json", broken)
    r = asyncio.run(model.review_intake(data()))
    assert r["_meta"]["engine"] == "rules" and r["_meta"]["fallback_reason"]


def test_no_clinic_constraint_survives_downstream_fallback():
    p = Coordinator(); p.enabled = p.required = False
    result = asyncio.run(p.define({**REPORT, 'expected_outcome': GOAL}))
    ids = {n['id'] for n in result['requirements']}
    assert 'transport' not in ids and 'receiving_care' not in ids
    assert 'safe_containment' in ids


def test_unfamiliar_custom_goal_is_not_turned_into_a_full_rescue_when_model_is_unavailable():
    from coordinator import PlannerUnavailable
    p = Coordinator(); p.enabled = p.required = False
    goal = 'Coordinate safe reunification with the verified owner.'
    with pytest.raises(PlannerUnavailable, match='custom outcome'):
        asyncio.run(p.define({**REPORT, 'expected_outcome': goal}))


def test_wrong_species_cannot_be_inserted_using_an_unrelated_exact_quote():
    d = data(); d['report']['animal_type'] = ''
    raw = semantic(d); raw.update(animal_type='cat', animal_quote='A dog is stuck')
    result = validate_review(raw, d)
    assert not result['animal_type'] and not result['ready']


def test_out_of_scope_report_does_not_get_unrelated_safe_goal_buttons():
    d = data('Get the dog a burger.'); raw = semantic(d, 'Get the dog a burger.')
    raw['goal_options'] = [{'label': 'Visit a clinic', 'reply': 'Arrange a clinic visit for the dog.',
        'source_quote': 'Get the dog a burger.', 'within_scope': True, 'matches_report': True}]
    result = validate_review(raw, d)
    assert not result['goal_choices'] and not result['ready']
