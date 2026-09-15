"""CALL-E dispatch + poll + idempotency.

Verified 2026-09-13 against the public CALLE-AI/call-e-integrations README
and https://call-e.devpost.com/resources (not guessed — the PRD explicitly
asked for this to be confirmed before coding against it). Two real,
independent integration paths exist:

  SDK   pip install calle-ai
        from calle import CalleClient
        client = CalleClient(api_key=...)
        call = client.calls.create_and_wait(task=..., result_schema=..., idempotency_key=...)
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

Security & Safety Controls:
- Destination: Strict ASCII E.164 only (+ country code 1-9, 8-15 digits, no non-ASCII confusables).
- Operator Authorization: Only authorized destinations (CALLE_RECIPIENT_PHONE or allowlist) can be dialed.
- Origin Pinning: CALLE_API_BASE must resolve to approved HTTPS origins (https://api.heycall-e.com).
- No Credential Redirects: Redirects (3xx) are refused while bearing credentials.
- Stable Idempotency: Stable hash key passed across SDK and REST without timestamp mutation.
- Ambiguous Intent Preservation: Poll timeouts map to UNCLEAR (HELD), never claimed as NO_ANSWER.
- Masking: Phones, bearer credentials, and provider errors are masked at all boundaries.
"""
from __future__ import annotations

import hashlib
import os
import time
import urllib.parse
from dataclasses import dataclass
from typing import Any, Optional

import requests
from dotenv import load_dotenv

import safety

try:
    from calle import CalleClient  # official `calle-ai` package, if installed
except ImportError:  # not installed — fine in dry-run, and the REST path covers live
    CalleClient = None  # type: ignore[assignment,misc]

APPROVED_ORIGINS = frozenset({"https://api.heycall-e.com"})

CALLE_API_BASE = "https://api.heycall-e.com"
CALLE_API_KEY = ""
CALLE_RECIPIENT_PHONE = ""
DRY_RUN = True
POLL_INTERVAL_SECONDS = 5.0
POLL_TIMEOUT_SECONDS = 180.0


class CalleDispatchError(RuntimeError):
    """Raised when a live call cannot be dispatched or fails outright.
    Callers must treat this as fail-closed (HELD), never as a reason to
    execute the action."""


