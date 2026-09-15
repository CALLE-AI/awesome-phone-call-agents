"""v5.1 complete-plan choice and five user-reported regression cases.
All provider/model results are mock fixtures, not live calls or model inference.
"""
import asyncio
from contextlib import closing
import copy
import json
import pytest
import app as relay
from coordinator import build_coverage, rule_analysis
from goal_scope import observation_only
from plan_options import build_plan_options, plan_id
from intake import rule_review, validate_review
from test_adaptive import REPORT, incident, wait
from test_rescue_flow import edit, execute
from test_v5 import more

CAPS=['safe_containment','transport','receiving_care']
USER={**REPORT,'summary':'I think a dog is acting strange.','location':'Near Tariq Road, Karachi','expected_outcome':'Someone to check the dog'}


def start(client,report=REPORT):
    response=client.post('/api/incidents',json=report);assert response.status_code==201,response.text
    r=client.post(f"/api/incidents/{response.json()['id']}/coordinate",json={});assert r.status_code==202,r.text
    return wait(client,r.json()['run_id'])


def add(client,name,caps,price=1500,approved=True):
    r=client.post('/api/businesses',json={'name':name,'capabilities':caps,'consent_to_contact':approved,
        'simulation':{'quote_status':'fixed','quote_amount':price,'quote_currency':'USD','quote_scope':'All offered tasks','eta_minutes':15}})
    assert r.status_code==201,r.text
    return r.json()['id']


def select(client,run,option):
    r=client.post(f"/api/runs/{run['id']}/selection",json={'plan_token':run['plan_token'],'plan_id':option['id']})
    assert r.status_code==200,r.text
    return r.json()


def test_two_partial_offers_make_one_complete_plan(client):
    run=start(client)
    assert len(run['plan']['contact_offers'])==2 and run['calls_made']==2
    assert len(run['plan_options'])==1
    plan=run['plan_options'][0]
    assert plan['helpers_count']==2 and plan['capabilities_count']==3
    assert plan['complete'] and plan['selected']
    assert plan['assignments']=={'safe_containment':'biz_street_team','transport':'biz_street_team','receiving_care':'biz_paws'}
    assert run['actions']==[]


def test_two_responder_plan_and_solo_alternative_choose_only_solo(client):
    first=start(client)
    solo=add(client,'Solo Alternative',CAPS)
    run=more(client,first)
    assert len(run['plan_options'])==2
    assert run['selected_plan_id']==first['selected_plan_id']
    assert next(p for p in run['plan_options'] if p['selected'])['helpers_count']==2
    alternative=next(p for p in run['plan_options'] if p['helpers_count']==1)
    chosen=select(client,run,alternative)
    assert chosen['plan']['selection']=={n:solo for n in CAPS}
    assert chosen['plan']['cost']['known_total']==1500
    assert chosen['actions']==[]
    ended=execute(client,chosen)
    assert ended['status']=='active'
    assert [a['business_id'] for a in ended['actions']]==[solo]
    assert ended['approval']['plan_id']==alternative['id']


def test_solo_plan_and_later_split_plan_choose_both_assigned_responders(client):
    solo=add(client,'Complete team',CAPS,3000)
    first=start(client)
    assert first['calls_made']==1 and first['plan_options'][0]['helpers_count']==1
    partial=more(client,first)
    assert len(partial['plan_options'])==1  # a new partial offer is NOT Plan 2
    second=more(client,partial)
    assert len(second['plan_options'])==2
    assert second['selected_plan_id']==first['selected_plan_id']
    split=next(p for p in second['plan_options'] if p['helpers_count']==2)
    chosen=select(client,second,split)
    ended=execute(client,chosen)
    assert ended['status']=='active'
    assert {a['business_id'] for a in ended['actions']}=={'biz_street_team','biz_paws'}
    assert solo not in {a['business_id'] for a in ended['actions']}
    assigned=[n['id'] for a in ended['actions'] for n in a['assignments']]
    assert len(assigned)==len(set(assigned))==3
    assert ended['approval']['plan_id']==split['id']


def test_alternative_multi_responder_plan_can_share_one_responder(client):
    original=start(client)
    field=add(client,'Alternative field team',['safe_containment','transport'],600)
    compared=more(client,original)
    assert len(compared['plan_options'])==2
    alternative=next(p for p in compared['plan_options'] if field in p['assignments'].values())
    assert alternative['helpers_count']==2
    ended=execute(client,select(client,compared,alternative))
    assert {a['business_id'] for a in ended['actions']}=={field,'biz_paws'}
    assert len(ended['actions'])==2  # shared clinic gets one callback, not one per plan


