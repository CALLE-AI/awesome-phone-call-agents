"""Goal-refinement regressions. Models are fixtures and no responders are called."""
import asyncio
from contextlib import closing

import pytest

import app as relay
from coordinator import Coordinator, PlannerUnavailable
from goal_dialogue import GOAL_CHOICES, CHECK_QUESTION, UNCERTAIN_QUESTION
from goal_scope import observation_only
from intake import rule_review, validate_review
from rescue_intent import (ambiguous_check_goal, assessment_only, conditional_transport,
                           extract_goal, goal_revision_request)

VAGUE = 'check him out.'
CLEAR = 'Arrange for someone to observe the dog from a safe distance and report back.'
REPORT = {'summary': 'A dog is acting strangely beside the road.', 'location': 'Near Tariq Road, Karachi',
          'animal_type': 'dog', 'expected_outcome': VAGUE}


def data(reply=None, *, goal=VAGUE, context=None):
    return {'report': {**REPORT, 'expected_outcome': goal},
            'messages': [{'role': 'user', 'text': reply}] if reply else [],
            'new_reply': reply is not None, 'goal_clarification': context}


def review(d):
    return validate_review(rule_review(d), d)


def follow(previous, text=None):
    return data(text, goal=previous['expected_outcome'], context=previous['goal_clarification'])


def test_exact_reported_exchange_is_refinement_not_confirmation(client):
    r = client.post('/api/intake/review', json=data('yeah this can be improved'))
    assert r.status_code == 200, r.text
    result = r.json()
    assert not result['ready']
    assert result['expected_outcome'] == VAGUE
    assert result['goal_clarification']['kind'] == 'revision'
    assert 'refine' in result['understanding']
    assert 'Review your goal' not in result['understanding']
    assert result['questions'][0]['field'] == 'expected_outcome'
    assert 'veterinary professional' in result['questions'][0]['question']
    assert len(result['goal_choices']) == 3
    assert result['location'] == REPORT['location'] and result['animal_type'] == 'dog'
    assert client.get('/api/incidents').json() == []
    with closing(relay.connect()) as db:
        assert db.execute('SELECT COUNT(*) FROM coordination_runs').fetchone()[0] == 0


@pytest.mark.parametrize('feedback', [
    'yeah this can be improved', 'This goal could be improved.', 'can we improve this?',
    'Please refine the goal.', 'make it more specific', 'That could be clearer.',
    "That's not what I meant.", 'Not quite.', 'No, not exactly.',
    'Can you reword this goal for the dog?', 'change the goal', 'help me decide',
    "Don't confirm this yet.", "I'm not ready to confirm.", 'This is not what I asked for.', 'Please refine the rescue goal.', 'no', 'nope', 'not really',
])
def test_revision_feedback_is_not_a_new_goal(feedback):
    assert goal_revision_request(feedback)
    assert not extract_goal(feedback)
    r = review(data(feedback, goal=CLEAR))
    assert r['expected_outcome'] == CLEAR and not r['ready']
    assert r['goal_clarification']['kind'] == 'revision'


@pytest.mark.parametrize('text', [
    "The dog's condition is getting better.", 'The dog is improving.', 'His condition could be better.',
    'The dog is still watching people.', 'My budget could be improved.',
    'Yes, that looks good.', 'I am standing near the animal.',
])
def test_status_or_positive_feedback_is_not_mistaken_for_revision(text):
    assert not goal_revision_request(text)
    assert review(data(text, goal=CLEAR))['ready']


@pytest.mark.parametrize('goal', [
    'check him out.', 'Please check her out.', 'Can someone check out the dog?',
    'get him checked out', 'Check it.', 'Look at him.',
])
def test_vague_check_requires_scope_choice_and_cannot_be_directly_confirmed(client, goal):
    assert ambiguous_check_goal(goal)
    r = review(data(goal=goal))
    assert not r['ready'] and any(q['field'] == 'expected_outcome' for q in r['questions'])
    response = client.post('/api/incidents', json={**REPORT, 'expected_outcome': goal, 'goal_confirmed': True})
    assert response.status_code == 422, response.text
    assert client.get('/api/incidents').json() == []


