"""One chase cycle: may we call, what do we say, what came back, what changes in the ledger."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from . import policy
from .client import CalleClient
from .models import ESCALATION_LADDER, Ledger, add_commitment, mask_phone, now_iso
from .plan import RESULT_SCHEMA, build_request

MODES = ("preview", "fixture", "live")
JSON_TYPES = {"string": str, "boolean": bool}


class ChaseResult(dict):
    """Outcome of run_cycle: {'placed': bool, 'reason': str, 'call': dict|None, 'case': dict}."""


def idempotency_key() -> str:
    """One key per attempted call, recorded on the case before the request leaves the machine."""
    return "casechaser-" + uuid.uuid4().hex


def validate_result(result: Any) -> List[str]:
    """Validate a structured result against RESULT_SCHEMA in full: closed field set, every field present,
    exact JSON type per field, enum membership, and a real calendar date. Any problem means the result is unusable."""
    problems: List[str] = []
    if not isinstance(result, dict):
        return ["no structured result"]
    props = RESULT_SCHEMA["properties"]
    for key in result:
        if key not in props:
            problems.append(f"unexpected field {key}")
    for key in RESULT_SCHEMA["required"]:
        if key not in result:
            problems.append(f"missing {key}")
            continue
        expected = JSON_TYPES[props[key]["type"]]
        value = result[key]
        if expected is str and (not isinstance(value, str)):
            problems.append(f"{key} must be a string")
        elif expected is bool and (not isinstance(value, bool)):
            problems.append(f"{key} must be a boolean")
    outcome = result.get("outcome")
    if isinstance(outcome, str) and outcome not in props["outcome"]["enum"]:
        problems.append(f"bad outcome {outcome!r}")
    bd = result.get("commitment_by_date")
    if isinstance(bd, str) and bd:
        try:
            datetime.strptime(bd, "%Y-%m-%d")
        except ValueError:
            problems.append(f"commitment_by_date not YYYY-MM-DD: {bd!r}")
    return problems


def check_broken_commitments(case: Dict[str, Any], now_utc: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Mark pending commitments whose date plus grace has passed without resolution."""
    now_utc = now_utc or datetime.now(timezone.utc)
    broken: List[Dict[str, Any]] = []
    if case["status"] in ("resolved", "denied", "abandoned"):
        return broken
    for c in case["commitments"]:
        if c["status"] != "pending" or not c.get("by_date"):
            continue
        try:
            due = datetime.fromisoformat(c["by_date"]).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if (now_utc - due).days >= policy.GRACE_DAYS_AFTER_PROMISE:
            c["status"] = "broken"
            broken.append(c)
    if broken:
        case["escalation_level"] = min(case.get("escalation_level", 0) + 1, len(ESCALATION_LADDER) - 1)
        case["next_call_after"] = None
    return broken


def _stop_for_human(case: Dict[str, Any], call_record: Dict[str, Any], question: str, disposition: str) -> None:
    case["status"] = "needs_human"
    case["pending_question"] = question
    case["next_call_after"] = None
    call_record["disposition"] = disposition


def apply_result(case: Dict[str, Any], call_record: Dict[str, Any]) -> None:
    """Fold a terminal call into the case: status, commitments, IVR memory, human queue.

    Nothing ambiguous schedules another call. An unusable or unknown result stops the case at a human."""
    r = call_record.get("structured_result")
    problems = validate_result(r)
    call_record["result_problems"] = problems
    if problems:
        _stop_for_human(case, call_record, "The last call returned a result the app could not validate (" + "; ".join(problems) +
                        "). Review the transcript, then record a decision to resume chasing or close the case.", "unusable")
        return
    if r.get("ivr_path"):
        case["ivr_path_learned"] = r["ivr_path"]
    outcome = r["outcome"]
    if outcome == "resolved":
        for c in case["commitments"]:
            if c["status"] == "pending":
                c["status"] = "kept"
    elif r.get("commitment_action"):
        for c in case["commitments"]:
            if c["status"] == "pending":
                c["status"] = "superseded"
    if r.get("commitment_action"):
        add_commitment(case, call_record["id"], r["commitment_action"], r.get("commitment_by_date") or None,
                       r.get("commitment_quote") or r["commitment_action"], r.get("representative") or "representative")
    if r.get("needs_human") or outcome == "offer_made":
        q = r.get("needs_human_reason") or "Decision required."
        if r.get("offer_quote"):
            q = f"Offer made: \"{r['offer_quote']}\" {q}"
        _stop_for_human(case, call_record, q, "needs_human")
    elif outcome == "resolved":
        case["status"] = "resolved"
        case["closed_at"] = now_iso()
        case["next_call_after"] = None
        call_record["disposition"] = "resolved"
    elif outcome == "denied":
        _stop_for_human(case, call_record, "The company denied the case: " + (r.get("status_statement") or ""), "denied")
    elif outcome == "needs_customer_action":
        case["status"] = "waiting_on_customer"
        case["pending_question"] = r.get("customer_action_required") or "Customer action required."
        case["next_call_after"] = None
        call_record["disposition"] = "customer_action"
    elif outcome == "in_progress":
        case["status"] = "waiting_on_company"
        case["next_call_after"] = policy.next_call_after(r.get("commitment_by_date") or None)
        call_record["disposition"] = "chase_later"
    elif outcome == "unreached":
        case["status"] = "open"
        case["next_call_after"] = policy.next_call_after(None)
        call_record["disposition"] = "retry"
    else:  # unknown: something happened on the line but nothing usable was learned; a human looks first
        _stop_for_human(case, call_record, "The call ended without a usable outcome: " + (r.get("status_statement") or "no status statement") +
                        ". Review the transcript, then record a decision to resume chasing or close the case.", "unknown")


