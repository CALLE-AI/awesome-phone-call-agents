"""The real CALL-E adapter.

Uses the ``calle-ai`` SDK. Three properties matter and are enforced here:

* **The origin is allowlisted.** The base URL has already been validated at
  startup (:mod:`reachable.config`); this module re-asserts it before
  constructing a client, so no future refactor can route a bearer token
  elsewhere.
* **Non-blocking create plus our own poll.** ``create_and_wait`` holds state in a
  blocked thread, which cannot survive a process restart. Reachable records the
  call id first and polls, so a restart resumes by reading rather than dialling.
* **The key goes with the request.** Reusing it returns the original call
  instead of creating a duplicate.

The SDK is synchronous and 0.7.0 ships no async client, so every method here
blocks; callers on an event loop must use :func:`run_in_worker_thread`.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any, Mapping

from ..config import Config, validate_calle_origin
from ..phone import mask_display
from ..sanitize import clean_text
from .client import CallError, CallHandle, CallRequest, CallSubmissionUnknown

#: SDK exception names that mean the request may already have been accepted.
#: Matched by name so this module does not need the SDK importable to decide.
_AMBIGUOUS = frozenset(
    {
        "CalleTimeoutError",
        "CalleConnectionError",
        "TimeoutError",
        "ConnectionError",
        "ReadTimeout",
        "ConnectTimeout",
    }
)


class CalleClient:
    """Wraps ``calle.CalleClient``. Constructed only when a live call is allowed."""

    def __init__(self, config: Config) -> None:
        if not config.calle_api_key:
            raise CallError("CALLE_API_KEY is required to reach CALL-E")
        # Re-assert the allowlist at the point of use, not only at startup.
        self._base_url = validate_calle_origin(config.calle_base_url)
        self._config = config
        self._client: Any = None
        self._lock = threading.Lock()

    def _sdk(self) -> Any:
        with self._lock:
            if self._client is None:
                try:
                    from calle import CalleClient as SdkClient
                except ImportError as exc:  # pragma: no cover - needs the extra
                    raise CallError(
                        "the calle-ai SDK is not installed; run: uv sync --extra live"
                    ) from exc
                self._client = SdkClient(
                    api_key=self._config.calle_api_key,
                    base_url=self._base_url,
                    timeout=self._config.calle_timeout_seconds,
                )
            return self._client

    def _describe(self, exc: Exception) -> str:
        """The exception class plus its message, with the key removed.

        The class name on its own is not diagnosable: "CalleAPIError" tells an
        operator nothing about whether they are out of credit, sending a bad
        region, or hitting a concurrency cap. The message is what says which.

        It is sanitised and the bearer key is stripped out of it first, because
        a provider message may echo parts of the request, and this string is
        written to the event log and shown in the dashboard.
        """
        detail = str(exc)
        key = self._config.calle_api_key
        if key and len(key) >= 8:
            detail = detail.replace(key, "[redacted]")
        detail = clean_text(mask_display(detail), max_length=300)
        return f"{type(exc).__name__}: {detail}" if detail else type(exc).__name__

    def create(self, request: CallRequest) -> CallHandle:
        """Submit one call and return its id, without waiting for the outcome."""
        client = self._sdk()
        try:
            created = client.calls.create(
                task=request.task,
                result_schema=request.result_schema,
                metadata=dict(request.metadata),
                recipients=[
                    {
                        "phones": [request.destination],
                        "region": request.region,
                        "locale": request.locale,
                    }
                ],
                idempotency_key=request.idempotency_key,
            )
        except Exception as exc:  # noqa: BLE001 - classified, never re-raised raw
            if type(exc).__name__ in _AMBIGUOUS:
                raise CallSubmissionUnknown(self._describe(exc)) from exc
            raise CallError(self._describe(exc)) from exc

        if not isinstance(created, Mapping) or not isinstance(created.get("id"), str):
            # A malformed success is still an unknown submission: the call may
            # have been accepted even though we cannot name it.
            raise CallSubmissionUnknown("create returned no usable call id")
        return CallHandle(str(created["id"]), str(created.get("status", "queued")))

    def get(self, call_id: str) -> dict[str, Any]:
        """The authoritative read. Everything that moves a case comes from here."""
        client = self._sdk()
        try:
            snapshot = client.calls.get(call_id)
        except Exception as exc:  # noqa: BLE001
            raise CallError(self._describe(exc)) from exc
        if not isinstance(snapshot, Mapping):
            raise CallError("calls.get returned a non-object")
        return dict(snapshot)


async def run_in_worker_thread(fn, *args, **kwargs):
    """Run a blocking SDK call off the event loop.

    Required because ``calle-ai`` 0.7.0 has no async client; without this one
    in-flight call would stall every other dashboard request.
    """
    return await asyncio.to_thread(fn, *args, **kwargs)
