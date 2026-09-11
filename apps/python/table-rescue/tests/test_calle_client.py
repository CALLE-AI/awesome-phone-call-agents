from hypothesis import given, settings
from hypothesis import strategies as st

from table_rescue.calle_client import (
    LEG_CONFIRM,
    LEG_OFFER,
    CallRequest,
    DryRunClient,
    build_confirm_goal,
    build_offer_goal,
    keyword_hint,
    map_terminal_status,
    parse_outcome_token,
)
from table_rescue.models import CallStatus
from table_rescue.safety import SafetyViolation


def test_parse_outcome_token_reads_only_explicit_token():
    assert parse_outcome_token("thanks, OUTCOME: CANCELLED") == CallStatus.CANCELLED
    assert parse_outcome_token("agent said outcome: cancelled") == CallStatus.CANCELLED
    assert parse_outcome_token("no token here") is None
    assert parse_outcome_token(None) is None
    assert parse_outcome_token("OUTCOME: BANANA") is None


def test_keyword_hint_is_informational_only():
    assert keyword_hint("The guest will cancel the booking.") == "cancel"
    assert keyword_hint("Guest would like to reschedule to Friday.") == "reschedul"
    assert keyword_hint("no decision was reached") is None


def test_map_terminal_status_token_only_decisions():
    assert (
        map_terminal_status("COMPLETED", "OUTCOME: ACCEPTED", LEG_OFFER)
        == CallStatus.ACCEPTED
    )
    assert (
        map_terminal_status("COMPLETED", "garbage", LEG_CONFIRM)
        == CallStatus.UNCERTAIN
    )
    assert (
        map_terminal_status("COMPLETED", "The guest confirmed they will keep it.", LEG_CONFIRM)
        == CallStatus.UNCERTAIN
    )
    assert (
        map_terminal_status("COMPLETED", "OUTCOME: ACCEPTED", LEG_CONFIRM)
        == CallStatus.UNCERTAIN
    )
    assert (
        map_terminal_status("COMPLETED", "OUTCOME: CONFIRMED", LEG_OFFER)
        == CallStatus.UNCERTAIN
    )
    assert map_terminal_status("VOICEMAIL", None, LEG_CONFIRM) == CallStatus.NO_ANSWER
    assert map_terminal_status("DECLINED", None, LEG_CONFIRM) == CallStatus.DECLINED
    assert map_terminal_status("FAILED", None, LEG_CONFIRM) == CallStatus.UNCERTAIN
    assert map_terminal_status("EXPIRED", None, LEG_OFFER) == CallStatus.UNCERTAIN


def test_mcp_client_rejects_foreign_origin():
    with pytest.raises(SafetyViolation, match="ORIGIN_NOT_ALLOWED"):
        McpCallClient(base_url="https://evil.example.com")
    with pytest.raises(SafetyViolation, match="ORIGIN_NOT_ALLOWED"):
        McpCallClient(base_url="http://seleven-mcp-sg.airudder.com")


def test_goal_builders_include_outcome_protocol():
    confirm = build_confirm_goal("Fictional Guest", 4, "2026-09-10T19:00:00+07:00")
    offer = build_offer_goal("Fictional Waitlist", 2, "2026-09-10T19:00:00+07:00")
    assert "OUTCOME: CONFIRMED" in confirm
    assert "OUTCOME: ACCEPTED" in offer
    assert "automated assistant" in confirm
    assert "automated assistant" in offer


