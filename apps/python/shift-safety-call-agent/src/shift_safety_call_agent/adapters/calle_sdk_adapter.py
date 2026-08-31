"""Injected CALL-E SDK adapter with execution limited to contract-test doubles."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol

from shift_safety_call_agent.adapters.calle_offline import (
    CalleResponseSnapshot,
    InvalidProviderResponseError,
    InvalidStructuredResultError,
    RealCallDisabledError,
    map_calle_response,
    parse_calle_response,
)
from shift_safety_call_agent.domain.models import CallPlan, SafetyInterviewResult

CONTRACT_TEST_RECIPIENT = "contract-test-recipient"
DEFAULT_INTERVAL_SECONDS = 2.0
DEFAULT_TIMEOUT_SECONDS = 600.0


class CalleCallsResource(Protocol):
    """Only the audited SDK 0.6.0 Calls surface used by this project."""

    def create_and_wait(
        self,
        *,
        task: str,
        recipient: dict[str, Any],
        result_schema: dict[str, Any],
        metadata: dict[str, Any],
        idempotency_key: str,
        interval_seconds: float,
        timeout_seconds: float,
    ) -> dict[str, Any]:
        """Create one test-double call task and return its terminal snapshot."""


class ContractTestExecutionPermit:
    """Capability whose instances are intentionally unavailable to production source."""

    __slots__ = ()

    def __new__(cls) -> ContractTestExecutionPermit:
        raise TypeError("Contract-test permits can only be supplied by test code")


class RealCallExecutionDisabledError(RealCallDisabledError):
    """Raised before a Calls resource can run without the test-only capability."""


class CalleSdkProviderError(RuntimeError):
    """Base class for redacted provider failures."""


class ProviderAuthenticationError(CalleSdkProviderError):
    """Authentication or authorization was rejected."""


class ProviderValidationError(CalleSdkProviderError):
    """The provider rejected the request contract."""


class ProviderRateLimitError(CalleSdkProviderError):
    """The provider rate-limited the request."""


class ProviderTimeoutError(CalleSdkProviderError):
    """The provider operation timed out."""


class ProviderTransportError(CalleSdkProviderError):
    """The provider could not be reached or returned no response."""


class ProviderServerError(CalleSdkProviderError):
    """The provider returned a server-side failure."""


class ProviderUnknownError(CalleSdkProviderError):
    """An unclassified SDK failure occurred."""


@dataclass(frozen=True, slots=True)
class CalleSdkRequest:
    """Audited keyword arguments for the injected Calls resource."""

    task: str
    recipient: dict[str, object]
    result_schema: dict[str, object]
    metadata: dict[str, object]
    idempotency_key: str
    interval_seconds: float
    timeout_seconds: float


def _thaw_json(value: object) -> object:
    if isinstance(value, Mapping):
        copied: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError("result schema keys must be strings")
            copied[key] = _thaw_json(item)
        return copied
    if isinstance(value, tuple):
        return [_thaw_json(item) for item in value]
    return value


def build_calle_sdk_request(
    plan: CallPlan,
    *,
    idempotency_key_generator: Callable[[CallPlan], str],
) -> CalleSdkRequest:
    """Build the non-routable request used only with a marked test double."""

    key = idempotency_key_generator(plan)
    if not isinstance(key, str) or not key.strip():
        raise ValueError("idempotency key generator must return a non-empty string")
    schema = _thaw_json(plan.result_schema)
    if not isinstance(schema, dict):
        raise TypeError("result schema must normalize to an object")
    return CalleSdkRequest(
        task=plan.task,
        recipient={"phones": [CONTRACT_TEST_RECIPIENT], "region": plan.region},
        result_schema=schema,
        metadata={"mode": "contract-test", "region": plan.region},
        idempotency_key=key,
        interval_seconds=DEFAULT_INTERVAL_SECONDS,
        timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
    )


_TOP_LEVEL_FIELDS = (
    "id",
    "status",
    "task_completed",
    "completion_confidence",
    "structured_result",
    "evidence",
    "summary",
    "recipients",
)
_RECIPIENT_FIELDS = ("id", "status", "structured_result", "summary")


def _selected_mapping(value: object, fields: tuple[str, ...]) -> dict[str, object]:
    if isinstance(value, Mapping):
        source = value
    else:
        selected = {
            field: getattr(value, field)
            for field in fields
            if hasattr(value, field)
        }
        if not selected:
            raise InvalidProviderResponseError("Provider response must be an object")
        source = selected
    return {field: source[field] for field in fields if field in source}


def _normalize_optional_mapping(value: object) -> object:
    if value is None:
        return value
    if isinstance(value, Mapping):
        return dict(value)
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        converted = to_dict()
        if isinstance(converted, Mapping):
            return dict(converted)
    raise InvalidProviderResponseError("Provider model did not produce an object")


def _normalize_structured_result(value: object) -> object:
    try:
        return _normalize_optional_mapping(value)
    except InvalidProviderResponseError:
        raise InvalidStructuredResultError("Structured result must be an object or null") from None


def normalize_calle_sdk_response(payload: object) -> CalleResponseSnapshot:
    """Select SDK fields for the internal structured response boundary."""

    selected = _selected_mapping(payload, _TOP_LEVEL_FIELDS)
    selected["evidence"] = [] if selected.get("evidence") is None else selected["evidence"]
    if "completion_confidence" in selected:
        selected["completion_confidence"] = _normalize_optional_mapping(
            selected["completion_confidence"]
        )
    if "structured_result" in selected:
        selected["structured_result"] = _normalize_structured_result(selected["structured_result"])
    recipients = selected.get("recipients")
    if recipients is not None:
        if not isinstance(recipients, (list, tuple)):
            raise InvalidProviderResponseError("Provider recipients have an invalid type")
        selected_recipients = []
        for recipient in recipients[:1]:
            selected_recipient = _selected_mapping(recipient, _RECIPIENT_FIELDS)
            if "structured_result" in selected_recipient:
                selected_recipient["structured_result"] = _normalize_structured_result(
                    selected_recipient["structured_result"]
                )
            selected_recipients.append(selected_recipient)
        selected["recipients"] = selected_recipients
    return parse_calle_response(selected)


_VALIDATION_CODES = frozenset(
    {
        "invalid_request",
        "no_recipients",
        "invalid_recipient",
        "invalid_phone",
        "result_schema_invalid",
        "recipient_result_schema_invalid",
        "idempotency_conflict",
        "unsupported_region",
        "unsupported_language",
        "recipient_blocked",
        "policy_violation",
    }
)


def map_calle_sdk_exception(error: Exception) -> CalleSdkProviderError:
    """Classify SDK failures without copying their message, payload, or details."""

    class_name = type(error).__name__
    status_code = getattr(error, "status_code", None)
    code = getattr(error, "code", None)
    if (
        class_name == "CalleAuthenticationError"
        or status_code == 401
        or status_code == 403
    ):
        return ProviderAuthenticationError("CALL-E authentication was rejected")
    if class_name == "CalleRateLimitError" or status_code == 429:
        return ProviderRateLimitError("CALL-E rate limit was reached")
    if class_name == "CalleTimeoutError":
        return ProviderTimeoutError("CALL-E operation timed out")
    if class_name == "CalleConnectionError":
        return ProviderTransportError("CALL-E transport failed")
    if class_name == "CalleAPIError":
        if status_code == 400 or status_code == 409 or status_code == 422 or (
            isinstance(code, str) and code in _VALIDATION_CODES
        ):
            return ProviderValidationError("CALL-E rejected the request contract")
        if isinstance(status_code, int) and status_code >= 500:
            return ProviderServerError("CALL-E reported a server failure")
    if isinstance(error, ValueError):
        return ProviderValidationError("CALL-E rejected the request contract")
    return ProviderUnknownError("CALL-E SDK operation failed")


class CalleSdkAdapter:
    """Invoke only a marked test double after an exact test-only permit check."""

    name = "calle-sdk-contract-test"

    def __init__(
        self,
        calls_resource: CalleCallsResource,
        *,
        idempotency_key_generator: Callable[[CallPlan], str],
    ) -> None:
        self._calls_resource = calls_resource
        self._idempotency_key_generator = idempotency_key_generator

    def execute(
        self,
        plan: CallPlan,
        *,
        permit: ContractTestExecutionPermit | None = None,
    ) -> SafetyInterviewResult:
        """Run one injected test-double contract and map its selected response."""

        if type(permit) is not ContractTestExecutionPermit:
            raise RealCallExecutionDisabledError(
                "CALL-E execution is disabled without a contract-test permit"
            )
        if getattr(self._calls_resource, "contract_test_only", False) is not True:
            raise RealCallExecutionDisabledError("Only a contract-test Calls double may be injected")

        request = build_calle_sdk_request(
            plan,
            idempotency_key_generator=self._idempotency_key_generator,
        )
        try:
            payload = self._calls_resource.create_and_wait(
                task=request.task,
                recipient=request.recipient,
                result_schema=request.result_schema,
                metadata=request.metadata,
                idempotency_key=request.idempotency_key,
                interval_seconds=request.interval_seconds,
                timeout_seconds=request.timeout_seconds,
            )
        except Exception as error:
            raise map_calle_sdk_exception(error) from None
        return map_calle_response(normalize_calle_sdk_response(payload))
