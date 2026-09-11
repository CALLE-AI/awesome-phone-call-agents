"""CALL-E Developer API client.

Deliberately thin, and deliberately the only module in Concord that can reach
the network. `concord.judge` imports nothing from here, which is what keeps
gathering and ruling apart.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

# The bearer token is sent on every request, so the destination is not a free
# parameter. CALLE_BASE_URL exists for a CALL-E staging host, not as a way to
# point a live credential at an arbitrary collector, and an http:// override
# would put the token on the wire in clear text.
ALLOWED_HOSTS = frozenset({"api.heycall-e.com", "api.staging.heycall-e.com"})


class CalleAPIError(RuntimeError):
    pass


def assert_trusted_base_url(base_url: str) -> str:
    """Refuse to carry the credential anywhere but a trusted CALL-E origin."""
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme != "https":
        raise CalleAPIError(
            f"CALL-E base URL must use https, got {parsed.scheme or 'no scheme'!r}. "
            "The API key is sent as a bearer token and will not be put on an "
            "unencrypted connection."
        )
    if parsed.hostname not in ALLOWED_HOSTS:
        raise CalleAPIError(
            f"Refusing to send the CALL-E credential to {parsed.hostname!r}. "
            f"Allowed hosts: {', '.join(sorted(ALLOWED_HOSTS))}."
        )
    return base_url.rstrip("/")


class CalleClient:
    def __init__(self, api_key: str, base_url: str = "https://api.heycall-e.com") -> None:
        if not api_key:
            raise CalleAPIError(
                "CALLE_API_KEY is required for a live run. Concord reads it from the "
                "environment only, and never writes it to disk."
            )
        self.api_key = api_key
        self.base_url = assert_trusted_base_url(base_url)

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {"Authorization": f"Bearer {self.api_key}", "Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            raise CalleAPIError(f"CALL-E returned HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise CalleAPIError(f"Could not reach CALL-E: {exc.reason}") from exc

    def create_call(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        return self._request("POST", "/v1/calls", payload, idempotency_key)

    def get_call(self, call_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/calls/{call_id}")

    def wait_for_completion(
        self, call_id: str, poll_seconds: int = 8, timeout_seconds: int = 900
    ) -> dict[str, Any]:
        terminal = {"completed", "failed", "cancelled", "canceled"}
        deadline = time.monotonic() + timeout_seconds
        while True:
            result = self.get_call(call_id)
            if str(result.get("status", "")).lower() in terminal:
                return result
            if time.monotonic() >= deadline:
                raise CalleAPIError(
                    "Polling timed out. The audit may still be running. Reuse this call "
                    "id and do not create a second audit."
                )
            time.sleep(poll_seconds)