# ----------------------------------------------------------------------------------------------
# Live authorization
# ----------------------------------------------------------------------------------------------

def new_authorization(case: Dict[str, Any], expires_on: str, max_calls: int, unattended: bool) -> Dict[str, Any]:
    """The operator's record of exactly which number may be dialled for this case, until when, how often."""
    datetime.strptime(expires_on, "%Y-%m-%d")
    problems = policy.destination_problems(case["hotline"], case["region"])
    if problems:
        raise ValueError("cannot authorize an invalid destination: " + "; ".join(v for _, v in problems))
    return {"case_id": case["id"], "destination": case["hotline"], "region": case["region"], "authorized_at": now_iso(),
            "expires_on": expires_on, "max_calls": int(max_calls), "calls_used": 0, "unattended": bool(unattended)}


def authorization_problems(case: Dict[str, Any], auth: Optional[Dict[str, Any]], unattended: bool,
                           now_utc: Optional[datetime] = None) -> List[str]:
    now_utc = now_utc or datetime.now(timezone.utc)
    if not isinstance(auth, dict):
        return ["no authorization record for this case; run `casechaser authorize <case_id> ...` first"]
    problems: List[str] = []
    if auth.get("case_id") != case["id"]:
        problems.append("authorization record belongs to a different case")
    if auth.get("destination") != case["hotline"]:
        problems.append(f"authorized destination {mask_phone(str(auth.get('destination', '')))} is not the case hotline {mask_phone(case['hotline'])}")
    if auth.get("region") != case.get("region"):
        problems.append("authorized region differs from the case region")
    try:
        if datetime.strptime(str(auth.get("expires_on")), "%Y-%m-%d").date() < now_utc.date():
            problems.append(f"authorization expired on {auth.get('expires_on')}")
    except ValueError:
        problems.append("authorization has no valid expiry date")
    if int(auth.get("calls_used", 0)) >= int(auth.get("max_calls", 0)):
        problems.append("authorized call budget exhausted")
    if unattended and not auth.get("unattended"):
        problems.append("authorization does not permit unattended (scheduled) runs")
    return problems


# ----------------------------------------------------------------------------------------------
# Cycle
# ----------------------------------------------------------------------------------------------

def _fold_terminal(case: Dict[str, Any], terminal: Dict[str, Any], mode: str, key: str) -> Dict[str, Any]:
    call_record = {
        "id": terminal["id"], "created_at": now_iso(), "mode": mode, "status": terminal.get("status"),
        "hotline_masked": mask_phone(case["hotline"]), "escalation_level": case.get("escalation_level", 0),
        "summary": terminal.get("summary"), "task_completed": terminal.get("task_completed"),
        "completion_confidence": terminal.get("completion_confidence"), "evidence": terminal.get("evidence", []),
        "structured_result": terminal.get("structured_result"),
        "transcript": [t for rcp in terminal.get("recipients", []) for a in rcp.get("attempts", []) for t in a.get("transcript_turns", [])],
        "failure_code": terminal.get("failure_code"), "idempotency_key": key,
    }
    case["calls"].append(call_record)
    apply_result(case, call_record)
    case["pending_call"] = None
    return call_record


def run_cycle(ledger: Ledger, case_id: str, mode: str, client: Optional[CalleClient] = None,
              fixture_scenario: Optional[str] = None, force: bool = False, webhook_url: str = "",
              authorization: Optional[Dict[str, Any]] = None, unattended: bool = False) -> ChaseResult:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    if mode == "live" and force:
        raise ValueError("force is not available in live mode: every policy hold applies to a real call")
    case = ledger.get(case_id)
    if mode == "live":
        problems = authorization_problems(case, authorization, unattended)
        if problems:
            return ChaseResult(placed=False, reason="not authorized: " + "; ".join(problems), call=None, case=case)
    check_broken_commitments(case)
    reasons = policy.suppression_reasons(case)
    if reasons and not force:
        ledger.upsert(case)
        return ChaseResult(placed=False, reason="; ".join(f"{k}: {v}" for k, v in reasons), call=None, case=case)
    key = idempotency_key()
    request = build_request(case, key, webhook_url)
    if mode == "fixture" and fixture_scenario:
        request["metadata"]["fixture_scenario"] = fixture_scenario
    if mode == "preview":
        ledger.upsert(case)
        return ChaseResult(placed=False, reason="preview: no call placed", call=None, case=case, request=request,
                           masked_hotline=mask_phone(case["hotline"]))
    if client is None:
        raise ValueError("client required for fixture and live modes")
    # Record the intent before anything leaves the machine. If the process dies between here and the fold,
    # the case holds with pending_reconciliation until an operator reconciles it; it is never re-dialled blind.
    case["pending_call"] = {"idempotency_key": key, "started_at": now_iso(), "mode": mode, "call_id": None}
    ledger.upsert(case)
    created = client.create_call(request, key)
    case["pending_call"]["call_id"] = created["id"]
    ledger.upsert(case)
    terminal = client.wait(created["id"], poll_seconds=0.05 if mode == "fixture" else 5.0)
    call_record = _fold_terminal(case, terminal, mode, key)
    if authorization is not None:
        authorization["calls_used"] = int(authorization.get("calls_used", 0)) + 1
    ledger.upsert(case)
    return ChaseResult(placed=True, reason="ok", call=call_record, case=case)


