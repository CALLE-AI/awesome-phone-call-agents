# calle_client.py
"""
Minimal, standalone CALL-E client used by confirm_call.py.

This wraps CALL-E's stable Calls API directly over HTTP (the same surface
the `calle-ai` 0.2.x SDK uses, per https://docs.heycall-e.com):

    POST /v1/calls              -> create a call, returns {"id": ...}
    GET  /v1/calls/{id}         -> read call status + structured_result

No desktop UI, no other assistant tools, no local config file — this reads
one thing from the environment (CALLE_API_KEY) and does one thing (places
a single outbound call to confirm an appointment, then reports the result).
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import time
import uuid
from typing import Optional

import requests

_DEFAULT_BASE_URL = "https://api.heycall-e.com"
_TERMINAL_STATUSES = {"succeeded", "completed", "failed", "canceled", "cancelled", "error"}


class CallEError(Exception):
    """Raised for any CALL-E request/validation failure, with a message
    that's already safe to print or speak directly to the end user."""


def get_api_key() -> str:
    key = os.environ.get("CALLE_API_KEY")
    if not key:
        raise CallEError(
            "CALLE_API_KEY is not set. Export it before running this app:\n"
            "  export CALLE_API_KEY=sk_...\n"
            "Get a key (with 20 free calls) by following "
            "https://github.com/CALLE-AI/call-e-integrations"
        )
    return key


def get_base_url() -> str:
    return os.environ.get("CALLE_BASE_URL", _DEFAULT_BASE_URL).rstrip("/")


# ---------------------------------------------------------------------------
# Phone validation — the single most common way a call silently never
# reaches its recipient: a bare local number gets a "+" tacked on the front
# and is misread as a completely different country's code (e.g. a 10-digit
# Indian mobile number "9876543210" becomes "+9876543210", which parses as
# a Turkmenistan (+993) number with a mangled remainder). Catching this
# before the network call gives a clear, actionable error instead of a
# generic "phone number is invalid" rejection from the API — or worse, a
# real call fired at a wrong number.
# ---------------------------------------------------------------------------
def normalize_phone(phone: str, region: str) -> str:
    phone = (phone or "").strip()
    if not phone:
        raise CallEError("No phone number given.")

    try:
        import phonenumbers
    except ImportError:
        digits = "".join(c for c in phone if c.isdigit())
        if not phone.startswith("+") or len(digits) < 8:
            raise CallEError(
                f"'{phone}' doesn't look like a complete phone number. "
                f"Give the full number with a country code, e.g. "
                f"+91XXXXXXXXXX for India or +1XXXXXXXXXX for the US."
            )
        return phone

    try:
        parsed = phonenumbers.parse(phone, region or "US")
    except phonenumbers.NumberParseException:
        raise CallEError(
            f"Couldn't read '{phone}' as a phone number. Give the full "
            f"number including its country code (e.g. +91XXXXXXXXXX for "
            f"India)."
        )

    if not phonenumbers.is_valid_number(parsed):
        region_name = phonenumbers.region_code_for_number(parsed) or region or "US"
        raise CallEError(
            f"'{phone}' isn't a valid number for region '{region_name}'. "
            f"If it belongs to a different country, pass --region for that "
            f"country (or give it as a full E.164 number) instead of a "
            f"bare local number — a leading '+' on a raw local number gets "
            f"misread as a different country's code."
        )

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


# ---------------------------------------------------------------------------
# HTTP calls
# ---------------------------------------------------------------------------
def _headers(api_key: str, idempotency_key: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Idempotency-Key": idempotency_key,
    }


def create_call(task: str, phone: str, region: str, locale: Optional[str],
                 result_schema: Optional[dict], idempotency_key: str) -> dict:
    api_key = get_api_key()
    base_url = get_base_url()

    recipient: dict = {"phones": [phone]}
    if region:
        recipient["region"] = region
    if locale:
        recipient["locale"] = locale

    payload: dict = {"task": task, "recipients": [recipient]}
    if result_schema:
        payload["result_schema"] = result_schema

    try:
        resp = requests.post(
            f"{base_url}/v1/calls",
            headers=_headers(api_key, idempotency_key),
            json=payload,
            timeout=30,
        )
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        detail = ""
        try:
            body = e.response.json()
            err = body.get("error", body)
            detail = err.get("message", "")
            errs = (err.get("details") or {}).get("validation_errors")
            if errs:
                detail += " (" + "; ".join(
                    f"{'.'.join(str(p) for p in ve.get('loc', []))}: {ve.get('msg')}"
                    for ve in errs
                ) + ")"
        except Exception:
            detail = e.response.text[:200] if e.response is not None else str(e)
        raise CallEError(f"CALL-E rejected the call request: {detail or e}")
    except requests.exceptions.RequestException as e:
        raise CallEError(f"Could not reach CALL-E: {e}")

    return resp.json()


