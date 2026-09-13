"""Condition rechecks: explicit inquiries, immutable history, no automatic booking."""
import copy
from contextlib import closing
import json
import pytest
import app as relay
import calling
from coordinator import build_coverage
from test_adaptive import REPORT, wait
from test_rescue_flow import edit, execute
from test_v51_plans import start

GOAL = 'Arrange for someone to observe the animal from a safe distance and report back; no handling or transport.'
USER = {**REPORT, 'summary': 'A dog keeps licking his genital area.', 'location': 'Near Tariq Road, Karachi',
        'expected_outcome': GOAL, 'animal_type': 'dog'}


def conditional(client):
    edit(client, 'biz_neighbor', simulation={'response': 'conditional', 'conditions': 'supervisor confirms availability',
        'transcript': 'yeah who is it. what do you want?', 'transcript_mode': 'opening'})
    return start(client, USER)


def send(client, run, reply='saved', **changes):
    data={'plan_token':run['plan_token'], 'source_call_id':run['calls'][0]['id'],
          'confirm_followup':True, 'practice_reply':reply, **changes}
    return client.post(f"/api/runs/{run['id']}/follow-up", json=data)


def recheck(client, run, reply='saved', **changes):
    r=send(client,run,reply,**changes);assert r.status_code==202,r.text
    return wait(client,run['id'])


def test_exact_dead_end_recovers_without_new_contact_or_approval(client):
    first=conditional(client)
    for id in ['biz_street_team','biz_paws']:
        r=client.post(f"/api/runs/{first['id']}/continue",json={'plan_token':first['plan_token'],'contact_id':id,'confirm_unmatched':True})
        assert r.status_code==202,r.text
        first=wait(client,first['id'])
    assert first['continue_blocked_code']=='no_contacts'
    assert not first['can_approve'] and first['actions']==[]
    assert [c['contact_id'] for c in first['followup_options']]==['biz_neighbor']
    before=copy.deepcopy(first['calls'])
    original_profile=client.get('/api/businesses').json()
    after=recheck(client,first,'agrees')
    assert after['status']=='covered',after.get('error')
    assert after['can_approve'] and len(after['plan_options'])==1
    assert after['calls_made']==4 and after['actions']==[] and after['approval'] is None
    assert after['calls'][:3]==before
    assert client.get('/api/businesses').json()==original_profile
    assert len(after['plan']['contact_offers'])==3 # latest reply, no duplicate contact card
    assert after['plan']['requirements'][0]['assignment']['call_id']==after['calls'][-1]['id']
    assert after['plan_token']!=first['plan_token']
    evidence=after['calls'][-1]['evidence']
    assert evidence['offer_followup']['practice_reply']=='agrees'
    assert evidence['simulated']
    texts=' '.join(t['text'] for t in evidence['transcript'])
    assert 'follow-up about your earlier conditions' in texts
    assert 'not permission to start or travel' in texts
    active=execute(client,after)
    assert active['status']=='active'
    assert [a['business_id'] for a in active['actions']]==['biz_neighbor']
    assert active['calls_made']==4 # approval uses separate callback record


@pytest.mark.parametrize('reply',['saved','conditional','declines','no_answer'])
def test_pending_decline_no_answer_never_unlock_approval(client,reply):
    first=conditional(client);after=recheck(client,first,reply)
    assert after['status']=='partial',after.get('error')
    assert not after['can_approve'] and after['plan_options']==[] and after['actions']==[]
    assert after['calls_made']==2
    assert len(after['plan']['contact_offers'])==1
    if reply in {'saved','conditional'}:
        assert after['followup_options'][0]['call_id']==after['calls'][-1]['id']
    else:
        assert not after['followup_options']


def test_followup_requires_explicit_permission_and_current_source(client):
    first=conditional(client)
    assert send(client,first,confirm_followup=False).status_code==422
    assert send(client,first,source_call_id='unrelated').status_code==409
    after=recheck(client,first,'conditional')
    assert send(client,first).status_code==409 # stale token
    assert send(client,after).status_code==409 # stale source even with fresh token
    assert client.get(f"/api/runs/{first['id']}").json()['calls_made']==2


def test_ordinary_continue_still_never_redials(client):
    first=conditional(client)
    r=client.post(f"/api/runs/{first['id']}/continue",json={'plan_token':first['plan_token'],'contact_id':'biz_neighbor'})
    assert r.status_code==409
    assert client.get(f"/api/runs/{first['id']}").json()['calls_made']==1


@pytest.mark.parametrize('change',[{'consent_to_contact':False},{'phone':'+12025550199'}])
def test_revoked_or_changed_recipient_cannot_be_rechecked(client,change):
    first=conditional(client);edit(client,'biz_neighbor',**change)
    fresh=client.get(f"/api/runs/{first['id']}").json()
    assert not fresh['followup_options'] and send(client,fresh).status_code==409


