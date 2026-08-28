"""CALL-E adapter. The only module that imports the CALL-E SDK.

Live and simulated runs both come through here: the simulator swaps the httpx
client underneath `CalleClient`, so the SDK's request building, error mapping
and polling are exercised either way and there is no second code path to drift.
"""

from __future__ import annotations

from typing import Any

import httpx
from calle import CalleClient
from calle.errors import (
    CalleAPIError,
    CalleAuthenticationError,
    CalleConnectionError,
    CalleTimeoutError,
)

from kept.calls.port import CallPlacementError, CallRequest, PlacedCall
from kept.models import redact_phone_like

_PROBE_CALL_ID = "call_kept_credential_probe"


class CalleCallPort:
    def __init__(self, *, client: CalleClient, poll_interval_seconds: float = 5.0) -> None:
        self._client = client
        self._poll_interval_seconds = poll_interval_seconds

    @classmethod
    def live(cls, *, api_key: str, base_url: str) -> "CalleCallPort":
        return cls(client=CalleClient(api_key=api_key, base_url=base_url, timeout=60.0))

    @classmethod
    def with_transport(cls, *, transport: httpx.BaseTransport, base_url: str) -> "CalleCallPort":
        http_client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": "Bearer calle_simulated_key"},
            transport=transport,
            timeout=5.0,
        )
        return cls(
            client=CalleClient(api_key="calle_simulated_key", http_client=http_client),
            poll_interval_seconds=0.0,
        )

    def place(self, request: CallRequest) -> PlacedCall:
        return self.await_result(self.dispatch(request))

    def dispatch(self, request: CallRequest) -> str:
        try:
            call = self._client.calls.create(
                task=request.task,
                recipient={
                    "phones": [request.phone],
                    "region": request.region,
                    "locale": request.locale,
                },
                result_schema=request.result_schema,
                metadata=request.metadata,
                idempotency_key=request.idempotency_key,
            )
        except (CalleAPIError, CalleTimeoutError, CalleConnectionError) as exc:
            raise _placement_error(exc) from exc
        return str(call["id"])

    def await_result(self, call_id: str) -> PlacedCall:
        try:
            call = self._client.calls.wait_for_result(
                call_id,
                interval_seconds=self._poll_interval_seconds,
                timeout_seconds=900.0,
            )
        except (CalleAPIError, CalleTimeoutError, CalleConnectionError) as exc:
            raise _placement_error(exc) from exc
        return _to_placed_call(call)

    def check_credentials(self) -> str:
        """Confirm the key is accepted without placing a call.

        Reads a call id that cannot exist. A `not_found` answer means the key
        authenticated; only an auth failure is a credential problem. This is the
        cheapest way to tell a bad key from an empty balance before dialling.
        """
        try:
            self._client.calls.get(_PROBE_CALL_ID)
        except CalleAuthenticationError as exc:
            raise CallPlacementError(
                f"CALL-E rejected the API key: {redact_phone_like(str(exc))}", code=exc.code
            ) from exc
        except CalleAPIError as exc:
            if exc.code == "not_found":
                return "API key accepted."
            raise CallPlacementError(
                f"CALL-E returned {exc.code}: {redact_phone_like(str(exc))}", code=exc.code
            ) from exc
        except CalleConnectionError as exc:
            raise CallPlacementError(redact_phone_like(str(exc)), code="connection_error") from exc
        return "API key accepted."

    def close(self) -> None:
        self._client.close()


def _placement_error(exc: Exception) -> CallPlacementError:
    """Provider failure text is persisted to the ledger, so it is masked first."""
    if isinstance(exc, CalleAPIError):
        return CallPlacementError(redact_phone_like(str(exc)), code=exc.code)
    code = "timeout" if isinstance(exc, CalleTimeoutError) else "connection_error"
    return CallPlacementError(redact_phone_like(str(exc)) or f"CALL-E call {code}.", code=code)


def _to_placed_call(call: dict[str, Any]) -> PlacedCall:
    return PlacedCall(
        call_id=str(call.get("id", "")),
        status=str(call.get("status", "")),
        task_completed=call.get("task_completed"),
        confidence=_confidence(call),
        structured_result=call.get("structured_result"),
        summary=_optional_masked(call.get("summary")),
        failure_code=call.get("failure_code"),
        transcript=_transcript(call),
        task=str(call.get("task") or ""),
        metadata=_metadata(call),
        phones=_phones(call),
    )


def _optional_masked(value: Any) -> str | None:
    return None if value is None else redact_phone_like(str(value))


def _metadata(call: dict[str, Any]) -> dict[str, str]:
    block = call.get("metadata")
    if not isinstance(block, dict):
        return {}
    return {str(key): str(value) for key, value in block.items()}


def _phones(call: dict[str, Any]) -> tuple[str, ...]:
    """Every number CALL-E says it dialled, so a result can be bound to one."""
    return tuple(
        str(phone)
        for recipient in call.get("recipients") or []
        for phone in recipient.get("phones") or []
    )


def _confidence(call: dict[str, Any]) -> float:
    block = call.get("completion_confidence")
    if not isinstance(block, dict):
        return 0.0
    score = block.get("score")
    return float(score) if isinstance(score, (int, float)) else 0.0


def _transcript(call: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    turns: list[tuple[str, str]] = []
    for recipient in call.get("recipients") or []:
        for attempt in recipient.get("attempts") or []:
            for turn in attempt.get("transcript_turns") or []:
                text = redact_phone_like(str(turn.get("text", "")))
                turns.append((str(turn.get("speaker", "unknown")), text))
    return tuple(turns)
