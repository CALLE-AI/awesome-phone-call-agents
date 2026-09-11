"""v5.3 regressions: completed mock dialogue, honest candidate inventory, safe pauses.

All model/provider outputs here are local fixtures. No live inference or calls.
"""
import asyncio
from contextlib import closing
import copy
import hashlib
import json
import pytest
import app as relay
import calling
from conversation_input import resolve_input_mode, completion_state
from contact_candidates import candidate_inventory
from coordinator import Coordinator, PlannerUnavailable, build_coverage
from test_adaptive import REPORT, incident, wait
from test_rescue_flow import edit
from test_v5 import comparison, more

@pytest.fixture(autouse=True)
def fast_practice_calls(monkeypatch):
    # Test semantics, not the cosmetic practice delay. Browser checks use latency.
    monkeypatch.setattr(calling, 'MOCK_DELAY_SECONDS', .001)


NEED = {'id': 'scene_observation', 'label': 'Someone to check on the animal', 'reason': 'Reporter requested a safe scene check.'}
GOAL = 'Someone to check on the dog from a safe distance.'
DEFINITION = {'goal': GOAL, 'requirements': [NEED], 'uncertainties': []}
CASE = {**REPORT, 'expected_outcome': GOAL, 'animal_type': 'dog'}
GREETING = 'yeah who is it. what do you want?'


def mock_contact(**settings):
    return {'id': 'helper_1', 'name': 'Neighborhood Support', 'description': 'Can observe from a safe distance.',
            'capabilities': ['scene_observation'], 'simulation': settings}


def inquiry(contact=None, coordinator=None):
    return asyncio.run(calling.mock_call(CASE, contact or mock_contact(), DEFINITION,
                                       build_coverage(DEFINITION, []), coordinator=coordinator))[1]


def start(client):
    ident = incident(client, expected_outcome=GOAL)
    response = client.post(f'/api/incidents/{ident}/coordinate', json={})
    assert response.status_code == 202, response.text
    return wait(client, response.json()['run_id'])


def test_legacy_opening_continues_instead_of_ending_call(client):
    edit(client, 'biz_neighbor', simulation={'transcript': 'Contact: '+GREETING})
    run = start(client)
    assert run['status'] == 'covered' and run['calls_made'] == 1
    call = run['calls'][0]
    assert call['business_id'] == 'biz_neighbor'
    assert call['evidence']['transcript'][0]['text'] == GREETING
    assert len(call['evidence']['transcript']) > 5
    assert call['evidence']['conversation_state'] == 'complete'
    assert call['evidence']['generation']['continued_from_opening']
    assert call['analysis']['recipient_confirmed'] == 'yes'
    assert run['plan']['selection'] == {'scene_observation': 'biz_neighbor'}
    assert run['actions'] == [] and not run['approved_at']


@pytest.mark.parametrize('mode', ['auto', 'opening'])
def test_greeting_is_prefix_and_never_bypasses_price_controls(mode):
    evidence = inquiry(mock_contact(transcript=GREETING, transcript_mode=mode, quote_status='fixed', quote_amount=3000))
    assert evidence['transcript'][0]['text'] == GREETING
    assert evidence['generation']['input_mode'] == 'opening'
    assert not evidence['simulation_profile']['custom_transcript']
    from pricing import extract_quote
    assert extract_quote(evidence)['amount'] == 3000


def test_exact_greeting_remains_incomplete_evidence_with_explanation():
    evidence = inquiry(mock_contact(transcript=GREETING, transcript_mode='exact'))
    assert len(evidence['transcript']) == 1
    assert evidence['conversation_state'] == 'incomplete'
    assert 'incomplete evidence' in evidence['completion_note']
    assert not evidence['generation']['continued_from_opening']
    assert evidence['structured_result']['recipient_confirmed'] != 'yes'