def test_archived_contact_cannot_be_rechecked(client):
    first=conditional(client);client.delete('/api/businesses/biz_neighbor')
    assert send(client,first).status_code==409


def test_limit_applies_to_followups(client,monkeypatch):
    first=conditional(client);monkeypatch.setattr(relay,'MAX_CONTACTS',1)
    assert send(client,first).status_code==409
    assert not client.get(f"/api/runs/{first['id']}").json()['followup_options']


@pytest.mark.parametrize('state',['running','starting','failed','interrupted','active','completed'])
def test_unsafe_or_post_approval_states_block_recheck(client,state):
    first=conditional(client)
    with closing(relay.connect()) as db:
        db.execute('UPDATE coordination_runs SET status=? WHERE id=?',(state,first['id']));db.commit()
    assert send(client,first).status_code==409


def test_other_active_report_blocks_followup(client):
    first=conditional(client)
    with closing(relay.connect()) as db:
        db.execute("INSERT INTO incidents(id,summary,location,status,created_at) VALUES ('another','dog','road','new',?)",(relay.utc_now(),))
        db.execute("INSERT INTO coordination_runs(id,incident_id,mode,status,started_at) VALUES ('busy','another','mock','running',?)",(relay.utc_now(),));db.commit()
    assert send(client,first).status_code==409


def test_live_mode_rejects_fictional_result_override(client,monkeypatch):
    first=conditional(client);monkeypatch.setattr(relay,'CALL_MODE','live')
    r=send(client,first,'agrees',confirm_live=True)
    assert r.status_code==422 and 'Practice replies' in r.text


def test_mode_change_never_redials(client,monkeypatch):
    first=conditional(client);monkeypatch.setattr(relay,'CALL_MODE','live')
    monkeypatch.setattr(relay,'ENABLE_LIVE_CALLS',True);monkeypatch.setattr(relay,'CALLE_API_KEY','fixture')
    r=send(client,first,confirm_live=True)
    assert r.status_code==409


def test_paid_followup_gets_fresh_quote_not_earlier_free_quote(client):
    first=conditional(client)
    edit(client,'biz_neighbor',simulation={'quote_status':'fixed','quote_amount':1500,'quote_currency':'USD'})
    after=recheck(client,first,'agrees')
    assert after['plan']['cost']['known_total']==1500
    assert after['calls'][0]['analysis']['cost_quote']['status']=='free'
    assert after['actions']==[]


def test_latest_reply_replaces_entire_old_bundle_not_only_mentioned_tasks():
    needs={'requirements':[{'id':'scene_observation','label':'Observe','reason':''},{'id':'transport','label':'Transport','reason':''}]}
    quote={'status':'free','amount':0,'currency':'PKR'}
    def c(id,assessments):
        return {'id':id,'business_id':'helper','business_name':'Helper','status':'completed',
                'analysis':{'assessments':assessments,'cost_quote':quote}}
    def a(id,status='committed'):
        return {'requirement_id':id,'status':status,'eta_minutes':None,'conditions':[],'action':'Offer','evidence_quote':'Confirmed'}
    old=c('old',[a('scene_observation'),a('transport')])
    new=c('new',[a('scene_observation','declined')])
    plan=build_coverage(needs,[old,new])
    assert plan['covered_count']==0 and len(plan['contact_offers'])==1
    assert all(not n['offers'] for n in plan['requirements'])
    assert old['analysis']['assessments'][0]['status']=='committed'


def test_live_prompt_explicitly_asks_conditions_without_booking(client):
    first=conditional(client)
    contact=next(c for c in client.get('/api/businesses').json() if c['id']=='biz_neighbor')
    coverage={**first['plan'],'offer_followup':first['followup_options'][0]}
    task=calling.call_task(USER,contact,first['definition'],coverage)
    assert 'each earlier prerequisite is now resolved' in task
    assert 'not the requester authorizing work' in task
    assert 'supervisor confirms availability' in task
    assert 'Do not book or engage anyone' in task

@pytest.mark.parametrize('text,expected',[
    ('Our supervisor has confirmed availability.',True),
    ('Our earlier prerequisites are resolved.',True),
    ('Our supervisor has not confirmed availability.',False),
    ('We are still waiting for supervisor approval.',False),
    ('We can observe the dog.',False),
])
def test_condition_resolution_requires_explicit_evidence(text,expected):
    from offer_followup import rule_resolutions, validate_resolutions
    followup={'conditions':['supervisor confirms availability'],'requirement_ids':['scene_observation']}
    evidence={'transcript':[{'speaker':'recipient','text':text}]}
    result={'assessments':[{'requirement_id':'scene_observation','status':'committed','conditions':[]}],
            'condition_resolutions':rule_resolutions(evidence,followup),'validation_notes':[]}
    checked=validate_resolutions(result,evidence,followup)
    assert (checked['assessments'][0]['status']=='committed')==expected


