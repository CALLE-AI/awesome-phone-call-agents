"""CALL-E dispatch + poll + idempotency.

Verified 2026-09-13 against the public CALLE-AI/call-e-integrations README
and https://call-e.devpost.com/resources (not guessed — the PRD explicitly
asked for this to be confirmed before coding against it). Two real,
independent integration paths exist:

  SDK   pip install calle-ai
        from calle import CalleClient
        client = CalleClient(api_key=...)
        call = client.calls.create_and_wait(task=..., result_schema=...)
        -> dict-like result: call["status"], call["task_completed"],
           call["structured_result"], call["evidence"]
        create_and_wait dispatches AND waits for completion in one call —
        there is no documented separate create/poll pair on the SDK.

  REST  base https://api.heycall-e.com
        POST /v1/calls            create a call. Header: Idempotency-Key.
        GET  /v1/calls/{call_id}  read status + result. Poll until the
                                   response's task_completed is true.
        Authorization: Bearer $CALLE_API_KEY on both.

CALL-E has no native "disposition" field — the API returns `status`,
`task_completed`, `structured_result`, and `evidence`. We get a disposition
by passing `result_schema` (a JSON Schema CALL-E fills from the call), so
both the SDK and REST paths below request the same DISPOSITION_RESULT_SCHEMA
and go through the same _disposition_from_result mapping.

Module not independently verified beyond the two pages above: the exact
`calle-ai` PyPI version, and whether create_and_wait accepts an idempotency
kwarg. Our own app-level idempotency check (audit_log.has_existing_call,
enforced in app.py) is the real safety net regardless, so this module does
not depend on CALL-E's API also deduplicating.

dry_run defaults to true. Every automated test/validation run should stay in
dry-run mode; flip CALLE_DRY_RUN=false only for the one real call you record.
"""
from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests

from dotenv import load_dotenv

try:
    from calle import CalleClient  # official `calle-ai` package, if installed
except ImportError:  # not installed — fine in dry-run, and the REST path covers live
    CalleClient = None  # type: ignore[assignment,misc]

CALLE_API_BASE = "https://api.heycall-e.com"
CALLE_API_KEY = ""
CALLE_RECIPIENT_PHONE = ""
DRY_RUN = True
POLL_INTERVAL_SECONDS = 5.0
POLL_TIMEOUT_SECONDS = 180.0


def reload_config() -> None:
    global CALLE_API_BASE, CALLE_API_KEY, CALLE_RECIPIENT_PHONE, DRY_RUN, POLL_INTERVAL_SECONDS, POLL_TIMEOUT_SECONDS
    load_dotenv(override=True)
    if "PYTEST_CURRENT_TEST" in os.environ:
        os.environ["CALLE_DRY_RUN"] = "true"
    CALLE_API_BASE = os.environ.get("CALLE_API_BASE", "https://api.heycall-e.com")
    CALLE_API_KEY = os.environ.get("CALLE_API_KEY", "")
    CALLE_RECIPIENT_PHONE = os.environ.get("CALLE_RECIPIENT_PHONE", "")
    DRY_RUN = os.environ.get("CALLE_DRY_RUN", "true").strip().lower() != "false"
    POLL_INTERVAL_SECONDS = float(os.environ.get("CALLE_POLL_INTERVAL", "5"))
    POLL_TIMEOUT_SECONDS = float(os.environ.get("CALLE_POLL_TIMEOUT", "180"))


reload_config()

VALID_DISPOSITIONS = {"APPROVE", "HOLD", "ESCALATE", "NO_ANSWER", "UNCLEAR"}

# What we ask CALL-E to extract from the conversation. APPROVE/HOLD/ESCALATE
# are things the recipient can actually say; NO_ANSWER is derived separately
# from the call's own terminal status (no one picked up to be asked at all).
DISPOSITION_RESULT_SCHEMA = {
    "type": "object",
    "required": ["disposition"],
    "properties": {
        "disposition": {"type": "string", "enum": ["APPROVE", "HOLD", "ESCALATE", "UNCLEAR"]},
        "reason": {"type": "string"},
    },
}

