"""The CALL-E integration, driven through the protocol end to end.

These tests run the real `CalleMcpClient` and the real `CallEVerificationCaller`
over HTTP, against an endpoint that answers the way CALL-E's own guide documents:
a real JSON-RPC handshake, a real `tools/list`, and real `plan_call` /
`run_call` / `get_call_run` exchanges carrying CALL-E's envelopes. Nothing in the
application under test is stubbed, so a change to the client, to the adapter or
to the way an envelope is unpacked fails here rather than in production.

The cases that matter are the ones where CALL-E behaves the way its own guide
warns it can: a run that is still `PREPARING` when `run_call` returns, a result
that arrives as a `structuredContent` object or only as a JSON text block, and a
`run_call` that comes back with no `run_id` at all.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from callibrate.calling.calle import (
    CallEVerificationCaller,
    render_call_goal,
    render_user_input,
    result_schema,
)
from callibrate.calling.mcp import CalleAuth, CalleAuthRequired, CalleError, CalleMcpClient
from callibrate.calling.models import CallError, CallOutcome

TRANSCRIPT = [
    {"offset_seconds": 0, "speaker": "bot", "text": "Hello, this is an automated assistant calling on behalf of the community resource directory."},
    {"offset_seconds": 5, "speaker": "user", "text": "Go ahead."},
    {"offset_seconds": 8, "speaker": "bot", "text": "We publish Wednesdays nine until twelve. Is that still right?"},
    {"offset_seconds": 14, "speaker": "user", "text": "It moved to ten until one."},
    {"offset_seconds": 19, "speaker": "bot", "text": "So that is Wednesdays, ten in the morning until one in the afternoon?"},
    {"offset_seconds": 26, "speaker": "user", "text": "Yes, that is right."},
]


class FakeCalle:
    """A stand-in for CALL-E's `/mcp/openagent_oauth` endpoint."""

    def __init__(
        self,
        *,
        statuses: list[str] | None = None,
        text_block_only: bool = False,
        run_id: str | None = "run_abc123",
        ready: bool = True,
    ) -> None:
        self.statuses = statuses or ["COMPLETED"]
        self.text_block_only = text_block_only
        self.run_id = run_id
        self.ready = ready
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.authorizations: list[str] = []

    def _wrap(self, payload: dict[str, Any]) -> dict[str, Any]:
        text = json.dumps(payload)
        if self.text_block_only:
            # The guide is explicit that the JSON text block need not be first.
            return {"content": [{"type": "text", "text": "Working on it."}, {"type": "text", "text": text}]}
        return {"content": [{"type": "text", "text": text}], "structuredContent": payload}

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.authorizations.append(request.headers.get("authorization", ""))
        body = json.loads(request.content or b"{}")
        method = body.get("method")

        if method == "initialize":
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": body.get("id"), "result": {"protocolVersion": "2025-11-25"}},
                headers={"mcp-session-id": "session-1"},
            )
        if method == "notifications/initialized":
            return httpx.Response(202, json={})
        if method == "tools/list":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": body.get("id"),
                    "result": {"tools": [{"name": "plan_call"}, {"name": "run_call"}, {"name": "get_call_run"}]},
                },
            )
        if method != "tools/call":
            return httpx.Response(400, json={"error": {"message": f"unexpected {method}"}})

        name = body["params"]["name"]
        arguments = body["params"]["arguments"]
        self.calls.append((name, arguments))

        if name == "plan_call":
            if not self.ready:
                result = self._wrap(
                    {"ready_to_run": False, "clarifying_questions": ["Which number should I call?"]}
                )
            else:
                result = self._wrap(
                    {"plan_id": "plan_xyz", "confirm_token": "tok_secret", "ready_to_run": True}
                )
        elif name == "run_call":
            payload: dict[str, Any] = {"status": "PREPARING"}
            if self.run_id:
                payload["run_id"] = self.run_id
            result = self._wrap(payload)
        else:
            status = self.statuses.pop(0) if len(self.statuses) > 1 else self.statuses[0]
            result = self._wrap(
                {
                    "run_id": self.run_id,
                    "status": status,
                    "summary": "The provider gave new Wednesday hours.",
                    "transcript_turns": TRANSCRIPT if status == "COMPLETED" else [],
                }
            )
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": body.get("id"), "result": result})


