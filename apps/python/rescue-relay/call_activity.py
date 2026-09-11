"""Read-only progress projection. Never places calls or infers provider ringing.

Derived from existing saved rows/events, so old databases need no migration and
reloading the page cannot restart a call. Timestamps are stable between reads.
"""
from __future__ import annotations

ACTIVE_RUNS = {"queued", "running", "starting"}
ACTIVE_CALLS = {"queued", "dialing", "waiting", "analyzing"}
ACTIVE_ACTIONS = {"queued", "contacting", "analyzing"}
PROVIDER_DONE = {"completed", "failed", "canceled", "cancelled"}


def build_call_activity(run: dict) -> dict:
    mock = run.get("mode") == "mock"
    active = run.get("status") in ACTIVE_RUNS
    events = [e for e in run.get("events", []) if e.get("type") != "reasoning"]
    last = events[-1] if events else {}
    calls, actions = run.get("calls", []), run.get("actions", [])
    callback = bool(actions) and run.get("execution_status") != "not_started"
    attempts = actions if callback else calls
    pending = ACTIVE_ACTIONS if callback else ACTIVE_CALLS
    current = next((a for a in attempts if a.get("status") in pending), None) if active else None
    attempted = [a for a in attempts if a.get("status") not in {"queued", "skipped"}]
    subject = current or (attempted[-1] if attempted else {})
    provider_status = subject.get("provider_status") or ""
    contact = subject.get("business_name") or ""
    phase = "idle"
    title = "No inquiry is running"
    detail = "Saved offers are unchanged. No further call starts without another approved action."
    since = last.get("at") or run.get("started_at")
    # An unresolved live provider request may survive our timeout/restart. Do NOT
    # claim the phone is idle merely because local coordination has stopped.
    unresolved = [a for a in attempts if (
        a.get("status") in {"failed", "interrupted", "needs_attention", "contacting", "waiting", "dialing"}
        and a.get("provider_status") not in PROVIDER_DONE
        and (a.get("provider_call_id") or a.get("status") in {"failed", "interrupted"}
             or "CALL-E" in (a.get("error") or ""))
    )]
    uncertain = not mock and not active and bool(unresolved)
    if uncertain:
        subject = unresolved[-1]
        provider_status = subject.get("provider_status") or ""
        contact = subject.get("business_name") or ""
    if active:
        phase, title = "preparing", "Preparing the next inquiry"
        detail = "Reading the confirmed goal before contacting anyone."
        if callback:
            title, detail = "Preparing the approved callback", "Preparing only the tasks and quote limits you approved."
        if current:
            since = current.get("attempt_started_at") or current.get("created_at") or since
            status = current.get("status")
            if status == "analyzing":
                phase, title = "analyzing", f"Reviewing {contact}'s reply"
                detail = "The conversation is recorded. Checking capabilities, conditions and price before any next call."
                since = current.get("updated_at") or since
            elif status == "queued":
                since = last.get("at") or since
                title = f"Preparing the callback to {contact}"
            elif mock:
                phase, title = "simulating", f"Simulating {'a callback to' if callback else 'an inquiry to'} {contact}"
                detail = "Generating a practice conversation. No phone is being dialed; the completed reply will be checked next."
            else:
                phase = "waiting" if status in {"waiting", "contacting"} and current.get("provider_call_id") else "contacting"
                title = f"Waiting for CALL-E · {contact}" if phase == "waiting" else f"Requesting a call to {contact}"
                detail = "Waiting for the provider's completed conversation. A submitted request is not proof that the phone is ringing or answered."
                if (current.get("provider_error") or {}).get("code") == "call_not_ready":
                    title = "Waiting for the saved call result" if current.get("provider_call_id") else "CALL-E creation is unconfirmed"
                    detail = ("The saved call has no terminal result. Checking the same Call ID without a new create request."
                              if current.get("provider_call_id") else
                              "No Call ID was returned. Only the saved request and original key are being checked; this is not confirmation that the phone rang.")
        elif last.get("type") == "choosing":
            phase, title, detail = "choosing", "Choosing the next trusted contact", last.get("message", "")
        elif last.get("type") == "coverage":
            phase, title, detail = "updating", "Updating your options", last.get("message", "")
        if run.get("cancel_requested"):
            title = "Stopping after the current reply" if current and current.get("status") != "queued" else "Stopping before the next call"
            detail += " No additional contacts will be called. Stopping here does not cancel an active provider call or an existing agreement."
    elif uncertain:
        phase, title = "uncertain", "Call status needs checking"
        detail = "Local coordination has paused, but a CALL-E call may still be active. Check the saved provider record before any intentional redial. No automatic retry."
        if (subject.get("provider_error") or {}).get("code") == "call_not_ready":
            title = "Saved call result is still pending" if subject.get("provider_call_id") else "Call creation is unconfirmed"
            detail = ("The call task has no terminal result. Check its saved Calls API ID; do not create another call."
                      if subject.get("provider_call_id") else
                      "CALL-E returned call_not_ready without a saved Call ID. This does not confirm creation or ringing. Recover only the original request and key; inspect the local diagnostic if it persists.")
            detail += " No further retries run while paused."
    elif run.get("status") == "stopped":
        title = "Further calls have stopped"
        detail = "No inquiry or callback is being processed. Saved replies remain available; existing agreements have not been canceled."
    elif run.get("status") in {"covered", "partial"}:
        phase, title = "paused", "Inquiries paused · review the results"
        detail = "The completed replies are saved. No responder is engaged by an inquiry."
    elif run.get("status") == "active":
        title, detail = "Approval callbacks recorded", "Follow the agreed plan below. Arrival and completion still need your recorded updates."
    elif run.get("status") == "completed":
        title, detail = "Rescue closed", "The saved conversations and your progress updates remain available."
    elif run.get("status") in {"failed", "interrupted", "attention"}:
        title, detail = "Coordination paused · review needed", run.get("error") or run.get("stop_reason") or detail
    return {
        "active": active, "uncertain": uncertain, "phase": phase,
        "mode": "mock" if mock else "live", "title": title, "detail": detail,
        "contact_name": contact, "purpose": "Approval callback" if callback else "Condition check · not approval" if ":followup:" in subject.get("idempotency_key", "") else "Capability & price inquiry",
        "attempt_id": subject.get("id"), "provider_call_id": subject.get("provider_call_id"),
        "provider_status": provider_status, "started_at": since,
        "updated_at": subject.get("updated_at") or last.get("at") or run.get("started_at"),
        "provider_error_code": (subject.get("provider_error") or {}).get("code"),
        "cancel_requested": bool(run.get("cancel_requested")),
    }
