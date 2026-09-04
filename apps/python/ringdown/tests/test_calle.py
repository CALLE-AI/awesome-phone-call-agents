from __future__ import annotations

import http.server
import threading

import pytest

from dataclasses import replace

from fake import scenarios
from fake.calle_server import FakeCalleServer, Fault
from ringdown.calle import (
    CODE_LIMIT,
    LIVE_BASE_URL,
    LIVE_MCP_URL,
    CalleError,
    McpClient,
    RestClient,
    UntrustedHost,
    _call_run,
    _snapshot,
    assert_trusted_url,
)
from ringdown.script import attempt_id, call_payload, idempotency_key
from tests.data import ALICE, LADDER

KEY = "rd-test-1"


def clients(server: FakeCalleServer) -> tuple[RestClient, McpClient]:
    return (
        RestClient(server.base_url, "rd_test_key", timeout=5),
        McpClient(server.mcp_url, "rd_test_key", timeout=5),
    )


def serving(scenario) -> FakeCalleServer:
    return FakeCalleServer({ALICE.phone: scenario})


def payload(incident) -> dict:
    return call_payload(incident, LADDER[0])


def test_a_plain_http_host_that_is_not_loopback_never_receives_a_credential():
    with pytest.raises(UntrustedHost, match="refusing to send a credential"):
        assert_trusted_url("http://calle.example.com", LIVE_BASE_URL)


def test_an_unknown_https_host_is_refused_and_there_is_no_flag_that_permits_it():
    with pytest.raises(UntrustedHost, match="refusing to send a credential"):
        assert_trusted_url("https://calle.example.com", LIVE_BASE_URL)


def test_each_channel_accepts_its_own_live_url_and_loopback():
    assert assert_trusted_url(LIVE_BASE_URL + "/", LIVE_BASE_URL) == LIVE_BASE_URL
    assert assert_trusted_url(LIVE_MCP_URL, LIVE_MCP_URL) == LIVE_MCP_URL
    assert assert_trusted_url("http://127.0.0.1:8080", LIVE_BASE_URL) == "http://127.0.0.1:8080"
    assert assert_trusted_url("http://127.0.0.1:8080", LIVE_MCP_URL) == "http://127.0.0.1:8080"


def test_each_client_pins_itself_and_does_not_trust_the_caller():
    with pytest.raises(UntrustedHost):
        RestClient(LIVE_MCP_URL, "rd_test_key")

    with pytest.raises(UntrustedHost):
        McpClient(LIVE_BASE_URL, "rd_test_key")


def test_the_trusted_host_is_pinned_to_one_whole_url_and_not_to_its_name():
    for near_miss, live in (
        ("https://api.heycall-e.com.evil.test", LIVE_BASE_URL),
        ("https://evil.test/api.heycall-e.com", LIVE_BASE_URL),
        ("https://notapi.heycall-e.com", LIVE_BASE_URL),
        ("https://api.heycall-e.com:8443", LIVE_BASE_URL),
        ("https://api.heycall-e.com/../evil", LIVE_BASE_URL),
        ("https://api.heycall-e.com/v1/calls", LIVE_BASE_URL),
        ("http://api.heycall-e.com", LIVE_BASE_URL),
        ("https://someone:secret@api.heycall-e.com", LIVE_BASE_URL),
        ("https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth/../../evil", LIVE_MCP_URL),
        (LIVE_MCP_URL, LIVE_BASE_URL),
        (LIVE_BASE_URL, LIVE_MCP_URL),
    ):
        with pytest.raises(UntrustedHost):
            assert_trusted_url(near_miss, live)


def test_a_url_that_is_not_http_is_refused():
    for bad in ("ftp://api.heycall-e.com", "file:///etc/passwd", "not a url"):
        with pytest.raises(UntrustedHost):
            assert_trusted_url(bad, LIVE_BASE_URL)


def test_a_created_call_is_read_back_from_the_placing_channel(incident):
    with serving(scenarios.answer_ack(ALICE.name, "alice")) as server:
        rest, _ = clients(server)

        created = rest.create_call(payload(incident), KEY)
        settled = rest.wait_for_result(created.id, timeout=5, interval=0)

        assert created.status == "queued"
        assert settled.terminal
        assert settled.task_completed is True
        assert settled.confidence_score == 0.94
        assert settled.recipient_phone == ALICE.phone
        assert settled.metadata["ringdown_attempt_id"] == attempt_id(incident, LADDER[0])
        assert any("taking this incident" in turn.text for turn in settled.turns)


def test_a_malformed_call_payload_is_an_unreadable_response_not_a_crash():
    for body in ([], {"recipients": 5}, {"completion_confidence": "high"}):
        with pytest.raises(CalleError) as raised:
            _snapshot(body)
        assert raised.value.code == "unreadable_response"


def test_a_malformed_run_payload_is_an_unreadable_run_not_a_crash():
    for result in ({"content": 5}, {"content": [{"text": '{"metadata": 5}'}]}):
        with pytest.raises(CalleError) as raised:
            _call_run(result)
        assert raised.value.code == "unreadable_run"


def test_the_verifying_channel_reads_the_same_call_without_the_provider_judgement(incident):
    with serving(scenarios.answer_ack(ALICE.name, "alice")) as server:
        rest, mcp = clients(server)

        created = rest.create_call(payload(incident), KEY)
        rest.wait_for_result(created.id, timeout=5, interval=0)
        run = mcp.get_call_run(created.id)

        assert run.call_id == created.id
        assert run.status == "COMPLETED"
        assert run.recipient_phone == ALICE.phone
        assert run.metadata["ringdown_attempt_id"] == attempt_id(incident, LADDER[0])
        assert not hasattr(run, "confidence_score")


