from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Mapping
from urllib.parse import urlparse

from ringdown.calls import CallRun, CallSnapshot, run_from, snapshot_from

CODE_LIMIT = 40
LIVE_BASE_URL = "https://api.heycall-e.com"
LIVE_MCP_URL = "https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
AMBIGUOUS_STATUSES = frozenset({408, 409, 425, 429})
MCP_RETRY_DELAY = 1.0


class CalleError(Exception):
    def __init__(self, code: str, status: int | None, message: str, details: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.status = status
        self.message = message
        self.details = details

    @property
    def may_have_landed(self) -> bool:
        return self.status is None or self.status in AMBIGUOUS_STATUSES or self.status >= 500

    @property
    def retriable(self) -> bool:
        return self.may_have_landed and self.status != 409


class UntrustedHost(ValueError):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CalleError(
            "unexpected_redirect",
            code,
            f"{req.full_url} answered with a redirect to {newurl}; refusing to follow it",
        )


_OPENER = urllib.request.build_opener(_NoRedirect)


def is_loopback(url: str) -> bool:
    return (urlparse(url).hostname or "") in LOOPBACK_HOSTS


def assert_trusted_base_url(url: str) -> str:
    pinned = url.rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise UntrustedHost(f"{url!r} is not an http or https URL")
    if parsed.username or parsed.password:
        raise UntrustedHost("refusing a URL that carries credentials in its userinfo")
    if parsed.query or parsed.fragment:
        raise UntrustedHost("refusing a base URL that carries a query string or a fragment")
    if pinned not in (LIVE_BASE_URL, LIVE_MCP_URL) and not is_loopback(url):
        raise UntrustedHost(
            f"refusing to send a credential to {url!r}: the live channels are pinned to "
            f"{LIVE_BASE_URL} and {LIVE_MCP_URL}, and every other target must be loopback"
        )
    return pinned


class _Client:
    def __init__(self, url: str, api_key: str, timeout: float = 15.0) -> None:
        self._url = assert_trusted_base_url(url)
        self._api_key = api_key
        self._timeout = timeout

    def _send(
        self,
        url: str,
        body: Any = None,
        headers: Mapping[str, str] | None = None,
        timeout: float | None = None,
    ) -> Any:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, method="POST" if data else "GET")
        request.add_header("Authorization", f"Bearer {self._api_key}")
        request.add_header("Content-Type", "application/json")
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        try:
            with _OPENER.open(request, timeout=timeout or self._timeout) as response:
                return json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            raise _http_error(error) from error
        except OSError as error:
            raise CalleError("transport_failure", None, str(error)) from error
        except json.JSONDecodeError as error:
            raise CalleError("unreadable_response", None, str(error)) from error


def _http_error(error: urllib.error.HTTPError) -> CalleError:
    try:
        body = json.loads(error.read() or b"{}")
        envelope = body.get("error", {}) if isinstance(body, dict) else {}
    except (json.JSONDecodeError, OSError):
        envelope = {}
    return CalleError(
        code=str(envelope.get("code") or f"http_{error.code}")[:CODE_LIMIT],
        status=error.code,
        message=str(envelope.get("message") or error.reason),
        details=envelope.get("details"),
    )


class RestClient(_Client):
    def create_call(self, payload: Mapping[str, Any], key: str) -> CallSnapshot:
        return _snapshot(self._send(f"{self._url}/v1/calls", payload, {"Idempotency-Key": key}))

    def get_call(self, call_id: str, timeout: float | None = None) -> CallSnapshot:
        return _snapshot(self._send(f"{self._url}/v1/calls/{call_id}", timeout=timeout))

    def wait_for_result(self, call_id: str, timeout: float, interval: float) -> CallSnapshot:
        deadline = time.monotonic() + timeout
        status = "unpolled"
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CalleError(
                    "poll_timeout",
                    None,
                    f"call {call_id} was still {status} after {timeout:.0f}s",
                )
            snapshot = self.get_call(call_id, timeout=max(0.001, min(self._timeout, remaining)))
            if snapshot.terminal:
                return snapshot
            status = snapshot.status
            time.sleep(min(interval, max(0.0, deadline - time.monotonic())))


class McpClient(_Client):
    def get_call_run(self, call_id: str) -> CallRun:
        try:
            return self._read_run(call_id)
        except CalleError as error:
            if not error.retriable:
                raise
        time.sleep(MCP_RETRY_DELAY)
        return self._read_run(call_id)

    def _read_run(self, call_id: str) -> CallRun:
        body = self._send(
            self._url,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "get_call_run", "arguments": {"run_id": call_id}},
            },
        )
        if not isinstance(body, dict) or "error" in body:
            envelope = body.get("error", {}) if isinstance(body, dict) else {}
            raise CalleError(
                "no_call_run", 404, str(envelope.get("message") or "the run is not readable")
            )
        run = _call_run(body.get("result"))
        if not run.readable:
            raise CalleError("unreadable_run", None, "the run carries no call id")
        return run


def _call_run(result: Any) -> CallRun:
    try:
        return run_from(_unwrap_content(result))
    except (AttributeError, IndexError, KeyError, TypeError, ValueError) as error:
        raise CalleError(
            "unreadable_run",
            None,
            f"the run payload does not have the expected shape: {error}",
        ) from error


def _snapshot(body: Any) -> CallSnapshot:
    try:
        snapshot = snapshot_from(body)
    except (AttributeError, IndexError, KeyError, TypeError, ValueError) as error:
        raise CalleError(
            "unreadable_response",
            None,
            f"the call payload does not have the expected shape: {error}",
        ) from error
    if not snapshot.id:
        raise CalleError("unreadable_response", None, "the call payload carries no id")
    return snapshot


def _unwrap_content(result: Any) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise CalleError("unreadable_run", None, "the run payload is not an object")
    content = result.get("content") or []
    if not content or not isinstance(content[0], dict):
        raise CalleError("unreadable_run", None, "the run payload carries no content")
    text = str(content[0].get("text") or "")
    if result.get("isError"):
        reported = " ".join(text.split()) or "the tool reported an error"
        raise CalleError("mcp_tool_error", 400, reported)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise CalleError("unreadable_run", None, f"the run payload is not JSON: {error}") from error
    if not isinstance(parsed, dict):
        raise CalleError("unreadable_run", None, "the run payload is not an object")
    return parsed
