"""v5 inquiry/approval, comparison, prices, intake and persona regressions.
All calls and model replies are simulated fixtures. No paid provider requests.
"""
import asyncio
import copy
import json
import time
import pytest
import app as relay
import calling
from coordinator import Coordinator, build_coverage
from intake import rule_review, validate_review
from pricing import CostQuote, extract_quote, quote_from_text, cost_summary, check_callback_price
from test_adaptive import REPORT, incident, wait
from test_rescue_flow import edit, execute, wait_start

CAPS = ['safe_containment', 'transport', 'receiving_care']

def comparison(client, **report_changes):
    edit(client,'biz_street_team',name='A Full Rescue Team',capabilities=CAPS,simulation={'response':'agrees','eta_minutes':10,'quote_status':'fixed','quote_amount':3000,'quote_currency':'USD','quote_scope':'all offered tasks'})
    edit(client,'biz_paws',name='B Alternative Rescue Team',capabilities=CAPS,simulation={'response':'agrees','eta_minutes':30,'quote_status':'fixed','quote_amount':1500,'quote_currency':'USD','quote_scope':'all offered tasks'})
    ident=incident(client,**report_changes)
    r=client.post(f'/api/incidents/{ident}/coordinate',json={})
    assert r.status_code==202,r.text
    return wait(client,r.json()['run_id'])

def more(client,run):
    r=client.post(f"/api/runs/{run['id']}/continue",json={'plan_token':run['plan_token']})
    assert r.status_code==202,r.text
    return wait(client,run['id'])

def choose(client,run,cid='biz_paws'):
    r=client.post(f"/api/runs/{run['id']}/selection",json={'plan_token':run['plan_token'],'assignments':{n['id']:cid for n in run['plan']['requirements']}})
    assert r.status_code==200,r.text
    return client.get(f"/api/runs/{run['id']}").json()

def test_intake_is_read_only_and_does_not_guess_rescue_goal(client):
    r=client.post('/api/intake/review',json={'report':{'summary':'An injured dog is beside the blue shop.','location':'Blue shop on Example Road'},'messages':[]})
    assert r.status_code==200,r.text
    review=r.json()
    assert not review['ready'] and review['animal_type']=='dog'
    assert 'expected_outcome' in {q['field'] for q in review['questions']}
    assert review['_meta']['engine']=='rules'
    assert client.get('/api/incidents').json()==[]

def test_chat_fills_goal_but_still_needs_explicit_submit(client):
    r=client.post('/api/intake/review',json={'report':{'summary':'A dog is injured.','location':'Blue shop'},'messages':[{'role':'user','text':'I want safe pickup and transport to a vet for assessment.'}]})
    assert r.json()['ready'] and 'transport to a vet' in r.json()['expected_outcome']
    ident=incident(client,expected_outcome='',goal_confirmed=False)
    assert client.post(f'/api/incidents/{ident}/coordinate',json={}).status_code==422
    updated=client.patch(f'/api/incidents/{ident}/intake',json=REPORT)
    assert updated.status_code==200,updated.text
    assert client.get(f'/api/incidents/{ident}').json()['latest_run'] is None

def test_intake_unknown_animal_and_fabricated_address():
    data={'report':{'summary':'An animal is at Blue Shop.','location':'','animal_type':'','expected_outcome':'Just observe from a safe distance.'},'messages':[{'role':'user','text':'The animal type is unknown.'}]}
    raw=rule_review(data)
    assert raw['animal_type']=='unknown'
    raw.update(location='Invented Street 99',location_quote='at Blue Shop')
    assert validate_review(raw,data)['location']==''

def test_one_full_offer_pauses_without_engaging_and_quote_counted_once(client):
    run=comparison(client)
    assert run['status']=='covered' and run['calls_made']==1
    assert run['actions']==[] and run['approval'] is None
    assert run['plan']['cost']['known_total']==3000
    assert run['plan']['cost']['selected_helpers']==1
    assert run['can_continue'] and run['eligible_uncalled_count']==1
    words=' '.join(t['text'] for t in run['calls'][0]['evidence']['transcript'])
    assert 'not booking' in words and 'separate approval callback' in words
    assert run['plan']['engagement_status']=='not_requested'

def test_keep_going_preserves_offer_then_explicit_select_then_callback(client):
    first=comparison(client)
    next_run=more(client,first)
    assert next_run['id']==first['id'] and next_run['calls_made']==2
    assert len({c['business_id'] for c in next_run['calls']})==2
    assert next_run['calls'][1]['target_needs']==CAPS
    assert next_run['plan']['selection']==first['plan']['selection']
    assert next_run['plan']['cost']['known_total']==3000 and next_run['actions']==[]
    chosen=choose(client,next_run)
    assert chosen['plan']['cost']['known_total']==1500 and chosen['actions']==[]
    assert client.post(f"/api/runs/{chosen['id']}/start",json={'plan_token':first['plan_token'],'confirm_costs':True}).status_code==409
    assert client.post(f"/api/runs/{chosen['id']}/start",json={'plan_token':chosen['plan_token']}).status_code==422
    active=execute(client,chosen)
    assert active['status']=='active',active.get('error')
    assert [a['business_id'] for a in active['actions']]==['biz_paws']
    assert active['approval']['cost']['known_total']==1500
    assert len(active['calls'])==2 and len(active['actions'])==1
    assert active['actions'][0]['analysis']['cost_quote']['amount']==1500
    assert not active['can_continue']