def test_caller_claim_or_fabricated_model_resolution_does_not_clear_condition():
    from offer_followup import validate_resolutions
    followup={'conditions':['supervisor confirms availability'],'requirement_ids':['scene_observation']}
    evidence={'transcript':[{'speaker':'assistant','text':'The supervisor has approved.'},
                            {'speaker':'recipient','text':'I can observe the animal.'}]}
    result={'assessments':[{'requirement_id':'scene_observation','status':'committed','conditions':[]}],
            'condition_resolutions':[{'condition_index':0,'evidence_quote':'The supervisor has approved.'}],'validation_notes':[]}
    assert validate_resolutions(result,evidence,followup)['assessments'][0]['status']=='conditional'


def test_later_pending_reply_overrides_prior_resolution():
    from offer_followup import rule_resolutions, validate_resolutions
    followup={'conditions':['supervisor confirms availability'],'requirement_ids':['scene_observation']}
    evidence={'transcript':[{'speaker':'recipient','text':'Our supervisor has confirmed availability.'},
                            {'speaker':'recipient','text':'Actually we are still waiting for our supervisor.'}]}
    result={'assessments':[{'requirement_id':'scene_observation','status':'committed','conditions':[]}],
            'condition_resolutions':[{'condition_index':0,'evidence_quote':evidence['transcript'][0]['text']}],'validation_notes':[]}
    assert not rule_resolutions(evidence,followup)
    assert validate_resolutions(result,evidence,followup)['assessments'][0]['status']=='conditional'


def test_final_explicit_resolution_can_clear_earlier_pending_reply():
    from offer_followup import rule_resolutions, validate_resolutions
    followup={'conditions':['supervisor confirms availability'],'requirement_ids':['scene_observation']}
    evidence={'transcript':[{'speaker':'recipient','text':'We are waiting for our supervisor.'},
                            {'speaker':'recipient','text':'Our supervisor has confirmed availability.'}]}
    result={'assessments':[{'requirement_id':'scene_observation','status':'committed','conditions':[]}],
            'condition_resolutions':rule_resolutions(evidence,followup),'validation_notes':[]}
    assert validate_resolutions(result,evidence,followup)['assessments'][0]['status']=='committed'


def test_duplicate_submission_creates_only_one_followup(client):
    first=conditional(client)
    assert send(client,first,'agrees').status_code==202
    assert send(client,first,'agrees').status_code==409
    after=wait(client,first['id'])
    assert after['calls_made']==2 and not after['actions']
    assert after['calls'][0]['idempotency_key']!=after['calls'][1]['idempotency_key']
    assert after['calls'][1]['idempotency_key'].endswith(':followup:'+first['calls'][0]['id'])


def test_scope_mismatch_cannot_be_rechecked(client):
    first=conditional(client)
    with closing(relay.connect()) as db:
        db.execute("UPDATE incidents SET expected_outcome=? WHERE id=?",('Arrange an on-site veterinary assessment of the animal; no transport yet.',first['incident_id']));db.commit()
    assert send(client,first).status_code==409


def test_unknown_followup_price_is_not_replaced_with_old_free_quote(client):
    first=conditional(client)
    edit(client,'biz_neighbor',simulation={'quote_status':'unknown','quote_amount':None})
    after=recheck(client,first,'agrees')
    assert after['can_approve'] and after['plan']['cost']['unknown_count']==1
    assert after['calls'][0]['analysis']['cost_quote']['status']=='free'
    assert after['plan']['contact_offers'][0]['quote']['status']=='unknown'
    assert not after['actions']


def test_generic_model_yes_does_not_resolve_old_supervisor_requirement(client,monkeypatch):
    import asyncio
    first=conditional(client)
    contact={'id':'biz_neighbor','name':'Neighborhood Support','capabilities':['scene_observation']}
    evidence={'provider_status':'completed','simulated':False,'transcript':[
        {'speaker':'recipient','text':'Yes, this is Neighborhood Support.'},
        {'speaker':'recipient','text':'I can observe the animal from a safe distance.'}]}
    from coordinator import rule_analysis
    coverage={**first['plan'],'offer_followup':first['followup_options'][0]}
    raw=rule_analysis(USER,first['definition'],evidence,contact,coverage)
    async def model(*args):return raw
    monkeypatch.setattr(relay.planner,'enabled',True);monkeypatch.setattr(relay.planner,'_json',model)
    result=asyncio.run(relay.planner.analyze(USER,first['definition'],evidence,contact,coverage))
    assert result['_meta']['engine']=='llm' # fixture only, not external inference
    assert result['assessments'][0]['status']=='conditional'