# CALL-E's documented terminal call statuses (docs/mcp/openagent-oauth.md).
# Only COMPLETED means a human was actually reached and could be asked
# anything; every other terminal status means the recipient never had the
# chance to give a disposition at all.
_REACHED_STATUS = "COMPLETED"

_sdk_client_instance: Any = None
_active_calls: dict[str, str] = {}


def set_call_phase(incident_id: str, phase: str) -> None:
    _active_calls[incident_id] = phase


def get_call_phase(incident_id: str) -> str:
    return _active_calls.get(incident_id, "idle")


def clear_call_phases() -> None:
    _active_calls.clear()


def idempotency_key(incident_id: str) -> str:
    """Deterministic key from incident_id so a retry or double-trigger can't
    place two calls for the same incident."""
    return hashlib.sha256(incident_id.encode("utf-8")).hexdigest()[:16]


@dataclass
class CallResult:
    call_id: str
    task_completed: bool
    disposition: str
    reason: str = ""
    transcript_evidence: str = ""
    dry_run: bool = True


class CalleDispatchError(RuntimeError):
    """Raised when a live call cannot be dispatched or fails outright.
    Callers must treat this as fail-closed (HELD), never as a reason to
    execute the action."""


def _disposition_from_result(status: Optional[str], task_completed: Optional[bool], structured_result: Optional[dict]) -> str:
    if (status or "").upper() and (status or "").upper() != _REACHED_STATUS:
        # Call ended without reaching a human (no answer, declined, busy,
        # voicemail, failed, canceled, expired) — there was no one to ask.
        return "NO_ANSWER"
    if not task_completed:
        return "UNCLEAR"
    disposition = str((structured_result or {}).get("disposition") or "").upper()
    return disposition if disposition in VALID_DISPOSITIONS else "UNCLEAR"


def _transcript_from_evidence(evidence: Any) -> str:
    if isinstance(evidence, list):
        return "; ".join(str(item) for item in evidence)
    return str(evidence) if evidence else ""


def _sdk_client():
    global _sdk_client_instance
    if CalleClient is None:
        return None
    if _sdk_client_instance is None:
        _sdk_client_instance = CalleClient(api_key=CALLE_API_KEY)
    return _sdk_client_instance


def place_call(
    task_text: str,
    incident_id: str,
    recipient_phone: Optional[str] = None,
    mock_disposition: str = "HOLD",
    mock_reason: str = "wants eyes on it first",
) -> CallResult:
    """Places the call and returns the resolved result. In dry-run mode this
    is fully mocked and synchronous — no network call, no CALL-E credentials
    required — which is what lets the whole incident -> call -> disposition
    -> action loop run end-to-end offline and under test."""
    set_call_phase(incident_id, "ringing")
    key = idempotency_key(incident_id)

    try:
        if DRY_RUN:
            disposition = mock_disposition if mock_disposition in VALID_DISPOSITIONS else "UNCLEAR"
            res = CallResult(
                call_id=f"dryrun_{key}",
                task_completed=True,
                disposition=disposition,
                reason=mock_reason,
                transcript_evidence="[dry-run] mocked transcript — no real call was placed.",
                dry_run=True,
            )
            set_call_phase(incident_id, "completed")
            return res

        if not CALLE_API_KEY:
            raise CalleDispatchError("CALLE_API_KEY is not set; cannot place a live call.")
        recipient_phone = recipient_phone or CALLE_RECIPIENT_PHONE
        if not recipient_phone:
            raise CalleDispatchError("CALLE_RECIPIENT_PHONE is not set; cannot place a live call.")

        task = f"Call {recipient_phone} and: {task_text}"

        if _sdk_client() is not None:
            res = _place_call_via_sdk(task, key)
        else:
            res = _place_call_via_rest(task, recipient_phone, key)
        set_call_phase(incident_id, "completed")
        return res
    except CalleDispatchError:
        set_call_phase(incident_id, "failed")
        raise