def test_budget_requires_specific_acknowledgment(client):
    run=comparison(client,budget_amount=2000,budget_currency='USD')
    assert run['plan']['cost']['over_budget']
    body={'plan_token':run['plan_token'],'confirm_costs':True}
    r=client.post(f"/api/runs/{run['id']}/start",json=body)
    assert r.status_code==422 and 'budget' in r.text
    assert client.post(f"/api/runs/{run['id']}/start",json={**body,'confirm_over_budget':True}).status_code==202
    assert wait_start(client,run['id'])['status']=='active'

@pytest.mark.parametrize('status,amount',[('fixed',3500),('unknown',None),('estimate',3000)])
def test_callback_changed_or_unconfirmed_price_never_engages(client,status,amount):
    run=comparison(client)
    patch={'quote_status':status,'quote_amount':amount}
    if status=='fixed':patch['start_quote_amount']=amount
    edit(client,'biz_street_team',simulation=patch)
    ended=execute(client,run)
    assert ended['status']=='attention'
    action=ended['actions'][0]
    assert action['status']!='confirmed'
    assert not action['analysis']['price_approved']
    words=' '.join(t['text'] for t in action['evidence']['transcript'])
    assert 'Please do not begin' in words
    assert 'agree to start these tasks' not in words

def test_unknown_initial_quote_is_not_free_or_permission_to_spend(client):
    run=comparison(client)
    # A fresh run with an unknown quote, not a mutation of saved evidence.
    edit(client,'biz_street_team',simulation={'quote_status':'unknown','quote_amount':None})
    ident=incident(client)
    rid=client.post(f'/api/incidents/{ident}/coordinate',json={}).json()['run_id']
    run=wait(client,rid)
    assert run['plan']['cost']['unknown_count']==1
    assert not run['plan']['cost']['all_prices_known']
    edit(client,'biz_street_team',simulation={'start_quote_amount':500})
    ended=execute(client,run)
    assert ended['status']=='attention' and ended['actions'][0]['analysis']['cost_quote']['amount']==500

def test_no_answer_alternative_does_not_destroy_previous_offer(client):
    run=comparison(client)
    edit(client,'biz_paws',simulation={'response':'no_answer'})
    next_run=more(client,run)
    assert next_run['status']=='covered' and next_run['plan']['selection']==run['plan']['selection']
    assert next_run['calls_made']==2 and not next_run['can_continue']

def test_continuation_limit_and_double_click_are_safe(client,monkeypatch):
    run=comparison(client)
    monkeypatch.setattr(calling,'MOCK_DELAY_SECONDS',.15)
    first=client.post(f"/api/runs/{run['id']}/continue",json={'plan_token':run['plan_token']})
    assert first.status_code==202
    duplicate=client.post(f"/api/runs/{run['id']}/continue",json={'plan_token':run['plan_token']})
    assert duplicate.status_code==409
    done=wait(client,run['id'])
    assert done['calls_made']==2
    assert client.post(f"/api/runs/{done['id']}/continue",json={'plan_token':done['plan_token']}).status_code==409

def test_total_contact_limit_applies_across_comparisons(client,monkeypatch):
    monkeypatch.setattr(relay,'MAX_CONTACTS',1)
    run=comparison(client)
    assert not run['can_continue']
    assert client.post(f"/api/runs/{run['id']}/continue",json={'plan_token':run['plan_token']}).status_code==409

def test_invalid_assignment_never_becomes_a_plan(client):
    run=comparison(client)
    r=client.post(f"/api/runs/{run['id']}/selection",json={'plan_token':run['plan_token'],'assignments':{n['id']:'biz_neighbor' for n in run['plan']['requirements']}})
    assert r.status_code==422,r.text

def test_species_restriction_is_not_silently_ignored(client):
    edit(client,'biz_street_team',capabilities=CAPS,simulation={'allowed_animals':['cat'],'behavior':'We only rescue cats, not dogs.','eta_minutes':1})
    ident=incident(client)
    rid=client.post(f'/api/incidents/{ident}/coordinate',json={}).json()['run_id']
    run=wait(client,rid)
    call=next(c for c in run['calls'] if c['business_id']=='biz_street_team')
    assert call['evidence']['simulation_profile']['species_compatible'] is False
    assert not any(a['status']=='committed' for a in call['analysis']['assessments'])

