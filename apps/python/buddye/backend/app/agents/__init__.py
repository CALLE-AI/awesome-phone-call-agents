"""The AI operator agents: propose a dispatch, write the paperwork, draft the message.

Three agents, one shared client, one rule they all obey — **the model proposes, deterministic code
disposes.** Each of them has a deterministic answer it can produce with no model at all (fleet's own
top-ranked asset, the rendered ICS form, the plain template message), and the model's output is only
ever used after code has checked it against the record. Every failure path — no key, a timeout, a
gateway that dies, JSON that will not parse, a choice that is not legal, a fact nobody recorded —
lands on that deterministic answer, and every one of them leaves an `OperatorAction` row saying so.

That is why an agent can never break a sweep, and why nothing here needs a network connection to be
correct.
"""
from __future__ import annotations

from app.agents.client import (
    ACTION_KINDS,
    UNATTRIBUTED,
    AgentCall,
    AgentClient,
    build_client,
    extract_json_object,
    is_response_format_rejection,
    record_action,
)
from app.agents.correspondence_agent import (
    draft_agency_message,
    draft_contact_message,
    draft_family_update,
    implies_already_sent,
)
from app.agents.dispatch_agent import DispatchProposal, deterministic_proposal, propose_dispatch
from app.agents.documentation_agent import (
    normalise_record,
    record_corpus,
    ungrounded_numbers,
    ungrounded_quotes,
    write_activity_log,
    write_general_message,
    write_situation_report,
)

__all__ = [
    "ACTION_KINDS",
    "UNATTRIBUTED",
    "AgentCall",
    "AgentClient",
    "DispatchProposal",
    "build_client",
    "deterministic_proposal",
    "draft_agency_message",
    "draft_contact_message",
    "draft_family_update",
    "extract_json_object",
    "implies_already_sent",
    "is_response_format_rejection",
    "normalise_record",
    "propose_dispatch",
    "record_action",
    "record_corpus",
    "ungrounded_numbers",
    "ungrounded_quotes",
    "write_activity_log",
    "write_general_message",
    "write_situation_report",
]
