"""The AI operator agents.

Two different things are under test here and they are worth keeping apart.

The **plumbing** tests prove the discipline: json mode first, the one retry that is allowed and the
one that is forbidden, a model choice re-validated before it counts, and an `OperatorAction` row on
every single path — including the paths where the model was never reached. Those are the tests that
would catch a regression.

The **judgment** tests prove what the agents are for, and they take the same honest form the
reconciler's do: the judgment lives in the SYSTEM prompts and nothing offline can exercise it, so
what is asserted is that the rules which make this layer safe — do not invent an asset, do not do
arithmetic, an agency request needs a specific justification, never say help is already coming — are
actually in the text being sent.

Every test runs with a fake client. Nothing here touches a network, and `build_client` returns None
when no key is configured, so nothing here *could*.
"""
from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from sqlmodel import select

from app.agents import correspondence_agent, dispatch_agent, documentation_agent
from app.agents.client import AgentClient, build_client, record_action
from app.db import session_scope
from app.models import Correspondence, Dispatch, IncidentDocument, OperatorAction


# --------------------------------------------------------------------------- fakes
class FakeCompletions:
    """Records what was sent and replays scripted responses."""

    def __init__(self, script: list[Any]) -> None:
        self.script = script
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class FakeClient:
    def __init__(self, script: list[Any]) -> None:
        self.chat = type("Chat", (), {"completions": FakeCompletions(script)})()


class APITimeoutError(Exception):
    """Shaped like the openai SDK's timeout: recognised by type name, not by message text."""


def reply(text: str, *, prompt: int = 400, completion: int = 60) -> Any:
    usage = type("U", (), {"prompt_tokens": prompt, "completion_tokens": completion})()
    message = type("M", (), {"content": text})()
    choice = type("C", (), {"message": message})()
    return type("R", (), {"choices": [choice], "usage": usage})()


def client_for(script: list[Any]) -> AgentClient:
    return AgentClient(api_key="unused-in-tests", client=FakeClient(script))


def sent(c: AgentClient, index: int = 0) -> dict[str, Any]:
    return c.client.chat.completions.calls[index]


def call_count(c: AgentClient) -> int:
    return len(c.client.chat.completions.calls)


def actions() -> list[SimpleNamespace]:
    """Provenance rows, detached from the session so a test can read them after it closes."""
    with session_scope() as s:
        rows = s.exec(select(OperatorAction).order_by(OperatorAction.created_at)).all()
        return [SimpleNamespace(**r.model_dump()) for r in rows]


# --------------------------------------------------------------------------- the record
HAZARD_ID = "haz_test"

HAZARD = {
    "id": HAZARD_ID,
    "kind": "heat",
    "headline": "Excessive Heat Warning — 114F",
    "area": "Maryvale, Phoenix",
    "severity": "warning",
    "starts_at": "2026-09-09T10:00",
    "ends_at": "2026-09-09T20:00",
}

NEIGHBOUR = {
    "id": "nbr_rosa",
    "name": "Rosa Delgado",
    "address": "4312 W Osborn Rd",
    "unit": "",
    "access_notes": "side gate, small dog in yard",
    "phone": "+15550142",
    "lives_alone": True,
    "age_band": "75_plus",
    "mobility": "cane_walker",
    "conditions": ["heat_sensitive", "copd"],
    "power_dependent": False,
    "contact_name": "Elena Delgado",
    "contact_relation": "daughter",
    "contact_phone": "+15550188",
}

INCIDENT = {
    "id": "inc_rosa",
    "priority": 2,
    "outcome": "URGENT",
    "address": NEIGHBOUR["address"],
    "needs": ["water", "assess"],
}

SITUATION = {
    "outcome": "URGENT",
    "concerns": ["the cooler quit yesterday", "has not been out of the chair since yesterday"],
    "last_words": "the cooler quit yesterday, but I'm alright, I just sit still",
}

RISK_REASONS = ["75 or older and lives alone", "swamp cooler in 114F heat", "COPD"]

