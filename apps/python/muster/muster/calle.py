"""CALL-E transport.

Uses the documented REST contract directly over the standard library, so the
package has no runtime dependencies and the whole test suite runs with no
credentials and places no calls.

`DryRunClient` is the default everywhere. Placing a real call requires
constructing `HttpClient` explicitly with an API key.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol

from .safety import redact

BASE_URL = "https://api.heycall-e.com/v1"

#: The only origins this client will send an API key to. A base_url override is
#: useful for a staging host, but it must never become a way to post a bearer
#: token to an arbitrary server.
ALLOWED_ORIGINS = frozenset({"https://api.heycall-e.com"})


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect while carrying a credential.

    urllib re-sends the Authorization header across hosts by default, so a
    single 302 from a compromised or misconfigured endpoint would hand the API
    key to whoever it points at.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        raise CalleError(
            "forbidden",
            f"refusing to follow a redirect to {redact(str(newurl))} while sending credentials",
        )


_OPENER = urllib.request.build_opener(_RefuseRedirects)


def _approved(base_url: str) -> str:
    """Return `base_url` if it is an approved HTTPS origin, else refuse."""
    parsed = urllib.parse.urlsplit(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if parsed.scheme != "https" or origin not in ALLOWED_ORIGINS:
        raise CalleError(
            "forbidden",
            f"refusing to send credentials to {origin!r}; "
            f"allowed origins are {sorted(ALLOWED_ORIGINS)}",
        )
    return base_url

#: Lifecycle states from which no further change is expected.
TERMINAL_STATUSES = {"completed", "failed", "canceled"}


class CalleError(RuntimeError):
    """A CALL-E API error, carrying the stable error code where one was given."""

    def __init__(self, code: str, message: str, status: int | None = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.status = status


class Client(Protocol):
    """The surface Muster needs. Implemented by the real and dry-run clients."""

    def create_call(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        ...

    def get_call(self, call_id: str) -> dict[str, Any]:
        ...


@dataclass
class HttpClient:
    """Talks to the live CALL-E API. Placing a call spends real credit."""

    api_key: str
    base_url: str = BASE_URL
    timeout: float = 30.0

    def __post_init__(self) -> None:
        _approved(self.base_url)

    def _request(self, method: str, path: str, body: dict | None = None,
                 headers: dict[str, str] | None = None) -> dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                **(headers or {}),
            },
        )
        try:
            with _OPENER.open(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raw = error.read().decode("utf-8", "replace")
            try:
                envelope = json.loads(raw)["error"]
                raise CalleError(
                    envelope.get("code", "unknown"),
                    redact(envelope.get("message", raw)),
                    error.code,
                ) from None
            except (ValueError, KeyError):
                raise CalleError("http_error", redact(raw), error.code) from None

    def create_call(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        # The key is derived from the attestation cycle, not the attempt, so a
        # retried run can never dial the same person twice.
        return self._request(
            "POST", "/calls", payload, {"Idempotency-Key": idempotency_key}
        )

    def get_call(self, call_id: str) -> dict[str, Any]:
        return self._request("GET", f"/calls/{call_id}")

    def list_goals(self, limit: int = 5) -> dict[str, Any]:
        """Read-only. Used to verify credentials without placing a call."""
        return self._request("GET", f"/goals?limit={limit}")


@dataclass
class DryRunClient:
    """Places no call. Returns the request that would have been sent.

    This is the default so that running Muster by accident cannot ring anybody.
    """

    scripted_result: dict[str, Any] | None = None
    last_payload: dict[str, Any] | None = None
    last_idempotency_key: str | None = None

    def create_call(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        self.last_payload = payload
        self.last_idempotency_key = idempotency_key
        return {"id": "call_dryrun", "status": "queued", "dry_run": True}

    def get_call(self, call_id: str) -> dict[str, Any]:
        if self.scripted_result is not None:
            return self.scripted_result
        return {
            "id": call_id,
            "status": "completed",
            "structured_result": None,
            "recipients": [],
            "dry_run": True,
        }


def wait_for_result(
    client: Client,
    call_id: str,
    timeout_seconds: float = 300.0,
    interval_seconds: float = 3.0,
    sleep=time.sleep,
) -> dict[str, Any]:
    """Poll until the call task reaches a terminal state.

    A timeout is not a failed call. It leaves the outcome unresolved, which the
    caller must treat as UNPROVEN rather than as a decline.
    """
    deadline = time.monotonic() + timeout_seconds
    while True:
        call = client.get_call(call_id)
        if call.get("status") in TERMINAL_STATUSES:
            return call
        if time.monotonic() >= deadline:
            raise CalleError("call_not_ready", f"call {call_id} did not reach a terminal state")
        sleep(interval_seconds)