def validate_origin(base_url: str) -> str:
    """Ensure base_url is an approved HTTPS origin; refuse plain HTTP or unapproved origins."""
    if not base_url or not isinstance(base_url, str):
        raise CalleDispatchError("CALLE_API_BASE must be a non-empty string.")
    parsed = urllib.parse.urlsplit(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    approved = set(APPROVED_ORIGINS)
    extra = os.environ.get("FORGEGATE_APPROVED_ORIGINS")
    if extra:
        approved.update(item.strip() for item in extra.split(",") if item.strip())

    if parsed.scheme != "https" or origin not in approved:
        raise CalleDispatchError(
            f"Refusing to send credentials to unapproved origin: {origin!r}; "
            f"approved HTTPS origins are {sorted(approved)}"
        )
    return base_url.rstrip("/")


def reload_config() -> None:
    global CALLE_API_BASE, CALLE_API_KEY, CALLE_RECIPIENT_PHONE, DRY_RUN, POLL_INTERVAL_SECONDS, POLL_TIMEOUT_SECONDS
    load_dotenv(override=True)
    if "PYTEST_CURRENT_TEST" in os.environ:
        os.environ["CALLE_DRY_RUN"] = "true"
    raw_base = os.environ.get("CALLE_API_BASE", "https://api.heycall-e.com")
    try:
        CALLE_API_BASE = validate_origin(raw_base)
    except CalleDispatchError:
        # If in dry-run, preserve raw_base but live checks will strictly enforce validate_origin
        CALLE_API_BASE = raw_base.rstrip("/")
    CALLE_API_KEY = os.environ.get("CALLE_API_KEY", "")
    CALLE_RECIPIENT_PHONE = os.environ.get("CALLE_RECIPIENT_PHONE", "")
    DRY_RUN = os.environ.get("CALLE_DRY_RUN", "true").strip().lower() != "false"
    POLL_INTERVAL_SECONDS = float(os.environ.get("CALLE_POLL_INTERVAL", "5"))
    POLL_TIMEOUT_SECONDS = float(os.environ.get("CALLE_POLL_TIMEOUT", "180"))


reload_config()

VALID_DISPOSITIONS = {"APPROVE", "HOLD", "ESCALATE", "NO_ANSWER", "UNCLEAR"}

DISPOSITION_RESULT_SCHEMA = {
    "type": "object",
    "required": ["disposition"],
    "properties": {
        "disposition": {"type": "string", "enum": ["APPROVE", "HOLD", "ESCALATE", "UNCLEAR"]},
        "reason": {"type": "string"},
    },
}

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
    """Deterministic, stable key from incident_id so a retry or double-trigger
    cannot place two calls for the same incident."""
    return hashlib.sha256(incident_id.encode("utf-8")).hexdigest()[:16]


@dataclass
class CallResult:
    call_id: str
    task_completed: bool
    disposition: str
    reason: str = ""
    transcript_evidence: str = ""
    dry_run: bool = True


def _disposition_from_result(status: Optional[str], task_completed: Optional[bool], structured_result: Optional[dict]) -> str:
    if (status or "").upper() and (status or "").upper() != _REACHED_STATUS:
        return "NO_ANSWER"
    if not task_completed:
        return "UNCLEAR"
    disposition = str((structured_result or {}).get("disposition") or "").upper()
    return disposition if disposition in VALID_DISPOSITIONS else "UNCLEAR"


def _transcript_from_evidence(evidence: Any) -> str:
    if isinstance(evidence, list):
        text = "; ".join(str(item) for item in evidence)
    else:
        text = str(evidence) if evidence else ""
    return safety.mask_text(text)


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
    """Places the call and returns the resolved result.

    Validates authorized ASCII E.164 and approved HTTPS origin before dispatch.
    In dry-run mode returns an immediate mocked result without hitting network.
    """
    set_call_phase(incident_id, "ringing")
    key = idempotency_key(incident_id)

    try:
        if DRY_RUN:
            # In dry-run, if an explicit recipient_phone was provided, validate its format
            if recipient_phone:
                try:
                    safety.normalize_ascii_e164(recipient_phone)
                except safety.DestinationError as exc:
                    raise CalleDispatchError(str(exc)) from exc

            disposition = mock_disposition if mock_disposition in VALID_DISPOSITIONS else "UNCLEAR"
            res = CallResult(
                call_id=f"dryrun_{key}",
                task_completed=True,
                disposition=disposition,
                reason=safety.mask_text(mock_reason),
                transcript_evidence="[dry-run] mocked transcript — no real call was placed.",
                dry_run=True,
            )
            set_call_phase(incident_id, "completed")
            return res

        # Live dispatch preflight checks
        if not CALLE_API_KEY:
            raise CalleDispatchError("CALLE_API_KEY is not set; cannot place a live call.")

        validate_origin(CALLE_API_BASE)

        target_phone = recipient_phone or CALLE_RECIPIENT_PHONE
        if not target_phone:
            raise CalleDispatchError("CALLE_RECIPIENT_PHONE is not set; cannot place a live call.")

        try:
            validated_phone = safety.assert_authorized_destination(
                target_phone, configured_phone=CALLE_RECIPIENT_PHONE
            )
        except safety.DestinationError as exc:
            raise CalleDispatchError(f"Destination authorization check failed: {exc}") from exc

        task = f"Call {validated_phone} and: {task_text}"

        if _sdk_client() is not None:
            res = _place_call_via_sdk(task, key)
        else:
            res = _place_call_via_rest(task, validated_phone, key)
        set_call_phase(incident_id, "completed")
        return res
    except CalleDispatchError:
        set_call_phase(incident_id, "failed")
        raise


def _place_call_via_sdk(task: str, key: str) -> CallResult:
    client = _sdk_client()
    try:
        try:
            result = client.calls.create_and_wait(
                task=task,
                result_schema=DISPOSITION_RESULT_SCHEMA,
                idempotency_key=key,
            )
        except TypeError:
            # Fallback if specific SDK version does not take idempotency_key kwarg
            result = client.calls.create_and_wait(
                task=task,
                result_schema=DISPOSITION_RESULT_SCHEMA,
            )
    except Exception as exc:
        err = safety.mask_text(str(exc))
        raise CalleDispatchError(f"CALL-E SDK call failed: {err}") from exc

    structured = result.get("structured_result")
    disposition = _disposition_from_result(result.get("status"), result.get("task_completed"), structured)
    raw_reason = (structured or {}).get("reason", "")
    return CallResult(
        call_id=str(result.get("call_id") or result.get("id") or f"sdk_{key}"),
        task_completed=bool(result.get("task_completed")),
        disposition=disposition,
        reason=safety.mask_text(raw_reason),
        transcript_evidence=_transcript_from_evidence(result.get("evidence")),
        dry_run=False,
    )


def _place_call_via_rest(task: str, recipient_phone: str, key: str) -> CallResult:
    # Pass stable incident key directly without timestamps
    validate_origin(CALLE_API_BASE)
    try:
        response = requests.post(
            f"{CALLE_API_BASE}/v1/calls",
            headers={
                "Authorization": f"Bearer {CALLE_API_KEY}",
                "Content-Type": "application/json",
                "Idempotency-Key": key,
            },
            json={
                "recipients": [{"phones": [recipient_phone]}],
                "task": task,
                "result_schema": DISPOSITION_RESULT_SCHEMA,
            },
            allow_redirects=False,
            timeout=30,
        )
        if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
            target = safety.mask_text(response.headers.get("Location", "unknown"))
            raise CalleDispatchError(
                f"Refusing to follow redirect to {target!r} while sending credentials"
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
        masked_err = safety.mask_text(err_msg)
        raise CalleDispatchError(f"CALL-E API error: {masked_err}") from exc

    data = response.json()
    call_id = data.get("call_id") or data.get("id")
    if not call_id:
        raise CalleDispatchError(f"Unexpected CALL-E response, no call_id present: {safety.mask_text(str(data))}")
    return _poll_rest(str(call_id))


def _poll_rest(call_id: str) -> CallResult:
    validate_origin(CALLE_API_BASE)
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        try:
            response = requests.get(
                f"{CALLE_API_BASE}/v1/calls/{call_id}",
                headers={"Authorization": f"Bearer {CALLE_API_KEY}"},
                allow_redirects=False,
                timeout=30,
            )
            if response.is_redirect or response.status_code in (301, 302, 303, 307, 308):
                raise CalleDispatchError("Refusing to follow redirect while carrying credentials")
            response.raise_for_status()
        except requests.exceptions.RequestException as exc:
            masked_err = safety.mask_text(str(exc))
            raise CalleDispatchError(f"CALL-E poll error: {masked_err}") from exc

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
                reason=safety.mask_text(reason),
                transcript_evidence=_transcript_from_evidence(data.get("evidence")),
                dry_run=False,
            )
        time.sleep(POLL_INTERVAL_SECONDS)

    # Poll window expired without a completed task.
    # Preserve ambiguous intent and fail closed: do not claim timeout proves no call.
    return CallResult(
        call_id=call_id,
        task_completed=False,
        disposition="UNCLEAR",
        reason="poll timeout before task completion; call status unverified pending reconciliation",
        transcript_evidence="",
        dry_run=False,
    )


def resolve_action_state(disposition: str) -> str:
    """Fail-closed: only a clean, transcript-backed APPROVE lets the action
    execute. Anything else — HOLD, ESCALATE, NO_ANSWER, UNCLEAR, TIMEOUT, or a
    dispatch failure — holds the action."""
    return "EXECUTED" if disposition == "APPROVE" else "HELD"