def reconcile(ledger: Ledger, case_id: str, client: Optional[CalleClient] = None, call_id: Optional[str] = None,
              clear: bool = False) -> ChaseResult:
    """Resolve a call that was sent but never recorded. With a known call id the terminal result is fetched and folded
    in; with --clear the operator asserts (after checking the CALL-E dashboard) that no call was created."""
    case = ledger.get(case_id)
    pc = case.get("pending_call")
    if not pc:
        return ChaseResult(placed=False, reason="nothing pending", call=None, case=case)
    cid = call_id or pc.get("call_id")
    if clear:
        case.setdefault("human_decisions", []).append({"at": now_iso(), "question": f"pending call {cid or pc['idempotency_key']}",
                                                       "decision": "operator confirmed no call was created; cleared"})
        case["pending_call"] = None
        ledger.upsert(case)
        return ChaseResult(placed=False, reason="cleared", call=None, case=case)
    if not cid:
        return ChaseResult(placed=False, reason="no call id recorded; find it in the CALL-E dashboard and pass --call-id, "
                                                "or pass --clear after confirming no call exists", call=None, case=case)
    if client is None:
        raise ValueError("client required to fetch the pending call")
    terminal = client.wait(cid, poll_seconds=0.05 if pc.get("mode") == "fixture" else 5.0)
    call_record = _fold_terminal(case, terminal, pc.get("mode", "live"), pc["idempotency_key"])
    ledger.upsert(case)
    return ChaseResult(placed=True, reason="reconciled", call=call_record, case=case)


def record_decision(ledger: Ledger, case_id: str, decision: str, resume: bool = True) -> Dict[str, Any]:
    """A human answers the pending question. The decision is carried into the next call's history."""
    case = ledger.get(case_id)
    case["human_decisions"].append({"at": now_iso(), "question": case.get("pending_question", ""), "decision": decision})
    case["pending_question"] = ""
    if resume:
        case["status"] = "open"
        case["next_call_after"] = None
    ledger.upsert(case)
    return case


def evidence_pack(case: Dict[str, Any]) -> str:
    """Dated, quoted record of every call and commitment, ready to attach to a written complaint."""
    lines = [f"# Evidence pack: {case['company']} case {case['reference']}", "",
             f"Customer: {case['customer_name']}  |  Case type: {case['case_type']}  |  Opened: {case['opened_on']}",
             f"Owed: {case['what_is_owed']}", f"Current status: {case['status']}  |  Escalation level: {ESCALATION_LADDER[min(case['escalation_level'], 3)]}", "",
             "## Calls", ""]
    for i, c in enumerate(case["calls"], 1):
        r = c.get("structured_result") if not c.get("result_problems") else {}
        r = r or {}
        lines.append(f"### Call {i}: {c['created_at'][:16].replace('T', ' ')} UTC to {c['hotline_masked']} ({c['mode']})")
        lines.append(f"- Outcome: {r.get('outcome', c.get('disposition') or c.get('status'))}")
        if r.get("representative"):
            lines.append(f"- Spoke to: {r['representative']}")
        if r.get("reference_number"):
            lines.append(f"- Reference given: {r['reference_number']}")
        if r.get("status_statement"):
            lines.append(f"- Status stated: \"{r['status_statement']}\"")
        if r.get("commitment_quote"):
            lines.append(f"- Commitment: \"{r['commitment_quote']}\" (by {r.get('commitment_by_date') or 'unspecified'})")
        if r.get("offer_quote"):
            lines.append(f"- Offer made: \"{r['offer_quote']}\"")
        for ev in c.get("evidence", []) or []:
            lines.append(f"- Evidence: {ev}")
        lines.append("")
    lines += ["## Commitments", ""]
    for c in case["commitments"]:
        lines.append(f"- [{c['status']}] {c['action']} by {c['by_date'] or 'unspecified'}: \"{c['quote']}\" ({c['who']})")
    lines += ["", "## Customer decisions", ""]
    for d in case["human_decisions"]:
        lines.append(f"- {d['at'][:10]}: {d['decision']} (question: {d['question']})")
    return "\n".join(lines) + "\n"