# Two legal options and one agency unit. The van is nearest, so it is what fleet ranked first and
# what every fallback in this file must produce.
CANDIDATES = [
    {"asset_id": "ast_van", "call_sign": "WV-2", "kind": "WELLNESS_VAN", "capabilities": ["water", "assess"],
     "capacity": 4, "served_this_shift": 1, "eta_minutes": 6.0, "distance_miles": 2.2},
    {"asset_id": "ast_nurse", "call_sign": "NURSE-1", "kind": "NURSE_OUTREACH", "capabilities": ["assess"],
     "capacity": 2, "served_this_shift": 0, "eta_minutes": 11.0, "distance_miles": 4.1},
    {"asset_id": "ast_ems", "call_sign": "EMS-7", "kind": "EMS_UNIT", "capabilities": ["als"],
     "capacity": 1, "served_this_shift": 0, "eta_minutes": 8.0, "distance_miles": 3.0},
]


async def propose(script: list[Any] | None, **kwargs: Any) -> Any:
    client = client_for(script) if script is not None else None
    proposal = await dispatch_agent.propose_dispatch(
        hazard_id=HAZARD_ID, hazard=HAZARD, incident=INCIDENT, incident_id=INCIDENT["id"],
        situation=SITUATION, risk_reasons=RISK_REASONS, findings=SITUATION["concerns"],
        needs=INCIDENT["needs"], candidates=kwargs.pop("candidates", CANDIDATES),
        client=client, **kwargs,
    )
    return proposal, client


# --------------------------------------------------------------------------- client discipline
async def test_json_mode_is_tried_first_and_the_reply_is_parsed(db) -> None:  # noqa: ANN001
    c = client_for([reply('{"asset_id": "ast_van", "reason": "nearest, carries water"}')])
    call = await c.complete_json(agent="t", system="S", user="U")
    assert call.data == {"asset_id": "ast_van", "reason": "nearest, carries water"}
    assert sent(c)["response_format"] == {"type": "json_object"}
    assert sent(c)["temperature"] == 0.0 and sent(c)["model"] == "z-ai/glm-5.3-free"
    assert call.json_mode is True and call.usage["completion_tokens"] == 60 and call.latency_ms >= 0
    assert call.ok and call.error is None


async def test_a_gateway_that_rejects_response_format_is_retried_once_without_it(db) -> None:  # noqa: ANN001
    c = client_for([RuntimeError("400 response_format is not supported"), reply('```json\n{"ok": true}\n```')])
    call = await c.complete_json(agent="t", system="S", user="U")
    assert call.data == {"ok": True}  # markdown fences and all
    assert "response_format" in sent(c, 0) and "response_format" not in sent(c, 1)
    assert call.json_mode is False


async def test_a_timeout_is_not_retried_without_json_mode(db) -> None:  # noqa: ANN001
    """The retry exists for a gateway that cannot do json_object, not for a slow one. The free tier
    runs 20-100 s; retrying spends that twice and returns the same nothing, while a coordinator waits."""
    c = client_for([APITimeoutError("Request timed out.")])
    call = await c.complete_json(agent="t", system="S", user="U")
    assert call.data is None and call.ok is False
    assert call_count(c) == 1  # the absence of the second call is the property
    assert "APITimeoutError" in call.error


async def test_prose_instead_of_json_is_not_an_answer(db) -> None:  # noqa: ANN001
    c = client_for([reply("Sure! I'd send the wellness van.")])
    call = await c.complete_json(agent="t", system="S", user="U")
    assert call.data is None and call.error == "unparseable response"


async def test_the_prompt_that_leaves_the_process_is_redacted(db) -> None:  # noqa: ANN001
    """Health information is the substance of the decision and is sent. A phone number is not, and
    has no bearing on which van to send, so it never leaves the machine."""
    c = client_for([reply("{}")])
    await c.complete_json(agent="t", system="S", user="Rosa Delgado, COPD, ring +15550142")
    body = sent(c)["messages"][1]["content"]
    assert "+15550142" not in body and "0142" in body
    assert "COPD" in body  # not stripped: it is why she is being called


async def test_no_key_means_no_network_path_at_all(db) -> None:  # noqa: ANN001
    from app.config import get_settings

    assert build_client(get_settings()) is None  # conftest leaves TOKENROUTER_API_KEY empty
    assert build_client(get_settings().model_copy(update={"TOKENROUTER_API_KEY": "x"})) is not None


async def test_an_agent_can_never_mark_its_own_work_accepted(db) -> None:  # noqa: ANN001
    record_action(hazard_id=HAZARD_ID, kind="triage_note", agent="t", rationale="note")
    row = actions()[0]
    assert row.accepted is None and row.accepted_by == ""


