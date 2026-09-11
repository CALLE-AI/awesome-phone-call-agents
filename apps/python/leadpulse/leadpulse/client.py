"""A minimal CALL-E Calls API client.

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

from leadpulse.phone import assert_authorized, region_for
from leadpulse.results import TERMINAL
from leadpulse.schema import RESULT_SCHEMA
from leadpulse.task import build_task

OFFICIAL_ORIGIN = "https://api.heycall-e.com"
_OFFICIAL_HOST = "api.heycall-e.com"


class CredentialTargetError(RuntimeError):
    """CALLE_BASE_URL does not point at the official HTTPS origin."""


class CalleAPIError(RuntimeError):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{code}: {message}")
        self.status, self.code, self.message = status, code, message


def resolve_base_url(value: str | None = None) -> str:
    """Pin the bearer token to the official origin.

    The URL is parsed, not string-matched, so plaintext HTTP, userinfo, a path or query,
    another port, and look-alikes such as ``https://api.heycall-e.com.example`` are refused.
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


def idempotency_key(lead_id: str) -> str:
    """Stable per lead, so a retried dispatch never places a second call to the same lead."""
    return f"leadpulse:lead:{lead_id}:qualify:v1"


def build_request(
    business: dict[str, Any], form: dict[str, Any], phone: str, webhook_url: str | None = None
) -> dict[str, Any]:
    recipient: dict[str, Any] = {"phones": [phone], "locale": "en-US"}
    region = region_for(phone)
    if region:
        recipient["region"] = region
    body: dict[str, Any] = {
        "task": build_task(business, form),
        "recipients": [recipient],
        "result_schema": RESULT_SCHEMA,
        "metadata": {"app": "leadpulse", "lead_id": str(form["lead_id"])},
    }
    if webhook_url:
        if urlsplit(webhook_url).scheme != "https":
            raise ValueError("webhook_url must be an https:// URL")
        body["webhook_url"] = webhook_url
    return {"idempotency_key": idempotency_key(str(form["lead_id"])), "body": body}


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


def place_call(
    business: dict[str, Any],
    form: dict[str, Any],
    webhook_url: str | None = None,
    client: CalleClient | None = None,
) -> dict[str, Any]:
    """Create one real call. The destination is authorized before any client is built."""
    phone = assert_authorized(str(form.get("phone") or ""))
    if form.get("consent_to_call") is not True:
        raise PermissionError("the form submission does not record consent_to_call: true")
    request = build_request(business, form, phone, webhook_url)
    return (client or CalleClient()).create_call(request)
