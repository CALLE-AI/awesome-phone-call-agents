"""Goal-completion hotfix regressions. Models are fixtures; no external calls."""
import asyncio
import copy
import json
from contextlib import closing

import pytest

import app as relay
from coordinator import Coordinator, PlannerUnavailable
from goal_dialogue import GOAL_CHOICES, MISSING_QUESTION, CHECK_QUESTION
from intake import rule_review, validate_review
from rescue_intent import (extract_goal, unsafe_request, welfare_context, safe_reply,
                           conditional_transport, WELFARE_CHECK_GOAL)

# Exact problematic input is test data only; it must never become a work order.
MIXED = 'yes checking on him and maybe giving his balls a hard lick'
UNSAFE = 'maybe giving his balls a hard lick'
REPORT = {'summary': 'A dog is beside the road.', 'location': 'Near Tariq Road, Karachi',
          'animal_type': 'dog', 'expected_outcome': ''}
CLEAR = WELFARE_CHECK_GOAL


def data(reply=None, *, goal='', context=None, location=REPORT['location']):
    return {'report': {**REPORT, 'expected_outcome': goal, 'location': location},
            'messages': [{'role': 'user', 'text': reply}] if reply is not None else [],
            'new_reply': reply is not None, 'goal_clarification': context}


def review(payload, questions=None):
    raw = rule_review(payload)
    if questions is not None:
        raw['questions'] = questions
    return validate_review(raw, payload)


def follow(result, text):
    return data(text, goal=result['expected_outcome'], context=result['goal_clarification'],
                location=result['location'])


def assert_no_calls(client):
    assert client.get('/api/incidents').json() == []
    with closing(relay.connect()) as db:
        assert db.execute('SELECT COUNT(*) FROM coordination_runs').fetchone()[0] == 0


def test_exact_exchange_via_http_retains_safe_goal_and_stops_repeating(client):
    first = client.post('/api/intake/review', json=data()).json()
    assert not first['ready'] and first['goal_clarification']['kind'] == 'missing'
    second_response = client.post('/api/intake/review', json=follow(first, MIXED))
    assert second_response.status_code == 200
    second = second_response.json()
    assert second['ready'] and second['expected_outcome'] == CLEAR
    assert second['safety_notice'] and second['questions'] == []
    assert second['goal_clarification'] is None
    third = client.post('/api/intake/review', json=follow(second, 'that is all')).json()
    assert third['ready'] and third['expected_outcome'] == CLEAR and third['questions'] == []
    assert_no_calls(client)


@pytest.mark.parametrize('text', [
    'checking on him', 'yes checking on him', 'yes, checking on him',
    'just checking on the dog', 'someone checking on him', 'someone to check on him',
    'a welfare check', 'only a check on her', 'checking on it and reporting back',
    'yeah just checking on the dog please', MIXED,
])
def test_named_welfare_answers_resolve_missing_goal(text):
    first = review(data())
    r = review(follow(first, text))
    assert r['ready'] and r['expected_outcome'] == CLEAR
    assert r['goal_clarification'] is None


@pytest.mark.parametrize('text', ['checking on him', 'yes checking on the dog', 'a welfare check'])
def test_fragments_are_also_accepted_in_the_dedicated_goal_field(text):
    r = review(data(goal=text))
    assert r['ready'] and r['expected_outcome'] == CLEAR


@pytest.mark.parametrize('text', ['I am checking on him.', 'He is checking on the dog.',
                                  'yes', 'not sure', 'maybe', 'not checking on him',
                                  'checking on his testicles', 'checking on him if needed'])
def test_nonanswers_observations_negations_and_medical_ambiguity_do_not_pick_observation(text):
    r = review(follow(review(data()), text))
    assert not r['ready'] and not r['expected_outcome']


def test_situation_field_is_not_implicitly_an_answer_to_the_goal_question():
    d = data(); d['report']['summary'] = 'checking on him'
    r = review(d)
    assert not r['ready'] and not r['expected_outcome']


@pytest.mark.parametrize('question', [MISSING_QUESTION, CHECK_QUESTION,
    'What kind of help would you like?', 'What help do you want for the animal?',
    'What is your rescue goal?', 'What would a successful rescue look like to you?'])
