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
                 recipient_result_schema: Optional[dict], idempotency_key: str) -> dict:
    api_key = get_api_key()
    base_url = get_base_url()

    recipient: dict = {"phones": [phone]}
    if region:
        recipient["region"] = region
    if locale:
        recipient["locale"] = locale

    payload: dict = {"task": task, "recipients": [recipient]}
    if recipient_result_schema:
        # Per CALL-E's documented Calls API (see calle-ai SDK quickstart):
        # `result_schema` aggregates a structured result across the whole
        # call (all recipients combined) — meaningless for a single-
        # recipient call and never populated here. The individual
        # recipient's answer is `recipient_result_schema`, read back per-
        # recipient at recipients[i].structured_result. Sending the wrong
        # field is why structured_result previously came back null even
        # on a fully successful call.
        payload["recipient_result_schema"] = recipient_result_schema

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
# Result summarization
# ---------------------------------------------------------------------------
def mask_phone(phone: str) -> str:
    """Mask everything but the last 3 digits. Used everywhere a phone
    number reaches a terminal/log after the call is placed — the full
    number is only ever shown in the interactive live-call prompt itself,
    never in a summary, dry-run preview, or --check output."""
    if not phone:
        return phone
    digits_only = "".join(c for c in phone if c.isdigit())
    if len(digits_only) <= 3:
        return phone
    prefix = phone[: -len(digits_only)] if len(digits_only) else phone
    return prefix + "*" * (len(digits_only) - 3) + digits_only[-3:]


def _recipient_structured_result(call: dict) -> Optional[dict]:
    """Per CALL-E's documented Calls API, a single-recipient call's answer
    lives at recipients[0].structured_result (populated from the
    recipient_result_schema sent on create), not the call-level
    structured_result field (which aggregates across multiple recipients
    and is never populated for a call with only one)."""
    recipients = call.get("recipients") or []
    if not recipients:
        return None
    r0 = recipients[0]
    return r0.get("structured_result") or r0.get("structuredResult")


def summarize(call: dict) -> str:
    status = str(call.get("status", "unknown"))
    call_id = call.get("id", "")
    structured = _recipient_structured_result(call)
    summary = call.get("summary") or call.get("result_summary")
    phone = ""
    recipients = call.get("recipients") or []
    if recipients:
        phone = (recipients[0].get("phones") or [""])[0]

    lines = [f"CALL-E call {call_id} to {mask_phone(phone)}: {status}."]

    if call.get("_timed_out"):
        lines.append(f"Still running past the wait window — check back with call id {call_id}.")
        return " ".join(lines)

    if status.lower() in {"failed", "canceled", "cancelled", "error"}:
        # Report only what CALL-E's response actually documents for a
        # failed attempt — a failure_code and its stated meaning, if any.
        # We deliberately do not infer what a fast failure or a specific
        # code "usually means" (e.g. unreachable vs. busy): CALL-E's API
        # doesn't document that inference as reliable, so asserting it
        # here would be an unsupported claim dressed up as a diagnosis.
        for recipient in recipients:
            for attempt in (recipient.get("attempts") or []):
                code = str(attempt.get("failure_code") or "").strip()
                reason = str(attempt.get("failure_reason") or "").strip()
                if code or reason:
                    detail = " ".join(p for p in (code, reason) if p)
                    lines.append(f"CALL-E reported failure detail: {detail}.")

    if summary:
        lines.append(str(summary))
    if structured:
        lines.append(f"Structured result: {json.dumps(structured, ensure_ascii=False)}")

    return " ".join(lines)


def new_idempotency_key() -> str:
    return str(uuid.uuid4())
