"""Approval recovery: one explicit callback, original terms, immutable attempts."""
import copy
import json
from contextlib import closing

import pytest
import app as relay
import calling
from coordinator import Coordinator
from callback_recovery import candidate, practice_contact
from test_rescue_flow import edit, execute, wait_start
from test_v51_plans import start
from test_v535_offer_followup import USER

EXACT = 'alright you ahole, i will do it.'


def paused(client, transcript=EXACT, **simulation):
    edit(client, 'biz_neighbor', simulation={'start_transcript': transcript,
         'start_transcript_mode': 'exact', **simulation})
    report = start(client, USER)
    result = execute(client, report)
    assert result['status'] == 'attention'
    return result


def send(client, run, reply='agrees', **changes):
    option = run['callback_recovery']
    return client.post(f"/api/actions/{option['action_id']}/retry", json={
        'recovery_token': option['token'], 'confirm_callback': True,
        'practice_reply': reply, **changes})


def recover(client, run, reply='agrees', **changes):
    response = send(client, run, reply, **changes)
    assert response.status_code == 202, response.text
    return wait_start(client, run['id'])


def test_exact_user_reply_missing_price_has_actionable_recovery(client):
    run = paused(client)
    assert run['callback_recovery']['code'] == 'price_missing'
    assert run['callback_recovery']['quote']['status'] == 'free'
    first = copy.deepcopy(run['actions'][0])
    calls = copy.deepcopy(run['calls'])
    contacts = client.get('/api/businesses').json()
    result = recover(client, run)
    assert result['status'] == 'active'
    assert result['callback_recovery'] is None
    assert len(result['actions']) == 1
    action = result['actions'][0]
    assert action['status'] == 'confirmed' and action['progress'] == 'ready'
    assert action['analysis']['price_approved'] is True
    assert action['analysis']['cost_quote']['amount'] == 0
    assert action['evidence']['practice_reply_selected'] == 'agrees'
    assert action['evidence']['simulated'] is True
    assert action['attempts'][0]['evidence'] == first['evidence']
    assert action['attempts'][0]['analysis'] == first['analysis']
    assert action['attempts'][0]['idempotency_key'] == first['idempotency_key']
    assert action['idempotency_key'] != first['idempotency_key']
    assert action['assignments'] == first['assignments']
    assert result['approval'] == run['approval']
    assert result['calls'] == calls
    assert client.get('/api/businesses').json() == contacts
    # Fresh approval is still rejected; retry is not a second /start.
    assert client.post(f"/api/runs/{run['id']}/start", json={'plan_token':result['plan_token'], 'confirm_costs':True}).status_code == 409
    assert send(client, run).status_code == 409


@pytest.mark.parametrize('reply', ['saved', 'conditional', 'declines', 'no_answer'])
def test_retry_can_fail_and_never_fabricates_confirmed_work(client, reply):
    run = paused(client)
    result = recover(client, run, reply)
    assert result['status'] == 'attention'
    assert result['actions'][0]['status'] == 'needs_attention'
    assert result['actions'][0]['progress'] == 'waiting'
    assert result['callback_recovery']['token'] != run['callback_recovery']['token']
    assert len(result['actions'][0]['attempts']) == 1
    assert send(client, run).status_code == 409
    if reply in {'declines','no_answer'}:
        assert result['callback_recovery']['code'] == {'declines':'declined','no_answer':'no_answer'}[reply]
    if reply == 'saved':
        assert result['actions'][0]['evidence']['transcript'] == run['actions'][0]['evidence']['transcript']


def test_retry_requires_explicit_consent_and_current_revision(client):
    run = paused(client)
    for changes, status in [({'confirm_callback':False},422),({'recovery_token':'a'*64},409),({'practice_reply':'magic'},422)]:
        assert send(client,run,**changes).status_code == status
    assert client.get(f"/api/runs/{run['id']}").json()['actions'] == run['actions']


@pytest.mark.parametrize('state',['running','starting','queued','active','completed','interrupted','failed'])
def test_retry_not_offered_in_unsafe_or_closed_states(client,state):
    run = paused(client)
    with closing(relay.connect()) as db:
        db.execute('UPDATE coordination_runs SET status=? WHERE id=?',(state,run['id']));db.commit()
    fresh = client.get(f"/api/runs/{run['id']}").json()
    assert fresh['callback_recovery'] is None
    assert send(client,run).status_code == 409


