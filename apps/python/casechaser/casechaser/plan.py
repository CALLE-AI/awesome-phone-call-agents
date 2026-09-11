"""Turn a case and its history into one CALL-E task: instruction text plus a closed result schema."""
from __future__ import annotations

from typing import Any, Dict, List

from .models import CALL_OUTCOMES, ESCALATION_LADDER
from .policy import HARD_BOUNDARIES

RESULT_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["outcome", "status_statement", "reference_number", "representative", "commitment_action",
                 "commitment_by_date", "commitment_quote", "customer_action_required", "offer_quote",
                 "ivr_path", "needs_human", "needs_human_reason"],
    "properties": {
        "outcome": {"type": "string", "enum": list(CALL_OUTCOMES),
                    "description": "resolved: company confirms the owed action is complete. in_progress: still being handled. needs_customer_action: the customer must do something first. denied: the company refuses. offer_made: a settlement, credit, or partial offer was stated. unknown: nothing usable learned. unreached: no human reached."},
        "status_statement": {"type": "string", "description": "One sentence in the representative's own words describing the current status."},
        "reference_number": {"type": "string", "description": "Any new or confirmed case, ticket, claim, or interaction reference. Empty string if none."},
        "representative": {"type": "string", "description": "First name and department of the person spoken to, or empty string."},
        "commitment_action": {"type": "string", "description": "What the company committed to do next, in plain words. Empty string if nothing was committed."},
        "commitment_by_date": {"type": "string", "description": "ISO date YYYY-MM-DD by which the company said it will act, or empty string. Convert 'five business days' to a date."},
        "commitment_quote": {"type": "string", "description": "Exact words the representative used for the commitment. Empty string if none."},
        "customer_action_required": {"type": "string", "description": "Anything the customer must send, sign, or confirm, or empty string."},
        "offer_quote": {"type": "string", "description": "Exact words of any settlement, refund amount, credit, or fee offer. Empty string if none."},
        "ivr_path": {"type": "string", "description": "Menu options pressed or said to reach a person, for example '2, 4, say claims'. Empty string if none."},
        "needs_human": {"type": "boolean", "description": "true when the customer must decide something, an offer was made, identity could not be verified, or the representative asked a question the agent was not authorised to answer."},
        "needs_human_reason": {"type": "string", "description": "Why a human is needed, or empty string."},
    },
}


def history_lines(case: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    for call in case.get("calls", []):
        r = call.get("structured_result") or {}
        if not r:
            lines.append(f"- {call['created_at'][:10]}: call placed, no usable result ({call.get('status')}).")
            continue
        who = r.get("representative") or "a representative"
        line = f"- {call['created_at'][:10]}: spoke to {who}; outcome {r.get('outcome')}. {r.get('status_statement','')}"
        if r.get("commitment_action"):
            line += f" They committed to: {r['commitment_action']} by {r.get('commitment_by_date') or 'an unspecified date'}."
        if r.get("reference_number"):
            line += f" Reference given: {r['reference_number']}."
        lines.append(line)
    for c in case.get("commitments", []):
        if c["status"] == "broken":
            lines.append(f"- BROKEN COMMITMENT: '{c['quote']}' (due {c['by_date']}), not honoured.")
    for d in case.get("human_decisions", []):
        lines.append(f"- Customer decision on {d['at'][:10]}: {d['decision']}")
    return lines


def build_task(case: Dict[str, Any]) -> str:
    level = ESCALATION_LADDER[min(case.get("escalation_level", 0), len(ESCALATION_LADDER) - 1)]
    facts = "; ".join(f"{k}: {v}" for k, v in case.get("identity_facts", {}).items()) or "none provided"
    parts = [
        f"Call {case['company']} customer service about an open {case['case_type'].replace('_', ' ')} on behalf of {case['customer_name']}.",
        f"Case reference: {case['reference']}. Opened on {case['opened_on']}.",
        f"Background: {case['summary']}",
        f"What the company owes the customer: {case['what_is_owed']}",
        f"Identity details you may give if asked to locate the case: {facts}.",
    ]
    ivr = case.get("ivr_path_learned") or case.get("ivr_hints")
    if ivr:
        parts.append(f"IVR guidance: {ivr.rstrip('.')}. Navigate the phone menu to reach a person handling this kind of case.")
    hist = history_lines(case)
    if hist:
        parts.append("History of previous calls:\n" + "\n".join(hist))
    goals = [
        "Goal for this call: get the current status of the case in the representative's own words,",
        "confirm or obtain a reference number, and obtain a specific commitment: what the company will do next and by which date.",
    ]
    if level == "supervisor":
        goals.append("A previous commitment was not honoured. Politely ask to speak with a supervisor or team lead, state the broken commitment with its date, and ask for a firm new date.")
    elif level in ("written_complaint", "regulator"):
        goals.append("Commitments have been broken more than once. Ask for the formal complaints process, the address or email for written complaints, and the complaint reference. Do not argue.")
    parts.append(" ".join(goals))
    parts.append("Rules you must follow:\n" + "\n".join(f"- {b}" for b in HARD_BOUNDARIES))
    parts.append("End the call by summarising the commitment back to the representative and thanking them.")
    return "\n\n".join(parts)


def build_request(case: Dict[str, Any], idempotency_key: str, webhook_url: str = "") -> Dict[str, Any]:
    req: Dict[str, Any] = {
        "task": build_task(case),
        "recipients": [{"phones": [case["hotline"]], "region": case["region"], "locale": case.get("locale", "en-US")}],
        "result_schema": RESULT_SCHEMA,
        "metadata": {"app": "casechaser", "case_id": case["id"], "reference": case["reference"], "idempotency_key": idempotency_key},
    }
    if webhook_url:
        req["webhook_url"] = webhook_url
    return req