@pytest.mark.parametrize('goal', [CLEAR, 'Someone to check the dog',
    'Please check on the dog and report back.',
    'Please check him out from a safe distance and report back.',
    'Please have a veterinary professional check him out on site.',
    'Arrange safe pickup and transport to a vet for assessment.',
])
def test_specific_existing_goals_remain_compatible(goal):
    assert not ambiguous_check_goal(goal)
    assert review(data(goal=goal))['ready']


def test_model_goal_question_survives_nonempty_goal():
    d = data(goal=CLEAR)
    raw = rule_review(d)
    question = {'field': 'expected_outcome', 'question': 'What should the helper report back to you about?'}
    raw.update(understanding='Confirm the goal now.', questions=[question])
    r = validate_review(raw, d)
    assert r['questions'] == [question] and not r['ready']
    assert r['goal_clarification']['kind'] == 'model'
    assert 'Confirm the goal now' not in r['understanding']


def test_model_goal_question_has_priority_over_optional_questions():
    d = data(goal=CLEAR)
    d['report'].update(location='', animal_type='', summary='There is an animal here.')
    raw = rule_review(d)
    raw['questions'] = [{'field': 'situation', 'question': f'Additional situation detail {i}?'} for i in range(3)] + [
        {'field': 'expected_outcome', 'question': 'What should the helper report back about?'}]
    r = validate_review(raw, d)
    assert any(q['field'] == 'expected_outcome' for q in r['questions'])
    assert len(r['questions']) <= 4 and not r['ready']


@pytest.mark.parametrize('goal', [VAGUE, CLEAR])
def test_model_cannot_ignore_revision_or_copy_feedback_into_goal(goal):
    d = data('yeah this can be improved', goal=goal)
    raw = rule_review(d)
    raw.update(expected_outcome='yeah this can be improved', outcome_quote='yeah this can be improved', questions=[])
    r = validate_review(raw, d)
    assert not r['ready'] and r['expected_outcome'] == goal
    assert r['questions'] and r['goal_clarification']


@pytest.mark.parametrize('text', [None, 'yes', 'yeah', 'okay', 'I am still nearby.', 'It is not my dog.', 'not sure yet'])
def test_pending_revision_survives_review_and_non_answers(text):
    first = review(data('yeah this can be improved', goal=CLEAR))
    d = follow(first, text)
    # Even a model dropping its question cannot make this pending draft ready.
    raw = rule_review(d); raw['questions'] = []
    r = validate_review(raw, d)
    assert not r['ready'] and r['expected_outcome'] == CLEAR
    assert r['goal_clarification']


def test_pending_model_question_can_evolve_but_cannot_silently_disappear():
    d = data(goal=CLEAR); raw = rule_review(d)
    raw['questions'] = [{'field': 'expected_outcome', 'question': 'What should the helper report about?'}]
    first = validate_review(raw, d)
    d = follow(first, 'not sure'); raw = rule_review(d)
    revised = 'Should the helper report whether the animal is still at the location?'
    raw['questions'] = [{'field': 'expected_outcome', 'question': revised}]
    second = validate_review(raw, d)
    assert second['goal_clarification']['question'] == revised and not second['ready']
    d = follow(second); raw = rule_review(d); raw['questions'] = []
    third = validate_review(raw, d)
    assert third['goal_clarification']['question'] == revised and not third['ready']


@pytest.mark.parametrize('text, index', [
    ('first option', 0), ('the first one', 0), ('1', 0), ('observation only', 0),
    ('second option', 1), ('the second one', 1), ('on-site vet', 1), ('a vet should come here', 1),
    ('third option', 2), ('option 3', 2), ('transport to a vet', 2),
])
def test_explicit_contextual_choice_resolves_vague_goal(text, index):
    first = review(data())
    r = review(follow(first, text))
    assert r['expected_outcome'] == GOAL_CHOICES[index]['reply']
    assert r['ready'] and r['goal_clarification'] is None
    if index == 0:
        assert observation_only(r['expected_outcome'])
    elif index == 1:
        assert assessment_only(r['expected_outcome'])


@pytest.mark.parametrize('text', ['yes', 'not the first option', 'not an on-site vet', 'a vet', 'maybe', 'he looks sick'])
def test_non_choices_do_not_guess_a_service(text):
    first = review(data())
    r = review(follow(first, text))
    assert not r['ready'] and r['expected_outcome'] == VAGUE


