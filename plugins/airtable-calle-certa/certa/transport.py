"""The seam between this workflow and CALL-E.

Everything above this module is exercised by `FixtureTransport`, which replays
recorded JSON. That is why the whole test suite runs with no credentials, no
network and no call placed -- the repository requires it, and it is also the
only honest way to test a component whose side effect is ringing a stranger's
phone.

`LiveTransport` is the only place a real request is made. It refuses to send a
credential anywhere except CALL-E's documented HTTPS origin, because a base URL
read from configuration is otherwise a way to exfiltrate an API key.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Protocol

from .types import redact
from .net import CredentialRoutingError, check_base_url, urlopen as net_urlopen

DEFAULT_BASE_URL = "https://api.heycall-e.com"

# A credential-bearing request may only go here. Use FixtureTransport for
# credential-free local testing instead of overriding a live client's origin.
ALLOWED_CREDENTIAL_ORIGINS = frozenset({"api.heycall-e.com"})

USER_AGENT = "certa/0.1 (+awesome-phone-call-agents)"


class TransportError(Exception):
    """A request could not be made, or came back in a shape we will not trust."""


class Transport(Protocol):
    """The four operations this workflow needs from CALL-E."""

    def create_call(self, payload: dict[str, Any], *, idempotency_key: str) -> dict[str, Any]: ...

    def get_call(self, call_id: str) -> dict[str, Any]: ...

    def list_events(self, call_id: str) -> dict[str, Any]: ...


def _origin(url: str) -> str:
    return urllib.parse.urlsplit(url).netloc.lower()


class LiveTransport:
    """Real calls. Constructing one does not place a call; `create_call` does."""

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30.0,
    ) -> None:
        if not api_key:
            raise TransportError("CALLE_API_KEY is required for live transport")
        try:
            check_base_url(base_url, ALLOWED_CREDENTIAL_ORIGINS, what="a CALL-E API key")
        except CredentialRoutingError as exc:
            raise TransportError(
                f"{exc} Point a fake server at FixtureTransport instead."
            ) from exc
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url=url, data=data, method=method)
        request.add_header("Authorization", f"Bearer {self.api_key}")
        request.add_header("Content-Type", "application/json")
        request.add_header("User-Agent", USER_AGENT)
        for key, value in (headers or {}).items():
            request.add_header(key, value)

        try:
            with net_urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
        except CredentialRoutingError as exc:
            raise TransportError(str(exc)) from exc
        except urllib.error.HTTPError as exc:
            detail = redact(exc.read().decode("utf-8", "replace")[:500])
            raise TransportError(f"CALL-E {method} {path} -> {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise TransportError(f"CALL-E {method} {path} unreachable: {exc.reason}") from exc

        if not raw:
            return {}
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise TransportError(f"CALL-E {method} {path} returned non-JSON") from exc

    def create_call(self, payload: dict[str, Any], *, idempotency_key: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/v1/calls",
            body=payload,
            headers={"Idempotency-Key": idempotency_key},
        )

    def get_call(self, call_id: str) -> dict[str, Any]:
        return self._request("GET", f"/v1/calls/{urllib.parse.quote(call_id)}")

    def list_events(self, call_id: str) -> dict[str, Any]:
        return self._request(
            "GET", f"/v1/calls/{urllib.parse.quote(call_id)}/events"
        )


class FixtureTransport:
    """Replays recorded CALL-E responses. Places no calls, ever.

    A fixture file is a JSON object:

        {
          "create": { ...POST /v1/calls response... },
          "poll":   [ { ...first GET... }, { ...second GET... } ],
          "events": { ...GET /v1/calls/{id}/events response... }
        }

    `poll` is consumed in order and the last entry repeats, so a scenario can
    show a call moving from in_progress to a terminal state.

    A fixture may instead key scenarios by request id, so one replay can show
    several different outcomes side by side:

        { "calls": { "VR-1041": { "create": ..., "poll": [...] }, ... } }

    The request id is read from the payload's `metadata.request_id`, which is
    the same correlation key a real deployment uses on the webhook.
    """

    def __init__(self, scenario: dict[str, Any]) -> None:
        self.scenario = scenario
        self.created: list[tuple[dict[str, Any], str]] = []
        self._poll_index = 0
        self._by_call: dict[str, dict[str, Any]] = {}
        self._poll_index_by_call: dict[str, int] = {}

    @classmethod
    def from_file(cls, path: str | Path) -> "FixtureTransport":
        text = Path(path).read_text(encoding="utf-8")
        return cls(json.loads(text))

    def _scenario_for(self, payload: dict[str, Any]) -> dict[str, Any]:
        keyed = self.scenario.get("calls")
        if not keyed:
            return self.scenario
        request_id = ((payload.get("metadata") or {}).get("request_id")) or ""
        if request_id not in keyed:
            raise TransportError(
                f"fixture has no scenario for request {request_id!r}; "
                f"known: {sorted(keyed)}"
            )
        return keyed[request_id]

    def create_call(self, payload: dict[str, Any], *, idempotency_key: str) -> dict[str, Any]:
        scenario = self._scenario_for(payload)
        created = dict(scenario.get("create", {}))
        # Replaying the same idempotency key returns the same result, as the
        # real API is required to, so tests can assert re-runs do not re-dial.
        for _seen_payload, seen_key in self.created:
            if seen_key == idempotency_key:
                return dict(created, replayed=True)
        self.created.append((payload, idempotency_key))
        call_id = str(created.get("id") or "")
        if call_id:
            self._by_call[call_id] = scenario
        return created

    def get_call(self, call_id: str) -> dict[str, Any]:
        scenario = self._by_call.get(call_id, self.scenario)
        polls = scenario.get("poll") or [scenario.get("create", {})]
        index = min(self._poll_index_by_call.get(call_id, 0), len(polls) - 1)
        self._poll_index_by_call[call_id] = index + 1
        self._poll_index += 1
        return polls[index]

    def list_events(self, call_id: str) -> dict[str, Any]:
        return self.scenario.get("events", {"object": "list", "data": []})
