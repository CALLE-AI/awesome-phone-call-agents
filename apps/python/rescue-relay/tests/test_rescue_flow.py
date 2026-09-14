"""Version 3 regressions. No external model inference or real telephone calls."""
import asyncio
import copy
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest
import app as relay
import calling
from coordinator import Coordinator, build_coverage, rule_analysis, validate_analysis
from test_adaptive import incident, start, REPORT, FakeOpenAI


def edit(client, ident, **changes):
    c = next(c for c in client.get('/api/businesses').json() if c['id'] == ident)
    body = {k: c[k] for k in ('name', 'description', 'capabilities', 'consent_to_contact')}
    if 'simulation' in c:
        body['simulation'] = c['simulation']
    if 'simulation' in changes:
        changes['simulation'] = {**body.get('simulation', {}), **changes['simulation']}
    body.update(changes)
    r = client.patch('/api/businesses/' + ident, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def wait_start(client, rid):
    for _ in range(600):
        r = client.get('/api/runs/' + rid).json()
        if r['status'] not in {'queued', 'running', 'starting'}:
            return r
        time.sleep(.01)
    pytest.fail('Start rescue did not settle')


def execute(client, run):
    r = client.post(f"/api/runs/{run['id']}/start", json={"plan_token": run["plan_token"], "confirm_costs": True})
    assert r.status_code == 202, r.text
    return wait_start(client, run['id'])


def test_environment_is_only_mode_switch(client, monkeypatch):
    ident = incident(client)
    assert client.post(f'/api/incidents/{ident}/coordinate', json={'mode':'live'}).status_code == 422
    assert client.post(f'/api/incidents/{ident}/coordinate', json={'scenario':'one_contact'}).status_code == 422
    monkeypatch.setattr(relay, 'CALL_MODE', 'live')
    assert client.post(f'/api/incidents/{ident}/coordinate', json={'mode':'mock'}).status_code == 422
    assert 'simulation' not in client.get('/api/businesses').json()[0]


def test_custom_contact_optional_phone_and_arbitrary_capabilities(client):
    body = {'name':'My complete team','capabilities':['safe_containment','transport','receiving_care','Boat support'], 'consent_to_contact':True,
            'simulation':{'eta_minutes':7}}
    r = client.post('/api/businesses', json=body)
    assert r.status_code == 201, r.text
    assert r.json()['simulated_only']
    assert 'Boat support' in r.json()['capabilities']
    run = start(client)
    assert run['calls_made'] == 1
    assert run['calls'][0]['business_id'] == r.json()['id']
    assert run['plan']['complete']
    assert all(n['assignment']['eta_minutes'] == 7 for n in run['plan']['requirements'])


def test_handwritten_transcript_changes_actual_coverage(client):
    edit(client, 'biz_street_team', simulation={'transcript':"Assistant: Can you help?\nContact: Yes, this is Street Animal Response.\nContact: I will safely secure the animal in 12 minutes.\nContact: I cannot transport it today."})
    run = start(client)
    assert run['status'] == 'partial'
    assert next(n for n in run['plan']['requirements'] if n['id']=='transport')['status'] != 'covered'
    assert run['calls'][0]['evidence']['transcript'][-1]['text'] == 'I cannot transport it today.'
    assert run['calls'][0]['analysis']['_meta']['engine'] == 'rules'


def test_custom_transcript_overrides_profile_but_still_gets_analyzed(client):
    edit(client, 'biz_street_team', simulation={'response':'no_answer','transcript':
        'Contact: Yes, this is Street Animal Response.\nContact: I will safely secure the animal in 12 minutes.\nContact: I will transport the animal in 12 minutes.'})
    run = start(client)
    assert run['status'] == 'covered'
    assert run['calls'][0]['evidence']['simulation_profile']['custom_transcript']
    assert run['calls'][0]['analysis']['_meta']['phase'] == 'transcript analysis'


def test_transcript_receiving_noun_does_not_prove_receiving_agreement(client):
    edit(client,'biz_street_team',simulation={'transcript':
        'Contact: Yes, this is Street Animal Response.\nContact: I will safely secure the animal in 18 minutes.\nContact: I will transport the animal to the receiving team in 18 minutes.'})
    run = start(client)
    assert run['calls_made'] == 2
    assert run['calls'][1]['target_needs'] == ['receiving_care']


def test_start_creates_real_followup_stage_and_stops_once_all_ready(client):
    planned = start(client)
    assert planned['execution_status'] == 'not_started' and planned['actions'] == []
    active = execute(client, planned)
    assert active['status'] == 'active'
    assert [a['business_id'] for a in active['actions']] == ['biz_paws','biz_street_team']
    assert all(a['status']=='confirmed' and a['progress']=='ready' for a in active['actions'])
    for a in active['actions']:
        assert a['evidence']['transcript'] and a['analysis']['status']=='confirmed'
        assert a['analysis']['_meta']['phase']=='start confirmation'
        assert a['message']['_meta']['phase']=='start message'
        assert REPORT['location'] in a['message']['fact_sheet']
        assert 'contact_json' not in a
    assert client.post(f"/api/runs/{active['id']}/start",json={}).status_code==409
    assert active['calls_made']==2 and len(active['actions'])==2


@pytest.mark.parametrize('reply',['declines','conditional','no_answer'])
def test_receiving_refusal_stops_other_start_calls(client, reply):
    edit(client,'biz_paws',simulation={'start_response':reply, 'conditions':'Need manager approval'})
    active = execute(client,start(client))
    assert active['status']=='attention'
    assert active['actions'][0]['status']=='needs_attention'
    assert active['actions'][1]['status']=='skipped'
    assert active['actions'][1]['evidence'] is None


def test_generic_followup_yes_does_not_confirm_every_task(client):
    edit(client,'biz_paws',simulation={'start_transcript':'Contact: Yes, this is Paws & Care.\nContact: Yes, okay.'})
    run = execute(client,start(client))
    assert run['status']=='attention'
    assert run['actions'][0]['analysis']['status']=='unknown'


def test_cannot_start_partial_plan(client):
    run=start(client,'gap')
    assert client.post(f"/api/runs/{run['id']}/start",json={"plan_token": run["plan_token"], "confirm_costs": True}).status_code==409
    assert client.get(f"/api/runs/{run['id']}").json()['actions']==[]


@pytest.mark.parametrize('changes',[{'name':'Different person'},{'phone':'+12025550177'},{'consent_to_contact':False}])
def test_reapproval_and_recipient_binding_before_followup(client, changes):
    run=start(client)
    edit(client,'biz_street_team',**changes)
    assert client.post(f"/api/runs/{run['id']}/start",json={"plan_token": run["plan_token"], "confirm_costs": True}).status_code==409
    assert client.get(f"/api/runs/{run['id']}").json()['actions']==[]


def test_execution_updates_are_explicit_not_timer_based(client):
    run=execute(client,start(client))
    time.sleep(.05)
    assert all(a['progress']=='ready' for a in client.get(f"/api/runs/{run['id']}").json()['actions'])
    assert client.post(f"/api/runs/{run['id']}/complete",json={'confirmed_safe':True,'note':'Confirmed received.'}).status_code==409
    for a in run['actions']:
        assert client.post(f"/api/actions/{a['id']}/progress",json={'progress':'finished'}).status_code==409
        states=['arrived','finished'] if a['business_id']=='biz_paws' else ['on_the_way','arrived','finished']
        for state in states:
            r=client.post(f"/api/actions/{a['id']}/progress",json={'progress':state,'note':'Confirmed directly by helper.'})
            assert r.status_code==200,r.text
    assert client.post(f"/api/runs/{run['id']}/complete",json={'confirmed_safe':False,'note':'Not sure yet'}).status_code==422
    r=client.post(f"/api/runs/{run['id']}/complete",json={'confirmed_safe':True,'note':'Animal received safely, verified directly.'})
    assert r.status_code==200,r.text
    run=client.get(f"/api/runs/{run['id']}").json()
    assert run['status']=='completed'
    assert all(a['progress_log'][-1]['source']=='reporter' for a in run['actions'])
    assert client.post(f"/api/actions/{run['actions'][0]['id']}/progress",json={'progress':'finished'}).status_code==409


def test_stop_during_followup_prevents_next_call(client,monkeypatch):
    planned=start(client)
    monkeypatch.setattr(calling,'MOCK_DELAY_SECONDS',.2)
    assert client.post(f"/api/runs/{planned['id']}/start",json={"plan_token": planned["plan_token"], "confirm_costs": True}).status_code==202
    for _ in range(100):
        current=client.get(f"/api/runs/{planned['id']}").json()
        if current['actions'] and current['actions'][0]['status']=='contacting': break
        time.sleep(.005)
    client.post(f"/api/runs/{planned['id']}/stop")
    run=wait_start(client,planned['id'])
    assert run['status']=='stopped'
    assert run['actions'][1]['evidence'] is None


def test_no_llm_is_explicit_backup_at_every_reasoning_stage(client):
    run=execute(client,start(client))
    traces=[e for e in run['events'] if e['type']=='reasoning']
    assert traces
    assert {'incident analysis','next-contact selection','transcript analysis','start message','start confirmation'} <= {e['phase'] for e in traces}
    assert all(e['engine']=='rules' and e['fallback_reason']=='No model configured.' for e in traces)


def test_configured_model_runs_even_with_legacy_demo_setting(client,monkeypatch):
    monkeypatch.setenv('LLM_BASE_URL','http://127.0.0.1:1234/v1')
    monkeypatch.setenv('LLM_MODEL','my-local-model')
    monkeypatch.setenv('LLM_MODE','demo')
    p=Coordinator(); assert p.enabled
    FakeOpenAI.requests=[]; p.client_factory=FakeOpenAI
    monkeypatch.setattr(relay,'planner',p)
    run=start(client)
    assert run['status']=='covered'
    assert all(c['analysis']['_meta']['engine']=='llm' for c in run['calls'])
    assert 'conversation simulation' in [r['phase'] for r in FakeOpenAI.requests]


@pytest.mark.parametrize('fault',['exception','invalid_json_schema'])
def test_configured_broken_model_falls_back_at_each_phase(client,monkeypatch,fault):
    calls=[]
    async def broken(phase,instruction,data):
        calls.append(phase)
        if fault=='exception': raise ValueError('Provider test failure')
        return {'not':'the required object'}
    monkeypatch.setattr(relay.planner,'enabled',True)
    monkeypatch.setattr(relay.planner,'_json',broken)
    run=execute(client,start(client))
    assert run['status']=='active'
    assert {'incident analysis','next-contact selection','conversation simulation','transcript analysis','start message','start confirmation'} <= set(calls)
    assert all(c['analysis']['_meta']['engine']=='rules' for c in run['calls'])
    assert all(a['analysis']['_meta']['fallback_reason']!='No model configured.' for a in run['actions'])


def test_empty_capabilities_stay_empty_across_restart(client):
    edit(client,'biz_street_team',capabilities=[])
    relay.init_db()
    c=next(c for c in client.get('/api/businesses').json() if c['id']=='biz_street_team')
    assert c['capabilities']==[]


def test_user_scripts_and_profiles_survive_reload(client):
    changed=edit(client,'biz_paws',simulation={'eta_minutes':77,'transcript':'Contact: A custom saved reply.'})
    relay.init_db()
    c=next(c for c in client.get('/api/businesses').json() if c['id']=='biz_paws')
    assert c['simulation']==changed['simulation']


def test_no_unverified_live_evidence_from_directory_or_structured_result(client):
    p=relay.planner
    c={'id':'test','name':'Full Team','capabilities':['transport']}
    definition={'goal':'Arrange a ride','requirements':[{'id':'transport','label':'Transport','reason':'Needs a ride'}]}
    evidence={'simulated':False,'provider_status':'completed','transcript':[], 'structured_result':{'recipient_confirmed':'yes','all_tasks':'agreed'}}
    a=asyncio.run(p.analyze(REPORT,definition,evidence,c,build_coverage(definition,[])))
    assert a['assessments']==[] and a['recipient_confirmed']=='unknown'


def test_live_planner_fallback_analyzes_real_reply_not_simulated_profile(client):
    definition={'goal':'Arrange a ride','requirements':[{'id':'transport','label':'Transport','reason':'Needs a ride'}]}
    c={'id':'test','name':'My Team','simulation':{'response':'agrees'},'capabilities':['transport']}
    evidence={'simulated':False,'provider_status':'completed','transcript':[{'speaker':'user','text':'Yes, this is My Team.'},{'speaker':'user','text':'We cannot transport the animal today.'}], 'structured_result':{'all_tasks':'agreed'}}
    a=asyncio.run(relay.planner.analyze(REPORT,definition,evidence,c,build_coverage(definition,[])))
    assert a['_meta']['engine']=='rules'
    assert a['assessments'][0]['status']=='declined'


def test_real_openai_sdk_http_request_to_local_stub(client,monkeypatch):
    """Real AsyncOpenAI serialization/transport; responses are fixtures, not a real model."""
    sdk = pytest.importorskip("openai")
    if not hasattr(sdk, "AsyncOpenAI"):
        pytest.skip("OpenAI SDK not installed in this verification container; pip install -r requirements.txt to run this HTTP test.")
    requests=[]
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append({'path':self.path,**payload})
            body=json.dumps({'id':'chatcmpl-local-test','object':'chat.completion','created':1,'model':'local-fixture',
                 'choices':[{'index':0,'message':{'role':'assistant','content':json.dumps(FakeOpenAI.definition)},'finish_reason':'stop'}]}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        monkeypatch.setenv('LLM_BASE_URL',f'http://127.0.0.1:{server.server_port}/v1')
        monkeypatch.setenv('LLM_MODEL','local-fixture')
        p=Coordinator();result=asyncio.run(p.define(REPORT))
        assert result['_meta']['engine']=='llm', result['_meta']
        assert requests[0]['path']=='/v1/chat/completions'
        assert requests[0]['model']=='local-fixture'
        assert requests[0]['response_format']=={'type':'json_object'}
        assert 'UNTRUSTED DATA' in requests[0]['messages'][0]['content']
    finally:
        server.shutdown();server.server_close();thread.join(timeout=2)


def test_configured_model_success_all_six_phases(client,monkeypatch):
    phases=[]
    base=FakeOpenAI()
    class FullModel(FakeOpenAI):
        async def create(self, **kwargs):
            p=json.loads(kwargs['messages'][1]['content']);phases.append(p['phase']);d=p['data']
            if p['phase']=='start message':r={'message':'Please confirm you are ready for the agreed tasks.'}
            elif p['phase']=='start confirmation':
                texts=[t['text'] for t in d['completed_call']['transcript'] if t['speaker']=='user']
                r={'recipient_confirmed':'yes','identity_quote':texts[0],'status':'confirmed',
                   'confirmed_requirement_ids':[n['id'] for n in d['assigned_tasks']], 'evidence_quote':texts[-1],
                   'summary':'The helper confirmed starting each task.','eta_minutes':None,'conditions':[]}
            else:return await base.create(**kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(r)))])
    monkeypatch.setattr(relay.planner,'enabled',True)
    monkeypatch.setattr(relay.planner,'client_factory',FullModel)
    run=execute(client,start(client))
    assert run['status']=='active'
    assert {'incident analysis','next-contact selection','conversation simulation','transcript analysis','start message','start confirmation'}<=set(phases)
    assert all(c['analysis']['_meta']['engine']=='llm' for c in run['calls'])
    assert all(a['message']['_meta']['engine']=='llm' and a['analysis']['_meta']['engine']=='llm' for a in run['actions'])


