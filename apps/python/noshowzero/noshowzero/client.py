"""A minimal CALL-E Calls API client and the two NoShowZero call requests.

POST /v1/calls        create one call task; ``Idempotency-Key`` makes a retry return the original call
GET  /v1/calls/{id}   current call task snapshot
GET  /v1/goals        authenticated and side-effect free - used as the credential check
"""
from __future__ import annotations

import os
import time
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx

from noshowzero.phone import assert_authorized, region_for
from noshowzero.results import TERMINAL
from noshowzero.schema import OFFER_RESULT_SCHEMA, REMINDER_RESULT_SCHEMA
from noshowzero.task import build_offer_task, build_reminder_task

OFFICIAL_ORIGIN = "https://api.heycall-e.com"
_OFFICIAL_HOST = "api.heycall-e.com"
REMINDER_WINDOWS = ("72h", "24h", "2h")


class CredentialTargetError(RuntimeError):
    """CALLE_BASE_URL does not point at the official HTTPS origin."""


class CalleAPIError(RuntimeError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status, self.code, self.message = status, code, message


def resolve_base_url(value: str | None = None) -> str:
    """Pin the bearer token to the official origin.

    The URL is parsed, not string-matched, so plaintext HTTP, userinfo, a path or query, another port,
    and look-alikes such as ``https://api.heycall-e.com.example`` are refused.
    """
    raw = (os.environ.get("CALLE_BASE_URL") or OFFICIAL_ORIGIN) if value is None else value
    try:
        parts = urlsplit(raw.strip())
        port = parts.port
    except ValueError as exc:
        raise CredentialTargetError(f"CALLE_BASE_URL is not a valid URL: {exc}") from exc
    if (
        parts.scheme != "https"
        or parts.hostname != _OFFICIAL_HOST
        or parts.username is not None
        or parts.password is not None
        or port not in (None, 443)
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        raise CredentialTargetError(f"CALLE_BASE_URL must be exactly {OFFICIAL_ORIGIN}")
    return OFFICIAL_ORIGIN


def reminder_key(appointment_id: str, window: str) -> str:
    """One reminder per appointment per window: a retried dispatch never calls the patient twice."""
    return f"noshowzero:appointment:{appointment_id}:reminder:{window}:v1"


def offer_key(entry_id: str, slot_id: str) -> str:
    """One offer per waitlist patient per released slot."""
    return f"noshowzero:waitlist:{entry_id}:slot:{slot_id}:offer:v1"


def _recipient(phone: str, language: str | None) -> dict[str, Any]:
    recipient: dict[str, Any] = {"phones": [phone], "locale": language or "en-US"}
    region = region_for(phone)
    if region:
        recipient["region"] = region
    return recipient


def _with_webhook(body: dict[str, Any], webhook_url: str | None) -> dict[str, Any]:
    if webhook_url:
        if urlsplit(webhook_url).scheme != "https":
            raise ValueError("webhook_url must be an https:// URL")
        body["webhook_url"] = webhook_url
    return body


def build_reminder_request(
    clinic: dict[str, Any], appointment: dict[str, Any], phone: str, window: str, webhook_url: str | None = None
) -> dict[str, Any]:
    if window not in REMINDER_WINDOWS:
        raise ValueError(f"reminder window must be one of {', '.join(REMINDER_WINDOWS)}")
    body = {
        "task": build_reminder_task(clinic, appointment),
        "recipients": [_recipient(phone, appointment.get("language"))],
        "result_schema": REMINDER_RESULT_SCHEMA,
        "metadata": {"app": "noshowzero", "kind": "reminder", "clinic_id": str(clinic.get("clinic_id")),
                     "appointment_id": str(appointment["appointment_id"]), "reminder_window": window},
    }
    return {"idempotency_key": reminder_key(str(appointment["appointment_id"]), window),
            "body": _with_webhook(body, webhook_url)}


def build_offer_request(
    clinic: dict[str, Any], entry: dict[str, Any], phone: str, *, slot_id: str, slot_at: str, service_type: str,
    webhook_url: str | None = None,
) -> dict[str, Any]:
    body = {
        "task": build_offer_task(clinic, entry, slot_at, service_type),
        "recipients": [_recipient(phone, entry.get("language"))],
        "result_schema": OFFER_RESULT_SCHEMA,
        "metadata": {"app": "noshowzero", "kind": "waitlist_offer", "clinic_id": str(clinic.get("clinic_id")),
                     "entry_id": str(entry["entry_id"]), "slot_id": slot_id, "slot_at": slot_at},
    }
    return {"idempotency_key": offer_key(str(entry["entry_id"]), slot_id), "body": _with_webhook(body, webhook_url)}


class CalleClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ):
        key = api_key if api_key is not None else os.environ.get("CALLE_API_KEY", "")
        if not key:
            raise RuntimeError("CALLE_API_KEY is not set")
        self._http = httpx.Client(
            base_url=resolve_base_url(base_url),
            timeout=30.0,
            transport=transport,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            resp = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise CalleAPIError(0, "connection_error", type(exc).__name__) from exc
        if not resp.is_success:
            try:
                err = resp.json().get("error") or {}
            except ValueError:
                err = {}
            raise CalleAPIError(
                resp.status_code, err.get("code") or f"http_{resp.status_code}", err.get("message") or ""
            )
        return resp.json()

    def create_call(self, request: dict[str, Any]) -> dict[str, Any]:
        return self._request(
            "POST", "/v1/calls", json=request["body"], headers={"Idempotency-Key": request["idempotency_key"]}
        )

    def get_call(self, call_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/calls/{call_id}")

    def check_credentials(self) -> dict[str, Any]:
        return self._request("GET", "/v1/goals", params={"limit": 1})

    def wait_for_result(
        self,
        call_id: str,
        timeout_seconds: float = 600.0,
        interval_seconds: float = 5.0,
        sleep: Callable[[float], None] = time.sleep,
    ) -> dict[str, Any]:
        """Poll until the call is terminal. Polling never creates a call, so it cannot redial."""
        waited = 0.0
        while True:
            call = self.get_call(call_id)
            if call.get("status") in TERMINAL:
                return call
            if waited >= timeout_seconds:
                raise TimeoutError(f"call {call_id} is still {call.get('status')} after {waited:.0f}s")
            sleep(interval_seconds)
            waited += interval_seconds


def _authorize(record: dict[str, Any], who: str) -> str:
    phone = assert_authorized(str(record.get("phone") or ""))
    if record.get("consent_to_call") is not True:
        raise PermissionError(f"the {who} record does not include consent_to_call: true")
    return phone


def place_reminder_call(
    clinic: dict[str, Any], appointment: dict[str, Any], window: str,
    webhook_url: str | None = None, client: CalleClient | None = None,
) -> dict[str, Any]:
    """Create one real reminder call. The destination is authorized before any client is built."""
    phone = _authorize(appointment, "appointment")
    request = build_reminder_request(clinic, appointment, phone, window, webhook_url)
    return (client or CalleClient()).create_call(request)


def place_offer_call(
    clinic: dict[str, Any], entry: dict[str, Any], *, slot_id: str, slot_at: str, service_type: str,
    webhook_url: str | None = None, client: CalleClient | None = None,
) -> dict[str, Any]:
    """Create one real waitlist offer call. The destination is authorized before any client is built."""
    phone = _authorize(entry, "waitlist")
    request = build_offer_request(clinic, entry, phone, slot_id=slot_id, slot_at=slot_at,
                                  service_type=service_type, webhook_url=webhook_url)
    return (client or CalleClient()).create_call(request)
