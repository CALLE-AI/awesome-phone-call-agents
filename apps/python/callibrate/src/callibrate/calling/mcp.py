"""A CALL-E MCP client: brokered login, Streamable HTTP, three tools.

CALL-E publishes an OAuth-protected Model Context Protocol endpoint over
Streamable HTTP with `plan_call`, `run_call` and `get_call_run`. Callibrate is a
server, not an agent, so it speaks that protocol directly rather than through an
agent host: it holds the bearer token, opens the MCP session, and calls the
three tools in order.

Two things here are worth naming.

**The token is never handled by a model and never logged.** It is read from the
`calle` CLI's local cache, or obtained through CALL-E's login broker, and lives
only in this module and the `Authorization` header. `redact()` exists so that
every error this module raises can be safely written to the audit ledger.

**A `run_id` is never lost.** `run_call` is asynchronous and can return before
the phone rings. The caller above persists the `run_id` before polling starts,
so a restart resumes `get_call_run` instead of dialling anybody twice. This
module never retries `run_call` on its own.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

DEFAULT_BASE_URL = "https://seleven-mcp-sg.airudder.com"
DEFAULT_CHANNEL = "openagent_oauth"
DEFAULT_SCOPE = "openid email profile"
DEFAULT_CLIENT_NAME = "calle Login"
MCP_PROTOCOL_VERSION = "2025-11-25"

#: Sent on every request so CALL-E can attribute usage to this integration.
INTEGRATION_HEADER = "callibrate/1.0.0"

#: Terminal run statuses, from the CALL-E MCP guide. `NO ANSWER` with a space is
#: documented as the same outcome as `NO_ANSWER`.
TERMINAL_STATUSES = frozenset(
    {
        "COMPLETED",
        "FAILED",
        "NO_ANSWER",
        "NO ANSWER",
        "DECLINED",
        "CANCELED",
        "CANCELLED",
        "VOICEMAIL",
        "BUSY",
        "EXPIRED",
    }
)

_SECRET = re.compile(
    r"(?i)\b(bearer\s+[\w.\-]+|iams_[a-z]+_[\w\-]+|eyJ[\w\-]+\.[\w\-]+\.[\w\-]+)"
)


def redact(text: str) -> str:
    """Remove anything that looks like a credential from a message we will store."""
    return _SECRET.sub("[redacted]", text)[:2000]


class CalleError(RuntimeError):
    def __init__(self, message: str, *, code: str = "calle_error", status: int | None = None) -> None:
        super().__init__(redact(message))
        self.code = code
        self.status = status


class CalleAuthRequired(CalleError):
    """No usable CALL-E token. The operator has to complete a browser login."""

    def __init__(self, message: str, login_url: str = "") -> None:
        super().__init__(message, code="auth_required", status=401)
        self.login_url = login_url


@dataclass(slots=True)
class CalleAuth:
    """Where the bearer token comes from, in the order they are tried."""

    base_url: str = DEFAULT_BASE_URL
    channel: str = DEFAULT_CHANNEL
    #: An explicit token, from `CBR_CALLE_ACCESS_TOKEN`.
    access_token: str = ""
    #: The `calle` CLI cache root. The CLI writes `<root>/<md5(server_url)>/token.json`.
    cache_root: Path = field(default_factory=lambda: Path.home() / ".calle-mcp" / "cli")
    min_ttl_seconds: float = 120.0

    @property
    def server_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/mcp/{self.channel}"

    @property
    def token_path(self) -> Path:
        digest = hashlib.md5(self.server_url.encode("utf-8")).hexdigest()  # noqa: S324 - CLI's own layout
        return self.cache_root / digest / "token.json"

    def cached_token(self) -> str:
        """Read the CLI's cached access token, if it is present and not expiring."""
        if self.access_token:
            return self.access_token
        try:
            document = json.loads(self.token_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return ""
        token = (document.get("token") or {}).get("access_token")
        if not isinstance(token, str) or not token:
            return ""
        expires_at = document.get("expires_at")
        if isinstance(expires_at, str) and expires_at:
            try:
                moment = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            except ValueError:
                return token
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=UTC)
            if (moment - datetime.now(UTC)).total_seconds() <= self.min_ttl_seconds:
                return ""
        return token

    def status(self) -> dict[str, Any]:
        """A description of the auth state that contains no secret."""
        token = self.cached_token()
        return {
            "authenticated": bool(token),
            "server_url": self.server_url,
            "source": "environment" if self.access_token else "calle cli cache",
            "cache_path": str(self.token_path),
        }


