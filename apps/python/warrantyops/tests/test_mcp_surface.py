"""The MCP surface: three tools, fake defaults, no path around the kernel.

§6.3 (locked): assess claim, request authorized inquiry, review and write
back — and nothing else. These tests pin the tool count, prove the surface
constructs no provider but the fake and exposes no provider seam of its
own, and drive the full tool 2 → tool 3 cycle through the kernel's own
write-back with its review binding and source re-read.
"""

from __future__ import annotations

import inspect
import io
import json
from pathlib import Path
from typing import Optional

from test_scenarios import NOW, ON, fixtures

import warrantyops.mcp_surface as surface
from warrantyops.mcp_surface import (
    MCP_TOOLS,
    ReviewSession,
    dispatch_tool,
    serve_stdio,
)

SOURCE = Path(surface.__file__).read_text(encoding="utf-8")
CASE_A = "case_a_useful_resolution"
RECIPIENT_A = fixtures()[CASE_A]["recipient_e164"]


def assess(scenario: str = CASE_A):
    return dispatch_tool("assess_claim", {"scenario": scenario}, on=ON)


def inquiry(scenario: str = CASE_A, sessions: Optional[dict] = None) -> dict:
    return dispatch_tool(
        "request_authorized_inquiry",
        {"scenario": scenario},
        now=NOW,
        on=ON,
        sessions=sessions if sessions is not None else {},
    )


def decide(sessions: dict, review_id: str, decision: str = "APPROVE") -> dict:
    return dispatch_tool(
        "review_and_write_back",
        {
            "review_id": review_id,
            "decision": decision,
            "reviewer": "mcp-test",
            "operator_id": "operator-mcp",
        },
        now=NOW,
        sessions=sessions,
    )


# --- three tools, and only three ---------------------------------------------------------


def test_the_surface_is_exactly_three_tools():
    assert MCP_TOOLS == ("assess_claim", "request_authorized_inquiry", "review_and_write_back")
    assert set(surface.HANDLERS) == set(MCP_TOOLS)


def test_no_tool_or_dispatcher_takes_a_provider_client_or_config():
    handlers = (
        surface.assess_claim,
        surface.request_authorized_inquiry,
        surface.review_and_write_back,
        surface.dispatch_tool,
        surface.serve_stdio,
    )
    for handler in handlers:
        parameters = set(inspect.signature(handler).parameters)
        for forbidden in ("provider", "client", "config", "api_key"):
            assert forbidden not in parameters, (handler.__name__, forbidden)


def test_the_module_names_no_live_provider_and_no_sdk():
    for forbidden in ("calle_client", "CalleCallProvider", "os.environ", "CALLE_API_KEY"):
        assert forbidden not in SOURCE, forbidden


def test_an_unknown_tool_is_a_named_refusal():
    response = dispatch_tool("dial_everything", {})
    assert response == {
        "tool": "dial_everything",
        "refused": True,
        "reasons": ["TOOL_UNKNOWN:dial_everything"],
    }


# --- tool 1: assess claim ----------------------------------------------------------------


def test_the_preflight_runs_five_gates_and_names_the_two_it_cannot():
    report = assess()
    assert report["preflight_ok"] is True
    assert [gate["gate"] for gate in report["preflight_gates"]] == [
        "ENVELOPE",
        "RESIDUAL_NECESSITY",
        "SOURCE_STATE",
        "ECONOMICS",
        "DISCLOSURE",
    ]
    assert report["gates_evaluated_at_call_time"] == ["AUTHORIZATION", "ATTEMPT_LEDGER"]
    assert report["real_calls_placed"] == 0
    assert report["claim_id"] == "CLM-1042"


def test_the_preflight_reports_a_refused_gate_without_dialing():
    report = assess("case_b_source_sufficient")
    residual = next(
        gate
        for gate in report["preflight_gates"]
        if gate["gate"] == "RESIDUAL_NECESSITY"
    )
    assert residual["ok"] is False
    assert residual["refusals"] == ["SOURCE_ALREADY_ANSWERS"]
    assert report["preflight_ok"] is False


def test_a_scenario_name_that_travels_is_refused():
    assert dispatch_tool("assess_claim", {"scenario": "../case_a"})["refused"] is True
    assert dispatch_tool("assess_claim", {"scenario": "no_such_case"})["refused"] is True
    reasons = dispatch_tool("assess_claim", {"scenario": "no_such_case"})["reasons"]
    assert reasons == ["SCENARIO_NOT_FOUND:no_such_case"]


# --- tool 2: request authorized inquiry --------------------------------------------------


