from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest

from fake import scenarios
from fake.calle_server import FakeCalleServer

ALICE = "+14155550100"
KEY = "rd-test-key-1"


def payload(attempt: str = "inc-1/primary/1") -> dict:
    return {
        "task": "page the on-call engineer",
        "recipients": [{"phones": [ALICE]}],
        "metadata": {"ringdown_attempt_id": attempt},
    }


def request(
    url: str, body: dict | None = None, headers: dict | None = None, token: str | None = "rd_test"
) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    if token is not None:
        req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    for name, value in (headers or {}).items():
        req.add_header(name, value)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def create(server: FakeCalleServer, body: dict | None = None, key: str = KEY) -> tuple[int, dict]:
    return request(f"{server.base_url}/v1/calls", body or payload(), {"Idempotency-Key": key})


def read(server: FakeCalleServer, call_id: str) -> dict:
    return request(f"{server.base_url}/v1/calls/{call_id}")[1]


def get_call_run(server: FakeCalleServer, call_id: str) -> dict:
    _, body = request(
        server.mcp_url,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "get_call_run", "arguments": {"run_id": call_id}},
        },
    )
    if "error" in body:
        return body
    return json.loads(body["result"]["content"][0]["text"])


def serving(scenario) -> FakeCalleServer:
    return FakeCalleServer({ALICE: scenario})


@pytest.fixture
def server():
    with serving(scenarios.answer_ack("Alice Okafor", "alice")) as running:
        yield running


def test_a_request_without_bearer_credentials_is_refused(server):
    status, body = request(f"{server.base_url}/v1/calls/call_fake1", token=None)

    assert status == 401
    assert body["error"]["code"] == "invalid_token"


def test_a_payload_with_a_field_the_contract_does_not_define_is_rejected(server):
    body = payload() | {"recipient": {"phone": ALICE}}

    status, refusal = create(server, body)

    assert status == 400
    assert refusal["error"]["code"] == "invalid_request"
    assert server.created == []


def test_the_two_surfaces_return_different_projections_of_the_same_call(server):
    status, created = create(server)
    assert status == 201

    rest = read(server, created["id"])
    mcp = get_call_run(server, created["id"])

    assert rest["status"] == "completed"
    assert mcp["status"] == "COMPLETED"
    assert rest["recipients"][0]["structured_result"] is None
    assert "structured_result" not in mcp
    assert rest["completion_confidence"]["label"] == "high"
    assert "completion_confidence" not in mcp
    assert "task_completed" not in mcp
    assert rest["recipients"][0]["attempts"][0]["transcript_turns"] == mcp["transcript_turns"]


def test_a_voicemail_is_a_failure_on_rest_and_keeps_its_own_word_on_mcp():
    with serving(scenarios.voicemail("Alice Okafor")) as server:
        _, created = create(server)

        rest = read(server, created["id"])
        mcp = get_call_run(server, created["id"])

        assert rest["status"] == "failed"
        assert rest["failure_code"] == "voicemail"
        assert mcp["status"] == "VOICEMAIL"
        assert "failure_code" not in mcp


def test_a_call_reaches_a_terminal_status_only_after_it_is_polled(server):
    _, created = create(server)

    assert created["status"] == "queued"
    assert created["completed_at"] is None
    assert read(server, created["id"])["status"] == "completed"


def test_a_slow_pickup_passes_through_in_progress_before_it_completes():
    with serving(scenarios.slow_pickup("Alice Okafor", "alice")) as server:
        _, created = create(server)
        first = read(server, created["id"])
        second = read(server, created["id"])

        assert [created["status"], first["status"], second["status"]] == [
            "queued",
            "in_progress",
            "completed",
        ]


def test_the_same_idempotency_key_returns_the_same_call_instead_of_dialling_twice(server):
    first_status, first = create(server)
    second_status, second = create(server)

    assert (first_status, second_status) == (201, 200)
    assert first["id"] == second["id"]
    assert len(server.created) == 1


def test_the_same_key_with_a_different_body_is_a_conflict(server):
    create(server)
    status, body = create(server, payload(attempt="inc-1/primary/2"))

    assert status == 409
    assert body["error"]["code"] == "idempotency_conflict"
    assert len(server.created) == 1


def test_a_call_that_never_leaves_queued_reports_no_transcript_and_no_completion_time():
    with serving(scenarios.queued_forever()) as server:
        _, created = create(server)
        rest = read(server, created["id"])

        assert rest["status"] == "queued"
        assert rest["task_completed"] is None
        assert rest["completed_at"] is None
        assert rest["recipients"][0]["attempts"][0]["transcript_turns"] == []


def test_a_lost_reply_still_created_the_call_and_the_replay_finds_it():
    with serving(scenarios.error_after_create("Alice Okafor", "alice")) as server:
        first_status, _ = create(server)
        second_status, second = create(server)

        assert first_status == 503
        assert second_status == 200
        assert second["id"] == server.created[0].id
        assert len(server.created) == 1


def test_a_dropped_connection_leaves_the_client_without_any_status():
    with serving(scenarios.dropped_connection("Alice Okafor", "alice")) as server:
        with pytest.raises(OSError):
            create(server)

        assert len(server.created) == 0


def test_the_mismatch_scenario_serves_an_acknowledgement_on_rest_and_confusion_on_mcp():
    with serving(scenarios.channel_mismatch("Alice Okafor", "alice")) as server:
        _, created = create(server)
        rest = read(server, created["id"])
        mcp = get_call_run(server, created["id"])

        rest_said = " ".join(
            t["text"]
            for t in rest["recipients"][0]["attempts"][0]["transcript_turns"]
            if t["speaker"] == "user"
        )
        mcp_said = " ".join(t["text"] for t in mcp["transcript_turns"] if t["speaker"] == "user")

        assert "taking this incident" in rest_said
        assert "taking this incident" not in mcp_said
        assert "who is this" in mcp_said


def test_a_call_the_second_channel_never_saw_returns_no_run():
    with serving(scenarios.unseen_on_second_channel("Alice Okafor", "alice")) as server:
        _, created = create(server)
        read(server, created["id"])

        assert "error" in get_call_run(server, created["id"])


def test_the_mcp_surface_lists_the_tools_the_live_endpoint_exposes(server):
    _, body = request(server.mcp_url, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    names = [tool["name"] for tool in body["result"]["tools"]]

    assert names == ["plan_call", "run_call", "get_call_run", "track_ui_events"]


def test_a_refusal_carries_the_question_the_provider_needs_answered():
    with serving(scenarios.refused()) as server:
        status, body = create(server)

        assert status == 422
        assert body["error"]["code"] == "call_not_ready"
        assert body["error"]["details"]["questions"]
        assert len(server.created) == 0


def test_a_query_string_does_not_hide_the_call(server):
    _, created = create(server)
    status, body = request(f"{server.base_url}/v1/calls/{created['id']}?verbose=1")

    assert status == 200
    assert body["id"] == created["id"]