def test_named_plan_must_match_exact_assignments_and_current_token(client):
    first=start(client);solo=add(client,'New solo',CAPS)
    later=more(client,first);plan=next(p for p in later['plan_options'] if p['helpers_count']==1)
    path=f"/api/runs/{later['id']}/selection"
    assert client.post(path,json={'plan_token':first['plan_token'],'plan_id':plan['id']}).status_code==409
    assert client.post(path,json={'plan_token':later['plan_token'],'plan_id':'plan_'+'0'*20}).status_code==422
    assert client.post(path,json={'plan_token':later['plan_token'],'plan_id':plan['id'],'assignments':first['plan']['selection']}).status_code==422
    assert client.get(f"/api/runs/{later['id']}").json()['actions']==[]


def test_plan_ids_and_labels_do_not_change_when_new_plan_added(client):
    first=start(client);add(client,'New full plan',CAPS)
    second=more(client,first)
    old=first['plan_options'][0]
    same=next(p for p in second['plan_options'] if p['id']==old['id'])
    assert same['label']==old['label'] and same['assignments']==old['assignments']


@pytest.mark.parametrize('goal',[
    'Someone to check the dog','Can somebody check on the dog?',
    'Please send someone to check on it and report back.',
    'Just observe from a safe distance; do not attempt capture.',
    'Check the animal, no need to transport it.',
    'No transport; someone checking on the dog.',
])
def test_check_goal_is_not_silently_expanded(client,goal):
    r=asyncio.run(relay.planner.define({**USER,'expected_outcome':goal}))
    assert [n['id'] for n in r['requirements']]==['scene_observation']


@pytest.mark.parametrize('goal',[
    'Check the dog and take it to a clinic.',
    'Safely rescue and transport it to a vet.',
    'Check the animal and move it to a safe place.',
])
def test_explicit_broader_goal_is_not_reduced_to_observation(goal):
    assert not observation_only(goal)


def test_chat_goal_is_grounded_and_visible_in_review_result(client):
    response=client.post('/api/intake/review',json={'report':{'summary':USER['summary'],'location':USER['location']},'messages':[{'role':'user','text':USER['expected_outcome']}],'new_reply':True})
    assert response.status_code==200,response.text
    assert response.json()['ready'] and response.json()['expected_outcome']=='Someone to check the dog'
    assert client.get('/api/incidents').json()==[]


def test_rejected_goal_does_not_invite_confirmation(client):
    data={'report':{'summary':USER['summary'],'location':USER['location']},'messages':[]}
    raw=rule_review(data);raw.update(understanding='Confirm your goal now.',expected_outcome='Take the dog to a clinic.',outcome_quote='Invented words',questions=[])
    result=validate_review(raw,data)
    assert not result['ready'] and not result['expected_outcome']
    assert 'Confirm your goal now' not in result['understanding']


def test_form_edits_override_old_chat_but_new_chat_can_correct(client):
    data={'report':{k:v for k,v in USER.items() if k in {'summary','location','expected_outcome','animal_type'}},'messages':[{'role':'user','text':'I want transport to a vet.'}]}
    assert client.post('/api/intake/review',json=data).json()['expected_outcome']==USER['expected_outcome']
    data['new_reply']=True
    assert client.post('/api/intake/review',json=data).json()['expected_outcome']=='I want transport to a vet.'


def test_exact_user_report_one_check_plan_no_unapproved_callbacks(client):
    run=start(client,USER)
    assert run['calls_made']==1 and run['plan_options'][0]['capabilities_count']==1
    assert run['plan']['selection']=={'scene_observation':'biz_neighbor'} and run['actions']==[]
    ended=execute(client,run)
    assert [a['business_id'] for a in ended['actions']]==['biz_neighbor']
    assert ended['actions'][0]['progress']=='ready'


def test_model_scope_violation_falls_back_or_pauses_without_calls(client,monkeypatch):
    async def wrong(*args):return {'goal':'Go to a clinic','requirements':[{'id':'transport','label':'Transport','reason':'Assumed need'}],'uncertainties':[]}
    monkeypatch.setattr(relay.planner,'enabled',True);monkeypatch.setattr(relay.planner,'_json',wrong)
    definition=asyncio.run(relay.planner.define(USER))
    assert definition['_meta']['engine']=='rules'
    assert [n['id'] for n in definition['requirements']]==['scene_observation']
    monkeypatch.setattr(relay.planner,'required',True)
    run=start(client,USER)
    assert run['status']=='failed' and run['calls']==[] and run['actions']==[]


