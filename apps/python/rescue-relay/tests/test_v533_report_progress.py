"""Review-report progress regressions. Model calls are fixtures; no telephony."""
from contextlib import closing
import copy

import pytest

import app as relay
from coordinator import Coordinator
from goal_dialogue import CHECK_QUESTION, GOAL_CHOICES, scope_menu_question
from intake import rule_review, validate_review
from rescue_intent import ambiguous_check_goal, goal_completion_reply, extract_goal

REPORT = {'summary': 'A dog has some problems with his genital area and keeps licking himself.',
          'location': 'Near Tariq Road, Karachi', 'animal_type': 'dog', 'expected_outcome': 'check him up'}
MENUS = [
    "When you say 'check him up', do you mean a welfare check (observation and report), an on-site veterinary assessment, or pickup and transport to a vet?",
    'Do you want a welfare check (observation and report), an on‑site veterinary assessment, or pickup and transport to a vet?',
    'Would you prefer transport to a vet, an on-site veterinary assessment, or a welfare check with observation and report?',
]


def data(reply=None, *, goal='check him up', context=None):
    return {'report': {**REPORT, 'expected_outcome': goal},
            'messages': [{'role': 'user', 'text': reply}] if reply is not None else [],
            'new_reply': reply is not None, 'goal_clarification': context}


def review(d, question=None):
    raw = rule_review(d)
    if question is not None:
        raw['questions'] = [{'field': 'expected_outcome', 'question': question}]
    return validate_review(raw, d)


def follow(r, reply=None):
    return data(reply, goal=r['expected_outcome'], context=r['goal_clarification'])


def no_calls(client):
    assert client.get('/api/incidents').json() == []
    with closing(relay.connect()) as db:
        assert db.execute('SELECT COUNT(*) FROM coordination_runs').fetchone()[0] == 0


@pytest.mark.parametrize('goal', ['check him up', 'Please check her up.', 'Can someone check up the dog?',
                                   'get him checked up', 'Check the dog up.'])
def test_vague_check_up_has_controls_and_cannot_be_directly_confirmed(client, goal):
    assert ambiguous_check_goal(goal)
    r = review(data(goal=goal))
    assert r['expected_outcome'] == goal and not r['ready']
    assert r['goal_clarification']['kind'] == 'scope'
    assert r['goal_choices'] == GOAL_CHOICES
    response = client.post('/api/incidents', json={**REPORT, 'expected_outcome': goal, 'goal_confirmed': True})
    assert response.status_code == 422, response.text
    no_calls(client)


@pytest.mark.parametrize('goal', ['check up on him', 'Please check him up from a safe distance and report back.',
    'Please have a vet check him up on site.', 'Arrange safe pickup and transport to a vet for assessment.'])
def test_specific_scopes_are_not_reopened_by_new_check_up_guard(goal):
    assert not ambiguous_check_goal(goal)
    assert review(data(goal=goal))['ready']


@pytest.mark.parametrize('text', ['that is it', "that's it", 'That’s it.', 'yes, that is it!',
                                  'that is all', "that's all", 'nothing else'])
def test_completion_words_end_optional_revision_of_clear_goal(text):
    assert goal_completion_reply(text)
    goal = GOAL_CHOICES[1]['reply']
    first = review(data('this can be improved', goal=goal))
    assert not first['ready']
    r = review(follow(first, text), MENUS[1])
    assert r['ready'] and r['expected_outcome'] == goal and not r['questions']


@pytest.mark.parametrize('goal', ['', 'check him up', 'check him out'])
def test_that_is_it_does_not_invent_an_answer_for_an_ambiguous_goal(goal):
    first = review(data(goal=goal))
    r = review(follow(first, 'that is it'))
    assert not r['ready'] and r['questions'] and r['goal_clarification']
    if r['goal_choices']:
        assert 'Choose one type of help' in r['understanding']


@pytest.mark.parametrize('text', ['yes', 'okay', 'it', 'that is it but please change the goal',
                                  'that is it if the vet says transport is needed'])
def test_non_completion_or_condition_is_not_a_completion_token(text):
    assert not goal_completion_reply(text)


@pytest.mark.parametrize('menu', MENUS)
@pytest.mark.parametrize('choice', GOAL_CHOICES)
def test_reworded_model_scope_menu_cannot_reopen_a_selected_scope(menu, choice):
    first = review(data(), menu)
    r = review(follow(first, choice['reply']), menu)
    assert r['ready'] and r['expected_outcome'] == choice['reply'] and not r['questions']
    assert r['goal_clarification'] is None


@pytest.mark.parametrize('menu', MENUS)
def test_saved_model_scope_menu_becomes_a_canonical_clickable_menu(menu):
    old = {'kind': 'model', 'goal': 'check him up', 'question': menu}
    d = data('that is it', context=old)
    before = copy.deepcopy(d)
    r = review(d, menu)
    assert r['goal_clarification'] == {'kind': 'scope', 'goal': 'check him up', 'question': CHECK_QUESTION}
    assert r['goal_choices'] == GOAL_CHOICES and not r['ready']
    assert d == before


