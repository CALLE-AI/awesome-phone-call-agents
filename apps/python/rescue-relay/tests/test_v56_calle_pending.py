"""Provider responses are local fixtures. No real CALL-E endpoint or phone used."""
import asyncio
import json
from contextlib import closing
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import httpx
import pytest
import calling
import app as relay
from test_calle_transport import RESULT
from test_v55_provider_transport import factory
from test_v55_provider_recovery import prepare, send, wait

RAW = ' {"task": "Authorized original operation", "recipients": [{"phones": ["+12025550199"]}], "metadata": {"unchanged": "always"}} '
KEY = 'saved-operation-v56'
SECRET = 'private-api-key-v56'


def not_ready(**extra):
    return httpx.Response(422, json={'error': {'code': 'call_not_ready',
        'message': ('Call task creation was rejected: the recipient at +12025550199 is in an '
                    'unsupported region. Private token: '+SECRET),
        'details': {'phone': '+12025550199', 'questions': [
            'Use a supported region and language combination for +12025550199.'
        ], **extra}}})


def execute(handler, records, **kw):
    return asyncio.run(calling.execute_saved_call(RAW, KEY, SECRET, lambda **f: records.append(f),
                       client_factory=factory(handler), **kw))


@pytest.fixture(autouse=True)
def fast_checks(monkeypatch):
    monkeypatch.setattr(calling, 'CALLE_POLL_INTERVAL_SECONDS', .0001)
    monkeypatch.setattr(calling, 'CALLE_TIMEOUT_SECONDS', 2)


def test_create_not_ready_halts_after_one_post_and_surfaces_sanitized_guidance():
    requests, records = [], []
    def handler(req):
        requests.append(req)
        return not_ready()
    with pytest.raises(calling.CallUncertain) as ex:
        execute(handler, records)
    assert [r.method for r in requests] == ['POST']
    assert requests[0].content == RAW.encode()
    assert requests[0].headers['idempotency-key'] == KEY
    assert 'unsupported region' in str(ex.value)
    assert 'supported region and language combination' in str(ex.value)
    assert SECRET not in str(ex.value) and '+12025550199' not in str(ex.value)
    diagnostic = json.loads(records[0]['provider_error_json'])
    assert diagnostic['classification'] == 'creation_unconfirmed'
    assert diagnostic['same_operation_replays'] == 0
    assert diagnostic['guidance'][0].endswith('Private [REDACTED_CREDENTIAL]')
    assert diagnostic['guidance'][1] == 'Use a supported region and language combination for [REDACTED_PHONE].'


def test_persistent_create_not_ready_stops_after_bound_with_no_invented_call_id():
    requests, records = [], []
    def handler(req):
        requests.append(req)
        # A diagnostic may mention an ID. It is not a documented CallTask response.
        return not_ready(call_id='call_not_an_authoritative_id', provider_call_id='attempt_not_a_call')
    with pytest.raises(calling.CallUncertain) as ex:
        execute(handler, records)
    assert len(requests) == 1 and requests[0].method == 'POST'
    assert len({r.content for r in requests}) == 1
    assert len({r.headers['idempotency-key'] for r in requests}) == 1
    assert 'Creation and dialing are unconfirmed' in str(ex.value)
    assert 'No Calls API ID was returned or saved' in str(ex.value)
    assert 'Use its saved Call ID' not in str(ex.value)
    assert SECRET not in str(ex.value) and SECRET not in json.dumps(records)
    assert not any(r.get('provider_call_id') for r in records)
    diagnostic = [json.loads(r['provider_error_json']) for r in records if r.get('provider_error_json')][-1]
    assert diagnostic['classification'] == 'creation_unconfirmed'
    assert diagnostic['same_operation_replays'] == 0
    assert 'unsupported region' in diagnostic['private_response']['response_body']


@pytest.mark.parametrize('known_id', [False, True])
def test_call_not_ready_during_get_is_pending_not_failure_and_never_recreates(known_id):
    requests, records = [], []
    gets = 0
    def handler(req):
        nonlocal gets
        requests.append(req)
        if req.method == 'POST':
            return httpx.Response(201, json={'id': RESULT['id'], 'status': 'queued'})
        gets += 1
        if gets < 3:
            return not_ready()
        return httpx.Response(200, json=RESULT)
    execute(handler, records, provider_call_id=RESULT['id'] if known_id else None)
    assert sum(r.method == 'POST' for r in requests) == (0 if known_id else 1)
    assert gets == 3
    assert all(r.url.path.endswith('/calls/'+RESULT['id']) for r in requests if r.method=='GET')
    assert any(json.loads(r['provider_error_json'])['classification'] == 'result_pending'
               for r in records if r.get('provider_error_json'))


