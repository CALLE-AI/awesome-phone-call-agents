"""Tests for `McpStatusClient` against the repository's fake MCP broker.

This client had no coverage at all: not one line of it had ever run, against a
fake server or anything else. Everything it assumed about the MCP surface — the
tool name, the argument name, the token cache format, where the payload lands —
was copied from `apps/python/batch-runner` and never executed.

`apps/shared/fake-mcp-broker-server.mjs` already implements `get_call_run`, so
these exercise the real code path over real HTTP. No CALL-E credentials, no
browser login, and no outbound call.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterator

import pytest

from clients import (
    CALLE_MCP_HOST,
    AuthUnavailableError,
    ConfigurationError,
    McpStatusClient,
    default_token_cache_path,
)
from mapping import OutcomeMap
from poller import PollingPolicy, poll
from reconciler import reconcile

REPO_ROOT = Path(__file__).resolve().parents[3]
FAKE_BROKER = REPO_ROOT / "apps" / "shared" / "fake-mcp-broker-server.mjs"

#: The token the fake broker accepts. Same value as in the broker source.
FAKE_ACCESS_TOKEN = "fake-access-token"

#: A trusted URL for tests that exercise the token cache rather than a request.
TRUSTED_MCP_URL = f"https://{CALLE_MCP_HOST}/mcp/openagent_oauth"

pytestmark = pytest.mark.skipif(
    shutil.which("node") is None or not FAKE_BROKER.exists(),
    reason="needs node and apps/shared/fake-mcp-broker-server.mjs",
)


@pytest.fixture(scope="module")
def outcome_map() -> OutcomeMap:
    return OutcomeMap.load()


@pytest.fixture
def fake_broker() -> Iterator[dict[str, Any]]:
    process = subprocess.Popen(
        ["node", str(FAKE_BROKER)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    line = process.stdout.readline()
    if not line:
        process.kill()
        raise AssertionError("fake MCP broker did not announce its URLs")
    try:
        yield json.loads(line)
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:  # pragma: no cover - defensive
            process.kill()


def write_token_cache(path: Path, token: str = FAKE_ACCESS_TOKEN, expires_at: str | None = None) -> Path:
    """Write a cache in the shape `@call-e/cli` actually produces.

    The token is nested under `token`. Reading a top-level `access_token`
    instead — as this client used to — finds nothing against a real cache.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    document: dict[str, Any] = {"token": {"access_token": token, "refresh_token": "fake-refresh"}}
    if expires_at:
        document["expires_at"] = expires_at
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    return path


def test_the_default_cache_path_matches_the_one_the_cli_writes() -> None:
    """Mirrors fallback_token_cache_path in apps/python/batch-runner/client.py."""
    server_url = TRUSTED_MCP_URL
    digest = hashlib.md5(server_url.encode("utf-8")).hexdigest()
    resolved = default_token_cache_path(server_url)
    assert resolved.name == "token.json"
    assert resolved.parent.name == digest
    assert resolved.parent.parent.name == "cli"
    assert ".calle-mcp" in str(resolved)


def test_a_nested_cli_token_cache_is_read(tmp_path: Path) -> None:
    cache = write_token_cache(tmp_path / "token.json")
    client = McpStatusClient(server_url=TRUSTED_MCP_URL, token_cache_path=cache)
    client.check_auth()


def test_a_flat_token_cache_is_still_accepted(tmp_path: Path) -> None:
    cache = tmp_path / "token.json"
    cache.write_text(json.dumps({"access_token": FAKE_ACCESS_TOKEN}), encoding="utf-8")
    McpStatusClient(server_url=TRUSTED_MCP_URL, token_cache_path=cache).check_auth()


def test_a_missing_cache_names_the_path_it_looked_in(tmp_path: Path) -> None:
    missing = tmp_path / "absent" / "token.json"
    client = McpStatusClient(server_url=TRUSTED_MCP_URL, token_cache_path=missing)
    with pytest.raises(AuthUnavailableError, match="calle auth login"):
        client.check_auth()


def test_a_cache_without_a_usable_token_is_refused(tmp_path: Path) -> None:
    cache = tmp_path / "token.json"
    cache.write_text(json.dumps({"token": {"refresh_token": "only-this"}}), encoding="utf-8")
    client = McpStatusClient(server_url=TRUSTED_MCP_URL, token_cache_path=cache)
    with pytest.raises(AuthUnavailableError, match="no usable access token"):
        client.check_auth()


def test_an_expired_token_is_refused_before_a_request_is_made(tmp_path: Path) -> None:
    """An expired token would otherwise fail as an opaque transport error."""
    cache = write_token_cache(tmp_path / "token.json", expires_at="2020-01-01T00:00:00Z")
    client = McpStatusClient(server_url=TRUSTED_MCP_URL, token_cache_path=cache)
    with pytest.raises(AuthUnavailableError, match="expires in"):
        client.check_auth()


