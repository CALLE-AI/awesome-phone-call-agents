from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any


class CalleAPIError(RuntimeError):
    pass


OFFICIAL_CALLE_BASE_URL = "https://api.heycall-e.com"


class CalleClient:
    def __init__(self, api_key: str, base_url: str = OFFICIAL_CALLE_BASE_URL) -> None:
        if not api_key:
            raise CalleAPIError("CALLE_API_KEY is required for a live run.")
        normalized_base_url = base_url.rstrip("/")
        if normalized_base_url != OFFICIAL_CALLE_BASE_URL:
            raise CalleAPIError(
                "Live CALL-E credentials may only be sent to the official HTTPS API origin."
            )
        self.api_key = api_key
        self.base_url = normalized_base_url

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        data = json.dumps(payload).encode() if payload is not None else None
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
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
                    "Polling timed out. The call may still be active. Reuse this call ID and do not create a duplicate."
                )
            time.sleep(poll_seconds)
