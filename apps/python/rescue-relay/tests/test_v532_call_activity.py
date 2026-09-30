"""Progress/UI contract regressions; fake model/provider evidence, no live calls."""
import asyncio
import copy
import json
import threading
import time
from contextlib import closing

import httpx
import pytest

import app as relay
import calling
from call_activity import build_call_activity
from coordinator import Coordinator, CallAnalysis, RescueDefinition, validation_failure, build_coverage
from rescue_intent import unsafe_request, welfare_context
from test_adaptive import REPORT, incident, wait
from test_rescue_flow import edit, wait_start

OBSERVATION = 'a dog has some problems with his balls, he keeps licking them.'
GOAL = 'check up on him'
STAMP = '2026-09-09T05:40:00+00:00'


def run_row(**changes):
    return {'mode': 'mock', 'status': 'running', 'calls': [], 'actions': [],
            'events': [], 'started_at': STAMP, 'cancel_requested': False,
            'execution_status': 'not_started', **changes}


def attempt(status='dialing', **changes):
    return {'id': 'call_local', 'business_name': 'Neighborhood Support', 'status': status,
            'created_at': STAMP, 'updated_at': STAMP, **changes}


@pytest.mark.parametrize('status', ['queued', 'running'])
def test_preparing_visible_before_first_call(status):
    a = build_call_activity(run_row(status=status))
    assert a['active'] and a['phase'] == 'preparing'
    assert a['provider_call_id'] is None and not a['contact_name']


@pytest.mark.parametrize('status,phase', [('dialing','simulating'), ('waiting','simulating'), ('analyzing','analyzing')])
def test_practice_phases_do_not_claim_to_dial(status, phase):
    a = build_call_activity(run_row(calls=[attempt(status)]))
    assert a['active'] and a['phase'] == phase and a['mode'] == 'mock'
    assert a['contact_name'] == 'Neighborhood Support'
    assert 'ringing' not in a['title'].lower()
    assert a['started_at'] == STAMP


@pytest.mark.parametrize('provider', ['queued', 'in_progress', 'ringing', 'unknown', 'custom-provider-state'])
def test_live_provider_status_is_passed_through_not_inferred(provider):
    a = build_call_activity(run_row(mode='live', calls=[attempt('waiting', provider_call_id='call_fixture', provider_status=provider)]))
    assert a['phase'] == 'waiting' and a['provider_status'] == provider
    assert a['provider_call_id'] == 'call_fixture'
    assert 'ringing' not in a['title'].lower()


@pytest.mark.parametrize('status', ['queued','contacting','analyzing'])
def test_callback_has_distinct_purpose_before_during_and_after_call(status):
    a = build_call_activity(run_row(status='starting', execution_status='starting', actions=[attempt(status)]))
    assert a['active'] and a['purpose'] == 'Approval callback'
    assert a['phase'] == {'queued':'preparing','contacting':'simulating','analyzing':'analyzing'}[status]


@pytest.mark.parametrize('status', ['covered','partial','stopped','failed','interrupted','active','attention','completed'])
def test_terminal_local_states_do_not_spin(status):
    a = build_call_activity(run_row(status=status, calls=[attempt('completed')], cancel_requested=True))
    assert not a['active'] and not a['uncertain']
    assert 'will finish' not in a['detail']


def test_stop_keeps_pending_call_visible_but_does_not_claim_provider_cancel():
    a = build_call_activity(run_row(mode='live', cancel_requested=True,
        calls=[attempt('waiting',provider_call_id='call_fixture',provider_status='in_progress')]))
    assert a['active'] and a['phase']=='waiting'
    assert a['title']=='Stopping after the current reply'
    assert 'does not cancel' in a['detail']


@pytest.mark.parametrize('local', ['failed','interrupted','needs_attention'])
def test_uncertain_live_call_survives_local_terminal_status(local):
    a = build_call_activity(run_row(mode='live',status='failed',calls=[attempt(local,
        provider_call_id='call_fixture',provider_status='in_progress')]))
    assert not a['active'] and a['uncertain'] and a['phase']=='uncertain'
    assert 'may still be active' in a['detail']


def test_timeout_during_create_is_uncertain_even_without_provider_id():
    a=build_call_activity(run_row(mode='live',status='failed',calls=[attempt('failed')]))
    assert a['uncertain'] and a['provider_call_id'] is None