# --------------------------------------------------------------------------- dispatch: the good case
async def test_the_model_may_choose_the_further_unit_and_say_why(db) -> None:  # noqa: ANN001
    """What the model is actually for: the nurse is five minutes further out and is the right call
    for a woman who has not been out of her chair since yesterday. Both options were legal; code
    filtered, the model chose."""
    proposal, c = await propose([reply(
        '{"asset_id": "ast_nurse", "reason": "She has not been out of the chair since yesterday and has '
        'COPD in 114F heat; NURSE-1 can assess her, the van cannot.", "agency_request": false}'
    )])
    assert proposal.asset_id == "ast_nurse" and proposal.source == "model"
    assert "assess" in proposal.reason
    # ETA and distance come from the record, never from the reply: the model does not do arithmetic.
    assert proposal.eta_minutes == 11.0 and proposal.distance_miles == 4.1
    assert proposal.requires_authorisation is False
    row = actions()[0]
    assert row.kind == "dispatch_proposal" and row.agent == "dispatch_agent"
    assert row.incident_id == INCIDENT["id"] and row.model == "z-ai/glm-5.3-free"
    assert row.output["asset_id"] == "ast_nurse" and row.rationale == proposal.reason
    assert row.error is None and row.latency_ms is not None
    assert proposal.action_id == row.id


async def test_the_shortlist_and_the_ban_on_arithmetic_are_actually_in_the_prompt(db) -> None:  # noqa: ANN001
    _, c = await propose([reply('{"asset_id": "ast_van", "reason": "nearest with water"}')])
    system, user = sent(c)["messages"][0]["content"], sent(c)["messages"][1]["content"]
    assert "THE SHORTLIST IS THE WHOLE WORLD" in system and "DO NOT DO ARITHMETIC" in system
    assert "needs a paramedic rather than a neighbour with water" in system
    assert "ast_van" in user and "ast_nurse" in user and "ast_ems" in user
    assert "6.0" in user and "2.2" in user  # ETAs and distances are given, not asked for
    assert "the cooler quit yesterday" in user and "COPD" in user


async def test_a_dispatch_proposal_is_not_a_dispatch(db) -> None:  # noqa: ANN001
    """The agent proposes. Committing, and enforcing the authorisation gate at commit time, belongs
    to the dispatch layer — so nothing here may write a Dispatch row."""
    await propose([reply('{"asset_id": "ast_ems", "reason": "unresponsive", "justification": "x"}')])
    with session_scope() as s:
        assert s.exec(select(Dispatch)).all() == []


# --------------------------------------------------------------------------- dispatch: every failure
async def test_an_asset_that_does_not_exist_is_refused_and_the_deterministic_pick_stands(db) -> None:  # noqa: ANN001
    """The failure this whole design exists to make harmless. A model that hallucinates a unit gets
    a coordinator standing at a door waiting for a van that was never real."""
    proposal, _ = await propose([reply('{"asset_id": "ast_ladder_9", "reason": "Ladder 9 is closest."}')])
    assert proposal.asset_id == "ast_van"  # fleet's own top-ranked candidate
    assert proposal.source == "deterministic"
    assert "not on the shortlist" in proposal.fallback_reason
    # The coordinator-facing reason stays a sentence about the unit. Provenance is exact in `source`
    # and `fallback_reason` (asserted above) and in the audit row — a raw gateway error never leaks into
    # the text a person reads at the door.
    assert "not on the shortlist" not in proposal.reason and "Error code" not in proposal.reason
    row = actions()[0]
    assert "not on the shortlist" in row.error and row.output["asset_id"] == "ast_van"


async def test_a_timeout_degrades_to_the_deterministic_pick_without_a_second_call(db) -> None:  # noqa: ANN001
    proposal, c = await propose([APITimeoutError("Request timed out.")])
    assert proposal.asset_id == "ast_van" and proposal.source == "deterministic"
    assert call_count(c) == 1
    assert "APITimeoutError" in proposal.fallback_reason
    assert "APITimeoutError" in actions()[0].error


async def test_garbage_json_degrades_to_the_deterministic_pick(db) -> None:  # noqa: ANN001
    proposal, _ = await propose([reply("I'd probably send the van? Not sure.")])
    assert proposal.asset_id == "ast_van" and proposal.source == "deterministic"
    assert proposal.fallback_reason == "unparseable response"
    assert actions()[0].error == "unparseable response"


