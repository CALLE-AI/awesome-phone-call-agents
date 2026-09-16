"""Explicit, bounded recovery of one approved callback; never automatic redial.

The API rechecks the saved recipient and approval in a write transaction. These
pure helpers expose only a proposed next step, never permission to place a call.
"""
from __future__ import annotations

import copy
import hashlib
import json

from pricing import DEFAULT_CURRENCY

MAX_RETRIES_PER_HELPER = 3
REPLY_CHOICES = {"saved", "agrees", "conditional", "declines", "no_answer"}


def recovery_token(run: dict, action: dict) -> str:
    snapshot = {"run_id": run["id"], "status": run["status"],
                "approval": run.get("approval"), "definition": run.get("definition"), "report": run.get("report_snapshot"),
                "actions": [{k: a.get(k) for k in ("id", "status", "updated_at", "assignments", "evidence", "analysis", "attempts")}
                            for a in run.get("actions", [])], "action_id": action["id"]}
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()


def describe_blocker(action: dict) -> tuple[str, str, str]:
    analysis = action.get("analysis") or {}
    quote = analysis.get("cost_quote") or {}
    if action["status"] == "skipped":
        return "next_callback", "Confirm the next helper", "This approved helper has not been called yet."
    if analysis.get("status") == "declined":
        return "declined", "The helper declined", "Ask again only if their availability may have changed."
    if action.get("evidence") is not None and not action["evidence"].get("transcript"):
        return "no_answer", "No answer yet", "No reply was received to the approval callback."
    # Surface the precise deterministic price check, not a generic model summary.
    if analysis.get("price_approved") is False:
        if quote.get("status", "unknown") == "unknown":
            return "price_missing", "Confirm the final price", "The last reply did not confirm the approved price."
        return "price_changed", "The price is not agreed", "Ask again within the approved price limit. A higher price is not approved."
    if analysis.get("status") == "conditional":
        return "condition", "Confirm the remaining details", "The helper still has a condition to resolve."
    return "unconfirmed", "Confirm the helper’s reply", "The last callback did not confirm all the approved work."


def candidate(run: dict, max_calls: int) -> dict | None:
    if (run.get("status") not in {"attention", "stopped"} or not run.get("approval")
            or run.get("scope_warning") or run.get("activity", {}).get("uncertain")
            or run.get("engine_version", 0) < 3):
        return None
    if (run["approval"].get("report_snapshot") and run["approval"]["report_snapshot"] != run.get("report_snapshot")):
        return None
    if run["approval"].get("plan_token") and run["approval"]["plan_token"] != run.get("plan_token"):
        return None
    actions = run.get("actions", [])
    target = next((a for a in actions if a["status"] != "confirmed"), None)
    if not target or target["status"] not in {"needs_attention", "skipped"}:
        return None
    # A provider error or interrupted request is NOT evidence that no call exists.
    if run["mode"] == "live" and (target.get("error") or (target["status"] != "skipped" and
            (target.get("provider_status") not in {"completed", "no_answer"} or not target.get("evidence")))):
        return None
    if run["mode"] == "live" and target.get("provider_status") == "completed" and not (target.get("evidence") or {}).get("transcript"):
        return None
    attempts = target.get("attempts") or []
    if len(attempts) >= MAX_RETRIES_PER_HELPER:
        return None
    count = len(run.get("calls", [])) + sum(
        len(a.get("attempts") or []) + (a["status"] not in {"queued", "skipped"}) for a in actions)
    if count >= max_calls:
        return None
    code, title, reason = describe_blocker(target)
    return {"action_id": target["id"], "contact_id": target["business_id"],
            "name": target["business_name"], "token": recovery_token(run, target),
            "code": code, "title": title, "reason": reason,
            "quote": (target.get("assignments") or [{}])[0].get("assignment", {}).get("quote", {}),
            "tasks": [n["label"] for n in target.get("assignments", [])],
            "label": "Confirm next helper" if code == "next_callback" else "Confirm with helper"}


def practice_contact(contact: dict, reply: str, assignments: list[dict]) -> dict:
    """One explicitly selected fictional result. Never edit the saved directory."""
    if reply not in REPLY_CHOICES:
        raise ValueError("Unknown practice reply")
    contact = copy.deepcopy(contact)
    if reply == "saved":
        return contact
    quote = (assignments or [{}])[0].get("assignment", {}).get("quote") or {}
    profile = contact.setdefault("simulation", {})
    profile.update(start_response=reply, start_transcript="", start_transcript_mode="exact",
                   start_quote_amount=None, quote_status=quote.get("status", "unknown"),
                   quote_amount=quote.get("amount"), quote_currency=quote.get("currency", DEFAULT_CURRENCY),
                   quote_scope="all assigned tasks", quote_terms="", conditions="our team confirms availability")
    return contact