def test_old_overbroad_plan_blocked_without_erasing_history(client):
    run=start(client)
    with closing(relay.connect()) as db:
        db.execute('UPDATE incidents SET expected_outcome=? WHERE id=?',(USER['expected_outcome'],run['incident_id']));db.commit()
    saved=client.get(f"/api/runs/{run['id']}").json()
    assert saved['scope_warning'] and not saved['can_approve'] and not saved['can_continue']
    assert client.post(f"/api/runs/{run['id']}/start",json={'plan_token':saved['plan_token'],'confirm_costs':True}).status_code==409
    assert client.get(f"/api/runs/{run['id']}").json()['calls']==saved['calls']


def test_exhaustion_is_distinct_from_processing_and_new_contact_enables_continue(client):
    run=start(client,USER)
    assert not run['can_continue'] and run['continue_blocked_code']=='no_capability_match'
    assert run['unmatched_uncalled_count']==2 and run['can_check_unmatched']
    cid=add(client,'Another observer',['scene_observation'],400,approved=False)
    assert not client.get(f"/api/runs/{run['id']}").json()['can_continue']
    edit(client,cid,consent_to_contact=True)
    updated=client.get(f"/api/runs/{run['id']}").json()
    assert updated['can_continue'] and updated['eligible_uncalled_count']==1
    assert updated['calls_made']==1 and updated['actions']==[]


def test_limit_reason_does_not_recommend_adding_contacts(client,monkeypatch):
    monkeypatch.setattr(relay,'MAX_CONTACTS',1);add(client,'Full',CAPS)
    run=start(client)
    assert run['continue_blocked_code']=='call_limit' and not run['can_continue']


def test_report_saved_before_slow_planning_and_version_identifies_patch(client,monkeypatch):
    assert client.get('/health').json()['version']=='5.6.0'
    assert client.get('/api/config').json()['version']=='5.6.0'
    original=relay.planner.define
    async def slow(i):await asyncio.sleep(.2);return await original(i)
    monkeypatch.setattr(relay.planner,'define',slow)
    ident=incident(client,**{k:v for k,v in USER.items() if k!='goal_confirmed'})
    assert client.get('/api/incidents').json()[0]['id']==ident
    response=client.post(f'/api/incidents/{ident}/coordinate',json={})
    assert client.get('/api/incidents').json()[0]['id']==ident
    assert client.get(f"/api/runs/{response.json()['run_id']}").json()['calls']==[]
    assert wait(client,response.json()['run_id'])['status']=='covered'


def fake_coverage(specs,selection=None):
    needs=[{'id':k,'label':k.replace('_',' '),'reason':'Requested'} for k in CAPS]
    definition={'goal':'A complete rescue','requirements':needs}
    calls=[]
    for cid,caps,amount in specs:
        calls.append({'id':'call_'+cid,'business_id':cid,'business_name':cid,'status':'completed','analysis':{
            'cost_quote':{'status':'fixed' if amount is not None else 'unknown','amount':amount,'currency':'USD','scope':'all offered tasks','terms':''},
            'assessments':[{'requirement_id':k,'status':'committed','action':k,'evidence_quote':'fixture','eta_minutes':10,'conditions':[]} for k in caps]}})
    return build_coverage(definition,calls,selection)


def test_plan_totals_count_bundles_once_and_distinguish_unknown():
    coverage=fake_coverage([('Full',CAPS,3000),('Field',CAPS[:2],1000),('Clinic',CAPS[2:],500)])
    options=build_plan_options(coverage)['options']
    assert len(options)==2
    assert sorted(p['cost']['known_total'] for p in options)==[1500,3000]
    unknown=build_plan_options(fake_coverage([('Field',CAPS[:2],1000),('Clinic',CAPS[2:],None)]))['options'][0]
    assert unknown['cost']['known_total']==1000 and unknown['cost']['unknown_count']==1


def test_redundant_callback_combinations_not_suggested_but_custom_selection_preserved():
    coverage=fake_coverage([('A',CAPS,3000),('B',CAPS,1500)])
    assert len(build_plan_options(coverage)['options'])==2  # no pointless A+B option
    custom={CAPS[0]:'A',CAPS[1]:'B',CAPS[2]:'B'}
    options=build_plan_options(fake_coverage([('A',CAPS,3000),('B',CAPS,1500)],custom))
    chosen=next(p for p in options['options'] if p['selected'])
    assert chosen['custom'] and chosen['assignments']==custom


def test_plan_enumeration_is_bounded_and_discloses_omissions():
    coverage=fake_coverage([(f'Team{i}',CAPS,1000+i) for i in range(50)])
    result=build_plan_options(coverage,max_options=5,max_states=20)
    assert result['options_limited'] and len(result['options'])<=6
    assert any(p['selected'] for p in result['options'])