async def test_fleet_refusing_the_choice_beats_the_model(db) -> None:  # noqa: ANN001
    """Re-validation is the last gate: between the model choosing and the dispatch committing, the
    nurse may have been sent somewhere else."""
    def refuse(asset_id: str) -> tuple[bool, str]:
        return (False, "NURSE-1 was committed to another incident 40 seconds ago")

    proposal, _ = await propose(
        [reply('{"asset_id": "ast_nurse", "reason": "can assess her"}')], validate=refuse
    )
    assert proposal.asset_id == "ast_van" and proposal.source == "deterministic"
    assert "another incident" in proposal.fallback_reason


async def test_a_validator_that_explodes_is_a_refusal_not_a_pass(db) -> None:  # noqa: ANN001
    def boom(asset_id: str) -> bool:
        raise RuntimeError("db gone")

    proposal, _ = await propose([reply('{"asset_id": "ast_nurse", "reason": "can assess her"}')], validate=boom)
    assert proposal.asset_id == "ast_van" and "fleet refused" in proposal.fallback_reason


async def test_nothing_eligible_is_reported_not_swallowed(db) -> None:  # noqa: ANN001
    proposal, _ = await propose([reply("{}")], candidates=[])
    assert proposal is None
    row = actions()[0]
    assert row.error == "no eligible candidates" and row.kind == "dispatch_proposal"


async def test_with_no_model_configured_the_deterministic_pick_is_still_recorded(db) -> None:  # noqa: ANN001
    proposal, _ = await propose(None)
    assert proposal.asset_id == "ast_van" and proposal.source == "deterministic"
    assert proposal.fallback_reason == "no model configured"
    assert "2.2 mi out, ETA 6 min" in proposal.reason and "carries water" in proposal.reason
    assert len(actions()) == 1 and actions()[0].output["asset_id"] == "ast_van"


# --------------------------------------------------------------------------- dispatch: the agency gate
async def test_an_ems_request_is_flagged_for_a_human_whatever_the_model_says(db) -> None:  # noqa: ANN001
    """`requires_authorisation` is re-derived from domain.state, never copied from the reply. A model
    that claims its ambulance is not an agency unit does not get one auto-dispatched."""
    proposal, _ = await propose([reply(
        '{"asset_id": "ast_ems", "agency_request": false, "reason": "she needs a medic", '
        '"justification": "She has COPD, the cooler quit yesterday and she has not been able to get out '
        'of the chair since yesterday — that is a person who cannot self-rescue in 114F heat."}'
    )])
    assert proposal.asset_id == "ast_ems" and proposal.source == "model"
    assert proposal.requires_authorisation is True
    assert "chair since yesterday" in proposal.justification


async def test_an_agency_request_without_a_justification_never_reaches_a_coordinator(db) -> None:  # noqa: ANN001
    """A false ambulance call takes a unit from somebody else's emergency, and the person approving
    has seconds. "Trust me" is not something to put in front of them."""
    proposal, _ = await propose([reply('{"asset_id": "ast_ems", "reason": "high risk, send EMS"}')])
    assert proposal.asset_id == "ast_van" and proposal.source == "deterministic"
    assert proposal.fallback_reason == "agency unit requested without a justification"


async def test_a_deterministic_agency_pick_carries_the_record_not_a_flourish(db) -> None:  # noqa: ANN001
    """When the only eligible unit is an agency one and no model was involved, the justification is
    assembled from the record and says so — a human must not be handed fluent reasoning nobody wrote."""
    proposal, _ = await propose(None, candidates=[CANDIDATES[2]])
    assert proposal.asset_id == "ast_ems" and proposal.requires_authorisation is True
    assert "the cooler quit yesterday" in proposal.justification
    assert "not written by a model" in proposal.justification


# --------------------------------------------------------------------------- documentation
ENTRIES = [
    {"at": "2026-09-09T14:02", "text": "Check-in call placed to Rosa Delgado (4312 W Osborn Rd)."},
    {"at": "2026-09-09T14:05", "text": "Call completed. Outcome URGENT: swamp cooler not working.",
     "quote": "the cooler quit yesterday, but I'm alright, I just sit still"},
    {"at": "2026-09-09T14:07", "text": "WV-2 dispatched, ETA 6 minutes."},
]


