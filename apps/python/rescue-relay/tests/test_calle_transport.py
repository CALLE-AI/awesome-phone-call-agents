import asyncio
import json
import httpx
import pytest
import calling
from coordinator import build_coverage

INCIDENT = {"id": "incident_a", "summary": "Dog cannot walk normally.", "location": "Fictional site"}
CONTACT = {"id": "biz_a", "name": "Trusted Team", "phone": "+12025550199", "description": "A trained rescue team with a vehicle."}
DEFINITION = {"goal": "Transport safely.", "requirements": [{"id": "transport", "label": "Transport", "reason": "Movement needed."}]}
RESULT = {"id": "call_provider_123", "status": "completed", "summary": "Transport agreed.", "evidence": ["Recipient accepted."],
          "structured_result": {"offer_summary": "Transport agreed."},
          "recipients": [{"attempts": [{"transcript_turns": [{"speaker": "bot", "text": "Can you transport it?", "offset_seconds": 0}, {"speaker": "user", "text": "Yes, I will transport it.", "offset_seconds": 4}]}]}]}


def test_post_get_idempotency_and_nested_transcript(monkeypatch):
    monkeypatch.setattr(calling, "CALLE_POLL_INTERVAL_SECONDS", .001)
    requests, records = [], []
    def handler(request):
        requests.append(request)
        if request.method == "POST": return httpx.Response(201, json={"id": "call_provider_123", "status": "queued"})
        return httpx.Response(200, json=RESULT)
    def factory(**kwargs): return httpx.AsyncClient(**kwargs, transport=httpx.MockTransport(handler))
    provider, evidence = asyncio.run(calling.live_call(INCIDENT, CONTACT, DEFINITION, build_coverage(DEFINITION, []), "stable-key", "secret-test", lambda **f: records.append(f), client_factory=factory))
    assert [r.method for r in requests] == ["POST", "GET"]
    assert requests[0].headers["idempotency-key"] == "stable-key"
    payload = json.loads(requests[0].content)
    assert payload["recipients"] == [{"phones": [CONTACT["phone"]]}]
    assert payload["metadata"]["workflow"] == "rescue_relay_v5"
    assert "only" in payload["task"].lower()
    assert provider == "call_provider_123"
    assert evidence["transcript"][1]["speaker"] == "user"
    assert not evidence["simulated"]
    assert records[0]["provider_call_id"] == provider


def test_network_uncertainty_does_not_redial_or_leak_secrets():
    requests = []
    def handler(request):
        requests.append(request)
        raise httpx.ReadTimeout("secret-test +12025550199", request=request)
    def factory(**kwargs): return httpx.AsyncClient(**kwargs, transport=httpx.MockTransport(handler))
    with pytest.raises(calling.CallUncertain) as exc:
        asyncio.run(calling.live_call(INCIDENT, CONTACT, DEFINITION, build_coverage(DEFINITION, []), "stable-key", "secret-test", lambda **f: None, client_factory=factory))
    assert len(requests) == 1
    assert "secret-test" not in str(exc.value)
    assert "+12025550199" not in str(exc.value)


def test_result_timeout_does_not_create_another_call(monkeypatch):
    monkeypatch.setattr(calling, "CALLE_POLL_INTERVAL_SECONDS", .02)
    monkeypatch.setattr(calling, "CALLE_TIMEOUT_SECONDS", .001)
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(201 if request.method == "POST" else 200, json={"id": "call_provider_123", "status": "in_progress"})
    def factory(**kwargs): return httpx.AsyncClient(**kwargs, transport=httpx.MockTransport(handler))
    with pytest.raises(calling.CallUncertain):
        asyncio.run(calling.live_call(INCIDENT, CONTACT, DEFINITION, build_coverage(DEFINITION, []), "stable-key", "key", lambda **f: None, client_factory=factory))
    assert sum(r.method == "POST" for r in requests) == 1


def test_prompt_contains_only_missing_work():
    call = {"id": "c", "business_id": "b", "business_name": "Already Agreed Team", "analysis": {"assessments": [{"requirement_id": "transport", "status": "committed", "action": "Drive the animal.", "evidence_quote": "I will drive", "eta_minutes": 10, "conditions": []}]}}
    coverage = build_coverage(DEFINITION, [call])
    prompt = calling.call_task(INCIDENT, CONTACT, DEFINITION, coverage)
    facts = json.loads(prompt.split("Case facts follow:\n", 1)[1])
    assert facts["tasks_to_ask_about"] == []
    assert facts["existing_unaccepted_offers"][0]["helper"] == "Already Agreed Team"