def client_for(server: FakeCalle) -> CalleMcpClient:
    auth = CalleAuth(access_token="test-token")
    return CalleMcpClient(auth, transport=httpx.MockTransport(server.handle))


async def nap(_seconds: float) -> None:
    return None


# ----------------------------------------------------------------- the goal


def test_the_call_goal_is_built_from_the_contract(contract):
    goal = render_call_goal(contract)
    assert "automated assistant" in goal
    assert "WE 09:00-12:00" in goal
    assert "say the WHOLE new value back" in goal
    assert "ask not to be called again" in goal
    assert "looking for help rather than working there" in goal


def test_the_goal_changes_when_the_contract_does(contract):
    quiet = contract.model_copy(
        update={"call_constraints": contract.call_constraints.model_copy(update={"disclosure_required": False})}
    )
    assert "automated assistant" in render_call_goal(contract)
    assert "Say in your first sentence" not in render_call_goal(quiet)


def test_the_user_input_names_the_number_and_the_fields(contract):
    text = render_user_input(contract)
    assert contract.authoritative_phone in text
    assert "opening hours" in text


def test_the_published_result_schema_covers_every_field_under_contract(contract):
    schema = result_schema(contract)
    assert set(contract.fields_to_verify) <= set(schema["properties"])
    assert "asked_to_stop_calling" in schema["properties"]


# ------------------------------------------------------------------ the client


@pytest.mark.asyncio
async def test_the_session_handshake_lists_the_three_tools():
    server = FakeCalle()
    client = client_for(server)
    tools = await client.connect()
    assert tools == ["plan_call", "run_call", "get_call_run"]
    assert server.authorizations[0] == "Bearer test-token"
    await client.aclose()


@pytest.mark.asyncio
async def test_no_token_means_no_request_is_made(tmp_path):
    client = CalleMcpClient(CalleAuth(cache_root=tmp_path))
    with pytest.raises(CalleAuthRequired):
        await client.connect()


@pytest.mark.asyncio
async def test_a_token_the_server_rejects_asks_for_a_new_login():
    def unauthorized(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "expired"}})

    client = CalleMcpClient(CalleAuth(access_token="stale"), transport=httpx.MockTransport(unauthorized))
    with pytest.raises(CalleAuthRequired):
        await client.connect()


@pytest.mark.asyncio
async def test_a_result_carried_only_in_a_text_block_is_still_read():
    server = FakeCalle(text_block_only=True)
    client = client_for(server)
    await client.connect()
    plan = await client.plan_call(
        user_input="call them", to_phones=["+15550101101"], goal="confirm hours",
        language="English", region="US",
    )
    assert plan["plan_id"] == "plan_xyz"
    await client.aclose()


@pytest.mark.asyncio
async def test_a_credential_never_appears_in_an_error():
    from callibrate.calling.mcp import redact

    assert "Bearer" not in redact("failed with Authorization: Bearer abc.def-ghi")
    assert "iams_live_secret" not in redact("key iams_live_secret rejected")


# ------------------------------------------------------------------ the caller


@pytest.mark.asyncio
async def test_a_full_run_produces_evidence_the_policy_can_read(contract):
    server = FakeCalle()
    caller = CallEVerificationCaller(client_for(server), first_poll_seconds=0, sleep=nap)
    evidence = await caller.verify(contract)

    assert [name for name, _ in server.calls] == ["plan_call", "run_call", "get_call_run"]
    assert evidence.outcome is CallOutcome.COMPLETED
    assert evidence.call_id == "run_abc123"
    assert evidence.claims[0].proposed_value == "WE 10:00-13:00"
    assert evidence.claims[0].read_back_confirmed
    await caller.aclose()


@pytest.mark.asyncio
async def test_the_plan_is_always_made_before_the_call_is_run(contract):
    server = FakeCalle()
    caller = CallEVerificationCaller(client_for(server), first_poll_seconds=0, sleep=nap)
    await caller.verify(contract)
    names = [name for name, _ in server.calls]
    assert names.index("plan_call") < names.index("run_call")
    plan_arguments = server.calls[0][1]
    assert plan_arguments["to_phones"] == [contract.authoritative_phone]
    run_arguments = server.calls[1][1]
    assert run_arguments == {"plan_id": "plan_xyz", "confirm_token": "tok_secret", "ttl_seconds": 86_400}
    await caller.aclose()