@pytest.mark.parametrize('changes',[{'consent_to_contact':False},{'phone':'+12025550199'},{'name':'Different team'}])
def test_changed_or_revoked_contact_requires_review(client,changes):
    run=paused(client);edit(client,'biz_neighbor',**changes)
    assert client.get(f"/api/runs/{run['id']}").json()['callback_recovery'] is None
    assert send(client,run).status_code == 409


def test_archived_contact_cannot_be_retried(client):
    run=paused(client);client.delete('/api/businesses/biz_neighbor')
    assert send(client,run).status_code==409


def test_other_active_run_blocks_retry(client):
    run=paused(client)
    other=start(client,USER)
    with closing(relay.connect()) as db:
        db.execute("UPDATE coordination_runs SET status='running' WHERE id=?",(other['id'],));db.commit()
    assert send(client,run).status_code==409


def test_changed_goal_scope_cannot_reuse_approval(client):
    run=paused(client)
    with closing(relay.connect()) as db:
        db.execute("UPDATE incidents SET expected_outcome='Transport the animal to a vet clinic' WHERE id=?",(run['incident_id'],));db.commit()
    assert send(client,run).status_code==409


def test_retry_limits_and_old_history(client,monkeypatch):
    run=paused(client)
    original=copy.deepcopy(run['actions'][0]['evidence'])
    for _ in range(3):
        run=recover(client,run,'saved')
    assert run['callback_recovery'] is None
    assert len(run['actions'][0]['attempts'])==3
    assert run['actions'][0]['attempts'][0]['evidence']==original


def test_global_call_limit_is_not_reset(client,monkeypatch):
    run=paused(client)
    monkeypatch.setattr(relay,'MAX_CONTACTS',2)
    assert send(client,run).status_code==409


def test_unknown_or_higher_price_not_approved_by_retry(client):
    run=paused(client)
    transcript=('Neighborhood Support: Yes, this is Neighborhood Support. I can speak for our team.\n'
        'Neighborhood Support: Our total fee is PKR 50 for all assigned tasks. No extra charges.\n'
        'Neighborhood Support: I confirm the location and agree to start Someone to check on the animal now.')
    # Use the actual assigned label in a recipient commitment.
    transcript=transcript.replace('Someone to check on the animal',run['actions'][0]['assignments'][0]['label'])
    edit(client,'biz_neighbor',simulation={'start_transcript':transcript})
    result=recover(client,run,'saved')
    assert result['status']=='attention'
    assert not result['actions'][0]['analysis']['price_approved']
    assert result['callback_recovery']['code']=='price_changed'
    assert result['approval']==run['approval']
    assert result['callback_recovery']['quote']['amount']==0


def test_explicit_initial_practice_reply_is_optional_and_scoped(client):
    edit(client,'biz_neighbor',simulation={'start_transcript':EXACT})
    run=start(client,USER)
    response=client.post(f"/api/runs/{run['id']}/start",json={
        'plan_token':run['plan_token'],'confirm_costs':True,'practice_reply':'agrees'})
    assert response.status_code==202
    result=wait_start(client,run['id'])
    assert result['status']=='active'
    assert result['actions'][0]['evidence']['practice_reply_selected']=='agrees'
    saved=next(c for c in client.get('/api/businesses').json() if c['id']=='biz_neighbor')
    assert saved['simulation']['start_transcript']==EXACT


def test_two_helpers_recovery_is_one_at_a_time_no_redial(client):
    from test_adaptive import REPORT
    edit(client,'biz_paws',simulation={'start_transcript':EXACT})
    run=execute(client,start(client,REPORT))
    assert len(run['actions'])==2 and run['status']=='attention'
    result=recover(client,run)
    assert result['status']=='attention'
    assert result['actions'][0]['status']=='confirmed'
    assert result['actions'][1]['status']=='skipped'
    assert result['callback_recovery']['code']=='next_callback'
    first=copy.deepcopy(result['actions'][0])
    result=recover(client,result)
    assert result['status']=='active'
    assert result['actions'][0]==first
    assert all(a['status']=='confirmed' for a in result['actions'])
    assert len(result['actions'][1]['attempts'])==0 # skipped callback was never dialed


def test_restart_preserves_archived_callback_evidence(client):
    run=recover(client,paused(client),'saved')
    before=copy.deepcopy(run['actions'])
    relay.init_db()
    after=client.get(f"/api/runs/{run['id']}").json()
    assert after['actions']==before
    assert after['callback_recovery']['token']==run['callback_recovery']['token']