@pytest.mark.parametrize('mode', ['auto', 'opening', 'exact'])
@pytest.mark.parametrize('text', ["No thanks, do not call me.", "Wrong number. Goodbye.", "We cannot help with this rescue today."])
def test_opening_does_not_continue_past_refusal(mode, text):
    evidence = inquiry(mock_contact(transcript=text, transcript_mode=mode))
    assert len(evidence['transcript']) == 1
    assert evidence['generation']['input_mode'] == 'exact'
    assert not evidence['generation']['continued_from_opening']


def test_no_answer_control_prevents_an_opening_becoming_an_answer():
    evidence = inquiry(mock_contact(transcript=GREETING, response='no_answer'))
    assert evidence['transcript'] == []
    assert evidence['conversation_state'] == 'no_answer'


def test_auto_opening_keeps_animal_and_capability_restrictions():
    evidence = inquiry(mock_contact(transcript=GREETING, allowed_animals=['cat']))
    assert evidence['simulation_profile']['response'] == 'declines'
    assert not evidence['simulation_profile']['species_compatible']
    assert 'cannot help' in ' '.join(t['text'] for t in evidence['transcript'])
    assert not any(a['status'] == 'committed' for a in evidence['structured_result']['assessments'])


def test_auto_preserves_substantive_exact_script():
    text = 'Contact: Yes, this is Neighborhood Support.\nContact: We can observe the dog from a safe distance.\nContact: The total fee is PKR 700.'
    evidence = inquiry(mock_contact(transcript=text))
    assert evidence['generation']['input_mode'] == 'exact'
    assert evidence['transcript'] == calling.parse_transcript(text, 'Neighborhood Support')


def test_legacy_callback_vague_yes_is_not_automatically_expanded():
    contact = mock_contact(start_transcript='Contact: Yes, this is Neighborhood Support.\nContact: Yes.')
    profile = calling.profile_for(contact, CASE)
    assert profile['start_transcript_mode'] == 'exact'
    _, evidence = asyncio.run(calling.mock_call(CASE, contact, DEFINITION, build_coverage(DEFINITION, []), start=True, assignments=[]))
    assert len(evidence['transcript']) == 2
    assert evidence['conversation_state'] == 'incomplete'


@pytest.mark.parametrize('raw', [
    {'transcript': [{'speaker': 'recipient', 'text': 'Who are you?'}]},
    {'transcript': [{'speaker': 'assistant', 'text': 'Hello.'}, {'speaker': 'recipient', 'text': 'Yes, speaking.'}]},
])
def test_truncated_generated_dialogue_falls_back_to_completed_script(client, monkeypatch, raw):
    async def truncated(*args): return raw
    monkeypatch.setattr(relay.planner, 'enabled', True)
    monkeypatch.setattr(relay.planner, '_json', truncated)
    evidence = inquiry(coordinator=relay.planner)
    assert evidence['generation']['engine'] == 'rules'
    assert evidence['generation']['fallback_reason']
    assert evidence['conversation_state'] == 'complete'
    assert len(evidence['transcript']) > 5


def test_model_continuation_preserves_opening_and_is_not_replayed_as_exact(client, monkeypatch):
    seen = []
    async def generated(phase, instruction, data):
        seen.append(data)
        assert data['opening_transcript'][0]['text'] == GREETING
        return copy.deepcopy(data['reference_script'])
    monkeypatch.setattr(relay.planner, 'enabled', True)
    monkeypatch.setattr(relay.planner, '_json', generated)
    evidence = inquiry(mock_contact(transcript=GREETING), relay.planner)
    assert seen and evidence['generation']['engine'] == 'llm'
    assert evidence['generation']['continued_from_opening']
    assert evidence['conversation_state'] == 'complete'


def test_changed_opening_is_rejected_by_generation_validator(client, monkeypatch):
    async def changed(phase, instruction, data):
        result = copy.deepcopy(data['reference_script'])
        result['transcript'][0]['text'] = 'An invented initial reply.'
        return result
    monkeypatch.setattr(relay.planner, 'enabled', True)
    monkeypatch.setattr(relay.planner, '_json', changed)
    evidence = inquiry(mock_contact(transcript=GREETING), relay.planner)
    assert evidence['generation']['engine'] == 'rules'
    assert evidence['transcript'][0]['text'] == GREETING