def get_call(call_id: str) -> dict:
    api_key = get_api_key()
    base_url = get_base_url()
    try:
        resp = requests.get(
            f"{base_url}/v1/calls/{call_id}",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
        )
        resp.raise_for_status()
    except requests.exceptions.HTTPError as e:
        detail = e.response.text[:200] if e.response is not None else str(e)
        raise CallEError(f"CALL-E couldn't return call {call_id}: {detail}")
    except requests.exceptions.RequestException as e:
        raise CallEError(f"Could not reach CALL-E: {e}")
    return resp.json()


def poll_until_done(call_id: str, timeout_seconds: int = 180) -> dict:
    deadline = time.time() + timeout_seconds
    last_status = None
    poll_interval = 5

    while time.time() < deadline:
        call = get_call(call_id)
        status = str(call.get("status", "")).lower()
        if status != last_status:
            print(f"[CallE] call {call_id} -> {status}")
            last_status = status
        if status in _TERMINAL_STATUSES:
            return call
        time.sleep(poll_interval)

    call = get_call(call_id)
    call.setdefault("status", "pending")
    call["_timed_out"] = True
    return call


# ---------------------------------------------------------------------------
# Result summarization + sharper failure diagnosis
# ---------------------------------------------------------------------------
def _parse_calle_timestamp(ts: str):
    if not ts:
        return None
    ts = ts.rstrip("Z")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return _dt.datetime.strptime(ts, fmt)
        except ValueError:
            continue
    return None


def diagnose_failure(call: dict) -> Optional[str]:
    """CALL-E's generic 'may be busy, try again later' summary can hide a
    much sharper signal: if an attempt ended in a second or two with a
    carrier-level failure_code, that's not a busy/no-answer signal (those
    take several seconds of ringing first) — it means the number itself
    couldn't be reached at all (wrong digit, disconnected, not a real
    line)."""
    for recipient in (call.get("recipients") or []):
        for attempt in (recipient.get("attempts") or []):
            code = str(attempt.get("failure_code") or "").strip()
            if not code:
                continue
            started = _parse_calle_timestamp(attempt.get("started_at", ""))
            completed = _parse_calle_timestamp(attempt.get("completed_at", ""))
            duration = (completed - started).total_seconds() if started and completed else None
            if duration is not None and duration < 2:
                phone = (recipient.get("phones") or [""])[0]
                return (
                    f"Heads up: that attempt to {phone or 'the recipient'} ended in "
                    f"under {max(duration, 0):.0f}s with carrier failure code {code} — "
                    f"too fast for the phone to have even rung. That pattern almost "
                    f"always means the number itself couldn't be reached at all (a "
                    f"typo'd digit, disconnected, or not a real line), not that the "
                    f"recipient was busy or unavailable."
                )
    return None


def summarize(call: dict) -> str:
    status = str(call.get("status", "unknown"))
    call_id = call.get("id", "")
    structured = call.get("structured_result") or call.get("structuredResult")
    summary = call.get("summary") or call.get("result_summary")
    phone = ""
    recipients = call.get("recipients") or []
    if recipients:
        phone = (recipients[0].get("phones") or [""])[0]

    lines = [f"CALL-E call {call_id} to {phone}: {status}."]

    if call.get("_timed_out"):
        lines.append(f"Still running past the wait window — check back with call id {call_id}.")
        return " ".join(lines)

    if status.lower() in {"failed", "canceled", "cancelled", "error"}:
        diagnosis = diagnose_failure(call)
        if diagnosis:
            lines.append(diagnosis)

    if summary:
        lines.append(str(summary))
    if structured:
        lines.append(f"Structured result: {json.dumps(structured, ensure_ascii=False)}")

    return " ".join(lines)


def new_idempotency_key() -> str:
    return str(uuid.uuid4())