def test_private_contact_snapshot_not_exposed_in_attempts(client):
    run=recover(client,paused(client))
    serialized=json.dumps(run['actions'])
    assert 'contact_json' not in serialized and '+12025550103' not in serialized


def test_practice_override_does_not_mutate_source_or_infer_unknown_price():
    source={'simulation':{'start_transcript':EXACT,'start_response':'declines'}}
    original=copy.deepcopy(source)
    result=practice_contact(source,'agrees',[{'assignment':{'quote':{'status':'unknown'}}}])
    assert source==original and result['simulation']['quote_status']=='unknown'


def test_live_mode_rejects_practice_retry_even_with_local_consent(client,monkeypatch):
    run=paused(client)
    monkeypatch.setattr(relay,'CALL_MODE','live');monkeypatch.setattr(relay,'ENABLE_LIVE_CALLS',True)
    monkeypatch.setattr(relay,'CALLE_API_KEY','fixture-not-real')
    assert send(client,run,confirm_live=True).status_code==422
    assert send(client,run,'saved',confirm_live=True).status_code==409


@pytest.mark.parametrize('provider,error,transcript',[
    ('in_progress',None,[{'speaker':'user','text':'Hello'}]),
    ('completed','Unknown outcome',[{'speaker':'user','text':'Hello'}]),
    ('completed',None,[]),('unknown',None,[])])
def test_uncertain_live_provider_never_exposes_retry(provider,error,transcript):
    r={'id':'run','status':'attention','mode':'live','engine_version':5,'approval':{'plan':'x'},'activity':{'uncertain':False},'calls':[],
       'actions':[{'id':'a','business_id':'b','business_name':'Helper','status':'needs_attention','provider_status':provider,
                   'error':error,'evidence':{'transcript':transcript},'assignments':[]}]}
    assert candidate(r,12) is None


def test_duplicate_while_retry_is_running_cannot_dial_twice(client,monkeypatch):
    import asyncio
    run=paused(client)
    original=calling.mock_call
    async def slow(*args,**kwargs):
        await asyncio.sleep(.1)
        return await original(*args,**kwargs)
    monkeypatch.setattr(calling,'mock_call',slow)
    assert send(client,run).status_code==202
    assert send(client,run).status_code==409
    result=wait_start(client,run['id'])
    assert result['status']=='active' and len(result['actions'][0]['attempts'])==1


def test_delivered_v535_action_without_new_metadata_recovers(client):
    run=paused(client)
    approval=copy.deepcopy(run['approval']);approval.pop('report_snapshot')
    with closing(relay.connect()) as db:
        db.execute('UPDATE coordination_runs SET approval_json=? WHERE id=?',(json.dumps(approval),run['id']))
        db.execute('UPDATE rescue_actions SET attempts_json=\'[]\',attempt_started_at=NULL,recovery_request_json=NULL WHERE run_id=?',(run['id'],))
        db.commit()
    run=client.get(f"/api/runs/{run['id']}").json()
    assert run['callback_recovery'] is not None
    assert recover(client,run)['status']=='active'


