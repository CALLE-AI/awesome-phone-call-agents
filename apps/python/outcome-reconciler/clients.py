"""Status clients.

The reconciler never talks to the network. A `StatusClient` is injected, which
is what keeps the default test suite credential-free: tests inject
`ReplayClient` and never open a socket.

Four implementations ship here:

* `ReplayClient`         - replays a recorded fixture. Used by tests and --dry-run.
* `RestStatusClient`     - reads the documented Calls API.
* `GoalRunStatusClient`  - reads the documented Goal Runs API. This is the only
                           surface that publishes an enumerated failure
                           vocabulary, so it is the only one from which
                           `not_connected` and `declined` are reachable.
* `McpStatusClient`      - reads the MCP `get_call_run` tool, the surface the
                           `batch-runner` app in this repository polls.

This app never places a call. It only reads the status of a call reference the
caller already created.
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Mapping, Protocol, Sequence

#: The documented CALL-E API host. The `servers:` entry in calle.openapi.yaml
#: v0.6.0 calls this a "Placeholder developer API base URL", but that wording is
#: stale: https://docs.heycall-e.com/authentication documents a live request
#: against this exact origin, and every other app in this repository treats it
#: as the real host.
DEFAULT_BASE_URL = "https://api.heycall-e.com"

#: The one host this app has business sending an API key to.
CALLE_HOST = "api.heycall-e.com"

#: Loopback, so the local fake server and the demo work. Plain http is allowed
#: here and nowhere else.
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})

REST_API_KEY_ENV_VAR = "CALLE_API_KEY"
REST_BASE_URL_ENV_VAR = "CALLE_BASE_URL"
DEFAULT_REQUEST_TIMEOUT_SECONDS = 15.0

#: Where `@call-e/cli` writes its token cache. Mirrors DEFAULT_CACHE_ROOT and
#: fallback_token_cache_path in apps/python/batch-runner/client.py.
MCP_TOKEN_CACHE_ROOT = "~/.calle-mcp/cli"
MCP_MIN_TOKEN_TTL_SECONDS = 300.0

INTEGRATION_HEADER = "apps/python/outcome-reconciler/0.0.0"


class TransportError(Exception):
    """A status read failed. Never produces a semantic outcome on its own."""


class PlanTimeoutError(Exception):
    """A plan_call or status request timed out with no recoverable state."""


class AuthUnavailableError(Exception):
    """Credentials are absent or no longer usable."""


class UpstreamRequestError(Exception):
    """Upstream refused the request permanently. Retrying cannot help.

    Kept apart from `TransportError` because the poller retries transport
    errors within budget. A reference that does not exist would otherwise be
    asked for again on every cycle — up to the observation budget — against a
    metered API, for an answer that will never change.

    Like missing credentials, this is a caller mistake rather than an ambiguous
    call outcome, so it stops the run instead of producing an `unresolved`
    record that reads like a stuck call.
    """


class ConfigurationError(Exception):
    """The caller has not supplied something this app refuses to guess."""


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


_BASE_URL_ADVICE = (
    f"Set --base-url or {REST_BASE_URL_ENV_VAR} to {DEFAULT_BASE_URL}, with no port, path, "
    "query, fragment or credentials. Plain http is allowed only on 127.0.0.1, localhost or "
    "::1, so the local fake server works. Use --dry-run with a fixture to work offline."
)


def validate_base_url(value: str) -> str:
    """Refuse to send the API key anywhere it should not go.

    This runs before the key is read. A warning would be no use here: by the
    time anyone reads it the credential has already left. `https:` alone is not
    enough either — it says the transport was encrypted and nothing about who is
    on the other end — so the host must be CALL-E's or loopback.

    Matching is exact. `api.heycall-e.com.attacker.example` ends in a string
    this app trusts, and a suffix check would wave it through.

    Mirrors `validate_base_url` in apps/python/freshchain-resolver/client.py.
    """
    parsed = urllib.parse.urlparse(value)
    unadorned = (
        parsed.path in ("", "/")
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
    )
    if (
        parsed.scheme == "https"
        and parsed.hostname == CALLE_HOST
        and parsed.port in (None, 443)
        and unadorned
    ):
        return DEFAULT_BASE_URL
    if (
        parsed.scheme == "http"
        and (parsed.hostname or "").strip("[]") in LOOPBACK_HOSTS
        and parsed.port is not None
        and unadorned
    ):
        return value.rstrip("/")
    raise ConfigurationError(
        f"CALL-E base URL {value!r} is not a host this app trusts, so {REST_API_KEY_ENV_VAR} "
        f"was not sent. {_BASE_URL_ADVICE}"
    )


def resolve_base_url(explicit: str | None = None) -> str:
    """Resolve the REST base URL and check it is one the key may go to."""
    return validate_base_url(explicit or os.environ.get(REST_BASE_URL_ENV_VAR) or DEFAULT_BASE_URL)


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
          "started_at": "2026-08-06T10:00:00+00:00",
          "sequence": [
            {"payload": {"status": "queued"}},
            {"transport_error": "connection reset"},
            {"payload": {"status": "completed"}}
          ]
        }

    `started_at` is optional and is used only to give a replayed record
    plausible timestamps. When the sequence is exhausted the final step
    repeats, which is how a permanently stuck call is modelled.
    """

    surface: str
    sequence: Sequence[Mapping[str, Any]]
    recipient_phone: str | None = None
    started_at: str | None = None
    _cursor: int = 0

    @classmethod
    def from_fixture(cls, path: Path) -> "ReplayClient":
        """Load a fixture, refusing anything that is not one.

        Every failure here is a caller handing over the wrong file. Each says
        which file and what was missing, rather than surfacing a KeyError from
        somewhere inside the loader.
        """
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ConfigurationError(f"Fixture {path} is not valid JSON: {exc}") from exc
        if not isinstance(raw, dict):
            raise ConfigurationError(f"Fixture {path} must be a JSON object")
        surface = raw.get("surface")
        if not isinstance(surface, str) or not surface:
            raise ConfigurationError(
                f"Fixture {path} must name the surface its payloads came from, "
                'for example "surface": "rest.calls"'
            )
        sequence = raw.get("sequence") or []
        if not isinstance(sequence, list) or not sequence:
            raise ConfigurationError(f"Fixture {path} must declare a non-empty sequence")
        if not all(isinstance(step, dict) for step in sequence):
            raise ConfigurationError(f"Fixture {path} has a sequence step that is not an object")
        return cls(
            surface=surface,
            sequence=sequence,
            recipient_phone=raw.get("recipient_phone"),
            started_at=raw.get("started_at"),
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
class _RestReader:
    """Shared REST plumbing: auth, headers, and error classification.

    The API key is read from the environment and never logged or persisted.
    """

    base_url: str
    timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS

    def _api_key(self) -> str:
        key = os.environ.get(REST_API_KEY_ENV_VAR)
        if not key:
            raise AuthUnavailableError(
                f"{REST_API_KEY_ENV_VAR} is not set. Export it, or use --dry-run to replay a fixture."
            )
        return key

    def check_auth(self) -> None:
        self._api_key()

    def _get(self, path: str) -> Mapping[str, Any]:
        request = urllib.request.Request(
            self.base_url.rstrip("/") + path,
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
            # socket.timeout is an alias of TimeoutError, so a read-phase
            # timeout arrives here unwrapped.
            raise PlanTimeoutError(f"status request timed out after {self.timeout_seconds}s") from exc
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                raise AuthUnavailableError(f"status request rejected with HTTP {exc.code}") from exc
            if exc.code == 404:
                raise UpstreamRequestError(
                    f"upstream has no record of {path} (HTTP 404). Check the reference, and that "
                    "--surface matches where it came from: a Calls id is not a GoalRun id."
                ) from exc
            # 408 and 429 are worth another go; every other 4xx is the server
            # saying the request itself is wrong, and repeating it just spends
            # quota to be told the same thing.
            if 400 <= exc.code < 500 and exc.code not in (408, 429):
                raise UpstreamRequestError(
                    f"upstream refused the request with HTTP {exc.code}; retrying cannot help"
                ) from exc
            raise TransportError(f"HTTP {exc.code} reading call status") from exc
        except urllib.error.URLError as exc:
            # urllib wraps connect-phase timeouts in URLError. Left as a
            # transport error, a real request timeout would be reported as an
            # exhausted budget, blurring exactly the distinction this layer
            # draws between "never finished" and "could not be read".
            if isinstance(exc.reason, TimeoutError):
                raise PlanTimeoutError(
                    f"status request timed out after {self.timeout_seconds}s"
                ) from exc
            raise TransportError(f"network error reading call status: {exc.reason}") from exc
        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise TransportError(f"status response was not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise TransportError("status response was not a JSON object")
        return payload


@dataclass
class RestStatusClient(_RestReader):
    """Reads the documented Calls API."""

    call_path_template: str = "/v1/calls/{call_ref}"
    surface: str = "rest.calls"

    def fetch(self, call_ref: str) -> Mapping[str, Any]:
        return self._get(self.call_path_template.format(call_ref=call_ref))


@dataclass
class GoalRunStatusClient(_RestReader):
    """Reads the documented Goal Runs API.

    A Goal Run is addressed by a (goal_id, goal_run_id) pair. `call_ref` is the
    `goal_run_id` — the `GoalRun.id` returned by create. The contract is
    explicit that the nested telephone `run_id` is not valid in this path.

    The whole GoalRun is returned verbatim. Meaning is read from the nested
    `error.code` by the mapping table; nothing is extracted or reshaped here.
    """

    goal_id: str = ""
    goal_run_path_template: str = "/v1/goals/{goal_id}/runs/{goal_run_id}"
    surface: str = "rest.goal_runs"

    def __post_init__(self) -> None:
        if not self.goal_id:
            raise ConfigurationError(
                "Reading the rest.goal_runs surface needs a goal id. Pass --goal-id."
            )

    def fetch(self, call_ref: str) -> Mapping[str, Any]:
        return self._get(
            self.goal_run_path_template.format(goal_id=self.goal_id, goal_run_id=call_ref)
        )


# ---------------------------------------------------------------------------
# MCP
# ---------------------------------------------------------------------------


def default_token_cache_path(server_url: str) -> Path:
    """Where `@call-e/cli` caches the token for a given server.

    Mirrors `fallback_token_cache_path` in apps/python/batch-runner/client.py so
    a caller does not have to locate the file by hand.
    """
    digest = hashlib.md5(server_url.encode("utf-8")).hexdigest()
    return Path(MCP_TOKEN_CACHE_ROOT).expanduser() / digest / "token.json"


def _parse_expiry(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


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
    min_token_ttl_seconds: float = MCP_MIN_TOKEN_TTL_SECONDS
    surface: str = "mcp.get_call_run"

    def _cache_path(self) -> Path:
        return Path(self.token_cache_path or default_token_cache_path(self.server_url))

    def _access_token(self) -> str:
        path = self._cache_path()
        if not path.exists():
            raise AuthUnavailableError(
                f"No CALL-E CLI token cache at {path}. Run `calle auth login`, "
                "or use --dry-run to replay a fixture."
            )
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AuthUnavailableError(f"Token cache at {path} is unreadable: {exc}") from exc
        if not isinstance(cached, dict):
            raise AuthUnavailableError(f"Token cache at {path} is not a JSON object")

        # `@call-e/cli` nests the token under `token`. A flat document is
        # accepted too so a hand-written cache still works.
        nested = cached.get("token")
        token = nested.get("access_token") if isinstance(nested, dict) else cached.get("access_token")
        if not isinstance(token, str) or not token:
            raise AuthUnavailableError(f"Token cache at {path} holds no usable access token")

        expires_at = _parse_expiry(cached.get("expires_at"))
        if expires_at is not None:
            remaining = (expires_at - datetime.now(timezone.utc)).total_seconds()
            if remaining <= self.min_token_ttl_seconds:
                raise AuthUnavailableError(
                    f"Cached CALL-E token expires in {remaining:.0f}s. Run `calle auth login`."
                )
        return token

    def check_auth(self) -> None:
        self._access_token()

    @staticmethod
    def _structured_payload(result: Any) -> Mapping[str, Any] | None:
        """Locate the tool result payload.

        Precedence mirrors `structured_content` in
        apps/python/batch-runner/client.py, which is the only in-repo evidence
        of where this server puts it.
        """
        for candidate in (
            getattr(result, "structured_content", None),
            getattr(result, "structuredContent", None),
            getattr(result, "data", None),
        ):
            if isinstance(candidate, dict):
                return candidate
        return None

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
                payload = self._structured_payload(result)
                if payload is None:
                    raise TransportError("get_call_run returned no structured payload")
                return payload

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
