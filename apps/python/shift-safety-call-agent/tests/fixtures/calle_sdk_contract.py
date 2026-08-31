"""Contract-only CALL-E Calls double with no routable recipient or network path."""

from __future__ import annotations

import hashlib
import importlib.util
import socket
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from typing import Iterator
from unittest.mock import patch

from shift_safety_call_agent.adapters.calle_sdk_adapter import ContractTestExecutionPermit
from tests.fixtures.calle_responses import (
    EMPTY_EVIDENCE_RESPONSE,
    EQUIPMENT_ISSUE_RESPONSE,
    INVALID_STRUCTURED_RESPONSE,
    MINOR_NEAR_MISS_RESPONSE,
    NO_INCIDENT_RESPONSE,
    NULL_STRUCTURED_RESPONSE,
    TASK_INCOMPLETE_RESPONSE,
    UNKNOWN_STATUS_RESPONSE,
)


def make_contract_test_permit() -> ContractTestExecutionPermit:
    """Create the capability from test code; production source exposes no factory."""

    return object.__new__(ContractTestExecutionPermit)


@contextmanager
def network_blocked() -> Iterator[None]:
    """Fail the test if socket or available httpx send surfaces are used."""

    def fail_network(*args: object, **kwargs: object) -> None:
        raise AssertionError("network attempted")

    patches = [
        patch.object(socket, "create_connection", side_effect=fail_network),
        patch.object(socket.socket, "connect", side_effect=fail_network),
    ]
    if importlib.util.find_spec("httpx") is not None:
        import httpx

        patches.extend(
            (
                patch.object(httpx.Client, "send", side_effect=fail_network),
                patch.object(httpx.AsyncClient, "send", side_effect=fail_network),
            )
        )
    with patches[0], patches[1]:
        if len(patches) == 2:
            yield
        else:
            with patches[2], patches[3]:
                yield


@dataclass(frozen=True, slots=True)
class CallsRecord:
    """Safe call record that never retains the full task."""

    task_present: bool
    task_digest: str
    recipient: dict[str, object]
    result_schema: dict[str, object]
    metadata: dict[str, object]
    idempotency_key: str
    interval_seconds: float
    timeout_seconds: float


class RecordingCalleCalls:
    """Exact explicit subset of SDK 0.6.0 used by the adapter."""

    contract_test_only = True

    def __init__(self, response: object = None, *, error: Exception | None = None) -> None:
        self._response = response
        self._error = error
        self.call_count = 0
        self.last_call: CallsRecord | None = None

    def create_and_wait(
        self,
        *,
        task: str,
        recipient: dict[str, object],
        result_schema: dict[str, object],
        metadata: dict[str, object],
        idempotency_key: str,
        interval_seconds: float,
        timeout_seconds: float,
    ) -> object:
        self.call_count += 1
        self.last_call = CallsRecord(
            task_present=bool(task),
            task_digest=hashlib.sha256(task.encode("utf-8")).hexdigest(),
            recipient=deepcopy(recipient),
            result_schema=deepcopy(result_schema),
            metadata=deepcopy(metadata),
            idempotency_key=idempotency_key,
            interval_seconds=interval_seconds,
            timeout_seconds=timeout_seconds,
        )
        if self._error is not None:
            raise self._error
        return deepcopy(self._response)


class CalleAuthenticationError(Exception):
    pass


class CalleRateLimitError(Exception):
    pass


class CalleTimeoutError(Exception):
    pass


class CalleConnectionError(Exception):
    pass


class CalleAPIError(Exception):
    def __init__(self, *, status_code: int, code: str) -> None:
        super().__init__("provider detail must not be exposed")
        self.status_code = status_code
        self.code = code


def contract_response_cases() -> dict[str, object]:
    """Return the ten required response shapes without sharing mutable values."""

    no_confidence = deepcopy(NO_INCIDENT_RESPONSE)
    no_confidence.pop("completion_confidence")
    no_evidence = deepcopy(NO_INCIDENT_RESPONSE)
    no_evidence.pop("evidence")
    return {
        "completed-no-incident": deepcopy(NO_INCIDENT_RESPONSE),
        "completed-near-miss": deepcopy(MINOR_NEAR_MISS_RESPONSE),
        "equipment-follow-up": deepcopy(EQUIPMENT_ISSUE_RESPONSE),
        "null-structured-result": deepcopy(NULL_STRUCTURED_RESPONSE),
        "task-incomplete": deepcopy(TASK_INCOMPLETE_RESPONSE),
        "no-confidence": no_confidence,
        "valid-confidence": deepcopy(NO_INCIDENT_RESPONSE),
        "no-evidence": no_evidence,
        "unknown-status": deepcopy(UNKNOWN_STATUS_RESPONSE),
        "invalid-structured-result": deepcopy(INVALID_STRUCTURED_RESPONSE),
    }


def contract_exception_cases() -> dict[str, Exception]:
    """Return the seven SDK failure categories with non-sensitive details only."""

    return {
        "authentication": CalleAuthenticationError(),
        "validation": CalleAPIError(status_code=422, code="invalid_request"),
        "rate-limit": CalleRateLimitError(),
        "timeout": CalleTimeoutError(),
        "transport": CalleConnectionError(),
        "server": CalleAPIError(status_code=503, code="internal_error"),
        "unknown": RuntimeError(),
    }