async def test_the_activity_log_is_a_real_ics_214_with_no_model_at_all(db) -> None:  # noqa: ANN001
    doc = await documentation_agent.write_activity_log(
        hazard_id=HAZARD_ID, hazard=HAZARD, entries=ENTRIES, incident_id=INCIDENT["id"],
        incident=INCIDENT, prepared_by="Alma Reyes", client=None,
    )
    assert doc["form"] == "ICS-214"
    assert "1. Incident Name: Excessive Heat Warning — 114F" in doc["body"]
    assert "6. Activity Log:" in doc["body"]
    for entry in ENTRIES:
        assert entry["at"] in doc["body"] and entry["text"] in doc["body"]
    assert doc["fields"]["source"] == "deterministic" and doc["generated_by"].endswith("/renderer")
    # The API layer builds the row straight from this, and nothing here can sign it.
    assert "approved_by" not in doc
    with session_scope() as s:
        row = IncidentDocument(**{k: v for k, v in doc.items()})
        s.add(row)
        s.flush()
        assert row.approved_by == ""


async def test_a_generated_document_is_used_when_every_fact_in_it_is_in_the_record(db) -> None:  # noqa: ANN001
    body = (
        "ICS-214 ACTIVITY LOG\n1. Incident Name: Excessive Heat Warning — 114F\n"
        "6. Activity Log:\n2026-09-09T14:02 Check-in call placed to Rosa Delgado.\n"
        "2026-09-09T14:05 Outcome URGENT; she said \"the cooler quit yesterday\".\n"
        "2026-09-09T14:07 WV-2 dispatched.\n"
    )
    doc = await documentation_agent.write_activity_log(
        hazard_id=HAZARD_ID, hazard=HAZARD, entries=ENTRIES, prepared_by="Alma Reyes",
        client=client_for([reply('{"title": "ICS-214 — Rosa Delgado", "body": %s, "notes": ""}'
                                 % json.dumps(body))]),
    )
    assert doc["fields"]["source"] == "model" and doc["body"] == body.strip()
    assert doc["generated_by"] == "documentation_agent/z-ai/glm-5.3-free"
    assert actions()[0].kind == "documentation" and actions()[0].error is None


async def test_an_invented_number_sends_the_document_back_to_the_renderer(db) -> None:  # noqa: ANN001
    """The failure mode that matters on a form somebody defends later: a count nobody counted reads
    exactly like a fact once it is typed under a numbered heading."""
    doc = await documentation_agent.write_activity_log(
        hazard_id=HAZARD_ID, hazard=HAZARD, entries=ENTRIES, prepared_by="Alma Reyes",
        client=client_for([reply('{"title": "t", "body": "6. Activity Log:\\n2026-09-09T14:02 Called '
                                 '17 households; 4 needed water."}')]),
    )
    assert doc["fields"]["source"] == "deterministic"
    assert "number not in the record" in doc["fields"]["fallback_reason"]
    assert "17" in actions()[0].error


async def test_an_invented_quote_sends_the_document_back_to_the_renderer(db) -> None:  # noqa: ANN001
    doc = await documentation_agent.write_activity_log(
        hazard_id=HAZARD_ID, hazard=HAZARD, entries=ENTRIES, prepared_by="Alma Reyes",
        client=client_for([reply('{"title": "t", "body": "2026-09-09T14:05 She said '
                                 '\\"I can\'t breathe and I think I am going to pass out\\"."}')]),
    )
    assert doc["fields"]["source"] == "deterministic"
    assert "quote not in the record" in doc["fields"]["fallback_reason"]


async def test_a_general_message_keeps_the_ics_213_blocks_and_leaves_the_reply_empty(db) -> None:  # noqa: ANN001
    doc = await documentation_agent.write_general_message(
        hazard_id=HAZARD_ID, hazard=HAZARD, to="Maryvale Cooling Centre", frm="Alma Reyes",
        subject="Two residents needing transport", at="2026-09-09T15:10",
        message_record={"residents_needing_transport": 2, "earliest_pickup": "2026-09-09T15:40"},
        reply_requested="Confirm capacity", client=None,
    )
    assert doc["form"] == "ICS-213"
    assert "2. To (Name/Position): Maryvale Cooling Centre" in doc["body"]
    assert "8. Reply: (unanswered)" in doc["body"]
    assert doc["fields"]["subject"] == "Two residents needing transport"