def test_an_inquiry_runs_the_kernel_and_withholds_the_write_back():
    sessions: dict[str, ReviewSession] = {}
    report = inquiry(sessions=sessions)
    assert report["refused"] is False
    assert report["terminal_state"] == "INFORMATION_OBTAINED"
    assert report["write_back"] == "WITHHELD_PENDING_REVIEW"
    assert report["provider_replays"] == 1
    assert report["real_calls_placed"] == 0
    assert report["review_id"] in sessions


def test_the_inquiry_masks_the_recipient_everywhere():
    sessions: dict[str, ReviewSession] = {}
    report = inquiry(sessions=sessions)
    assert report["recipient"] == "+12*******42"
    assert RECIPIENT_A not in json.dumps(report)


def test_a_gate_refusal_reports_the_gate_and_registers_nothing():
    sessions: dict[str, ReviewSession] = {}
    report = inquiry("case_b_source_sufficient", sessions=sessions)
    assert report["refused"] is True
    assert report["gate"] == "RESIDUAL_NECESSITY"
    assert report["write_back"] == "NONE"
    assert sessions == {}


# --- tool 3: review and write back -------------------------------------------------------


def test_an_approval_writes_the_note_through_the_kernel():
    sessions: dict[str, ReviewSession] = {}
    review_id = inquiry(sessions=sessions)["review_id"]
    written = decide(sessions, review_id, "APPROVE")
    assert written["write_back"] == "NOTE_WRITTEN"
    assert written["note"]["claim_status"] == "STATED_RETURNED"
    assert written["safe_non_write"] is False


def test_a_refusal_is_a_recorded_safe_non_write():
    sessions: dict[str, ReviewSession] = {}
    review_id = inquiry(sessions=sessions)["review_id"]
    refused = decide(sessions, review_id, "REFUSE")
    assert refused["write_back"] == "NONE"
    assert refused["note_id"] is None
    assert refused["safe_non_write"] is True


def test_the_source_recheck_runs_at_write_time_not_call_time():
    sessions: dict[str, ReviewSession] = {}
    review_id = inquiry(sessions=sessions)["review_id"]
    session = sessions[review_id]
    session.store.set_version(
        session.claim.source_platform, session.claim.source_claim_id, "moved-v2"
    )
    drifted = decide(sessions, review_id, "APPROVE")
    assert drifted["write_back"] == "SOURCE_CHANGED"
    assert drifted["safe_non_write"] is True


def test_a_review_is_decided_once():
    sessions: dict[str, ReviewSession] = {}
    review_id = inquiry(sessions=sessions)["review_id"]
    assert decide(sessions, review_id, "REFUSE")["safe_non_write"] is True
    again = decide(sessions, review_id, "APPROVE")
    assert again["refused"] is True
    assert again["reasons"] == ["REVIEW_ALREADY_DECIDED"]


def test_tool_three_refuses_what_it_must():
    sessions: dict[str, ReviewSession] = {}
    review_id = inquiry(sessions=sessions)["review_id"]
    unknown = decide(sessions, "not-a-review-id")
    assert unknown["reasons"] == ["REVIEW_NOT_FOUND:not-a-review-id"]
    bad_decision = dispatch_tool(
        "review_and_write_back",
        {"review_id": review_id, "decision": "APPROVE_EVERYTHING",
         "reviewer": "x", "operator_id": "y"},
        now=NOW,
        sessions=sessions,
    )
    assert bad_decision["reasons"] == ["DECISION_UNKNOWN:APPROVE_EVERYTHING"]
    faceless = dispatch_tool(
        "review_and_write_back",
        {"review_id": review_id, "decision": "APPROVE", "reviewer": "  "},
        now=NOW,
        sessions=sessions,
    )
    assert faceless["reasons"] == ["MISSING_REVIEWER", "MISSING_OPERATOR_ID"]
    assert sessions[review_id].decided is False  # nothing was consumed


# --- the stdio loop ------------------------------------------------------------------------


def test_the_stdio_loop_answers_one_json_object_per_line():
    requests = io.StringIO(
        json.dumps({"tool": "assess_claim", "arguments": {"scenario": CASE_A}})
        + "\n{not json}\n"
        + json.dumps({"tool": "dial_everything", "arguments": {}})
        + "\n"
    )
    replies = io.StringIO()
    assert serve_stdio(requests, replies) == 3
    responses = [json.loads(line) for line in replies.getvalue().splitlines()]
    assert responses[0]["tool"] == "assess_claim"
    assert responses[0]["real_calls_placed"] == 0
    assert responses[1]["refused"] is True
    assert responses[1]["reasons"][0].startswith("REQUEST_NOT_JSON")
    assert responses[2]["reasons"] == ["TOOL_UNKNOWN:dial_everything"]