def test_model_required_truncation_stops_without_fake_evidence(client, monkeypatch):
    async def truncated(*args): return {'transcript': [{'speaker':'recipient','text':'Hello?'}]}
    monkeypatch.setattr(relay.planner, 'enabled', True)
    monkeypatch.setattr(relay.planner, 'required', True)
    monkeypatch.setattr(relay.planner, '_json', truncated)
    with pytest.raises(PlannerUnavailable):
        inquiry(coordinator=relay.planner)


def test_null_model_selection_cannot_hide_a_remaining_match(client, monkeypatch):
    async def no_contact(*args): return {'contact_id': None, 'reason': 'No contacts remain.'}
    monkeypatch.setattr(relay.planner, 'enabled', True)
    monkeypatch.setattr(relay.planner, '_json', no_contact)
    result = asyncio.run(relay.planner.choose(CASE, DEFINITION, build_coverage(DEFINITION, []), [mock_contact()], []))
    assert result['contact_id'] == 'helper_1'
    assert result['selection_adjusted']
    assert 'directory ranking' in result['reason']


def test_remaining_clinic_is_visible_as_unmatched_not_nonexistent(client):
    run = start(client)
    assert run['calls_made'] == 1
    assert run['eligible_uncalled_count'] == 0
    assert run['uncalled_count'] == run['unmatched_uncalled_count'] == 2
    assert run['continue_blocked_code'] == 'no_capability_match'
    assert run['can_check_unmatched']
    by_id = {c['contact_id']: c for c in run['contact_availability']}
    assert by_id['biz_paws']['status'] == 'no_capability_match'
    assert by_id['biz_neighbor']['status'] == 'already_contacted'
    assert 'phone' not in json.dumps(run['contact_availability']).lower()


def test_edit_existing_uncalled_rescuer_unlocks_keep_going_immediately(client):
    run = start(client)
    old_selection = run['plan']['selection']
    edit(client, 'biz_street_team', capabilities=['scene_observation'])
    updated = client.get(f"/api/runs/{run['id']}").json()
    assert updated['can_continue'] and updated['eligible_uncalled_count'] == 1
    assert updated['calls_made'] == 1 and updated['plan']['selection'] == old_selection
    after = more(client, updated)
    assert after['calls_made'] == 2 and after['status'] == 'covered'
    assert after['plan']['selection'] == old_selection and not after['actions']
    assert len(after['plan_options']) == 2


def test_true_exhaustion_explains_unapproved_and_archived_contacts(client):
    edit(client, 'biz_paws', consent_to_contact=False)
    assert client.delete('/api/businesses/biz_street_team').status_code in {200, 204}
    run = start(client)
    assert run['continue_blocked_code'] == 'no_contacts'
    assert run['uncalled_count'] == 0 and not run['can_check_unmatched']
    states = {i['contact_id']:i['status'] for i in run['contact_availability']}
    assert states['biz_paws'] == 'not_approved' and states['biz_street_team'] == 'inactive'


def test_explicit_suitability_check_requires_confirmation_and_does_not_invent_offer(client):
    run = start(client)
    body = {'plan_token': run['plan_token'], 'contact_id': 'biz_paws'}
    assert client.post(f"/api/runs/{run['id']}/continue", json=body).status_code == 422
    assert client.get(f"/api/runs/{run['id']}").json()['calls_made'] == 1
    body['confirm_unmatched'] = True
    response = client.post(f"/api/runs/{run['id']}/continue", json=body)
    assert response.status_code == 202, response.text
    after = wait(client, run['id'])
    assert after['calls_made'] == 2
    assert after['calls'][-1]['business_id'] == 'biz_paws'
    assert after['plan']['selection'] == run['plan']['selection']
    assert len(after['plan_options']) == 1 and not after['actions']


@pytest.mark.parametrize('contact_id', ['biz_neighbor','unknown_contact'])
def test_explicit_selection_cannot_redial_or_invent_contact(client, contact_id):
    run = start(client)
    r = client.post(f"/api/runs/{run['id']}/continue", json={'plan_token':run['plan_token'],'contact_id':contact_id,'confirm_unmatched':True})
    assert r.status_code == 409
    assert client.get(f"/api/runs/{run['id']}").json()['calls_made'] == 1