def test_model_mock_gets_persona_and_generates_transcript(client,monkeypatch):
    data_seen=[]
    async def fixture(phase,instruction,data):
        assert phase=='conversation simulation'
        data_seen.append(data)
        raw=copy.deepcopy(data['reference_script'])
        raw['transcript'].append({'speaker':'recipient','text':'Thank you for checking our availability first.'})
        return raw
    monkeypatch.setattr(relay.planner,'enabled',True)
    monkeypatch.setattr(relay.planner,'_json',fixture)
    contact={'id':'test','name':'Kind Team','description':'Trained transport team','capabilities':['transport'],'simulation':{'behavior':'Friendly, concise, only dogs.','allowed_animals':['dog'],'quote_status':'fixed','quote_amount':700,'quote_currency':'PKR'}}
    definition={'goal':'Transport to a vet','requirements':[{'id':'transport','label':'Transport','reason':'Needs a ride'}]}
    _,ev=asyncio.run(calling.mock_call(REPORT,contact,definition,build_coverage(definition,[]),coordinator=relay.planner))
    assert ev['generation']['engine']=='llm' and ev['simulated']
    assert data_seen[0]['contact_profile']['behavior']=='Friendly, concise, only dogs.'
    assert ev['transcript'][-1]['text'].startswith('Thank you for checking')

def test_live_inquiry_does_not_include_mock_responses():
    contact={'id':'x','name':'Trusted Team','description':'Trained team','phone':'+12025550198','simulation':{'behavior':'SECRET MOCK SCRIPT','quote_amount':123456}}
    definition={'goal':'Arrange transport','requirements':[{'id':'transport','label':'Transport','reason':'Ride'}]}
    task=calling.call_task(REPORT,contact,definition,build_coverage(definition,[]))
    assert 'SECRET MOCK SCRIPT' not in task and '123456' not in task
    assert 'please do not start work or travel' in task
    assert 'total price' in task

@pytest.mark.parametrize('text,status,amount',[
    ('I am free now.','unknown',None),('We have not confirmed a price. Please do not assume it is free of charge.','unknown',None),
    ('Our tasks are free of charge.','free',0),('This is not free of charge.','unknown',None),
    ('Our total price is 3,000 rupees for all tasks.','fixed',3000),
    ('Our estimate is PKR 2,000 plus fuel charges.','estimate',2000),
    ('Our total fee is PKR 3,000. No extra charges for that scope.','fixed',3000),
    ('PKR 2,000–3,000 depending on distance.','estimate',2000),
])
def test_price_extraction_is_explicit(text,status,amount):
    quote=quote_from_text(text)
    assert quote['status']==status and quote['amount']==amount

def test_price_evidence_only_recipient_and_latest_withdrawal():
    ev={'transcript':[{'speaker':'bot','text':'It costs PKR 9,000.'},{'speaker':'user','text':'Our total fee is PKR 3,000.'}]}
    assert extract_quote(ev)['amount']==3000
    ev['transcript'].append({'speaker':'user','text':'Additional fees for fuel may apply.'})
    assert extract_quote(ev)['status']=='estimate'
    ev['transcript'].append({'speaker':'user','text':'The quote is withdrawn.'})
    assert extract_quote(ev)['status']=='unknown'
    assert extract_quote(ev,False)['status']=='unknown'

def test_bundle_total_counts_each_helper_once_and_no_currency_conversion():
    q=CostQuote(status='fixed',amount=3000,currency='PKR').model_dump()
    needs=[{'assignment':{'contact_id':'a','quote':q}} for _ in range(3)]
    assert cost_summary(needs,currency='PKR')['known_total']==3000
    needs.append({'assignment':{'contact_id':'b','quote':{**q,'currency':'INR','amount':1000}}})
    costs=cost_summary(needs,budget=4000,currency='PKR')
    assert not costs['budget_comparable'] and costs['totals']=={'PKR':3000,'INR':1000}


def test_observation_only_does_not_add_capture_even_for_trapped_animal(client):
    result=asyncio.run(relay.planner.define({**REPORT,'summary':'A dog is trapped down a drain.','expected_outcome':'Just observe the animal from a safe distance; do not attempt capture.'}))
    assert [n['id'] for n in result['requirements']]==['scene_observation']

def test_containment_goal_does_not_invent_a_clinic_trip(client):
    result=asyncio.run(relay.planner.define({**REPORT,'expected_outcome':'Get the dog out of danger and into a safe place nearby.'}))
    assert [n['id'] for n in result['requirements']]==['safe_containment']

def test_generated_price_cannot_override_mock_controls(client,monkeypatch):
    script={'transcript':[{'speaker':'assistant','text':'What can your team offer and what is the price?'},{'speaker':'recipient','text':'We can transport the dog. Our total fee is PKR 3,000 for all offered tasks.'}]}
    async def wrong(*args):
        return {'transcript':[{'speaker':'recipient','text':'Our total fee is PKR 300 for all offered tasks.'}]}
    monkeypatch.setattr(relay.planner,'enabled',True)
    monkeypatch.setattr(relay.planner,'_json',wrong)
    result=asyncio.run(relay.planner.simulate({},script))
    assert result['_meta']['engine']!='llm'
    assert extract_quote(result)['amount']==3000
