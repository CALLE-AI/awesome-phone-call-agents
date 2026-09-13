"""One resolution cycle: analyse, plan, approve, call, fold the result into the case.

Preview and fixture modes place no call. Live mode places exactly one call per
explicit approval and never redials automatically: wait() only polls the status
of the call that was already created.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from . import policy
from .analysis import analyze_case
from .calle_client import CalleClient
from .call_plan import RESULT_SCHEMA, build_plan, build_request, build_task
from .models import mask_phone, now_iso, resolution_snapshot

MODES = ("preview", "fixture", "live")

# Live CALL-E result schemas have no null type: three-state answers arrive as
# "yes" / "no" / "unknown" strings and are mapped to True / False / None here,
# so the case model keeps a real unknown instead of a guess.
TRISTATE_MAP = {"yes": True, "no": False, "unknown": None}
TRISTATE_FIELDS = {
    "replacement_itinerary": "available",
    "hotel": "authorised",
    "meals": "available",
    "written_confirmation": "promised",
}

BEFORE_AFTER_ROWS = (
    ("cancellation_reason", "Cancellation reason"),
    ("replacement_itinerary", "Replacement itinerary"),
    ("hotel", "Hotel"),
    ("meals", "Meals"),
    ("written_confirmation", "Written confirmation"),
)


class RunResult(dict):
    """Outcome of run(): {'placed': bool, 'reason': str, 'call': dict|None, ...}."""


def idempotency_key() -> str:
    """One key per approved call, recorded on the case before the request leaves the machine."""
    return "claimcall-" + uuid.uuid4().hex


def _type_ok(value: Any, declared: Any) -> bool:
    allowed = declared if isinstance(declared, list) else [declared]
    for t in allowed:
        if t == "string" and isinstance(value, str):
            return True
        if t == "boolean" and isinstance(value, bool):
            return True
        if t == "null" and value is None:
            return True
        if t == "array" and isinstance(value, list):
            return True
        if t == "object" and isinstance(value, dict):
            return True
    return False


def validate_result(result: Any) -> List[str]:
    """Validate a structured result against RESULT_SCHEMA in full: closed field set,
    every field present, exact JSON type per field, string arrays. Any problem means
    the result is unusable and the case must go to human review."""
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
        value = result[key]
        declared = props[key]
        if declared["type"] == "object":
            if not isinstance(value, dict):
                problems.append(f"{key} must be an object")
                continue
            sub = declared["properties"]
            for sk in value:
                if sk not in sub:
                    problems.append(f"unexpected field {key}.{sk}")
            for sk in declared["required"]:
                if sk not in value:
                    problems.append(f"missing {key}.{sk}")
                elif not _type_ok(value[sk], sub[sk]["type"]):
                    problems.append(f"{key}.{sk} has the wrong type")
                elif "enum" in sub[sk] and value[sk] not in sub[sk]["enum"]:
                    problems.append(f"{key}.{sk} must be one of {sub[sk]['enum']}")
        elif declared["type"] == "array":
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                problems.append(f"{key} must be an array of strings")
        elif not _type_ok(value, declared["type"]):
            problems.append(f"{key} has the wrong type")
    return problems


def _display(value: Any) -> str:
    if value is None:
        return "Unknown"
    if isinstance(value, dict):
        flag = value.get("available", value.get("authorised", value.get("promised")))
        details = value.get("details")
        if flag is None and not details:
            return "Unknown"
        if details:
            return str(details)
        return "Yes" if flag else "No"
    return str(value)


def before_after(before: Dict[str, Any], after: Dict[str, Any]) -> List[Dict[str, str]]:
    """Row-by-row state change: the core answer to 'what changed because of the call?'."""
    rows = []
    for key, label in BEFORE_AFTER_ROWS:
        rows.append({"field": label, "before": _display(before.get(key)), "after": _display(after.get(key))})
    return rows


def extract_commitments(result: Dict[str, Any]) -> List[str]:
    return [c for c in result.get("representative_commitments", []) if isinstance(c, str) and c.strip()]


def recommended_next_action(case: Dict[str, Any]) -> str:
    """Deterministic next action from the structured state. Advisory only, never legal advice."""
    unresolved = case.get("unresolved_items") or []
    if unresolved:
        names = "; ".join(unresolved)
        return (
            f"Next action: follow up on the still-open items ({names}). "
            "Quote the recorded commitments when you follow up, and ask for written confirmation of anything new."
        )
    wc = case.get("written_confirmation") or {}
    if wc.get("promised"):
        return (
            "Next action: wait for the promised written confirmation and retain hotel/meal receipts. "
            "If the email is not received within the stated window, follow up using the recorded commitment."
        )
    return (
        "Next action: no written confirmation was promised on this call. "
        "Ask the airline for the disruption confirmation in writing and retain all disruption-related receipts."
    )


def apply_result(case: Dict[str, Any], call_record: Dict[str, Any]) -> None:
    """Fold a terminal call into the case.

    Nothing ambiguous mutates the case. An unusable result leaves every
    resolution fact untouched and the case goes to needs_human.
    """
    result = call_record.get("structured_result")
    problems = validate_result(result)
    call_record["result_problems"] = problems
    if problems:
        case["status"] = "needs_human"
        case["pending_question"] = (
            "The last call returned a result that could not be validated ("
            + "; ".join(problems)
            + "). Review the transcript, then re-run the call or resolve the case manually."
        )
        return
    assert isinstance(result, dict)
    case["before"] = resolution_snapshot(case)
    case["cancellation_reason"] = result.get("cancellation_reason") or None
    for key in ("replacement_itinerary", "hotel", "meals", "written_confirmation"):
        block = result.get(key) or {}
        case[key] = {
            TRISTATE_FIELDS[key]: TRISTATE_MAP[block.get(TRISTATE_FIELDS[key], "unknown")],
            "details": block.get("details") or None,
        }
    case["representative_commitments"] = extract_commitments(result)
    case["unresolved_items"] = [u for u in result.get("unresolved_items", []) if isinstance(u, str) and u.strip()]
    case["recommended_follow_up"] = result.get("recommended_follow_up") or None
    case["after"] = resolution_snapshot(case)
    case["before_after"] = before_after(case["before"], case["after"])
    case["recommended_next_action"] = recommended_next_action(case)
    if case["unresolved_items"]:
        case["status"] = "partially_resolved"
    else:
        case["status"] = "resolved"
    case["pending_question"] = ""


def preview(case: Dict[str, Any]) -> Dict[str, Any]:
    """No-call preview: exact destination (masked), purpose, objectives, restrictions, result schema."""
    analysis = analyze_case(case)
    plan = build_plan(case, analysis["missing_information"])
    task = build_task(case, plan)
    return {
        "placed": False,
        "reason": "preview: no call placed",
        "mode": "preview",
        "masked_destination": mask_phone(case["airline_hotline"]),
        "region": case["region"],
        "analysis": analysis,
        "plan": plan,
        "task": task,
        "result_schema": RESULT_SCHEMA,
    }


def _fold_terminal(case: Dict[str, Any], terminal: Dict[str, Any], mode: str, key: str,
                   dialed: Optional[str] = None) -> Dict[str, Any]:
    call_record = {
        "id": terminal["id"],
        "created_at": now_iso(),
        "mode": mode,
        "status": terminal.get("status"),
        "hotline_masked": mask_phone(dialed or case["airline_hotline"]),
        "summary": terminal.get("summary"),
        "task_completed": terminal.get("task_completed"),
        "completion_confidence": terminal.get("completion_confidence"),
        "evidence": terminal.get("evidence", []),
        "structured_result": terminal.get("structured_result"),
        "transcript": [t for rcp in terminal.get("recipients", []) for a in rcp.get("attempts", []) for t in a.get("transcript_turns", [])],
        "failure_code": terminal.get("failure_code"),
        "idempotency_key": key,
    }
    case["calls"].append(call_record)
    apply_result(case, call_record)
    return call_record


def run(
    case: Dict[str, Any],
    mode: str,
    client: Optional[CalleClient] = None,
    approved: bool = False,
    allowlist: Optional[str] = None,
    api_key_present: bool = False,
    live_destination: Optional[str] = None,
) -> RunResult:
    """Run one resolution cycle. Fixture and live share the same fold path.

    Fixture and live both require explicit approval; preview never dials and
    needs neither approval nor credentials. In live mode an explicit
    live_destination (typed into the dashboard) overrides the case hotline;
    it is validated and allowlisted exactly like the case number.
    """
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    if mode == "preview":
        return RunResult(preview(case))
    if not approved:
        return RunResult(placed=False, reason="refused: this call needs explicit human approval (Approve & Call)", call=None)
    if client is None:
        raise ValueError("client required for fixture and live modes")
    dialed = case["airline_hotline"]
    dest_region = case["region"]
    if mode == "live":
        if live_destination:
            dialed = live_destination.strip()
            derived = policy.region_for_number(dialed)
            if derived is None:
                return RunResult(placed=False, reason="refused: destination country code is not supported", call=None)
            dest_region = derived
        problems = policy.live_gate(dialed, dest_region, approved, api_key_present, allowlist)
        if problems:
            return RunResult(placed=False, reason="refused: " + "; ".join(problems), call=None)
        dest_problems = policy.destination_problems(dialed, dest_region)
        if dest_problems:
            return RunResult(placed=False, reason="refused: " + "; ".join(dest_problems), call=None)
    analysis = analyze_case(case)
    plan = build_plan(case, analysis["missing_information"])
    task = build_task(case, plan)
    key = idempotency_key()
    request = build_request(case, task, key, destination=dialed, region=dest_region)
    created = client.create_call(request, key)
    terminal = client.wait(created["id"], poll_seconds=0.05 if mode == "fixture" else 5.0)
    call_record = _fold_terminal(case, terminal, mode, key, dialed=dialed)
    return RunResult(
        placed=True,
        reason="ok",
        call=call_record,
        call_id=terminal["id"],
        call_status=terminal.get("status"),
    )