def test_explicit_selection_cannot_bypass_contact_approval(client):
    run = start(client)
    edit(client,'biz_paws',consent_to_contact=False)
    r = client.post(f"/api/runs/{run['id']}/continue", json={'plan_token':run['plan_token'],'contact_id':'biz_paws','confirm_unmatched':True})
    assert r.status_code == 409


def test_inventory_uses_original_phone_fingerprint_even_after_directory_edit():
    old_name, old_phone = 'Original Rescue', '+12025550111'
    calls = [{'business_id':'old','business_name_snapshot':old_name,
              'recipient_fingerprint':hashlib.sha256((old_name+'\0'+old_phone).encode()).hexdigest()}]
    contacts = [dict(mock_contact(),id='old',name='Changed Rescue',phone='+12025550112',active=True,consent_to_contact=True),
                dict(mock_contact(),id='duplicate',phone=old_phone,active=True,consent_to_contact=True)]
    inventory = candidate_inventory(contacts,calls,[NEED],'mock',is_fictional=relay.is_fictional_number)
    assert all(item['status']=='already_contacted' for item in inventory)


def test_inventory_prefers_matching_duplicate_over_unmatched_legacy_row():
    contacts = [dict(mock_contact(),id='unmatched',phone='+12025550111',capabilities=['receiving_care'],active=True,consent_to_contact=True),
                dict(mock_contact(),id='match',phone='+12025550111',active=True,consent_to_contact=True)]
    inventory = candidate_inventory(contacts,[],[NEED],'mock',is_fictional=relay.is_fictional_number)
    states={i['contact_id']:i['status'] for i in inventory}
    assert states == {'match':'eligible','unmatched':'duplicate_number'}


def test_inventory_excludes_fictional_numbers_in_live_mode():
    contacts=[dict(mock_contact(),phone='+12025550111',active=True,consent_to_contact=True)]
    assert candidate_inventory(contacts,[],[NEED],'live',is_fictional=relay.is_fictional_number)[0]['status']=='mock_only'


def test_saved_short_evidence_is_never_rewritten_when_mode_is_edited(client):
    edit(client,'biz_neighbor',simulation={'transcript':GREETING,'transcript_mode':'exact'})
    run=start(client)
    original=copy.deepcopy(run['calls'][0]['evidence'])
    edit(client,'biz_neighbor',simulation={'transcript':GREETING,'transcript_mode':'opening'})
    refreshed=client.get(f"/api/runs/{run['id']}").json()
    assert refreshed['calls_made']==run['calls_made']
    assert refreshed['calls'][0]['evidence']==original


def test_full_plan_pauses_until_keep_going_despite_more_matching_contacts(client):
    run=comparison(client)
    assert run['calls_made']==1 and run['can_continue'] and run['status']=='covered'
    selected=run['plan']['selection']
    # Refreshing is read-only and cannot restart the search.
    for _ in range(3):
        assert client.get(f"/api/runs/{run['id']}").json()['calls_made']==1
    after=more(client,run)
    assert after['calls_made']==2 and after['status']=='covered'
    assert after['plan']['selection']==selected and not after['actions']


def test_input_modes_are_validated_and_round_trip(client):
    c=client.get('/api/businesses').json()[0]
    body={k:c[k] for k in ['name','description','capabilities','consent_to_contact']}
    body['simulation']={'transcript_mode':'opening','transcript':GREETING,'start_transcript_mode':'exact'}
    response=client.patch('/api/businesses/'+c['id'],json=body)
    assert response.status_code==200,response.text
    saved=next(b for b in client.get('/api/businesses').json() if b['id']==c['id'])
    assert saved['simulation']['transcript_mode']=='opening'
    body['simulation']['transcript_mode']='invent-mode'
    assert client.patch('/api/businesses/'+c['id'],json=body).status_code==422


