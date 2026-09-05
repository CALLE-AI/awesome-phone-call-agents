"""CALL-E Developer API adapter for one hop.

Contract source: ``https://docs.heycall-e.com/openapi/calle.openapi.yaml``
(CALL-E Developer API 0.6.0).

* ``POST /v1/calls`` with ``task`` and ``result_schema``, bearer auth, optional
  ``Idempotency-Key``.
* ``GET  /v1/calls/{call_id}`` until the status is terminal.

The transport is injectable so the whole workflow can be exercised, and is
exercised in the tests, without a network or an API key.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from runaround.schema import HOP_RESULT_SCHEMA

API_KEY_ENV = "CALLE_API_KEY"
BASE_URL_ENV = "CALLE_BASE_URL"
DEFAULT_BASE_URL = "https://api.heycall-e.com"

CREATE_CALL_PATH = "/v1/calls"
GET_CALL_PATH = "/v1/calls/{call_id}"
IDEMPOTENCY_HEADER = "Idempotency-Key"

TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled"})
NON_TERMINAL_STATUSES = frozenset({"queued", "in_progress"})

#: Only these hosts may receive a bearer token.
APPROVED_HOSTS = frozenset({"api.heycall-e.com"})

POLL_INTERVAL_SECONDS = 5.0
POLL_MAX_ATTEMPTS = 120


class CallEError(RuntimeError):
    """Raised when CALL-E cannot be used for this hop."""


class Transport(Protocol):
    def request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> tuple[int, dict[str, Any]]: ...


def assert_approved_origin(base_url: str) -> str:
    """Return ``base_url`` if a credential may be sent to it, else raise.

    An operator-supplied base URL is a place where a bearer token can be
    redirected. ``api.heycall-e.com.evil.example`` ends in the right letters
    and is a different host, so the comparison is on the parsed host, exact.
    """
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme != "https":
        raise CallEError(f"CALL-E base URL must be https, got {base_url!r}")
    if parsed.hostname is None or parsed.hostname.lower() not in APPROVED_HOSTS:
        raise CallEError(
            f"refusing to send credentials to unapproved host {parsed.hostname!r}"
        )
    return base_url.rstrip("/")


def idempotency_key(*, case_id: str, hop_index: int, destination: str) -> str:
    """Return a stable key for one hop of one case.

    Derived from the authorization to place this hop, not from the attempt, so
    a retried timeout returns the original call instead of dialling a person
    twice.
    """
    material = f"runaround:{case_id}:{hop_index}:{destination}".encode()
    digest = hashlib.sha256(material).hexdigest()[:32]
    return f"runaround-{digest}"


def build_create_call_body(
    *,
    task_text: str,
    desk_phone: str,
    region: str | None,
    locale: str | None,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """Return the ``POST /v1/calls`` request body for one hop."""
    recipient: dict[str, Any] = {"phones": [desk_phone]}
    if locale:
        recipient["locale"] = locale
    if region:
        recipient["region"] = region
    return {
        "task": task_text,
        "recipients": [recipient],
        "result_schema": HOP_RESULT_SCHEMA,
        "metadata": metadata,
    }


class UrllibTransport:
    """Real HTTPS transport. Used only on the live path."""

    def __init__(self, timeout: float = 30.0) -> None:
        self._timeout = timeout

    def request(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str],
        body: bytes | None,
    ) -> tuple[int, dict[str, Any]]:
        request = urllib.request.Request(
            url, data=body, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                payload = response.read().decode("utf-8")
                return response.status, json.loads(payload or "{}")
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", errors="replace")
            try:
                return error.code, json.loads(raw or "{}")
            except json.JSONDecodeError:
                return error.code, {"error": {"code": "internal_error", "message": raw}}
        except urllib.error.URLError as error:
            raise CallEError(f"CALL-E is unreachable: {error.reason}") from error


@dataclass
class CallEClient:
    """Places one hop and returns the terminal call task."""

    api_key: str
    base_url: str = DEFAULT_BASE_URL
    transport: Transport | None = None
    poll_interval: float = POLL_INTERVAL_SECONDS
    poll_max_attempts: int = POLL_MAX_ATTEMPTS
    sleep: Any = time.sleep

    def __post_init__(self) -> None:
        self.base_url = assert_approved_origin(self.base_url)
        if not self.api_key:
            raise CallEError(
                f"{API_KEY_ENV} is not set; the live path needs a CALL-E API key"
            )
        if self.transport is None:
            self.transport = UrllibTransport()

    @classmethod
    def from_env(cls, **kwargs: Any) -> CallEClient:
        return cls(
            api_key=os.environ.get(API_KEY_ENV, ""),
            base_url=os.environ.get(BASE_URL_ENV, DEFAULT_BASE_URL),
            **kwargs,
        )

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if extra:
            headers.update(extra)
        return headers

    @staticmethod
    def _raise_for_error(status: int, payload: dict[str, Any]) -> None:
        if status < 400:
            return
        error = payload.get("error") or {}
        code = error.get("code", "internal_error")
        message = error.get("message", "no message")
        raise CallEError(f"CALL-E returned {status} {code}: {message}")

    def create_call(
        self, *, body: dict[str, Any], key: str | None = None
    ) -> dict[str, Any]:
        extra = {IDEMPOTENCY_HEADER: key} if key else None
        assert self.transport is not None
        status, payload = self.transport.request(
            method="POST",
            url=f"{self.base_url}{CREATE_CALL_PATH}",
            headers=self._headers(extra),
            body=json.dumps(body).encode("utf-8"),
        )
        self._raise_for_error(status, payload)
        return payload

    def get_call(self, call_id: str) -> dict[str, Any]:
        assert self.transport is not None
        status, payload = self.transport.request(
            method="GET",
            url=f"{self.base_url}{GET_CALL_PATH.format(call_id=call_id)}",
            headers=self._headers(),
            body=None,
        )
        self._raise_for_error(status, payload)
        return payload

    def await_terminal(self, call_id: str) -> dict[str, Any]:
        """Poll one call until CALL-E publishes a terminal state.

        A poll ceiling that is reached is not a failed call. The call may
        still be running, so the caller is told the outcome is unknown and the
        case waits for a human rather than redialling.
        """
        for attempt in range(self.poll_max_attempts):
            call = self.get_call(call_id)
            status = call.get("status")
            if status in TERMINAL_STATUSES:
                return call
            if status not in NON_TERMINAL_STATUSES:
                raise CallEError(f"unrecognized call status {status!r}")
            if attempt + 1 < self.poll_max_attempts:
                self.sleep(self.poll_interval)
        raise CallEError(
            f"call {call_id} did not reach a terminal state within "
            f"{self.poll_max_attempts} polls; its outcome is unknown and it "
            "must be reconciled by hand before this case calls anyone again"
        )

    def place_hop(
        self, *, body: dict[str, Any], key: str | None = None
    ) -> dict[str, Any]:
        created = self.create_call(body=body, key=key)
        call_id = created.get("id")
        if not call_id:
            raise CallEError("CALL-E create-call response carried no call id")
        if created.get("status") in TERMINAL_STATUSES:
            return created
        return self.await_terminal(call_id)


def extract_structured_result(call: dict[str, Any]) -> dict[str, Any] | None:
    """Return the task-level structured result, falling back to the recipient.

    A single-recipient hop can carry its result in either place depending on
    which schema CALL-E could satisfy. Neither one present means no result,
    which is a distinct state from an empty one.
    """
    task_level = call.get("structured_result")
    if isinstance(task_level, dict) and task_level:
        return task_level
    recipients = call.get("recipients") or []
    if recipients:
        recipient_level = recipients[0].get("structured_result")
        if isinstance(recipient_level, dict) and recipient_level:
            return recipient_level
    return None