def test_read_not_ready_timeout_preserves_id_get_only(monkeypatch):
    monkeypatch.setattr(calling, 'CALLE_TIMEOUT_SECONDS', .00001)
    requests, records = [], []
    def handler(req):
        requests.append(req)
        return not_ready()
    with pytest.raises(calling.CallUncertain) as ex:
        execute(handler, records, provider_call_id=RESULT['id'])
    assert len(requests) == 1 and requests[0].method=='GET'
    assert 'saved call has no terminal result' in str(ex.value)
    assert 'creation and dialing are unconfirmed' not in str(ex.value).lower()


def test_retry_after_longer_than_deadline_pauses_without_early_replay(monkeypatch):
    monkeypatch.setattr(calling, 'CALLE_TIMEOUT_SECONDS', 1)
    requests, records = [], []
    def handler(req):
        requests.append(req)
        response=not_ready(); response.headers['Retry-After']='60'; return response
    with pytest.raises(calling.CallUncertain):
        execute(handler, records)
    assert len(requests)==1
    assert json.loads(records[0]['provider_error_json'])['retry_after_seconds']==60


def test_success_without_call_id_is_ambiguous_and_never_posts_again():
    requests=[]
    def handler(req):
        requests.append(req)
        return httpx.Response(202, json={'status': 'queued'})
    with pytest.raises(calling.CallUncertain, match='did not return a usable Call ID'):
        execute(handler, [])
    assert len(requests)==1


def test_retry_after_parses_date_seconds_and_ignores_invalid():
    for value in ['garbage', '-1', 'nan', 'inf']:
        assert calling.retry_after_seconds(httpx.Response(422, headers={'Retry-After':value})) is None
    assert calling.retry_after_seconds(httpx.Response(422, headers={'Retry-After':'3'}))==3
    future=format_datetime(datetime.now(timezone.utc)+timedelta(seconds=60), usegmt=True)
    seconds=calling.retry_after_seconds(httpx.Response(422, headers={'Retry-After':future}))
    assert 55<seconds<=60


@pytest.mark.parametrize('code', ['unknown_code','idempotency_conflict','invalid_request','policy_violation','internal_error'])
def test_other_422_errors_never_replay(code):
    requests=[]
    def handler(req):
        requests.append(req)
        return httpx.Response(422, json={'error':{'code':code}})
    with pytest.raises(calling.CallUncertain) as ex:execute(handler, [])
    assert len(requests)==1
    if code in ['unknown_code','idempotency_conflict','internal_error']:
        assert 'create request was rejected' not in str(ex.value)


def test_cancel_during_pending_does_not_send_another_request(monkeypatch):
    requests=[]
    async def stop(delay):raise asyncio.CancelledError()
    monkeypatch.setattr(calling.asyncio, 'sleep', stop)
    def handler(req):requests.append(req);return not_ready()
    with pytest.raises(asyncio.CancelledError):
        execute(handler, [], provider_call_id=RESULT['id'])
    assert len(requests)==1 and requests[0].method == 'GET'


def test_private_provider_body_is_bounded_and_authentication_redacted():
    response=httpx.Response(422, text='Bearer other-auth-token '+SECRET+' '+('x'*20000),
                            headers={'x-request-id':'trace123', 'cf-ray':'edge456'})
    result=calling.private_provider_diagnostic(response,SECRET)
    assert len(result['response_body'])==16384 and result['body_truncated']
    assert 'other-auth-token' not in json.dumps(result) and SECRET not in json.dumps(result)
    assert result['request_id']=='trace123'
    assert calling.public_provider_error({'http_status':422,'private_response':result})=={'http_status':422}