def test_live_call_task_never_contains_practice_opening_or_controls():
    c=mock_contact(transcript='SECRET_MOCK_OPENING',transcript_mode='opening',behavior='SECRET_MOCK_PERSONA')
    task=calling.call_task(CASE,c,DEFINITION,build_coverage(DEFINITION,[]))
    assert 'SECRET_MOCK' not in task and 'transcript_mode' not in task


def test_changed_saved_phone_does_not_mark_a_different_never_called_number_as_called():
    name, old, new = 'Original Rescue', '+12025550111', '+12025550112'
    calls=[{'business_id':'old','business_name_snapshot':name,
            'recipient_fingerprint':hashlib.sha256((name+'\0'+old).encode()).hexdigest()}]
    contacts=[dict(mock_contact(),id='old',phone=new,active=True,consent_to_contact=True),
              dict(mock_contact(),id='different',phone=new,active=True,consent_to_contact=True)]
    states={i['contact_id']:i['status'] for i in candidate_inventory(contacts,calls,[NEED],'mock',is_fictional=relay.is_fictional_number)}
    assert states=={'old':'already_contacted','different':'eligible'}


def test_generated_final_refusal_is_not_replaced_by_success_because_it_lacks_a_price(client,monkeypatch):
    async def refuses(*args):
        return {'transcript':[{'speaker':'assistant','text':'Hello, can you discuss this request?'},
            {'speaker':'recipient','text':'We cannot help with this rescue today. Please try someone else.'}]}
    monkeypatch.setattr(relay.planner,'enabled',True);monkeypatch.setattr(relay.planner,'_json',refuses)
    evidence=inquiry(mock_contact(quote_status='free'),relay.planner)
    assert evidence['generation']['engine']=='llm' and evidence['conversation_state']=='complete'
    assert len(evidence['transcript'])==2
    assert not any(a['status']=='committed' for a in evidence['structured_result']['assessments'])


@pytest.mark.parametrize('reply',[
    'We can help and all offered tasks are free of charge.',
    'Yes, this is Neighborhood Support. We can help and all offered tasks are free of charge.',
])
def test_identity_or_taskless_generated_offer_is_completed_by_backup(client,monkeypatch,reply):
    async def generic(*args):
        return {'transcript':[{'speaker':'assistant','text':'Hello, can you discuss this request?'},
                              {'speaker':'recipient','text':reply}]}
    monkeypatch.setattr(relay.planner,'enabled',True);monkeypatch.setattr(relay.planner,'_json',generic)
    evidence=inquiry(coordinator=relay.planner)
    assert evidence['generation']['engine']=='rules'
    assert evidence['structured_result']['recipient_confirmed']=='yes'
    assert any(a['status']=='committed' for a in evidence['structured_result']['assessments'])


def test_explicit_opening_can_continue_after_partial_limitation_not_whole_call_refusal():
    prefix='Contact: We cannot help with transport, but can discuss watching the dog.'
    evidence=inquiry(mock_contact(transcript=prefix,transcript_mode='opening'))
    assert evidence['generation']['continued_from_opening']
    assert len(evidence['transcript'])>5


@pytest.mark.parametrize('text',['No thanks, do not call me.','Wrong number. Goodbye.','No.'])
def test_explicit_terminal_reply_is_complete_refusal_not_a_missing_conversation(text):
    evidence=inquiry(mock_contact(transcript=text,transcript_mode='opening'))
    assert evidence['generation']['input_mode']=='exact'
    assert evidence['conversation_state']=='complete'


@pytest.mark.parametrize('name',['Central Veterinary Clinic','Free Transport Rescue'])
def test_auto_identity_greeting_does_not_mistake_contact_name_for_a_quote_or_offer(name):
    c=mock_contact(transcript=f'Contact: Yes, this is {name}. How can I help?')
    c['name']=name
    evidence=inquiry(c)
    assert evidence['generation']['continued_from_opening']
    assert evidence['transcript'][0]['text']==f'Yes, this is {name}. How can I help?'
    assert evidence['conversation_state']=='complete'