def test_finished_provider_not_claimed_active_when_analysis_fails():
    a=build_call_activity(run_row(mode='live',status='failed',calls=[attempt('failed',provider_status='completed')]))
    assert not a['uncertain'] and not a['active']


def test_queued_or_skipped_callback_does_not_hide_uncertain_attempt():
    a=build_call_activity(run_row(mode='live',status='attention',execution_status='attention', actions=[
        attempt('needs_attention',provider_call_id='call_uncertain',provider_status='queued'),
        attempt('skipped',id='action_skipped',business_name='Never called')]))
    assert a['uncertain'] and a['provider_call_id']=='call_uncertain'
    assert a['contact_name']=='Neighborhood Support'


def test_activity_projection_is_read_only_and_stable():
    r=run_row(calls=[attempt()]);before=copy.deepcopy(r)
    assert build_call_activity(r)==build_call_activity(r)
    assert r==before


def until(client, rid, predicate):
    for _ in range(400):
        r=client.get('/api/runs/'+rid).json()
        if predicate(r):return r
        time.sleep(.005)
    pytest.fail('Expected progress phase was not recorded')


@pytest.mark.parametrize('method,phase', [('define','preparing'),('simulate','simulating'),('analyze','analyzing')])
def test_http_exposes_progress_during_slow_model_and_reads_do_not_redial(client,monkeypatch,method,phase):
    release=threading.Event();entered=threading.Event()
    original=getattr(relay.planner,method)
    async def held(*args,**kwargs):
        entered.set()
        while not release.is_set():await asyncio.sleep(.005)
        return await original(*args,**kwargs)
    monkeypatch.setattr(relay.planner,method,held)
    ident=incident(client,summary=OBSERVATION,location='Near Tariq Road, Karachi',expected_outcome=GOAL)
    rid=client.post(f'/api/incidents/{ident}/coordinate',json={}).json()['run_id']
    try:
        assert entered.wait(2)
        r=until(client,rid,lambda r:r['activity']['phase']==phase)
        before=copy.deepcopy(r['activity'])
        for _ in range(3):
            after=client.get(f'/api/incidents/{ident}').json()['latest_run']
            assert after['activity']==before and after['calls_made']==r['calls_made']
        if method=='simulate':
            assert client.post(f'/api/runs/{rid}/stop').status_code==200
            stopped=client.get('/api/runs/'+rid).json()
            assert stopped['activity']['active'] and stopped['activity']['cancel_requested']
    finally:
        release.set()
    final=wait(client,rid)
    assert not final['activity']['active'] and final['calls_made']==1
    assert not final['actions']
    assert final['status']==('stopped' if method=='simulate' else 'covered')


def test_callback_preparation_is_visible_before_any_callback_is_dialed(client,monkeypatch):
    ident=incident(client,expected_outcome=GOAL)
    rid=client.post(f'/api/incidents/{ident}/coordinate',json={}).json()['run_id']
    r=wait(client,rid)
    release=threading.Event();entered=threading.Event();original=relay.planner.prepare_message
    async def held(*args):
        entered.set()
        while not release.is_set():await asyncio.sleep(.005)
        return await original(*args)
    monkeypatch.setattr(relay.planner,'prepare_message',held)
    try:
        response=client.post(f'/api/runs/{rid}/start',json={'plan_token':r['plan_token'],'confirm_costs':True})
        assert response.status_code==202 and entered.wait(2)
        r=client.get('/api/runs/'+rid).json()
        assert r['activity']['purpose']=='Approval callback' and r['activity']['phase']=='preparing'
        assert r['activity']['contact_name']=='Neighborhood Support'
        assert r['actions'][0]['provider_call_id'] is None
        assert client.post(f'/api/runs/{rid}/stop').status_code==200
    finally:release.set()
    r=wait_start(client,rid)
    assert r['status']=='stopped' and not r['activity']['active']
    assert all(a['provider_call_id'] is None for a in r['actions'])