def test_live_calls_and_followups_use_same_backup_without_simulated_calls(client,monkeypatch):
    # Intercepted live-call function; no actual number is dialed. Reserved numbers
    # are first checked in other tests. Only this artificial transport is invoked.
    edit(client,'biz_street_team',phone='+12025550171')
    edit(client,'biz_paws',phone='+12025550172')
    # Test-only fixture: permit reserved destinations solely inside intercepted transport.
    with relay.connect() as db:
        db.execute("UPDATE businesses SET simulated_only=0 WHERE id IN ('biz_street_team','biz_paws')");db.commit()
    monkeypatch.setattr(relay,'is_fictional_number',lambda phone: phone not in {'+12025550171','+12025550172'})
    monkeypatch.setattr(relay,'CALL_MODE','live');monkeypatch.setattr(relay,'ENABLE_LIVE_CALLS',True)
    monkeypatch.setattr(relay,'CALLE_API_KEY','test-only-key')
    attempts=[]
    async def live(inc,contact,definition,coverage,key,api_key,record,**kwargs):
        attempts.append((contact['id'],bool(kwargs.get('task_override'))))
        starting=bool(kwargs.get('task_override'))
        assigned=[n for n in coverage['requirements'] if n.get('assignment',{}).get('contact_id')==contact['id']] if starting else []
        # Fixture transcript only; do not invoke the app's mock calling function.
        labels='; '.join(n['label'] for n in assigned)
        answer=('I confirm I will begin '+labels+' at the reported location in 18 minutes.') if starting else (
            'I confirm I will receive the animal in 18 minutes.' if contact['id']=='biz_paws' else 'I confirm I will safely secure the animal in 18 minutes. I confirm I will transport the animal in 18 minutes.')
        evidence={'simulated':False,'provider_status':'completed','transcript':[{'speaker':'user','text':'Yes, this is '+contact['name']+'.'},{'speaker':'user','text':answer},{'speaker':'user','text':'All our offered tasks are free of charge.'}],'structured_result':None}
        return 'call_test_'+str(len(attempts)),evidence
    async def forbidden(*args,**kwargs):raise AssertionError('Mock transport must never handle a live call.')
    monkeypatch.setattr(calling,'live_call',live);monkeypatch.setattr(calling,'mock_call',forbidden)
    ident=incident(client);r=client.post(f'/api/incidents/{ident}/coordinate',json={'confirm_live':True})
    assert r.status_code==202,r.text
    run=wait_start(client,r.json()['run_id'])
    assert run['status']=='covered',run['error']
    r=client.post(f"/api/runs/{run['id']}/start",json={'confirm_live':True, 'plan_token':run['plan_token'], 'confirm_costs':True})
    assert r.status_code==202,r.text
    run=wait_start(client,run['id']);assert run['status']=='active',run['error']
    assert attempts==[('biz_street_team',False),('biz_paws',False),('biz_paws',True),('biz_street_team',True)]
    assert all(not a['evidence']['simulated'] and a['analysis']['_meta']['engine']=='rules' for a in run['actions'])