def test_not_sure_gets_a_different_question_without_guessing():
    first = review(data()); r = review(follow(first, 'not sure'))
    assert r['questions'][0]['question'] == UNCERTAIN_QUESTION
    assert r['questions'][0]['question'] != first['questions'][0]['question']
    assert not r['ready'] and r['expected_outcome'] == VAGUE


def test_manual_form_edit_overrides_old_context_and_history():
    first = review(data('this can be improved', goal=CLEAR))
    d = follow(first)
    d['report']['expected_outcome'] = GOAL_CHOICES[1]['reply']
    d['messages'] = [{'role': 'user', 'text': 'this can be improved'}]
    r = review(d)
    assert r['ready'] and r['expected_outcome'] == GOAL_CHOICES[1]['reply']
    assert r['goal_clarification'] is None


def test_explicit_new_request_clears_pending_revision():
    first = review(data('this can be improved', goal=CLEAR))
    r = review(follow(first, 'I want transport to a vet.'))
    assert r['ready'] and r['expected_outcome'] == 'I want transport to a vet.'


@pytest.mark.parametrize('text', ['Keep the original goal.', CLEAR])
def test_explicit_reaffirmation_can_close_revision_of_a_clear_goal(text):
    first = review(data('this can be improved', goal=CLEAR))
    r = review(follow(first, text))
    assert r['ready'] and r['expected_outcome'] == CLEAR


def test_keep_original_cannot_clear_inherently_ambiguous_scope():
    first = review(data('this can be improved'))
    r = review(follow(first, 'Keep the original goal.'))
    assert not r['ready'] and r['expected_outcome'] == VAGUE


def test_missing_goal_accepts_clear_short_answer_in_question_context():
    first = review(data(goal=''))
    assert not first['ready'] and first['goal_clarification']['kind'] == 'missing'
    r = review(follow(first, 'on-site vet'))
    assert r['ready'] and assessment_only(r['expected_outcome'])


def test_conditional_goal_is_one_choice_and_ordinals_without_a_menu_cannot_narrow_it():
    first = review(data(goal='Please assess the dog, and take it to a vet only if the assessment finds it necessary.'))
    assert conditional_transport(first['expected_outcome']) and first['ready']
    assert len(first['goal_choices']) == 1
    for reply in ['the first one', 'second option', 'assessment first']:
        r = review(follow(first, reply))
        assert r['ready'] and r['expected_outcome'] == first['expected_outcome']
    r = review(follow(first, 'assessment only; no transport yet'))
    assert r['ready'] and assessment_only(r['expected_outcome'])


def test_model_path_preserves_goal_question_and_prompt_teaches_revision(monkeypatch):
    c = Coordinator(); c.enabled = True
    d = data(goal=CLEAR)
    async def model(phase, instruction, payload):
        assert 'this can be improved' in instruction
        assert 'DRAFT' in instruction and 'goal_clarification' in instruction
        raw = rule_review(payload)
        raw['questions'] = [{'field': 'expected_outcome', 'question': 'What outcome do you want the helper to report?'}]
        raw['goal_assessment'] = {'status': 'needs_clarification', 'source': 'explicit',
            'source_quotes': [CLEAR], 'matches_report': True, 'within_scope': True,
            'preserves_constraints': True, 'rationale': 'The requested report-back detail still needs clarification.'}
        return raw
    monkeypatch.setattr(c, '_json', model)
    r = asyncio.run(c.review_intake(d))
    assert r['_meta']['engine'] == 'llm' and not r['ready']


def test_timeout_fallback_still_reopens_revision(monkeypatch):
    c = Coordinator(); c.enabled = True
    async def timeout(*args):
        raise PlannerUnavailable('Fixture timeout.')
    monkeypatch.setattr(c, '_json', timeout)
    r = asyncio.run(c.review_intake(data('yeah this can be improved', goal=CLEAR)))
    assert not r['ready'] and r['_meta']['engine'] == 'rules'
    assert 'Fixture timeout' in r['_meta']['fallback_reason']


def test_oversized_or_invalid_clarification_is_rejected_without_side_effects(client):
    d = data(); d['goal_clarification'] = {'kind': 'confirmed', 'goal': VAGUE, 'question': 'x' * 401}
    assert client.post('/api/intake/review', json=d).status_code == 422
    assert client.get('/api/incidents').json() == []