@pytest.mark.asyncio
async def test_a_run_id_is_persisted_before_the_first_poll(contract):
    """A crash between starting a call and reading it must not redial anybody."""
    server = FakeCalle(statuses=["PREPARING", "IN_PROGRESS", "COMPLETED"])
    seen: list[tuple[str, str]] = []
    caller = CallEVerificationCaller(
        client_for(server),
        first_poll_seconds=0,
        poll_interval_seconds=0,
        sleep=nap,
        on_run_started=lambda run_id, plan_id: seen.append((run_id, plan_id)),
    )
    await caller.verify(contract)
    assert seen == [("run_abc123", "plan_xyz")]
    # It kept polling through the non-terminal statuses rather than believing them.
    assert [name for name, _ in server.calls].count("get_call_run") == 3
    assert [name for name, _ in server.calls].count("run_call") == 1
    await caller.aclose()


@pytest.mark.asyncio
async def test_a_run_that_never_reaches_a_terminal_status_fails_without_redialling(contract):
    server = FakeCalle(statuses=["PREPARING"])
    caller = CallEVerificationCaller(
        client_for(server), first_poll_seconds=0, poll_interval_seconds=0, max_wait_seconds=0.05, sleep=nap
    )
    with pytest.raises(CallError) as raised:
        await caller.verify(contract)
    assert "still valid" in str(raised.value)
    assert [name for name, _ in server.calls].count("run_call") == 1
    await caller.aclose()


@pytest.mark.asyncio
async def test_a_run_call_with_no_run_id_is_escalated_and_never_retried(contract):
    server = FakeCalle(run_id=None)
    caller = CallEVerificationCaller(client_for(server), first_poll_seconds=0, sleep=nap)
    with pytest.raises(CallError) as raised:
        await caller.verify(contract)
    assert not raised.value.retryable
    assert "recover" in str(raised.value)
    assert [name for name, _ in server.calls].count("run_call") == 1
    await caller.aclose()


@pytest.mark.asyncio
async def test_a_plan_that_is_not_ready_never_becomes_a_call(contract):
    server = FakeCalle(ready=False)
    caller = CallEVerificationCaller(client_for(server), first_poll_seconds=0, sleep=nap)
    with pytest.raises(CallError):
        await caller.verify(contract)
    assert [name for name, _ in server.calls] == ["plan_call"]
    await caller.aclose()


@pytest.mark.asyncio
async def test_a_no_answer_produces_evidence_that_authorises_nothing(contract):
    server = FakeCalle(statuses=["NO_ANSWER"])
    caller = CallEVerificationCaller(client_for(server), first_poll_seconds=0, sleep=nap)
    evidence = await caller.verify(contract)
    assert evidence.outcome is CallOutcome.NO_ANSWER
    assert not evidence.claims
    await caller.aclose()


@pytest.mark.asyncio
async def test_a_tool_error_from_calle_is_a_call_error_not_a_crash(contract):
    def failing(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content or b"{}")
        if body.get("method") == "tools/call":
            return httpx.Response(
                200,
                json={
                    "jsonrpc": "2.0",
                    "id": body.get("id"),
                    "result": {"isError": True, "content": [{"type": "text", "text": "no credits left"}]},
                },
            )
        return FakeCalle().handle(request)

    caller = CallEVerificationCaller(
        CalleMcpClient(CalleAuth(access_token="t"), transport=httpx.MockTransport(failing)),
        first_poll_seconds=0,
        sleep=nap,
    )
    with pytest.raises(CallError):
        await caller.verify(contract)
    await caller.aclose()


@pytest.mark.asyncio
async def test_terminal_statuses_match_the_documented_set():
    from callibrate.calling.mcp import TERMINAL_STATUSES

    assert {"COMPLETED", "FAILED", "NO_ANSWER", "NO ANSWER", "DECLINED", "CANCELED", "CANCELLED",
            "VOICEMAIL", "BUSY", "EXPIRED"} == set(TERMINAL_STATUSES)


def test_an_unknown_mcp_error_is_wrapped():
    assert issubclass(CalleAuthRequired, CalleError)
