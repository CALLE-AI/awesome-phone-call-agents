from __future__ import annotations

import json
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .core import OFFICIAL_BASE_URL


TERMINAL_STATUSES = {"completed", "failed", "canceled", "cancelled", "rejected", "declined"}


class CalleApiError(RuntimeError):
    pass


class CalleApiClient:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = OFFICIAL_BASE_URL,
        timeout_seconds: float = 30,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        if not isinstance(api_key, str) or not api_key.strip():
            raise ValueError("a CALL-E API key is required")
        if base_url != OFFICIAL_BASE_URL:
            raise ValueError("live credentials are restricted to the official CALL-E API origin")
        self._api_key = api_key.strip()
        self._base_url = base_url
        self._timeout_seconds = timeout_seconds
        self._opener = opener

    def _json_request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "application/json",
        }
        data = None
        if body is not None:
            data = json.dumps(body, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)
        request = Request(self._base_url + path, data=data, headers=headers, method=method)
        response = None
        try:
            response = self._opener(request, timeout=self._timeout_seconds)
            status = getattr(response, "status", None)
            if status is None:
                status = response.getcode()
            raw = response.read()
        except HTTPError as exc:
            raise CalleApiError(f"CALL-E returned HTTP {exc.code}; no automatic retry was attempted") from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise CalleApiError(
                "CALL-E network outcome is uncertain; do not create a new request. Reconcile with the same idempotency key."
            ) from exc
        finally:
            if response is not None and hasattr(response, "close"):
                response.close()
        if status < 200 or status >= 300:
            raise CalleApiError(f"CALL-E returned HTTP {status}; no automatic retry was attempted")
        try:
            decoded = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise CalleApiError("CALL-E returned a non-JSON response") from exc
        if not isinstance(decoded, dict):
            raise CalleApiError("CALL-E returned a non-object JSON response")
        return decoded

    def create_call(self, payload: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        return self._json_request(
            "POST",
            "/v1/calls",
            body=payload,
            extra_headers={"Idempotency-Key": idempotency_key},
        )

    def get_call(self, call_id: str) -> dict[str, Any]:
        if not isinstance(call_id, str) or not call_id.strip():
            raise ValueError("call_id is required")
        return self._json_request("GET", f"/v1/calls/{quote(call_id.strip(), safe='')}")


def wait_for_terminal(
    client: CalleApiClient,
    call_id: str,
    *,
    poll_interval_seconds: float = 10,
    timeout_seconds: float = 900,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    started = monotonic()
    while True:
        result = client.get_call(call_id)
        status = result.get("status")
        if status in TERMINAL_STATUSES:
            return result
        if monotonic() - started >= timeout_seconds:
            raise CalleApiError(
                f"Timed out waiting for existing call {call_id}; keep this id and reconcile it. Do not create another call."
            )
        sleep(poll_interval_seconds)
