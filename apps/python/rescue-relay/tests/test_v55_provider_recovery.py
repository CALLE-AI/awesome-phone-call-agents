"""Durable recovery, concurrency and API privacy; provider HTTP is local fixtures."""
import json
import time
from contextlib import closing
import httpx
import pytest
import app as relay
import calling
from test_v51_plans import start
from test_v535_offer_followup import USER
from test_v536_callback_recovery import paused


def prepare(client, monkeypatch, *, known_id=True, callback=False):
    run = paused(client) if callback else start(client, USER)
    table = 'rescue_actions' if callback else 'calls'
    owner_id = (run['actions'] if callback else run['calls'])[0]['id']
    with closing(relay.connect()) as db:
        owner = dict(db.execute(f'SELECT * FROM {table} WHERE id=?', (owner_id,)).fetchone())
        phone = '+12025550199'
        original_fictional_check = relay.is_fictional_number
        monkeypatch.setattr(relay, 'is_fictional_number',
                            lambda value: False if value == phone else original_fictional_check(value))
        db.execute('UPDATE businesses SET phone=?,simulated_only=0 WHERE id=?', (phone, owner['business_id']))
        contact = relay.internal_business(db.execute('SELECT * FROM businesses WHERE id=?', (owner['business_id'],)).fetchone())
        if callback:
            db.execute('UPDATE rescue_actions SET contact_json=? WHERE id=?', (json.dumps(contact), owner_id))
        else:
            db.execute('UPDATE calls SET recipient_fingerprint=? WHERE id=?', (relay.recipient_fingerprint(contact), owner_id))
        db.execute(f"UPDATE {table} SET status=?,provider_call_id=?,provider_status=NULL,analysis_json=NULL,evidence_json=NULL,error='CALL-E original response lost' WHERE id=?",
                   ('needs_attention' if callback else 'failed', 'call_recovery_fixture' if known_id else None, owner_id))
        db.execute("UPDATE coordination_runs SET mode='live',status=? WHERE id=?", ('attention' if callback else 'failed', run['id']))
        db.commit()
    original = json.dumps({'task': 'Use the exact saved rescue instruction, not a regenerated one.',
                         'recipients': [{'phones': [phone]}], 'metadata': {'original': 'unchanged'},
                         'result_schema': {'type': 'object', 'properties': {'answer': {'type': 'string'}}}}, indent=2)
    relay.save_provider_request(table, owner_id, owner['idempotency_key'], original)
    monkeypatch.setattr(relay, 'CALL_MODE', 'live')
    monkeypatch.setattr(relay, 'ENABLE_LIVE_CALLS', True)
    monkeypatch.setattr(relay, 'CALLE_API_KEY', 'fixture-key-never-sent')
    return client.get(f"/api/runs/{run['id']}").json(), original, contact


def send(client, run, **changes):
    option = run['provider_recovery']
    return client.post(f"/api/runs/{run['id']}/recover-provider", json={
        'operation_id': option['operation_id'], 'recovery_token': option['token'],
        'confirm_recovery': True, 'confirm_live': True, **changes})


def wait(client, ident):
    for _ in range(200):
        run = client.get(f'/api/runs/{ident}').json()
        if run['status'] not in relay.ACTIVE_RUN_STATUSES:
            return run
        time.sleep(.01)
    raise AssertionError('Recovery did not finish')


