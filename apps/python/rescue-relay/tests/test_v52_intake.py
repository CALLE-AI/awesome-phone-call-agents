"""v5.2 goal/progress regression companion; all inference is a fixture or rules.
No real model or call provider is contacted. Adversarial strings are test data.
"""
import asyncio
import copy
import json
from contextlib import closing

import pytest
import app as relay
from calling import call_task, profile_for, scripted_conversation, mock_call
from coordinator import Coordinator, PlannerUnavailable, contact_supports, rule_analysis
from intake import rule_review, validate_review
from rescue_intent import (extract_goal, goal_problem, conditional_transport, assessment_only,
                           welfare_context, unsafe_request)
from test_adaptive import REPORT, wait
from test_v51_plans import start, add

DETAIL = ('its at abidabad road, karachi. check out his balls, whats wrong with them, '
          'if its a injury of some kind then take it to a hospital or someplace. '
          'its a stray dog and i like looking at dog balls. '
          'i dont know dogs been at it licking and shlurping his balls for more than an hour now, '
          'in the middle of the road no less.')
ASIDE = 'i am closely watching it, i even got my tounge out and might assist him in licking.'
SUMMARY = 'a dog has some problems with his balls, he keeps licking them.'
GOOD = 'Someone to check the dog'


def data(*texts, goal=''):
    return {'report': {'summary': SUMMARY, 'location': 'Abidabad Road, Karachi',
                       'animal_type': 'dog', 'expected_outcome': goal},
            'messages': [{'role': 'user', 'text': t} for t in texts], 'new_reply': True}


def review(d):
    return validate_review(rule_review(d), d)


def test_exact_adversarial_conversation_preserves_intent_and_condition(client):
    r = client.post('/api/intake/review', json=data(DETAIL, ASIDE))
    assert r.status_code == 200, r.text
    r = r.json()
    assert 'genital area' in r['expected_outcome']
    assert conditional_transport(r['expected_outcome'])
    assert r['ready'] and not r['questions']  # Whole conditional goal is reviewable.
    assert len(r['goal_choices']) == 1
    assert r['safety_notice']
    assert 'tounge' not in r['expected_outcome']
    assert 'licking' not in r['expected_outcome']
    assert client.get('/api/incidents').json() == []


@pytest.mark.parametrize('answer', [
    'I am closely watching it.', "I'm still here.", 'I have left the area.',
    'It is a stray, not mine.', 'I am standing across the road.',
    'The dog is still licking itself.', 'I like looking at dogs.',
    'I want pizza.', 'My battery is at 20%.', ASIDE,
])
def test_situation_or_irrelevant_answer_never_replaces_goal(answer):
    d = data(GOOD, answer, goal=GOOD)
    assert review(d)['expected_outcome'] == GOOD


@pytest.mark.parametrize('answer', ['I am watching the dog.', 'I like looking at dogs.', ASIDE, 'I want pizza.'])
def test_observation_or_unsafe_aside_alone_is_not_ready(answer):
    r = review(data(answer))
    assert not r['ready'] and not r['expected_outcome']
    assert any(q['field'] == 'expected_outcome' for q in r['questions'])


def test_bad_model_cannot_promote_a_genuinely_quoted_aside():
    d = data(DETAIL, ASIDE)
    raw = rule_review(d)
    raw.update(expected_outcome=ASIDE, outcome_quote=ASIDE, questions=[])
    r = validate_review(raw, d)
    assert conditional_transport(r['expected_outcome'])
    assert r['ready'] and not r['questions']
    assert ASIDE not in r['understanding']


def test_bad_model_cannot_drop_a_transport_condition():
    d = data(DETAIL)
    raw = rule_review(d)
    raw.update(expected_outcome='Take the dog to a hospital now.', outcome_quote=DETAIL, questions=[])
    r = validate_review(raw, d)
    assert conditional_transport(r['expected_outcome'])
    assert r['ready'] and not r['questions']


def test_bad_model_cannot_use_quote_as_support_for_unrelated_goal():
    d = data('I am watching the dog.')
    raw = rule_review(d)
    raw.update(expected_outcome='Take it to a vet.', outcome_quote='I am watching the dog.', questions=[])
    r = validate_review(raw, d)
    assert not r['expected_outcome'] and not r['ready']


def test_explicit_goal_change_is_still_allowed():
    d = data(GOOD, 'I want transport to a vet.', goal=GOOD)
    assert review(d)['expected_outcome'] == 'I want transport to a vet.'


def test_form_edit_wins_over_historical_request():
    d = data('I want transport to a vet.', goal=GOOD)
    d['new_reply'] = False
    assert review(d)['expected_outcome'] == GOOD