async def test_the_situation_report_counts_come_from_the_record_and_the_unreachable_are_in_it(db) -> None:  # noqa: ANN001
    stats = {"contacted": 10, "unreachable": 3, "urgent": 3, "needs_help": 3, "safe": 3, "dispatched": 4}
    doc = await documentation_agent.write_situation_report(
        hazard_id=HAZARD_ID, hazard=HAZARD, stats=stats, entries=ENTRIES, prepared_by="Alma Reyes", client=None,
    )
    assert doc["form"] == "situation_report" and doc["incident_id"] is None
    assert doc["fields"]["stats"] == stats
    assert "unreachable: 3" in doc["body"] and "contacted: 10" in doc["body"]
    system = documentation_agent.SYSTEM
    assert "NEVER INVENT A DETAIL" in system and "not recorded" in system
    assert "NUMBERS AND TIMES ARE COPIED, NEVER COMPUTED" in system


def test_the_grounding_checks_catch_what_they_are_for() -> None:
    corpus = documentation_agent.record_corpus({"entries": ENTRIES, "stats": {"unreachable": 3}})
    assert documentation_agent.ungrounded_numbers("3 unreachable at 2026-09-09T14:02", corpus) == []
    assert documentation_agent.ungrounded_numbers("17 households were contacted", corpus) == ["17"]
    assert documentation_agent.ungrounded_quotes('She said "the cooler quit yesterday".', corpus) == []
    assert documentation_agent.ungrounded_quotes('She said "I am having chest pain".', corpus)


# --------------------------------------------------------------------------- correspondence
async def test_the_message_after_nobody_answers_says_what_is_not_known(db) -> None:  # noqa: ANN001
    attempts = [{"at": "2026-09-09T14:02", "outcome": "no answer"},
                {"at": "2026-09-09T14:35", "outcome": "no answer"}]
    draft = await correspondence_agent.draft_contact_message(
        hazard_id=HAZARD_ID, hazard=HAZARD, neighbour=NEIGHBOUR, attempts=attempts,
        captain_name="Alma Reyes", client=None,
    )
    assert draft["to_name"] == "Elena Delgado" and draft["to_ref"] == NEIGHBOUR["contact_phone"]
    assert "we do not know how they are" in draft["body"]
    assert "2026-09-09T14:35" in draft["body"] and "Rosa Delgado" in draft["body"]
    assert correspondence_agent.implies_already_sent(draft["body"]) == ""
    # A draft is not a message: the row it builds has never been sent and nobody has approved it.
    with session_scope() as s:
        row = Correspondence(**{k: v for k, v in draft.items() if k != "operator_action_id"})
        s.add(row)
        s.flush()
        assert row.sent_at is None and row.approved_by == ""
    assert actions()[0].kind == "correspondence" and actions()[0].output["sent"] is False


async def test_a_draft_claiming_help_is_on_the_way_is_thrown_out(db) -> None:  # noqa: ANN001
    """The sentence that turns a helpful note into a harmful one: a daughter who believes paramedics
    are coming stops making her own calls."""
    draft = await correspondence_agent.draft_contact_message(
        hazard_id=HAZARD_ID, hazard=HAZARD, neighbour=NEIGHBOUR, captain_name="Alma Reyes",
        client=client_for([reply('{"subject": "Your mother", "body": "We could not reach Rosa today. '
                                 'An ambulance is on its way to her now."}')]),
    )
    assert draft["drafted_by"].endswith("/template")
    assert "ambulance" not in draft["body"]
    assert "already coming" in actions()[0].error


@pytest.mark.parametrize("text,caught", [
    ("An ambulance is on its way to her now.", True),
    ("We have already called 911 about her.", True),
    ("Help is on the way.", True),
    ("This message was sent to her doctor as well.", True),
    ("Nobody answered, so we do not know how she is — could you look in?", False),
    ("A volunteer dropped off water at 14:07 and she was up and about.", False),
])
def test_the_one_claim_a_draft_may_never_make(text: str, caught: bool) -> None:
    assert bool(correspondence_agent.implies_already_sent(text)) is caught