def test_model_cannot_reopen_a_broad_menu_after_a_clear_answer(question):
    first = review(data())
    r = review(follow(first, MIXED), [{'field': 'expected_outcome', 'question': question}])
    assert r['ready'] and r['expected_outcome'] == CLEAR and not r['questions']


@pytest.mark.parametrize('question', [
    'What should the helper report back about?',
    'What outcome do you want the helper to report?',
    'Which entrance should the helper use to reach the animal?',
])
def test_fresh_targeted_model_questions_are_not_blanket_discarded(question):
    r = review(data(goal=CLEAR), [{'field': 'expected_outcome', 'question': question}])
    assert not r['ready'] and r['questions'][0]['question'] == question


@pytest.mark.parametrize('text', ['that is all', "that's all", 'nothing else',
                                  'That is all I want.', 'keep it as is'])
def test_completion_finishes_refinement_of_an_actionable_goal(text):
    first = review(data('this can be improved', goal=CLEAR))
    assert not first['ready']
    r = review(follow(first, text))
    assert r['ready'] and r['expected_outcome'] == CLEAR


@pytest.mark.parametrize('goal', ['', 'check him out.'])
def test_completion_does_not_invent_goal_or_resolve_ambiguous_scope(goal):
    first = review(data(goal=goal))
    r = review(follow(first, 'that is all'))
    assert not r['ready'] and r['goal_clarification']
    assert any(q['field'] == 'expected_outcome' for q in r['questions'])


def test_completion_does_not_hide_missing_location():
    d = data('that is all', goal=CLEAR, location='')
    d['report']['summary'] = 'A dog looks unwell.'
    r = review(d)
    assert not r['ready'] and r['expected_outcome'] == CLEAR
    assert any(q['field'] == 'location' for q in r['questions'])
    assert r['goal_clarification'] is None


def test_goal_and_location_are_separate_and_targeted_location_question_survives():
    first = review(data())
    location = {'field': 'location', 'question': 'Which shop or landmark near Tariq Road is the dog beside?'}
    r = review(follow(first, MIXED), [
        {'field': 'expected_outcome', 'question': MISSING_QUESTION}, location])
    assert r['expected_outcome'] == CLEAR and r['safety_notice']
    assert not r['ready'] and r['questions'] == [location]
    assert r['goal_clarification'] is None and 'goal is clear' in r['understanding']
    next_result = review(follow(r, 'that is all'), [location])
    assert not next_result['ready'] and next_result['questions'] == [location]
    assert next_result['expected_outcome'] == CLEAR


def test_old_stuck_draft_recovers_the_previous_safe_answer_on_next_review():
    first = review(data())
    d = follow(first, 'that is all')
    d['messages'] = [
        {'role': 'assistant', 'text': MISSING_QUESTION},
        {'role': 'user', 'text': MIXED},
        {'role': 'assistant', 'text': MISSING_QUESTION},
        {'role': 'user', 'text': 'that is all'},
    ]
    snapshot = copy.deepcopy(d)
    r = review(d, [{'field': 'expected_outcome', 'question': MISSING_QUESTION}])
    assert r['ready'] and r['expected_outcome'] == CLEAR
    assert r['safety_notice']
    assert d == snapshot  # raw history is preserved, not rewritten
    d['new_reply'] = False
    assert review(d)['expected_outcome'] == CLEAR


def test_recovery_uses_actual_previous_question_not_todays_menu():
    first = review(data())
    d = follow(first, 'that is all')
    d['messages'] = [
        {'role': 'assistant', 'text': 'What are you doing right now?'},
        {'role': 'user', 'text': 'checking on him'},
        {'role': 'assistant', 'text': MISSING_QUESTION},
        {'role': 'user', 'text': 'that is all'},
    ]
    r = review(d)
    assert not r['ready'] and not r['expected_outcome']


def test_historical_ordinal_is_not_reinterpreted_using_current_menu():
    first = review(data())
    d = follow(first, 'that is all')
    d['messages'] = [{'role': 'assistant', 'text': MISSING_QUESTION},
                     {'role': 'user', 'text': 'first option'},
                     {'role': 'assistant', 'text': MISSING_QUESTION},
                     {'role': 'user', 'text': 'that is all'}]
    assert not review(d)['ready']