def test_dry_run_client_uses_fixtures(tmp_path):
    fixture = tmp_path / "fixtures.jsonl"
    fixture.write_text(
        '{"target_id": "R-001", "status": "CANCELLED", "new_slot": null, "notes": "cannot make it"}\n'
        '{"target_id": "DEFAULT", "status": "NO_ANSWER", "new_slot": null, "notes": "nobody picked up"}\n',
        encoding="utf-8",
    )
    client = DryRunClient(fixture)
    request = CallRequest(run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm")
    assert client.place_call(request).status == CallStatus.CANCELLED
    other = CallRequest(run_id="run-1", target_id="R-999", phone="+15550199", goal="confirm")
    assert client.place_call(other).status == CallStatus.NO_ANSWER


import asyncio
import json

import pytest

from table_rescue.calle_client import McpCallClient


class FakeToolResult:
    def __init__(self, structured):
        self.structured_content = structured


class ScriptedMcpClient:
    def __init__(self, script):
        self.script = script
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        return FakeToolResult(self.script[name].pop(0))


def make_mcp_client(tmp_path, script):
    token_file = tmp_path / "token.json"
    token_file.write_text(
        json.dumps({"token": {"access_token": "tok"}}), encoding="utf-8"
    )
    client = McpCallClient(
        poll_interval_seconds=0,
        plan_retry_delay_seconds=0,
        client_factory=lambda: ScriptedMcpClient(script),
    )
    client._run_calle_json = lambda args: {"usable": True, "cache_path": str(token_file)}
    return client


def test_mcp_client_executes_plan_run_poll(tmp_path):
    script = {
        "plan_call": [{"plan_id": "p1", "confirm_token": "c1", "ready_to_run": True}],
        "run_call": [{"run_id": "call-1"}],
        "get_call_run": [
            {"status": "RUNNING"},
            {"status": "COMPLETED", "post_summary": "guest said OUTCOME: CANCELLED"},
        ],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm",
        leg=LEG_CONFIRM,
    )
    outcome = asyncio.run(client._execute(request))
    assert outcome.status == CallStatus.CANCELLED
    assert outcome.transcript_ref == "call-1"


def test_mcp_client_reads_nested_post_summary(tmp_path):
    # The real get_call_run payload nests the summary under "result" and the
    # agent often states the outcome in prose, not an OUTCOME token. Prose is
    # never decisive: the outcome is UNCERTAIN and the summary is kept for
    # human reconciliation (with a keyword hint appended to the notes).
    script = {
        "plan_call": [{"plan_id": "p1", "confirm_token": "c1", "ready_to_run": True}],
        "run_call": [{"run_id": "call-1"}],
        "get_call_run": [
            {
                "run_id": "call-1",
                "status": "COMPLETED",
                "result": {
                    "post_summary": "The reservation was successfully confirmed. "
                    "Fictional Guest chose to keep the booking for 4.",
                    "outcome": {"task_completed": True},
                },
            }
        ],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm",
        leg=LEG_CONFIRM,
    )
    outcome = asyncio.run(client._execute(request))
    assert outcome.status == CallStatus.UNCERTAIN
    assert outcome.uncertainty_reason == "UNPARSEABLE_SUMMARY"
    assert outcome.notes is not None and "successfully confirmed" in outcome.notes
    assert "hint: confirm" in outcome.notes


def test_mcp_client_retries_transient_not_ready_plan(tmp_path):
    # Regression: back-to-back calls to the same number can make plan_call
    # report ready_to_run=false once; the client must retry, not crash.
    script = {
        "plan_call": [
            {"plan_id": None, "confirm_token": None, "ready_to_run": False},
            {"plan_id": "p1", "confirm_token": "c1", "ready_to_run": True},
        ],
        "run_call": [{"run_id": "call-1"}],
        "get_call_run": [
            {
                "status": "COMPLETED",
                "result": {"post_summary": "The guest confirmed they will keep it."},
            },
        ],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm",
        leg=LEG_CONFIRM,
    )
    outcome = asyncio.run(client._execute(request))
    assert outcome.status == CallStatus.UNCERTAIN


def test_mcp_client_plan_retry_exhaustion_raises_with_detail(tmp_path):
    not_ready = {
        "plan_id": None,
        "confirm_token": None,
        "ready_to_run": False,
        "to_phones": ["+15550101"],
    }
    script = {
        "plan_call": [dict(not_ready), dict(not_ready), dict(not_ready)],
    }
    client = make_mcp_client(tmp_path, script)
    request = CallRequest(
        run_id="run-1", target_id="R-001", phone="+15550101", goal="confirm"
    )
    with pytest.raises(RuntimeError, match="after .* attempts") as excinfo:
        asyncio.run(client._execute(request))
    # Provider payloads echo the destination; the error must not carry it raw.
    assert "+15550101" not in str(excinfo.value)


def test_calle_command_failure_sanitizes_detail(monkeypatch):
    import subprocess as subprocess_module

    client = McpCallClient()

    def fake_run(command, **kwargs):
        return subprocess_module.CompletedProcess(
            command, 1, stdout="", stderr="failed dialing +14155550100"
        )

    monkeypatch.setattr("table_rescue.calle_client.subprocess.run", fake_run)
    with pytest.raises(RuntimeError) as excinfo:
        client._run_calle_json(["auth", "status"])
    assert "+14155550100" not in str(excinfo.value)


def test_ensure_access_token_requires_login():
    client = McpCallClient()
    client._run_calle_json = lambda args: {"usable": False}
    with pytest.raises(RuntimeError, match="not logged in"):
        client.ensure_access_token()


WORDS = st.lists(
    st.sampled_from(
        ["guest", "said", "they", "will", "cancel", "the", "booking",
         "maybe", "keep", "it", "reschedule", "accept", "decline", "?"]
    ),
    min_size=0,
    max_size=12,
).map(" ".join)


@given(summary=WORDS)
@settings(max_examples=200, deadline=None)
def test_prose_without_token_is_never_decisive(summary):
    for leg in (LEG_CONFIRM, LEG_OFFER):
        assert map_terminal_status("COMPLETED", summary, leg) == CallStatus.UNCERTAIN
