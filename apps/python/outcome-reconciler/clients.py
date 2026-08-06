"""Status clients.

The reconciler never talks to the network. A `StatusClient` is injected, which
is what keeps the default test suite credential-free: tests inject
`ReplayClient` and never open a socket.

Three implementations ship here:

* `ReplayClient`      - replays a recorded fixture. Used by tests and --dry-run.
* `RestStatusClient`  - reads the documented Calls API.
* `McpStatusClient`   - reads the MCP `get_call_run` tool, the surface the
                        `batch-runner` app in this repository polls.

This app never places a call. It only reads the status of a call reference the
caller already created.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Mapping, Protocol, Sequence

DEFAULT_REST_BASE_URL = "https://api.heycall-e.com"
REST_API_KEY_ENV_VAR = "CALLE_API_KEY"
INTEGRATION_HEADER = "apps/python/outcome-reconciler/0.0.0"


class TransportError(Exception):
    """A status read failed. Never produces a semantic outcome on its own."""


class PlanTimeoutError(Exception):
    """A plan_call or status request timed out with no recoverable state."""


class AuthUnavailableError(Exception):
    """Credentials are absent or no longer usable."""


class StatusClient(Protocol):
    """Reads one status observation for a call reference."""

    #: The mapping-table surface this client reads from.
    surface: str

    def check_auth(self) -> None:
        """Verify credentials. Called before every poll cycle."""

    def fetch(self, call_ref: str) -> Mapping[str, Any]:
        """Return one raw upstream payload, verbatim.

        Raises `TransportError` on a recoverable read failure and
        `PlanTimeoutError` when the request timed out with no recoverable state.
        """


# ---------------------------------------------------------------------------
# Replay
# ---------------------------------------------------------------------------


@dataclass
class ReplayClient:
    """Replays a recorded sequence. Makes no network request.

    A fixture is a JSON document:

        {
          "surface": "rest.calls",
          "recipient_phone": "+15550101234",
          "sequence": [
            {"payload": {"status": "queued"}},
            {"transport_error": "connection reset"},
            {"payload": {"status": "completed", "duration_seconds": 42}}
          ]
        }

    When the sequence is exhausted the final step repeats, which is how a
    permanently stuck call is modelled.
    """

    surface: str
    sequence: Sequence[Mapping[str, Any]]
    recipient_phone: str | None = None
    _cursor: int = 0

    @classmethod
    def from_fixture(cls, path: Path) -> "ReplayClient":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        sequence = raw.get("sequence") or []
        if not sequence:
            raise ValueError(f"Fixture {path} declares an empty sequence")
        return cls(
            surface=raw["surface"],
            sequence=sequence,
            recipient_phone=raw.get("recipient_phone"),
        )

    def check_auth(self) -> None:
        """No credentials are involved in a replay."""

    def fetch(self, call_ref: str) -> Mapping[str, Any]:
        index = min(self._cursor, len(self.sequence) - 1)
        self._cursor += 1
        step = self.sequence[index]
        if step.get("plan_timeout"):
            raise PlanTimeoutError(str(step.get("plan_timeout")))
        if step.get("transport_error"):
            raise TransportError(str(step["transport_error"]))
        payload = step.get("payload")
        if payload is None:
            raise TransportError("fixture step declared no payload")
        return payload


# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------


@dataclass
class RestStatusClient:
    """Reads the documented Calls API.

    The API key is read from the environment and never logged or persisted.
    """

    call_path_template: str = "/v1/calls/{call_ref}"
    base_url: str = DEFAULT_REST_BASE_URL
    timeout_seconds: float = 15.0
    surface: str = "rest.calls"

    def _api_key(self) -> str:
        key = os.environ.get(REST_API_KEY_ENV_VAR)
        if not key:
            raise AuthUnavailableError(
                f"{REST_API_KEY_ENV_VAR} is not set. Export it, or use --dry-run to replay a fixture."
            )
        return key

    def check_auth(self) -> None:
        self._api_key()

    def fetch(self, call_ref: str) -> Mapping[str, Any]:
        url = self.base_url.rstrip("/") + self.call_path_template.format(call_ref=call_ref)
        request = urllib.request.Request(
            url,
            headers={
                "Authorization": f"Bearer {self._api_key()}",
                "Accept": "application/json",
                "X-Integration": INTEGRATION_HEADER,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read().decode("utf-8")
        except TimeoutError as exc:
            raise PlanTimeoutError(f"status request timed out after {self.timeout_seconds}s") from exc
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise AuthUnavailableError(f"status request rejected with HTTP {exc.code}") from exc
            raise TransportError(f"HTTP {exc.code} reading call status") from exc
        except urllib.error.URLError as exc:
            raise TransportError(f"network error reading call status: {exc.reason}") from exc
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise TransportError(f"status response was not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise TransportError("status response was not a JSON object")
        return payload


# ---------------------------------------------------------------------------
# MCP
# ---------------------------------------------------------------------------


@dataclass
class McpStatusClient:
    """Reads the MCP `get_call_run` tool result.

    Mirrors how `apps/python/batch-runner` authenticates: it reuses the token
    cache written by `@call-e/cli` rather than performing its own OAuth flow.
    Run `calle auth login` first.

    This surface is undocumented upstream, so every observation it produces
    resolves to `unresolved`. It is supported because it is the surface the
    existing app in this repository polls.
    """

    server_url: str
    token_cache_path: Path | None = None
    timeout_seconds: float = 30.0
    surface: str = "mcp.get_call_run"

    def _access_token(self) -> str:
        path = self.token_cache_path
        if path is None or not Path(path).exists():
            raise AuthUnavailableError(
                "No CALL-E CLI token cache found. Run `calle auth login`, "
                "or use --dry-run to replay a fixture."
            )
        try:
            cached = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AuthUnavailableError(f"Token cache at {path} is unreadable: {exc}") from exc
        token = cached.get("access_token")
        if not isinstance(token, str) or not token:
            raise AuthUnavailableError(f"Token cache at {path} holds no usable access token")
        return token

    def check_auth(self) -> None:
        self._access_token()

    def fetch(self, call_ref: str) -> Mapping[str, Any]:
        try:
            import asyncio

            from fastmcp import Client
            from fastmcp.client.transports import StreamableHttpTransport
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise TransportError(f"fastmcp is unavailable: {exc}") from exc

        token = self._access_token()

        async def _call() -> Mapping[str, Any]:
            transport = StreamableHttpTransport(
                url=self.server_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Integration": INTEGRATION_HEADER,
                },
            )
            async with Client(transport) as client:
                result = await client.call_tool(
                    name="get_call_run",
                    arguments={"run_id": call_ref},
                    raise_on_error=False,
                )
                data = getattr(result, "data", None)
                if isinstance(data, dict):
                    return data
                structured = getattr(result, "structured_content", None)
                if isinstance(structured, dict):
                    return structured
                raise TransportError("get_call_run returned no structured payload")

        try:
            return asyncio.run(asyncio.wait_for(_call(), timeout=self.timeout_seconds))
        except asyncio.TimeoutError as exc:
            raise PlanTimeoutError(f"get_call_run timed out after {self.timeout_seconds}s") from exc
        except (TransportError, PlanTimeoutError, AuthUnavailableError):
            raise
        except Exception as exc:  # noqa: BLE001 - transport failures are recoverable
            raise TransportError(f"get_call_run failed: {exc}") from exc


def iter_fixture_paths(directory: Path) -> Iterator[Path]:
    yield from sorted(Path(directory).glob("*.json"))