async def test_a_good_family_update_is_used_and_says_what_was_actually_found(db) -> None:  # noqa: ANN001
    visit = {"who": "WV-2 (Marisol and Dan)", "arrived_at": "2026-09-09T14:41",
             "found": "the swamp cooler was not running and the house was hot",
             "actions": "left four gallons of water and a box fan running",
             "outstanding": "the cooler still needs a repair visit"}
    body = ("Hello Elena, Marisol and Dan called at your mother's at 2026-09-09T14:41. The swamp cooler "
            "was not running and the house was hot. They left four gallons of water and a box fan "
            "running, and she was sitting up talking with them when they left. The cooler still needs a "
            "repair visit — shall we ask the handyman list?")
    draft = await correspondence_agent.draft_family_update(
        hazard_id=HAZARD_ID, hazard=HAZARD, neighbour=NEIGHBOUR, visit=visit, captain_name="Alma Reyes",
        client=client_for([reply('{"subject": "We looked in on your mum", "body": %s}'
                                 % json.dumps(body))]),
    )
    assert draft["body"] == body and draft["drafted_by"].endswith("z-ai/glm-5.3-free")
    assert draft["subject"] == "We looked in on your mum"
    assert actions()[0].error is None


async def test_the_agency_covering_note_carries_the_address_and_says_it_is_not_sent(db) -> None:  # noqa: ANN001
    """A packet with the address masked helps nobody, so the covering note is not redacted beyond
    phones — and it states plainly that it has not been sent, because it has not."""
    packet = {"last_contact_at": "2026-09-09T14:05", "last_words": "I just sit still",
              "concerns": ["swamp cooler not working since yesterday"],
              "recommended_action": "Welfare check and cooling"}
    draft = await correspondence_agent.draft_agency_message(
        hazard_id=HAZARD_ID, hazard=HAZARD, neighbour=NEIGHBOUR, packet=packet,
        agency="Phoenix Fire — Community Assistance", captain_name="Alma Reyes", client=None,
    )
    assert "4312 W Osborn Rd" in draft["body"] and "side gate, small dog in yard" in draft["body"]
    assert "copd" in draft["body"].lower()
    assert "It has not been sent." in draft["body"]
    assert draft["channel"] == "call_script" and draft["to_ref"] == ""
    # The phone number never reaches the stored provenance either.
    assert "+15550142" not in str(actions()[0].inputs)


async def test_the_rules_that_make_a_draft_safe_are_in_the_prompt(db) -> None:  # noqa: ANN001
    system = correspondence_agent.SYSTEM
    assert "NEVER SAY HELP IS ALREADY COMING" in system
    assert "NEVER INVENT" in system and "WARM, PLAIN AND SHORT" in system
    assert "GIVE THEM ONE CLEAR THING TO DO" in system


# --------------------------------------------------------------------------- the real seam
# Everything above hands the agent hand-written candidate dicts. This one runs the actual pipeline:
# fleet filters the fleet and computes real distances from real Maryvale coordinates, the agent
# chooses among what fleet allowed, and fleet's own gate re-checks the choice before it counts.

def _real_fleet() -> tuple[Any, list[Any], Any]:
    from app.domain import fleet
    from app.domain.state import AssetKind, AssetStatus
    from app.models import Asset, Incident

    incident = Incident(hazard_id=HAZARD_ID, sweep_id="swp_1", neighbour_id=NEIGHBOUR["id"],
                        outcome="URGENT", priority=2, address=NEIGHBOUR["address"],
                        lat=33.4936, lon=-112.1560, needs=["water", "assess"])
    assets = [
        Asset(call_sign="WV-2", kind=AssetKind.WELLNESS_VAN, capabilities=["water", "assess"], capacity=4,
              lat=33.5089, lon=-112.1450, base_lat=33.5089, base_lon=-112.1450, status=AssetStatus.AVAILABLE),
        Asset(call_sign="NURSE-1", kind=AssetKind.NURSE_OUTREACH, capabilities=["assess"], capacity=2,
              lat=33.4790, lon=-112.1900, base_lat=33.4790, base_lon=-112.1900, status=AssetStatus.AVAILABLE),
    ]
    report = fleet.eligible(assets, incident)
    return incident, assets, fleet.rank(report.candidates, priority=2)


async def test_fleet_filters_the_agent_chooses_and_fleet_checks_the_choice(db) -> None:  # noqa: ANN001
    incident, assets, candidates = _real_fleet()
    nurse = next(c for c in candidates if c.call_sign == "NURSE-1")
    proposal = await dispatch_agent.propose_dispatch(
        hazard_id=HAZARD_ID, hazard=HAZARD, incident=incident.model_dump(), incident_id=incident.id,
        situation=SITUATION, risk_reasons=RISK_REASONS, needs=incident.needs, candidates=candidates,
        client=client_for([reply('{"asset_id": "%s", "reason": "She has COPD and has not been out of the '
                                 'chair since yesterday; NURSE-1 can assess her."}' % nurse.asset_id)]),
    )
    assert proposal.asset_id == nurse.asset_id and proposal.source == "model"
    # The numbers on the proposal are the ones geo computed, to the decimal.
    assert proposal.eta_minutes == nurse.eta_minutes and proposal.distance_miles == nurse.distance_miles
    assert proposal.distance_miles > 0 and proposal.requires_authorisation is False