def test_a_cache_with_no_expiry_is_accepted(tmp_path: Path) -> None:
    """Matches token_document_usable in batch-runner: absent expiry is not fatal."""
    cache = write_token_cache(tmp_path / "token.json")
    McpStatusClient(server_url=TRUSTED_MCP_URL, token_cache_path=cache).check_auth()


def test_fetch_reads_get_call_run_over_real_http(fake_broker: dict, tmp_path: Path) -> None:
    """The tool name, the run_id argument, and the payload location, all executed."""
    cache = write_token_cache(tmp_path / "token.json")
    client = McpStatusClient(server_url=fake_broker["server_url"], token_cache_path=cache)

    payload = client.fetch("run_e2e_1")
    assert payload["run_id"] == "run_e2e_1"
    assert payload["status"] == "IN_PROGRESS"

    # The broker reports COMPLETED from the second call onward.
    assert client.fetch("run_e2e_1")["status"] == "COMPLETED"


def test_polling_the_mcp_surface_reaches_a_terminal_state(
    fake_broker: dict, tmp_path: Path, outcome_map: OutcomeMap
) -> None:
    cache = write_token_cache(tmp_path / "token.json")
    client = McpStatusClient(server_url=fake_broker["server_url"], token_cache_path=cache)

    result = poll(
        "run_e2e_2",
        client,
        outcome_map,
        PollingPolicy(max_wall_clock_seconds=30, max_observations=4, initial_backoff_seconds=0.01, max_backoff_seconds=0.05),
    )
    assert not result.exhausted, "polling should have stopped on a terminal value"
    assert [o.payload["status"] for o in result.observations] == ["IN_PROGRESS", "COMPLETED"]


def test_a_terminal_mcp_status_still_resolves_to_unresolved(
    fake_broker: dict, tmp_path: Path, outcome_map: OutcomeMap
) -> None:
    """Terminality is operational. This surface publishes no meaning, so the
    record says so — and the raw payload survives for whoever needs it."""
    cache = write_token_cache(tmp_path / "token.json")
    client = McpStatusClient(server_url=fake_broker["server_url"], token_cache_path=cache)

    result = poll(
        "run_e2e_3",
        client,
        outcome_map,
        PollingPolicy(max_wall_clock_seconds=30, max_observations=4, initial_backoff_seconds=0.01, max_backoff_seconds=0.05),
    )
    record = reconcile("run_e2e_3", result.observations, outcome_map, exhausted=result.exhausted)
    assert record.outcome == "unresolved"
    assert record.reason == "undocumented_code"
    assert record.to_dict()["raw"]["last_payload"]["status"] == "COMPLETED"


def test_no_token_value_appears_in_the_record(
    fake_broker: dict, tmp_path: Path, outcome_map: OutcomeMap
) -> None:
    cache = write_token_cache(tmp_path / "token.json")
    client = McpStatusClient(server_url=fake_broker["server_url"], token_cache_path=cache)
    result = poll(
        "run_e2e_4",
        client,
        outcome_map,
        PollingPolicy(max_wall_clock_seconds=30, max_observations=4, initial_backoff_seconds=0.01, max_backoff_seconds=0.05),
    )
    emitted = json.dumps(reconcile("run_e2e_4", result.observations, outcome_map).to_dict())
    assert FAKE_ACCESS_TOKEN not in emitted
    assert "Bearer" not in emitted


# -- the token must not follow an arbitrary --mcp-server-url ----------------


@pytest.mark.parametrize(
    "server_url",
    [
        "https://evil.example/mcp",
        f"https://{CALLE_MCP_HOST}.attacker.example/mcp",   # suffix, not the host
        f"http://{CALLE_MCP_HOST}/mcp",                     # plaintext downgrade
        f"https://user:pw@{CALLE_MCP_HOST}/mcp",            # embedded credentials
        "http://localhost",                                 # loopback needs a port
        "http://10.0.0.5:8080",                             # not loopback
        "not a url",
    ],
)
def test_the_cached_token_is_never_sent_to_an_untrusted_server(
    server_url: str, tmp_path: Path
) -> None:
    """The cache holds a bearer credential for the user's CALL-E account.

    Forwarding it to any host named on the command line turns a mistyped or
    hostile flag into account takeover, so construction fails before the cache
    is even opened.
    """
    cache = write_token_cache(tmp_path / "token.json")
    with pytest.raises(ConfigurationError, match="not a host this app trusts"):
        McpStatusClient(server_url=server_url, token_cache_path=cache)


def test_refusal_happens_before_the_token_cache_is_read(tmp_path: Path) -> None:
    """Positive control: the cache is valid, so only the URL check can be refusing."""
    cache = write_token_cache(tmp_path / "token.json")
    McpStatusClient(server_url=TRUSTED_MCP_URL, token_cache_path=cache).check_auth()

    missing = tmp_path / "absent" / "token.json"
    with pytest.raises(ConfigurationError):
        McpStatusClient(server_url="https://evil.example/mcp", token_cache_path=missing)