def test_a_voicemail_keeps_its_own_word_on_the_verifying_channel(incident):
    with serving(scenarios.voicemail(ALICE.name)) as server:
        rest, mcp = clients(server)

        created = rest.create_call(payload(incident), KEY)
        settled = rest.wait_for_result(created.id, timeout=5, interval=0)

        assert (settled.status, settled.failure_code) == ("failed", "voicemail")
        assert mcp.get_call_run(created.id).status == "VOICEMAIL"


def test_a_dropped_connection_may_have_landed_and_can_be_replayed(incident):
    with serving(scenarios.dropped_connection(ALICE.name, "alice")) as server:
        rest, _ = clients(server)

        with pytest.raises(CalleError) as raised:
            rest.create_call(payload(incident), KEY)

        assert raised.value.status is None
        assert raised.value.may_have_landed
        assert raised.value.retriable


def test_a_lost_reply_after_the_call_was_created_may_have_landed(incident):
    with serving(scenarios.error_after_create(ALICE.name, "alice")) as server:
        rest, _ = clients(server)

        with pytest.raises(CalleError) as raised:
            rest.create_call(payload(incident), KEY)

        assert raised.value.status == 503
        assert raised.value.may_have_landed and raised.value.retriable
        assert len(server.created) == 1


def test_a_key_replayed_with_a_different_body_may_have_landed_but_is_never_retried(incident):
    with serving(scenarios.answer_ack(ALICE.name, "alice")) as server:
        rest, _ = clients(server)
        rest.create_call(payload(incident), KEY)

        edited = {**payload(incident), "task": "something else entirely"}
        with pytest.raises(CalleError) as raised:
            rest.create_call(edited, KEY)

        assert raised.value.code == "idempotency_conflict"
        assert raised.value.may_have_landed
        assert not raised.value.retriable


def test_a_provider_refusal_neither_landed_nor_retries(incident):
    with serving(scenarios.refused()) as server:
        rest, _ = clients(server)

        with pytest.raises(CalleError) as raised:
            rest.create_call(payload(incident), KEY)

        assert raised.value.code == "call_not_ready"
        assert not raised.value.may_have_landed
        assert raised.value.details["questions"]
        assert len(server.created) == 0


def test_a_call_that_never_settles_times_out_instead_of_reporting_a_failure(incident):
    with serving(scenarios.queued_forever()) as server:
        rest, _ = clients(server)
        created = rest.create_call(payload(incident), KEY)

        with pytest.raises(CalleError) as raised:
            rest.wait_for_result(created.id, timeout=0.05, interval=0)

        assert raised.value.code == "poll_timeout"
        assert raised.value.may_have_landed
        assert "queued" in raised.value.message


def test_polling_walks_a_slow_call_through_in_progress_to_completed(incident):
    with serving(scenarios.slow_pickup(ALICE.name, "alice")) as server:
        rest, _ = clients(server)
        created = rest.create_call(payload(incident), KEY)

        assert rest.get_call(created.id).status == "in_progress"
        assert rest.wait_for_result(created.id, timeout=5, interval=0).status == "completed"


def test_a_call_the_verifying_channel_cannot_see_raises_instead_of_returning_empty(incident):
    with serving(scenarios.unseen_on_second_channel(ALICE.name, "alice")) as server:
        rest, mcp = clients(server)
        created = rest.create_call(payload(incident), KEY)

        with pytest.raises(CalleError) as raised:
            mcp.get_call_run(created.id)

        assert raised.value.code == "no_call_run"


def test_a_bad_api_key_is_reported_as_unauthorized(incident):
    with serving(scenarios.answer_ack(ALICE.name, "alice")) as server:
        rest = RestClient(server.base_url, "", timeout=5)

        with pytest.raises(CalleError) as raised:
            rest.create_call(payload(incident), KEY)

        assert raised.value.status == 401
        assert not raised.value.may_have_landed


def test_a_redirecting_host_is_refused_and_the_api_key_never_follows(incident):
    seen: list[str] = []

    class Redirecting(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            seen.append(self.path)
            self.send_response(302)
            self.send_header("Location", "/leaked")
            self.end_headers()

        do_GET = do_POST

        def log_message(self, *_):
            pass

    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), Redirecting) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        rest = RestClient(f"http://127.0.0.1:{server.server_address[1]}", "rd_test_key", timeout=5)
        with pytest.raises(CalleError) as raised:
            rest.create_call(payload(incident), KEY)
        server.shutdown()

    assert raised.value.code == "unexpected_redirect"
    assert raised.value.status == 302
    assert not raised.value.may_have_landed
    assert seen == ["/v1/calls"]


def test_a_creation_response_without_an_id_is_unreadable_not_accepted():
    with pytest.raises(CalleError) as raised:
        _snapshot({"status": "queued"})

    assert raised.value.code == "unreadable_response"
    assert "no id" in raised.value.message


def test_an_error_code_the_provider_invents_cannot_grow_without_bound(incident):
    sprawling = replace(
        scenarios.answer_ack(ALICE.name, "alice"), faults={"create": [Fault(503, "x" * 500)]}
    )
    with serving(sprawling) as server:
        rest, _ = clients(server)

        with pytest.raises(CalleError) as raised:
            rest.create_call(payload(incident), KEY)

    assert raised.value.code == "x" * CODE_LIMIT