def test_exact_report_is_welfare_context_and_condition_is_not_complete(client):
    assert not unsafe_request(OBSERVATION)
    assert 'genital' in welfare_context({**REPORT,'summary':OBSERVATION,'expected_outcome':GOAL})
    edit(client,'biz_neighbor',simulation={'transcript':'yeah who is it. what do you want?',
        'response':'conditional','conditions':'supervisor confirms availability'})
    ident=incident(client,summary=OBSERVATION,expected_outcome=GOAL)
    rid=client.post(f'/api/incidents/{ident}/coordinate',json={}).json()['run_id']
    r=wait(client,rid)
    assert r['status']=='partial' and r['calls_made']==1 and not r['plan']['complete']
    assert r['plan']['requirements'][0]['status']=='conditional'
    assert r['plan']['covered_count']==0 and not r['actions']
    assert not r['activity']['active']


def test_user_suitability_selection_is_not_a_model_fallback(client):
    ident=incident(client,expected_outcome=GOAL)
    rid=client.post(f'/api/incidents/{ident}/coordinate',json={}).json()['run_id'];r=wait(client,rid)
    response=client.post(f'/api/runs/{rid}/continue',json={'plan_token':r['plan_token'],
        'contact_id':'biz_paws','confirm_unmatched':True})
    assert response.status_code==202
    r=wait(client,rid)
    user_events=[v for v in r['events'] if v.get('engine')=='user']
    assert len(user_events)==1 and user_events[0]['fallback_reason'] is None
    assert r['calls_made']==2 and r['plan']['covered_count']==1 and not r['actions']


def test_validation_diagnostics_do_not_expose_model_values_or_unknown_keys():
    secret='sk-never-show-model-text-or-phone'
    try:
        CallAnalysis.model_validate({'recipient_confirmed':'wrong '+secret,'summary':'Example',secret:secret})
    except Exception as exc:
        message=validation_failure(exc)
    assert 'recipient_confirmed (literal_error)' in message
    assert 'field (extra_forbidden)' in message
    assert secret not in message
    assert secret not in validation_failure(ValueError(secret))


def test_nested_validation_diagnostic_has_safe_path_and_error_code():
    try:
        CallAnalysis.model_validate({'recipient_confirmed':'unknown','summary':'Example',
            'assessments':[{'requirement_id':'scene_observation','status':'invalid','action':'Check', 'evidence_quote':''}]})
    except Exception as exc:message=validation_failure(exc)
    assert 'assessments.0.status (literal_error)' in message


def test_scope_rejection_has_explanation_and_does_not_expand_goal(client,monkeypatch):
    async def invalid(*args):
        return {'goal':'Take the dog to a clinic','requirements':[{'id':'transport','label':'Transport','reason':'Example'}]}
    monkeypatch.setattr(relay.planner,'enabled',True);monkeypatch.setattr(relay.planner,'_json',invalid)
    r=asyncio.run(relay.planner.define({**REPORT,'summary':OBSERVATION,'expected_outcome':GOAL}))
    assert r['_meta']['engine']=='rules' and 'did not match the confirmed goal' in r['_meta']['fallback_reason']
    assert [n['id'] for n in r['requirements']]==['scene_observation']
    assert r['goal']==GOAL


def test_live_adapter_progress_sequence_with_fake_provider_only(monkeypatch):
    monkeypatch.setattr(calling,'CALLE_POLL_INTERVAL_SECONDS',.001)
    records=[];methods=[];states=iter(['queued','in_progress','completed'])
    def handler(request):
        methods.append(request.method)
        return httpx.Response(200,json={'id':'call_fixture','status':next(states),'recipients':[]})
    def factory(**kwargs):return httpx.AsyncClient(**kwargs,transport=httpx.MockTransport(handler))
    contact={'id':'fixture','name':'Test helper','phone':'+12025550199','description':'Test'}
    definition={'goal':GOAL,'requirements':[{'id':'scene_observation','label':'Observe','reason':'Example'}]}
    def record(**fields):
        if not records:records.append(attempt())
        else:records.append(copy.deepcopy(records[-1]))
        records[-1].update(fields)
    asyncio.run(calling.live_call({**REPORT,'id':'fixture'},contact,definition,build_coverage(definition,[]),
        'fixture-key','fake-key',record,client_factory=factory))
    assert methods==['POST','GET','GET']
    assert {'queued','in_progress','completed'} <= {r.get('provider_status') for r in records}
    a=build_call_activity(run_row(mode='live',calls=[records[1]]))
    assert a['provider_call_id']=='call_fixture' and a['phase']=='waiting'