def test_live_retry_transport_fixture_honors_terms_and_single_recipient(client,monkeypatch):
    """Live adapter replaced with a local fixture; no provider HTTP requests."""
    run=paused(client)
    with closing(relay.connect()) as db:
        snapshot=json.loads(db.execute('SELECT contact_json FROM rescue_actions WHERE run_id=?',(run['id'],)).fetchone()[0])
        snapshot.update(phone='+12025550199',simulated_only=False)
        db.execute("UPDATE businesses SET phone=?,simulated_only=0 WHERE id='biz_neighbor'",(snapshot['phone'],))
        db.execute('UPDATE rescue_actions SET contact_json=? WHERE run_id=?',(json.dumps(snapshot),run['id']))
        db.execute("UPDATE coordination_runs SET mode='live' WHERE id=?",(run['id'],));db.commit()
    monkeypatch.setattr(relay,'CALL_MODE','live');monkeypatch.setattr(relay,'ENABLE_LIVE_CALLS',True)
    monkeypatch.setattr(relay,'CALLE_API_KEY','test-key-never-sent')
    original_fictional_check = relay.is_fictional_number
    monkeypatch.setattr(relay, 'is_fictional_number',
                        lambda phone: False if phone == '+12025550199' else original_fictional_check(phone))
    called=[]
    async def fake_call(incident,contact,definition,plan,key,api_key,record,*,task_override,persist_request):
        persist_request(json.dumps({'task': task_override, 'recipients': [{'phones': [contact['phone']]}]}))
        called.append({'contact':contact['id'],'phone':contact['phone'],'key':key,'task':task_override})
        assert 'clarification' in task_override and 'not a second booking' in task_override
        assert 'ceiling is USD 0.00' in task_override
        record(provider_call_id='call_fixture',provider_status='in_progress',status='waiting')
        label=run['actions'][0]['assignments'][0]['label']
        return 'call_fixture',{'provider_status':'completed','simulated':False,'transcript':[
            {'speaker':'user','text':'Yes, this is Neighborhood Support. I can speak for our team.'},
            {'speaker':'user','text':'All assigned tasks are free of charge. No fee.'},
            {'speaker':'user','text':f'I confirm the reported location and agree to start these tasks: {label}; we are ready now.'}
        ]}
    monkeypatch.setattr(calling,'live_call',fake_call)
    run=client.get(f"/api/runs/{run['id']}").json()
    assert send(client,run,'saved').status_code==422 # real-call confirmation required
    result=recover(client,run,'saved',confirm_live=True)
    assert result['status']=='active'
    assert len(called)==1 and called[0]['contact']=='biz_neighbor'
    assert result['actions'][0]['analysis']['price_approved'] is True
    assert result['actions'][0]['evidence']['simulated'] is False
    assert 'practice_reply_selected' not in result['actions'][0]['evidence']


def test_recipient_revoked_during_retry_preparation_prevents_call(client,monkeypatch):
    run=paused(client)
    prepare=relay.planner.prepare_message
    called=[]
    async def revoke(*args,**kwargs):
        result=await prepare(*args,**kwargs)
        with closing(relay.connect()) as db:
            db.execute("UPDATE businesses SET consent_to_contact=0 WHERE id='biz_neighbor'");db.commit()
        return result
    async def never(*args,**kwargs):
        called.append(True);raise AssertionError('Must not dial a revoked contact')
    monkeypatch.setattr(relay.planner,'prepare_message',revoke)
    monkeypatch.setattr(calling,'mock_call',never)
    result=recover(client,run)
    assert not called and result['status']=='stopped'
    assert result['callback_recovery'] is None


def test_arrival_and_closure_are_never_inferred_after_retry(client):
    run=recover(client,paused(client))
    action=run['actions'][0]
    assert client.post(f"/api/actions/{action['id']}/progress",json={'progress':'finished'}).status_code==409
    assert client.post(f"/api/runs/{run['id']}/complete",json={'confirmed_safe':True,'note':'Not witnessed.'}).status_code==409
    for progress in ['on_the_way','arrived','finished']:
        assert client.post(f"/api/actions/{action['id']}/progress",json={'progress':progress,'note':'Explicit witness fixture.'}).status_code==200
    assert client.post(f"/api/runs/{run['id']}/complete",json={'confirmed_safe':True,'note':'Explicit witness says animal is safe.'}).status_code==200


def test_v535_database_migration_preserves_saved_rows(client):
    run=paused(client)
    with closing(relay.connect()) as db:
        approval=json.loads(db.execute('SELECT approval_json FROM coordination_runs WHERE id=?',(run['id'],)).fetchone()[0])
        approval.pop('report_snapshot',None)
        db.execute('UPDATE coordination_runs SET approval_json=? WHERE id=?',(json.dumps(approval),run['id']))
        for field in ['attempts_json','attempt_started_at','recovery_request_json']:
            db.execute(f'ALTER TABLE rescue_actions DROP COLUMN {field}')
        db.commit()
        before={table:[dict(row) for row in db.execute(f'SELECT * FROM {table}')] for table in ['incidents','calls','rescue_actions','coordination_runs','businesses']}
    relay.init_db()
    with closing(relay.connect()) as db:
        for table,rows in before.items():
            after=[dict(row) for row in db.execute(f'SELECT * FROM {table}')]
            assert [{k:row[k] for k in rows[0]} for row in after]==rows
    fresh=client.get(f"/api/runs/{run['id']}").json()
    assert fresh['callback_recovery'] is not None
    assert fresh['actions'][0]['attempts']==[]
    assert recover(client,fresh)['status']=='active'