def test_old_reordered_menu_does_not_assign_new_meaning_to_an_ordinal():
    # In this old menu the first option is transport, not observation. Require
    # a named answer or show the canonical menu before accepting an ordinal.
    d = data('first option', context={'kind': 'model', 'goal': 'check him up', 'question': MENUS[2]})
    r = review(d, MENUS[2])
    assert not r['ready'] and r['expected_outcome'] == 'check him up'
    assert r['goal_choices'] == GOAL_CHOICES
    next_result = review(follow(r, 'first option'), MENUS[2])
    assert next_result['ready'] and next_result['expected_outcome'] == GOAL_CHOICES[0]['reply']


@pytest.mark.parametrize('question', [
    'Which entrance should the on-site vet use to assess the animal?',
    'What should the helper report back about?',
    'Which entrance allows observation, an on-site vet, or transport to a clinic?',
])
def test_targeted_model_questions_remain_separate_from_broad_menu(question):
    assert not scope_menu_question(question)
    r = review(data(goal=GOAL_CHOICES[1]['reply']), question)
    assert not r['ready'] and r['questions'][0]['question'] == question


def test_missing_location_cannot_be_skipped_with_completion():
    d = data('that is it', goal=GOAL_CHOICES[1]['reply'])
    d['report'].update(location='', summary='A dog looks unwell.')
    r = review(d, MENUS[1])
    assert not r['ready'] and r['expected_outcome'] == GOAL_CHOICES[1]['reply']
    assert r['goal_clarification'] is None
    assert any(q['field'] == 'location' for q in r['questions'])
    assert not any(q['field'] == 'expected_outcome' for q in r['questions'])


def test_legacy_model_contract_is_rejected_and_fallback_preserves_explicit_choice(client, monkeypatch):
    coordinator = Coordinator(); coordinator.enabled = True
    invocations = []
    async def model(phase, instruction, payload):
        invocations.append(payload)
        raw = rule_review(payload)
        raw['questions'] = [{'field': 'expected_outcome', 'question': MENUS[(len(invocations)-1) % len(MENUS)]}]
        return raw
    monkeypatch.setattr(coordinator, '_json', model)
    monkeypatch.setattr(relay, 'planner', coordinator)
    def api(d):
        response = client.post('/api/intake/review', json=d)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result['_meta']['engine'] == 'rules'
        assert 'semantic goal assessment' in result['_meta']['fallback_reason']
        return result
    first = api(data())
    second = api(follow(first, 'that is it'))
    assert not second['ready'] and len(second['goal_choices']) == 3
    assert 'You do not need to add more description' in second['understanding']
    third = api(follow(second, 'on-site vet'))
    fourth = api(follow(third, 'that is it'))
    assert third['ready'] and fourth['ready']
    assert fourth['expected_outcome'] == GOAL_CHOICES[1]['reply']
    assert not fourth['questions']
    no_calls(client)


@pytest.mark.parametrize('restriction', ['no handling or transport.', 'no treatment.', 'no medication.'])
def test_scope_restrictions_survive_a_chat_goal_and_subsequent_review(restriction):
    goal = 'Arrange for someone to observe the animal and report back; ' + restriction
    assert extract_goal(goal) == goal
    first = review(data())
    r = review(follow(first, goal), MENUS[1])
    assert r['ready'] and r['expected_outcome'] == goal
    assert review(follow(r, 'that is it'))['expected_outcome'] == goal


@pytest.mark.parametrize('completion', [None, 'that is it', 'yes'])
def test_a_model_service_question_is_not_dropped_for_a_merely_nonempty_generic_goal(completion):
    first = review(data(goal='Please help this dog'), MENUS[1])
    assert not first['ready'] and first['goal_choices'] == GOAL_CHOICES
    assert first['goal_clarification']['kind'] == 'scope'
    r = review(follow(first, completion), MENUS[1])
    assert not r['ready'] and r['expected_outcome'] == 'Please help this dog'
    done = review(follow(r, 'on-site vet'), MENUS[1])
    assert done['ready'] and done['expected_outcome'] == GOAL_CHOICES[1]['reply']


@pytest.mark.parametrize('reply', [None, 'that is it'])
def test_restored_stale_model_menu_does_not_reopen_a_known_concrete_scope(reply):
    goal = GOAL_CHOICES[1]['reply']
    r = review(data(reply, goal=goal, context={'kind': 'model', 'goal': goal, 'question': MENUS[1]}), MENUS[1])
    assert r['ready'] and r['expected_outcome'] == goal
    assert not r['questions'] and r['goal_clarification'] is None