def test_inappropriate_only_reply_is_not_a_goal_and_keeps_existing_valid_goal():
    r = review(follow(review(data()), UNSAFE))
    assert r['safety_notice'] and not r['expected_outcome'] and not r['ready']
    r = review(data(UNSAFE, goal=CLEAR))
    assert r['expected_outcome'] == CLEAR and r['safety_notice']


def test_model_cannot_insert_the_unsafe_clause_even_when_quoted_verbatim():
    d = follow(review(data()), MIXED)
    raw = rule_review(d); raw.update(expected_outcome=MIXED, outcome_quote=MIXED, questions=[])
    r = validate_review(raw, d)
    assert r['expected_outcome'] == CLEAR and r['safety_notice']
    assert 'lick' not in r['expected_outcome'] and 'balls' not in r['expected_outcome']


def test_raw_unsafe_goal_cannot_be_directly_confirmed(client):
    r = client.post('/api/incidents', json={**REPORT, 'expected_outcome': MIXED,
                                          'goal_confirmed': True})
    assert r.status_code == 422
    assert_no_calls(client)


@pytest.mark.parametrize('text', [
    'The dog is licking his testicles.', 'His balls are swollen.',
    'The dog is giving his paw a lick.', 'He is giving his balls a lick.',
    'Can a vet check his swollen testicles?',
])
def test_anatomical_observations_and_self_grooming_are_not_unsafe_requests(text):
    assert not unsafe_request(text)


def test_medical_request_remains_medical_not_observation():
    r = review(follow(review(data()), 'Can a vet check his swollen testicles?'))
    assert r['ready'] and 'veterinary assessment' in r['expected_outcome']
    assert not r['safety_notice']


def test_downstream_context_excludes_unsafe_aside_but_keeps_welfare_request():
    cleaned = welfare_context({**REPORT, 'conversation_json': json.dumps([
        {'role': 'user', 'text': MIXED}])})
    assert 'checking on him' in cleaned and 'lick' not in cleaned
    assert 'balls' not in cleaned


def test_safe_conjunctions_and_transport_conditions_are_not_lost_when_removing_aside():
    check = 'Please check on the dog and report back'
    assert safe_reply(check + ' and ' + UNSAFE) == check
    assert extract_goal(check + ' and ' + UNSAFE) == check
    request = 'Please assess the dog and take it to a vet only if the assessment finds it necessary'
    assert conditional_transport(extract_goal(request + ' and ' + UNSAFE))


def test_legacy_model_without_semantic_assessment_uses_labelled_fallback(client, monkeypatch):
    coordinator = Coordinator(); coordinator.enabled = True
    async def model(phase, instruction, payload):
        assert 'Do not discard a safe answer' in instruction
        raw = rule_review(payload)
        raw['questions'] = [{'field': 'expected_outcome', 'question': MISSING_QUESTION}]
        return raw
    monkeypatch.setattr(coordinator, '_json', model)
    monkeypatch.setattr(relay, 'planner', coordinator)
    first = client.post('/api/intake/review', json=data()).json()
    second = client.post('/api/intake/review', json=follow(first, MIXED)).json()
    third = client.post('/api/intake/review', json=follow(second, 'that is all')).json()
    assert second['_meta']['engine'] == third['_meta']['engine'] == 'rules'
    assert 'semantic goal assessment' in third['_meta']['fallback_reason']
    assert second['ready'] and third['ready'] and third['expected_outcome'] == CLEAR
    assert_no_calls(client)


def test_model_timeout_fallback_still_accepts_safe_answer(monkeypatch):
    coordinator = Coordinator(); coordinator.enabled = True
    async def timeout(*args):
        raise PlannerUnavailable('Fixture timeout')
    monkeypatch.setattr(coordinator, '_json', timeout)
    d = follow(review(data()), MIXED)
    r = asyncio.run(coordinator.review_intake(d))
    assert r['ready'] and r['expected_outcome'] == CLEAR
    assert r['_meta']['engine'] == 'rules' and 'Fixture timeout' in r['_meta']['fallback_reason']