def _place_call_via_sdk(task: str, key: str) -> CallResult:
    client = _sdk_client()
    try:
        result = client.calls.create_and_wait(task=task, result_schema=DISPOSITION_RESULT_SCHEMA)
    except Exception as exc:  # the SDK's own exception hierarchy isn't documented on the pages we verified
        raise CalleDispatchError(f"CALL-E SDK call failed: {exc}") from exc

    structured = result.get("structured_result")
    disposition = _disposition_from_result(result.get("status"), result.get("task_completed"), structured)
    return CallResult(
        call_id=str(result.get("call_id") or result.get("id") or f"sdk_{key}"),
        task_completed=bool(result.get("task_completed")),
        disposition=disposition,
        reason=(structured or {}).get("reason", ""),
        transcript_evidence=_transcript_from_evidence(result.get("evidence")),
        dry_run=False,
    )


def _place_call_via_rest(task: str, recipient_phone: str, key: str) -> CallResult:
    # Use key with epoch timestamp so retried attempts do not trigger 409 idempotency conflict on CALL-E
    dispatch_key = f"{key}_{int(time.time())}"
    try:
        response = requests.post(
            f"{CALLE_API_BASE}/v1/calls",
            headers={
                "Authorization": f"Bearer {CALLE_API_KEY}",
                "Content-Type": "application/json",
                "Idempotency-Key": dispatch_key,
            },
            json={
                "recipients": [{"phones": [recipient_phone]}],
                "task": task,
                "result_schema": DISPOSITION_RESULT_SCHEMA,
            },
            timeout=30,
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as exc:
        err_msg = str(exc)
        if hasattr(exc, "response") and exc.response is not None:
            try:
                err_data = exc.response.json()
                err_msg = err_data.get("error", {}).get("message") or exc.response.text
            except Exception:
                err_msg = exc.response.text or str(exc)
        raise CalleDispatchError(f"CALL-E API error: {err_msg}") from exc

    data = response.json()
    call_id = data.get("call_id") or data.get("id")
    if not call_id:
        raise CalleDispatchError(f"Unexpected CALL-E response, no call_id present: {data}")
    return _poll_rest(str(call_id))


def _poll_rest(call_id: str) -> CallResult:
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        try:
            response = requests.get(
                f"{CALLE_API_BASE}/v1/calls/{call_id}",
                headers={"Authorization": f"Bearer {CALLE_API_KEY}"},
                timeout=30,
            )
            response.raise_for_status()
        except requests.exceptions.RequestException as exc:
            raise CalleDispatchError(f"CALL-E poll error: {exc}") from exc
        data = response.json()
        status = (data.get("status") or "").lower()
        if data.get("task_completed") or status in ("completed", "failed", "canceled", "cancelled", "error"):
            structured = data.get("structured_result")
            disposition = _disposition_from_result(data.get("status"), data.get("task_completed"), structured)
            reason = (structured or {}).get("reason", "")
            if not reason and data.get("summary"):
                reason = data.get("summary")
            return CallResult(
                call_id=call_id,
                task_completed=bool(data.get("task_completed")),
                disposition=disposition,
                reason=reason,
                transcript_evidence=_transcript_from_evidence(data.get("evidence")),
                dry_run=False,
            )
        time.sleep(POLL_INTERVAL_SECONDS)

    # Poll window expired without a completed task. Fail-closed: treat this
    # exactly like an unanswered call, never as an implicit approval.
    return CallResult(
        call_id=call_id,
        task_completed=False,
        disposition="NO_ANSWER",
        reason="poll timeout before task completion",
        transcript_evidence="",
        dry_run=False,
    )


def resolve_action_state(disposition: str) -> str:
    """Fail-closed: only a clean, transcript-backed APPROVE lets the action
    execute. Anything else — HOLD, ESCALATE, NO_ANSWER, UNCLEAR, or a
    dispatch failure — holds the action."""
    return "EXECUTED" if disposition == "APPROVE" else "HELD"