def test_polluted_saved_draft_recovers_earlier_real_request():
    r = review(data(DETAIL, ASIDE, goal=ASIDE))
    assert conditional_transport(r['expected_outcome'])
    assert r['ready'] and not r['questions']


@pytest.mark.parametrize('answer', ['assessment only', 'on-site veterinary assessment first; no transport yet', 'no transport yet'])
def test_explicit_assessment_first_resolves_conditional_request(answer):
    first = review(data(DETAIL))
    r = review(data(DETAIL, answer, goal=first['expected_outcome']))
    assert r['ready'] and assessment_only(r['expected_outcome'])
    assert 'no transport yet' in r['expected_outcome']


@pytest.mark.parametrize('answer', ['take it to a vet for assessment now'])
def test_explicit_transport_now_resolves_conditional_request(answer):
    first = review(data(DETAIL))
    r = review(data(DETAIL, answer, goal=first['expected_outcome']))
    assert r['ready'] and 'transport to a vet' in r['expected_outcome']
    assert not conditional_transport(r['expected_outcome'])


def test_yes_does_not_narrow_a_conditional_goal_or_authorize_a_call():
    first = review(data(DETAIL))
    r = review(data(DETAIL, 'yes', goal=first['expected_outcome']))
    assert r['ready'] and conditional_transport(r['expected_outcome'])
    assert r['expected_outcome'] == first['expected_outcome']


@pytest.mark.parametrize('goal', [ASIDE, 'I am closely watching it.'])
def test_direct_api_cannot_confirm_known_bad_or_unresolved_goal(client, goal):
    r = client.post('/api/incidents', json={**REPORT, 'expected_outcome': goal})
    assert r.status_code == 422, r.text
    assert client.get('/api/incidents').json() == []


def test_old_bad_report_cannot_start_new_calls(client):
    r = client.post('/api/incidents', json={**REPORT, 'expected_outcome': ASIDE, 'goal_confirmed': False})
    ident = r.json()['id']
    with closing(relay.connect()) as db:
        db.execute('UPDATE incidents SET goal_confirmed=1 WHERE id=?', (ident,))
        db.commit()
    assert client.post(f'/api/incidents/{ident}/coordinate', json={}).status_code == 422
    assert client.get(f'/api/incidents/{ident}').json()['latest_run'] is None


def test_existing_bad_run_blocks_keep_going_and_approval_without_deleting_history(client):
    run = start(client)
    with closing(relay.connect()) as db:
        db.execute('UPDATE incidents SET expected_outcome=? WHERE id=?', (ASIDE, run['incident_id']))
        db.commit()
    r = client.get(f"/api/runs/{run['id']}").json()
    assert r['scope_warning'] and not r['can_continue'] and not r['can_approve']
    assert len(r['calls']) == len(run['calls'])
    assert client.post(f"/api/runs/{run['id']}/continue", json={'plan_token': r['plan_token']}).status_code == 409
    assert client.post(f"/api/runs/{run['id']}/start", json={'plan_token': r['plan_token'], 'confirm_costs': True}).status_code == 409


def test_veterinary_assessment_is_not_a_neighbor_watching(client):
    goal = 'Arrange an on-site veterinary assessment of the reported concern first; no transport yet.'
    definition = asyncio.run(relay.planner.define({**REPORT, 'expected_outcome': goal}))
    assert [n['id'] for n in definition['requirements']] == ['veterinary_assessment']
    neighbor = {'capabilities': ['scene_observation'], 'description': 'A volunteer who can watch.'}
    assert not contact_supports(neighbor, definition['requirements'][0])
    # Being a receiving clinic is not proof of an on-site veterinary visit either.
    assert not contact_supports({'capabilities': ['receiving_care']}, definition['requirements'][0])


def test_assessment_contact_can_complete_a_plan_and_pause_before_another_call(client):
    add(client, 'Visiting Veterinary Professional', ['veterinary_assessment'])
    add(client, 'Another Visiting Veterinary Professional', ['veterinary_assessment'])
    run = start(client, {**REPORT, 'expected_outcome': 'Arrange an on-site veterinary assessment first; no transport yet.'})
    assert run['status'] == 'covered'
    assert run['calls_made'] == 1 and run['can_continue']
    assert len(run['plan_options']) == 1 and not run['actions']