@pytest.mark.parametrize('callback', [False, True])
def test_private_provider_response_stays_in_database_not_public_api(client, monkeypatch, callback):
    run, _, _ = prepare(client, monkeypatch, known_id=False, callback=callback)
    owner=(run['actions'] if callback else run['calls'])[0]
    table='rescue_actions' if callback else 'calls'
    private={'http_status':422, 'code':'call_not_ready', 'phase':'create', 'call_id_saved':False,
             'classification':'creation_unconfirmed', 'private_response':{'response_body':'private-diagnostic-marker +12025550199'}}
    with closing(relay.connect()) as db:
        db.execute(f'UPDATE {table} SET provider_error_json=? WHERE id=?',(json.dumps(private),owner['id']));db.commit()
    after=client.get('/api/runs/'+run['id']).json()
    assert 'private-diagnostic-marker' not in json.dumps(after)
    public=(after['actions'] if callback else after['calls'])[0]['provider_error']
    assert public['code']=='call_not_ready' and 'private_response' not in public
    assert 'No Calls API ID is saved' in after['provider_recovery']['explanation']
    with closing(relay.connect()) as db:
        assert 'private-diagnostic-marker' in db.execute(f'SELECT provider_error_json FROM {table} WHERE id=?',(owner['id'],)).fetchone()[0]


def test_persistent_not_ready_api_recovery_stops_without_next_contact(client,monkeypatch):
    run, original, _=prepare(client,monkeypatch,known_id=False)
    requests=[]; real=calling.execute_saved_call
    def handler(req):requests.append(req);return not_ready()
    async def execute_fixture(*args,**kwargs):
        return await real(*args, **kwargs, client_factory=factory(handler))
    monkeypatch.setattr(calling,'execute_saved_call',execute_fixture)
    assert send(client,run).status_code==202
    after=wait(client,run['id'])
    assert after['status']=='failed' and after['calls_made']==run['calls_made']
    assert not after['actions'] and after['provider_recovery']['method']=='replay'
    assert after['provider_recovery']['idempotency_key']==run['provider_recovery']['idempotency_key']
    assert len(requests)==1 and requests[0].content.decode()==original
    assert SECRET not in after['error']
    assert 'private upstream' not in json.dumps(after)


@pytest.mark.parametrize('known_id', [False,True])
@pytest.mark.parametrize('active',[False,True])
def test_activity_names_unconfirmed_creation_or_pending_result_without_ringing(known_id,active):
    from call_activity import build_call_activity
    from test_v532_call_activity import run_row,attempt
    r=run_row(mode='live',status='running' if active else 'failed',calls=[attempt('waiting' if active else 'failed',
        provider_call_id=RESULT['id'] if known_id else None,
        provider_error={'code':'call_not_ready','phase':'read' if known_id else 'create'})])
    a=build_call_activity(r)
    assert a['provider_error_code']=='call_not_ready'
    assert ('result' if known_id else 'unconfirmed') in a['title'].lower()
    assert 'ringing' not in a['title'].lower()
    assert a['active']==active


def test_diagnostic_script_is_read_only_and_offline_by_default(client,monkeypatch):
    from scripts.diagnose_calle import read_operations,build_report
    run,_,_=prepare(client,monkeypatch,known_id=False)
    with closing(relay.connect()) as db:
        before=[tuple(row) for row in db.execute('SELECT * FROM calls')]
    def forbidden(**kw):raise AssertionError('Offline diagnostic must make no HTTP request')
    operations=read_operations(relay.DB_PATH,run['id'])
    report=build_report(operations,client_factory=forbidden)
    assert report['read_only'] and report['network_mode']=='offline'
    assert len(report['operations'])==len(run['calls'])
    assert 'provider_request_json' not in json.dumps(report)
    with closing(relay.connect()) as db:
        assert before==[tuple(row) for row in db.execute('SELECT * FROM calls')]


def test_diagnostic_gets_existing_call_and_events_never_creates():
    from scripts.diagnose_calle import fetch_existing
    requests=[]
    def handler(req):
        requests.append(req)
        return httpx.Response(200,json=RESULT)
    factory_sync=lambda **kw:httpx.Client(**kw,transport=httpx.MockTransport(handler))
    result=fetch_existing(RESULT['id'],SECRET,client_factory=factory_sync)
    assert len(requests)==2 and all(r.method=='GET' for r in requests)
    assert requests[0].url.path.endswith('/calls/'+RESULT['id'])
    assert requests[1].url.path.endswith('/calls/'+RESULT['id']+'/events')
    assert result['call']['status']=='completed' and SECRET not in json.dumps(result)
    before=len(requests)
    assert 'skipped' in fetch_existing('',SECRET,client_factory=factory_sync)
    assert len(requests)==before
