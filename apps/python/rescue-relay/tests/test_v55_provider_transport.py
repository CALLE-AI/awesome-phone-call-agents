"""HTTP transport is mocked. No test contacts CALL-E or dials any number."""
import asyncio
import json
import httpx
import pytest
import calling
from test_calle_transport import INCIDENT, CONTACT, DEFINITION, RESULT
from coordinator import build_coverage


def factory(handler):
    return lambda **kwargs: httpx.AsyncClient(**kwargs, transport=httpx.MockTransport(handler))


def live(handler, record=lambda **f: None, persist=lambda raw: None):
    return asyncio.run(calling.live_call(INCIDENT, CONTACT, DEFINITION, build_coverage(DEFINITION, []),
                       "one-stable-operation", "secret-not-for-errors", record,
                       client_factory=factory(handler), persist_request=persist))


def test_original_payload_commits_before_post_and_id_is_saved_before_poll(monkeypatch):
    monkeypatch.setattr(calling, 'CALLE_POLL_INTERVAL_SECONDS', .001)
    saved, events = [], []
    def handler(request):
        assert saved
        if request.method == "POST":
            assert request.content.decode() == saved[0]
            assert request.headers['idempotency-key'] == 'one-stable-operation'
            return httpx.Response(201, json={"id": RESULT['id'], "status": "queued"})
        assert any(e.get('provider_call_id') == RESULT['id'] for e in events)
        return httpx.Response(200, json=RESULT)
    live(handler, lambda **f: events.append(f), saved.append)
    assert len(saved) == 1


def test_persistence_failure_prevents_any_http_request():
    requests = []
    def fail(raw): raise OSError("disk unavailable")
    with pytest.raises(calling.CallUncertain, match='No provider request was sent'):
        live(lambda request: requests.append(request), persist=fail)
    assert requests == []


def test_lost_create_response_replays_unchanged_body_and_key_not_a_new_operation():
    saved, requests = [], []
    def lost(request):
        requests.append(request)
        raise httpx.ReadTimeout("secret-not-for-errors +12025550199", request=request)
    with pytest.raises(calling.CallUncertain): live(lost, persist=saved.append)
    def recovered(request):
        requests.append(request)
        return httpx.Response(200, json=RESULT)
    result = asyncio.run(calling.execute_saved_call(saved[0], 'one-stable-operation', 'secret', lambda **f: None,
                                                   client_factory=factory(recovered)))
    assert len(requests) == 2
    assert requests[0].content == requests[1].content
    assert requests[0].headers['idempotency-key'] == requests[1].headers['idempotency-key']
    assert result[0] == RESULT['id']


def test_known_call_id_recovery_is_get_only_even_without_original_payload():
    requests = []
    def recovered(request):
        requests.append(request)
        return httpx.Response(200, json=RESULT)
    asyncio.run(calling.execute_saved_call(None, 'one-stable-operation', 'secret', lambda **f: None,
                provider_call_id=RESULT['id'], client_factory=factory(recovered)))
    assert [r.method for r in requests] == ['GET']
    assert str(requests[0].url).endswith('/calls/'+RESULT['id'])


@pytest.mark.parametrize('http,code,expected', [
    (401, 'unauthorized', 'API key'), (403, 'forbidden', 'permission'),
    (402, 'insufficient_balance', 'billing'), (422, 'unsupported_region', 'destination'),
    (422, 'result_schema_invalid', 'schema'), (429, 'rate_limit_exceeded', 'backoff'),
    (409, 'idempotency_conflict', 'do not switch keys'), (503, 'provider_unavailable', 'unresolved'),
])
def test_http_errors_preserve_actionable_codes_without_raw_secrets(http, code, expected):
    requests, records = [], []
    def handler(request):
        requests.append(request)
        return httpx.Response(http, json={'error': {'code': code, 'message': 'secret-not-for-errors +12025550199',
                                                    'details': {'phone': '+12025550199'}}})
    with pytest.raises(calling.CallUncertain) as exc:
        live(handler, lambda **f: records.append(f))
    text = str(exc.value)
    assert str(http) in text and code in text and expected in text
    assert 'secret-not-for-errors' not in text and '+12025550199' not in text
    assert len(requests) == 1
    diagnostic = json.loads(records[-1]['provider_error_json'])
    assert diagnostic['phase'] == 'create' and diagnostic['http_status'] == http
    assert 'secret-not-for-errors' not in json.dumps(records)


def test_get_error_after_creation_never_says_the_original_create_was_rejected():
    def handler(request):
        return httpx.Response(404, json={'error': {'code': 'not_found'}})
    with pytest.raises(calling.CallUncertain) as exc:
        asyncio.run(calling.execute_saved_call(None, 'stable', 'secret', lambda **f: None,
                     provider_call_id=RESULT['id'], client_factory=factory(handler)))
    assert 'existing call' in str(exc.value) and 'read failed' in str(exc.value)
    assert 'create request was rejected' not in str(exc.value)


def test_no_id_and_no_original_body_cannot_be_reconstructed_or_sent():
    requests = []
    with pytest.raises(calling.CallUncertain, match='original CALL-E request was not saved'):
        asyncio.run(calling.execute_saved_call(None, 'stable', 'secret', lambda **f: None,
                                               client_factory=factory(lambda r: requests.append(r))))
    assert not requests


def test_unknown_failure_values_are_preserved_as_diagnostics_not_guessed_no_answer():
    result = {**RESULT, 'status': 'failed', 'failure_code': 'future_failure_value', 'failure_message': 'Future provider context.'}
    _, evidence = live(lambda request: httpx.Response(200, json=result))
    assert evidence['failure_code'] == 'future_failure_value'
    assert evidence['failure_message'] == 'Future provider context.'
    assert evidence['provider_status'] == 'failed'