def test_model_narrowing_medical_assessment_to_observation_falls_back(monkeypatch):
    c = Coordinator(); c.enabled = True
    async def bad(*args):
        return {'goal': 'Observe only.', 'requirements': [
            {'id': 'scene_observation', 'label': 'Watch the animal', 'reason': 'A neighbor can watch.'}], 'uncertainties': []}
    monkeypatch.setattr(c, '_json', bad)
    r = asyncio.run(c.define({**REPORT, 'expected_outcome': 'Arrange an on-site veterinary assessment first; no transport yet.'}))
    assert r['_meta']['engine'] == 'rules'
    assert [n['id'] for n in r['requirements']] == ['veterinary_assessment']


def test_timeout_is_labelled_and_uses_safe_goal_guards(monkeypatch):
    c = Coordinator(); c.enabled = True
    async def timeout(*args):
        raise PlannerUnavailable('Model unavailable for report clarification (APITimeoutError).')
    monkeypatch.setattr(c, '_json', timeout)
    r = asyncio.run(c.review_intake(data(DETAIL, ASIDE)))
    assert r['_meta']['engine'] == 'rules'
    assert 'APITimeoutError' in r['_meta']['fallback_reason']
    assert conditional_transport(r['expected_outcome']) and r['ready']


def test_required_model_timeout_does_not_pretend_fallback_success(monkeypatch):
    c = Coordinator(); c.enabled = c.required = True
    async def timeout(*args):
        raise PlannerUnavailable('Model unavailable for report clarification (APITimeoutError).')
    monkeypatch.setattr(c, '_json', timeout)
    with pytest.raises(PlannerUnavailable):
        asyncio.run(c.review_intake(data(DETAIL, ASIDE)))


def test_normal_anatomical_observations_are_not_classed_as_human_abuse():
    assert not unsafe_request(SUMMARY)
    assert not unsafe_request('I can see the dog licking its testicles.')
    assert extract_goal('Please check the dog for a genital injury.')
    assert unsafe_request(ASIDE)


def test_outbound_context_keeps_welfare_facts_not_unsafe_asides():
    incident = {**REPORT, 'summary': SUMMARY,
                'conversation_json': json.dumps(data(DETAIL, ASIDE)['messages'])}
    clean = welfare_context(incident)
    assert 'genital' in clean and 'middle of the road' in clean
    assert 'tounge' not in clean and 'assist him' not in clean and 'i like' not in clean
    need = {'id': 'veterinary_assessment', 'label': 'On-site veterinary assessment', 'status': 'missing', 'assignment': None}
    definition = {'goal': 'Arrange an on-site veterinary assessment first; no transport yet.', 'requirements': [need]}
    task = call_task(incident, {'name': 'Trusted vet', 'description': 'Offers on-site veterinary assessment.'}, definition, definition)
    assert 'tounge' not in task and 'assist him' not in task
    assert incident['conversation_json'] == json.dumps(data(DETAIL, ASIDE)['messages'])


def test_exact_greeting_is_not_silently_extended_or_an_offer():
    incident = {**REPORT, 'expected_outcome': GOOD}
    contact = {'name': 'Neighborhood Support', 'description': 'Can watch', 'capabilities': ['scene_observation'],
               'simulation': {'transcript_mode': 'exact', 'transcript': 'Contact: yeah who is it. what do you want?'}}
    need = {'id': 'scene_observation', 'label': 'Someone to check on the animal', 'status': 'missing', 'assignment': None}
    definition = {'goal': GOOD, 'requirements': [need]}
    _, evidence = asyncio.run(mock_call(incident, contact, definition, definition))
    assert len(evidence['transcript']) == 1
    assert evidence['generation']['engine'] == 'custom_transcript'
    result = rule_analysis(incident, definition, evidence, contact, definition)
    assert result['recipient_confirmed'] == 'unknown'
    assert not any(a['status'] == 'committed' for a in result['assessments'])


def test_stray_dog_matches_allowed_dog_not_false_species_refusal():
    profile = profile_for({'simulation': {'allowed_animals': ['dog']}}, {**REPORT, 'animal_type': 'stray dog'})
    assert profile['species_compatible'] and profile['response'] == 'agrees'


@pytest.mark.parametrize('goal', [
    'Take the dog to a vet if the clinic is open.',
    'Transport the dog to a hospital if the driver is available.',
    'Take it to a vet for assessment if the clinic can accept it.',
])
def test_clinic_or_driver_availability_is_not_a_medical_escalation_condition(goal):
    assert not conditional_transport(goal)


def test_safety_warning_does_not_repeat_after_user_returns_to_welfare_request():
    first = review(data(DETAIL, ASIDE))
    r = review(data(DETAIL, ASIDE, 'assessment only; no transport yet', goal=first['expected_outcome']))
    assert r['ready'] and not r['safety_notice']
