from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

@dataclass
class CallRun:
    status: str
    transcript: str = ""
    failure_code: str | None = None

class CalleHTTPClient:
    def __init__(self, base_url: str | None = None, token: str | None = None, timeout: int = 30):
        self.base_url = (base_url or os.getenv("CALL_E_BASE_URL", "")).rstrip("/")
        self.token = token or os.getenv("CALL_E_API_TOKEN", "")
        self.timeout = timeout

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.base_url:
            raise RuntimeError("CALL_E_BASE_URL is not configured")
        if not self.token:
            raise RuntimeError("CALL_E_API_TOKEN is not configured")

        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode()
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"CALL-E request failed with HTTP {exc.code}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError("CALL-E request could not be reached") from exc

        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("CALL-E returned non-JSON data") from exc

    def plan_call(self, task_description: str, destination: str, schema: dict[str, Any]) -> str:
        response = self._request(
            "POST",
            "/plan_call",
            {
                "task_description": task_description,
                "destination": destination,
                "structured_result_schema": schema,
            },
        )
        recovery_id = response.get("recovery_id")
        if not recovery_id:
            raise RuntimeError("CALL-E plan response did not contain recovery_id")
        return str(recovery_id)

    def run_call(self, recovery_id: str) -> None:
        self._request("POST", "/run_call", {"recovery_id": recovery_id})

    def get_call_run(self, recovery_id: str) -> CallRun:
        response = self._request("GET", f"/get_call_run/{recovery_id}")
        return CallRun(
            status=str(response.get("status", "")),
            transcript=str(response.get("transcript", "")),
            failure_code=response.get("failure_code"),
        )