async def start_broker_login(auth: CalleAuth, *, timeout: float = 20.0) -> dict[str, str]:
    """Open a CALL-E login session and return the URL a person has to visit."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{auth.base_url.rstrip('/')}/api/v1/openagent-auth/sessions",
            headers={"X-Call-E-Integration": INTEGRATION_HEADER},
            json={
                "server_url": auth.server_url,
                "auth_base_url": auth.base_url.rstrip("/"),
                "channel": auth.channel,
                "scope": DEFAULT_SCOPE,
                "client_name": DEFAULT_CLIENT_NAME,
            },
        )
        response.raise_for_status()
        payload = response.json()
    return {
        "session_id": str(payload["session_id"]),
        "session_secret": str(payload["session_secret"]),
        "login_url": str(payload["login_url"]),
        "status": str(payload.get("status", "PENDING")).upper(),
    }


async def finish_broker_login(
    auth: CalleAuth, pending: dict[str, str], *, deadline_seconds: float = 300.0
) -> dict[str, Any]:
    """Poll a started login until it is authorized, then exchange it for a token."""
    headers = {
        "X-OpenAgent-Session-Secret": pending["session_secret"],
        "X-Call-E-Integration": INTEGRATION_HEADER,
    }
    sessions = f"{auth.base_url.rstrip('/')}/api/v1/openagent-auth/sessions/{pending['session_id']}"
    ends_at = time.monotonic() + deadline_seconds
    async with httpx.AsyncClient(timeout=20.0) as client:
        while time.monotonic() < ends_at:
            status_response = await client.get(sessions, headers=headers)
            status_response.raise_for_status()
            body = status_response.json()
            status = str(body.get("status", "PENDING")).upper()
            if status == "AUTHORIZED":
                exchange = await client.post(f"{sessions}/exchange", headers=headers)
                exchange.raise_for_status()
                document = exchange.json()
                auth.token_path.parent.mkdir(parents=True, exist_ok=True)
                auth.token_path.write_text(json.dumps(document, indent=2), encoding="utf-8")
                return {"status": "logged_in", "cache_path": str(auth.token_path)}
            if status in {"FAILED", "EXPIRED", "EXCHANGED"}:
                raise CalleError(f"brokered login ended as {status}", code="auth_failed")
            await asyncio.sleep(min(float(body.get("poll_after_ms") or 1500) / 1000, 5.0))
    raise CalleError("timed out waiting for browser authorization", code="auth_timeout")


def _structured(result: dict[str, Any]) -> dict[str, Any]:
    """Prefer `structuredContent`; fall back to a JSON object in a text block.

    The MCP guide is explicit that the JSON text block is a compatibility
    representation and is not guaranteed to be first, so this scans every text
    block and accepts only a JSON *object*.
    """
    structured = result.get("structuredContent") or result.get("structured_content")
    if isinstance(structured, dict):
        return structured
    for block in result.get("content") or []:
        if not isinstance(block, dict) or block.get("type") != "text":
            continue
        try:
            parsed = json.loads(block.get("text") or "")
        except ValueError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return {}


def _parse_body(response: httpx.Response) -> dict[str, Any]:
    """Read a JSON-RPC body from either a JSON or an SSE Streamable HTTP reply."""
    content_type = response.headers.get("content-type", "")
    text = response.text
    if "text/event-stream" in content_type:
        for line in text.splitlines():
            if not line.startswith("data:"):
                continue
            try:
                parsed = json.loads(line[5:].strip())
            except ValueError:
                continue
            if isinstance(parsed, dict) and ("result" in parsed or "error" in parsed):
                return parsed
        return {}
    if not text.strip():
        return {}
    return json.loads(text)


class CalleMcpClient:
    """One MCP session against CALL-E, reused across the calls of one run."""

    def __init__(
        self,
        auth: CalleAuth,
        *,
        timeout_seconds: float = 30.0,
        plan_timeout_seconds: float = 150.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.auth = auth
        self.timeout_seconds = timeout_seconds
        self.plan_timeout_seconds = plan_timeout_seconds
        #: Injected only by the test suite, so the three tool calls can be driven
        #: against a stand-in server without any network and without a token.
        self.transport = transport
        self._client: httpx.AsyncClient | None = None
        self._headers: dict[str, str] | None = None
        self._tools: list[str] = []

    async def __aenter__(self) -> CalleMcpClient:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
        self._client = None
        self._headers = None

    async def connect(self) -> list[str]:
        """Open the session and return the tool names the server advertises."""
        token = self.auth.cached_token()
        if not token:
            raise CalleAuthRequired(
                "no CALL-E token is available; run `callibrate calle login` and finish the "
                "browser authorization"
            )
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(self.timeout_seconds), transport=self.transport
        )
        headers = {
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
            "mcp-protocol-version": MCP_PROTOCOL_VERSION,
            "Authorization": f"Bearer {token}",
            "X-Call-E-Integration": INTEGRATION_HEADER,
        }
        body, response_headers = await self._rpc(
            headers,
            {
                "jsonrpc": "2.0",
                "id": "callibrate-initialize",
                "method": "initialize",
                "params": {
                    "protocolVersion": MCP_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "callibrate", "version": "1.0.0"},
                },
            },
        )
        del body
        session_id = response_headers.get("mcp-session-id")
        if session_id:
            headers["mcp-session-id"] = session_id
        self._headers = headers
        await self._rpc(headers, {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        listing = await self._request("tools/list")
        self._tools = [
            tool.get("name", "")
            for tool in (listing.get("tools") or [])
            if isinstance(tool, dict)
        ]
        return self._tools

    @property
    def tools(self) -> list[str]:
        return list(self._tools)

    async def _rpc(
        self, headers: dict[str, str], payload: dict[str, Any], *, timeout: float | None = None
    ) -> tuple[dict[str, Any], httpx.Headers]:
        assert self._client is not None
        response = await self._client.post(
            self.auth.server_url,
            headers=headers,
            json=payload,
            timeout=timeout or self.timeout_seconds,
        )
        if response.status_code in {401, 403}:
            raise CalleAuthRequired(
                "CALL-E rejected the cached token; run `callibrate calle login` again"
            )
        if response.status_code >= 400:
            raise CalleError(
                f"CALL-E MCP returned HTTP {response.status_code} for {payload.get('method')}",
                code="mcp_http_error",
                status=response.status_code,
            )
        body = _parse_body(response)
        if isinstance(body, dict) and body.get("error"):
            message = body["error"].get("message") or f"MCP error for {payload.get('method')}"
            raise CalleError(message, code="mcp_tool_error")
        return body, response.headers

    async def _request(
        self, method: str, params: dict[str, Any] | None = None, *, timeout: float | None = None
    ) -> dict[str, Any]:
        if self._headers is None:
            await self.connect()
        assert self._headers is not None
        body, _ = await self._rpc(
            self._headers,
            {
                "jsonrpc": "2.0",
                "id": f"callibrate-{method.replace('/', '-')}",
                "method": method,
                "params": params or {},
            },
            timeout=timeout,
        )
        return body.get("result", {}) or {}

    async def call_tool(
        self, name: str, arguments: dict[str, Any], *, timeout: float | None = None
    ) -> dict[str, Any]:
        result = await self._request(
            "tools/call", {"name": name, "arguments": arguments}, timeout=timeout
        )
        if result.get("isError"):
            blocks = [
                block.get("text", "")
                for block in result.get("content") or []
                if isinstance(block, dict)
            ]
            raise CalleError(f"{name} failed: {' '.join(blocks)[:500]}", code="mcp_tool_error")
        return _structured(result)

    # -- The three CALL-E tools -------------------------------------------------

    async def plan_call(
        self,
        *,
        user_input: str,
        to_phones: list[str],
        goal: str,
        language: str,
        region: str,
        plan_id: str = "",
        ttl_seconds: int | None = None,
    ) -> dict[str, Any]:
        """Prepare a call. Never dials."""
        arguments: dict[str, Any] = {
            "user_input": user_input,
            "to_phones": to_phones,
            "goal": goal,
            "language": language,
            "region": region,
        }
        if plan_id:
            arguments["plan_id"] = plan_id
        if ttl_seconds:
            arguments["ttl_seconds"] = ttl_seconds
        return await self.call_tool("plan_call", arguments, timeout=self.plan_timeout_seconds)

    async def run_call(
        self, *, plan_id: str, confirm_token: str, ttl_seconds: int | None = None
    ) -> dict[str, Any]:
        """Start the planned call. This can ring a real telephone."""
        arguments: dict[str, Any] = {"plan_id": plan_id, "confirm_token": confirm_token}
        if ttl_seconds:
            arguments["ttl_seconds"] = ttl_seconds
        return await self.call_tool("run_call", arguments)

    async def get_call_run(
        self, *, run_id: str, cursor: str = "", limit: int | None = None
    ) -> dict[str, Any]:
        """Read a run. Read-only; never starts anything."""
        arguments: dict[str, Any] = {"run_id": run_id}
        if cursor:
            arguments["cursor"] = cursor
        if limit:
            arguments["limit"] = limit
        return await self.call_tool("get_call_run", arguments)