async def test_a_unit_that_got_busy_while_the_model_was_thinking_is_caught_by_fleet(db) -> None:  # noqa: ANN001
    """The free tier takes 20-100 seconds. Things move. This is why the choice is re-validated rather
    than trusted, and it is fleet's own gate doing it — no validator was injected here."""
    from app.domain.state import AssetStatus

    incident, assets, candidates = _real_fleet()
    nurse = next(c for c in candidates if c.call_sign == "NURSE-1")
    nurse.asset.status = AssetStatus.ASSIGNED  # committed elsewhere while the model was thinking
    proposal = await dispatch_agent.propose_dispatch(
        hazard_id=HAZARD_ID, hazard=HAZARD, incident=incident.model_dump(), incident_id=incident.id,
        situation=SITUATION, risk_reasons=RISK_REASONS, needs=incident.needs, candidates=candidates,
        client=client_for([reply('{"asset_id": "%s", "reason": "can assess her"}' % nurse.asset_id)]),
    )
    assert proposal.asset_id == candidates[0].asset_id and proposal.source == "deterministic"
    assert "not available" in proposal.fallback_reason


# --------------------------------------------------------------------------- the caller's contract
async def test_provenance_can_be_written_into_the_caller_s_own_session(db) -> None:  # noqa: ANN001
    """The free tier takes 20-100 s and sqlite has a five-second busy timeout, so a caller must not
    hold a session open across an agent call. When it has to, it passes the session in and the row
    lands inside its own transaction instead of stalling behind it."""
    with session_scope() as s:
        proposal = await dispatch_agent.propose_dispatch(
            hazard_id=HAZARD_ID, hazard=HAZARD, incident=INCIDENT, incident_id=INCIDENT["id"],
            situation=SITUATION, risk_reasons=RISK_REASONS, needs=INCIDENT["needs"],
            candidates=CANDIDATES, client=None, session=s,
        )
        rows = s.exec(select(OperatorAction)).all()
        assert len(rows) == 1 and rows[0].id == proposal.action_id
    assert len(actions()) == 1  # and it survived the commit


async def test_a_hazardless_call_still_leaves_a_row(db) -> None:  # noqa: ANN001
    """A wiring mistake must cost the hazard attribution, never the audit trail."""
    from app.agents.client import UNATTRIBUTED

    record_action(hazard_id="", kind="documentation", agent="t", rationale="orphan")
    assert actions()[0].hazard_id == UNATTRIBUTED


async def test_real_datetimes_in_the_record_do_not_condemn_every_document(db) -> None:  # noqa: ANN001
    """The check that would quietly disable this layer. Records carry real datetime columns, and
    str(datetime) keeps seconds and microseconds — so unless the agent normalises them first, a model
    writing the sensible "14:02" invents digits and every document falls back forever."""
    from datetime import datetime

    entries = [{"at": datetime(2026, 9, 9, 14, 2, 31, 123456), "text": "Call placed to Rosa Delgado."},
               {"at": datetime(2026, 9, 9, 14, 5, 9), "text": "Outcome URGENT."}]
    body = ("6. Activity Log:\n2026-09-09T14:02 Call placed to Rosa Delgado.\n"
            "2026-09-09T14:05 Outcome URGENT.\n")
    doc = await documentation_agent.write_activity_log(
        hazard_id=HAZARD_ID, hazard=HAZARD, entries=entries, prepared_by="Alma Reyes",
        client=client_for([reply(json.dumps({"title": "t", "body": body}))]),
    )
    assert doc["fields"]["source"] == "model", doc["fields"].get("fallback_reason")
    # and the renderer, the prompt and the grounding corpus all say the same thing
    assert "123456" not in documentation_agent.render_activity_log(
        hazard=HAZARD, entries=documentation_agent.normalise_record(entries),
        unit="u", prepared_by="Alma Reyes")