def mock_provider(monkeypatch, contact, run, requests, *, callback=False):
    real = calling.execute_saved_call
    if callback:
        label = run['actions'][0]['assignments'][0]['label']
        words = f'I confirm the reported location and agree to start these tasks: {label}; we are ready now.'
    else:
        words = 'Yes, we can observe the animal from a safe distance and report back. No handling or transport. We can help at the reported location.'
    response = {'id': 'call_recovery_fixture', 'status': 'completed', 'recipients': [{'attempts': [{'transcript_turns': [
        {'speaker': 'user', 'text': f"Yes, this is {contact['name']}. I can speak for our team."},
        {'speaker': 'user', 'text': words},
        {'speaker': 'user', 'text': 'All our offered tasks are free of charge. No fee.'}]}]}]}
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=response)
    async def execute(*args, **kwargs):
        return await real(*args, **kwargs, client_factory=lambda **kw: httpx.AsyncClient(**kw, transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(calling, 'execute_saved_call', execute)


@pytest.mark.parametrize('known_id', [True, False])
def test_recovery_of_one_inquiry_uses_original_operation_and_pauses(client, monkeypatch, known_id):
    run, original, contact = prepare(client, monkeypatch, known_id=known_id)
    requests = []; mock_provider(monkeypatch, contact, run, requests)
    assert send(client, run, confirm_recovery=False).status_code == 422
    assert send(client, run, confirm_live=False).status_code == 422
    before_keys = [c['idempotency_key'] for c in run['calls']]
    assert send(client, run).status_code == 202
    after = wait(client, run['id'])
    assert after['status'] in {'covered', 'partial'}, after.get('error')
    assert [c['idempotency_key'] for c in after['calls']] == before_keys
    assert after['calls_made'] == run['calls_made'] and not after['actions']
    assert after['provider_recovery'] is None
    assert [r.method for r in requests] == ['GET' if known_id else 'POST']
    if not known_id:
        assert requests[0].content.decode() == original
        assert requests[0].headers['idempotency-key'] == before_keys[0]
    assert send(client, run).status_code == 409  # stale/double submission
    public = json.dumps(after)
    assert 'provider_request_json' not in public and contact['phone'] not in public
    assert 'Use the exact saved rescue instruction' not in public


def test_callback_recovery_does_not_redial_or_bypass_approved_price(client, monkeypatch):
    run, original, contact = prepare(client, monkeypatch, callback=True)
    requests = []; mock_provider(monkeypatch, contact, run, requests, callback=True)
    approval = run['approval']; key = run['actions'][0]['idempotency_key']
    assert send(client, run).status_code == 202
    after = wait(client, run['id'])
    assert after['status'] == 'active', after.get('error')
    assert after['actions'][0]['analysis']['price_approved']
    assert after['actions'][0]['idempotency_key'] == key
    assert after['approval'] == approval and len(after['actions']) == 1
    assert [r.method for r in requests] == ['GET']


def test_payload_and_ledger_survive_restart_and_reject_changed_body(client, monkeypatch):
    run, original, _ = prepare(client, monkeypatch, known_id=False)
    option = run['provider_recovery']
    relay.init_db()
    with closing(relay.connect()) as db:
        before = db.execute('SELECT * FROM provider_requests WHERE idempotency_key=?', (option['idempotency_key'],)).fetchone()
        assert before['request_json'] == original
    with pytest.raises(ValueError):
        relay.save_provider_request('calls', option['operation_id'], option['idempotency_key'], original+' ')
    with closing(relay.connect()) as db:
        assert db.execute('SELECT request_json FROM provider_requests WHERE idempotency_key=?', (option['idempotency_key'],)).fetchone()[0] == original
    assert client.get(f"/api/runs/{run['id']}").json()['provider_recovery']['method'] == 'replay'


def test_legacy_unknown_call_without_original_payload_has_no_unsafe_recovery_button(client, monkeypatch):
    run, _, _ = prepare(client, monkeypatch, known_id=False)
    with closing(relay.connect()) as db:
        db.execute('UPDATE calls SET provider_request_json=NULL WHERE run_id=?', (run['id'],)); db.commit()
    assert client.get(f"/api/runs/{run['id']}").json()['provider_recovery'] is None
    assert send(client, run).status_code == 409


@pytest.mark.parametrize('known_id', [True, False])
def test_revoked_contact_can_be_read_but_never_replayed(client, monkeypatch, known_id):
    run, _, contact = prepare(client, monkeypatch, known_id=known_id)
    with closing(relay.connect()) as db:
        db.execute('UPDATE businesses SET consent_to_contact=0 WHERE id=?', (contact['id'],)); db.commit()
    option = client.get(f"/api/runs/{run['id']}").json()['provider_recovery']
    assert bool(option) == known_id


def test_live_path_persists_request_before_http_even_when_http_fails(client, monkeypatch):
    run, original, contact = prepare(client, monkeypatch, known_id=False)
    owner = run['calls'][0]
    with closing(relay.connect()) as db:
        db.execute('DELETE FROM provider_requests WHERE idempotency_key=?', (owner['idempotency_key'],))
        db.execute('UPDATE calls SET provider_request_json=NULL,provider_request_hash=NULL WHERE id=?', (owner['id'],)); db.commit()
    def handler(request):
        with closing(relay.connect()) as db:
            saved = db.execute('SELECT request_json FROM provider_requests WHERE idempotency_key=?', (owner['idempotency_key'],)).fetchone()
            assert saved and saved[0].encode() == request.content
        raise httpx.ReadTimeout('fixture', request=request)
    import asyncio
    with pytest.raises(calling.CallUncertain):
        asyncio.run(calling.live_call({'id': run['incident_id'], 'summary': USER['summary'], 'location': USER['location']}, contact,
                    run['definition'], run['plan'], owner['idempotency_key'], 'fixture', lambda **f: relay.update_call(owner['id'], **f),
                    client_factory=lambda **kw: httpx.AsyncClient(**kw, transport=httpx.MockTransport(handler)),
                    persist_request=lambda raw: relay.save_provider_request('calls', owner['id'], owner['idempotency_key'], raw)))
    assert client.get(f"/api/runs/{run['id']}").json()['provider_recovery']['method'] == 'replay'
