"""Guarded, one-shot CALL-E runtime execution boundary."""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from importlib import import_module
from importlib.metadata import version as distribution_version
from types import ModuleType
from typing import Protocol

from shift_safety_call_agent.adapters.calle_offline import (
    CalleAdapterError,
    CalleResponseSnapshot,
    map_calle_response,
)
from shift_safety_call_agent.adapters.calle_sdk import (
    CALLE_IMPORT_NAME,
    CalleSdkInspectionError,
    inspect_calle_sdk,
)
from shift_safety_call_agent.adapters.calle_sdk_adapter import (
    DEFAULT_INTERVAL_SECONDS,
    DEFAULT_TIMEOUT_SECONDS,
    map_calle_sdk_exception,
    normalize_calle_sdk_response,
)
from shift_safety_call_agent.application.calle_planning import (
    ENGLISH_SAFETY_TASK_VERSION,
    SAFETY_RESULT_SCHEMA_VERSION,
)
from shift_safety_call_agent.application.review_triage import (
    derive_review_disposition,
)
from shift_safety_call_agent.domain.models import CallPlan, SafetyInterviewResult

CALLE_API_KEY_ENV = "CALLE_API_KEY"
CALLE_RECIPIENT_ENV = "CALLE_RECIPIENT_E164"
CALL_PROVIDER_ENV = "CALL_PROVIDER"
ALLOW_REAL_CALLS_ENV = "ALLOW_REAL_CALLS"
HUMAN_CONFIRMATION_ENV = "CALLE_HUMAN_CONFIRMATION"
EXACT_HUMAN_CONFIRMATION = "I CONFIRM THIS CALL IS TO MY OWN PHONE"
EXACT_EXECUTION_PERMIT = "PLACE ONE CALL NOW"

_E164_FORMAT = re.compile(r"^\+[1-9]\d{7,14}$")
_JAPANESE_SELF_CALL_FORMAT = re.compile(r"\+81[1-9][0-9]*")


class CalleRuntimeBoundaryError(RuntimeError):
    """Base error for a redacted production-runtime boundary failure."""


class CalleRuntimeConfigurationError(CalleRuntimeBoundaryError):
    """Required runtime configuration is absent or invalid."""


class CalleClientConstructionError(CalleRuntimeBoundaryError):
    """The approved SDK client could not be constructed safely."""


class LiveCallGateError(CalleRuntimeBoundaryError):
    """One or more mandatory live-call gates are closed."""


class LiveCallExecutionPermitError(CalleRuntimeBoundaryError):
    """The interactive, one-use execution phrase did not match exactly."""


class LiveCallResultError(CalleRuntimeBoundaryError):
    """The provider result could not be normalized without inference."""


class _ClientLike(Protocol):
    calls: object

    def close(self) -> None:
        """Close client-owned local resources."""


@dataclass(frozen=True, slots=True)
class CalleRuntimeResources:
    """A client and Calls resource whose representation reveals no credentials."""

    client: _ClientLike = field(repr=False)
    calls_resource: object = field(repr=False)

    def close(self) -> None:
        """Close the SDK client without rendering any internal state."""

        try:
            self.client.close()
        except Exception:
            raise CalleClientConstructionError("CALL-E client close failed") from None

    def __repr__(self) -> str:
        return "CalleRuntimeResources(client=<redacted>, calls_resource=<redacted>)"


class ProductionCalleClientFactory:
    """Construct the pinned SDK client only when explicitly called."""

    __slots__ = ("_environment", "_module_loader", "_version_reader")

    def __init__(
        self,
        *,
        environment: Mapping[str, str] | None = None,
        version_reader: Callable[[str], str] = distribution_version,
        module_loader: Callable[[str], ModuleType] = import_module,
    ) -> None:
        self._environment = os.environ if environment is None else environment
        self._version_reader = version_reader
        self._module_loader = module_loader

    def __repr__(self) -> str:
        return "ProductionCalleClientFactory(api_key=<runtime-only>)"

    def api_key_is_set(self) -> bool:
        """Check only whether the runtime environment contains the key name."""

        return CALLE_API_KEY_ENV in self._environment

    def sdk_is_ready(self) -> bool:
        """Check pinned package availability without constructing a client."""

        try:
            info = inspect_calle_sdk(
                version_reader=self._version_reader,
                module_loader=self._module_loader,
            )
        except CalleSdkInspectionError:
            return False
        return info.installed and info.client_class_available

    def create(self) -> CalleRuntimeResources:
        """Read the runtime key once and construct a client without making a request."""

        try:
            api_key = self._environment[CALLE_API_KEY_ENV]
        except KeyError:
            raise CalleRuntimeConfigurationError("CALLE_API_KEY is not set") from None
        if not isinstance(api_key, str) or not api_key.strip():
            raise CalleRuntimeConfigurationError("CALLE_API_KEY is not set")

        try:
            info = inspect_calle_sdk(
                version_reader=self._version_reader,
                module_loader=self._module_loader,
            )
            if not info.installed:
                raise CalleClientConstructionError("Approved CALL-E SDK is not installed")
            module = self._module_loader(CALLE_IMPORT_NAME)
            client_class = getattr(module, "CalleClient", None)
            if not isinstance(client_class, type):
                raise CalleClientConstructionError("Approved CALL-E client is unavailable")
            client = client_class(api_key=api_key)
            calls_resource = getattr(client, "calls", None)
            if calls_resource is None:
                client.close()
                raise CalleClientConstructionError("Approved CALL-E Calls resource is unavailable")
        except CalleClientConstructionError:
            raise
        except Exception:
            raise CalleClientConstructionError("CALL-E client construction failed") from None
        finally:
            api_key = ""
        return CalleRuntimeResources(client=client, calls_resource=calls_resource)


@dataclass(frozen=True, slots=True, repr=False)
class LiveCallConfiguration:
    """Single-recipient runtime gates; no batch, schedule, or retry fields exist."""

    provider: str
    live_call_enabled: bool
    recipient: str | None
    human_confirmation: str | None

    def __repr__(self) -> str:
        return (
            "LiveCallConfiguration("
            f"provider={_provider_state(self.provider)!r}, "
            f"live_call_enabled={self.live_call_enabled!r}, "
            f"recipient_set={self.recipient is not None}, "
            f"human_confirmation_matches={self.human_confirmation == EXACT_HUMAN_CONFIRMATION})"
        )


@dataclass(frozen=True, slots=True)
class LiveCallPreflight:
    """Non-sensitive readiness facts that never authorize a call."""

    provider: str
    api_key_set: bool
    recipient_set: bool
    recipient_format_valid: bool
    live_call_enabled: bool
    human_confirmation_matches: bool
    client_factory_ready: bool
    real_call_will_be_placed: bool = False


@dataclass(frozen=True, slots=True, repr=False)
class LiveCallOutcome:
    """Selected non-recipient provider facts and an optional safe domain result."""

    snapshot: CalleResponseSnapshot
    normalized_result: SafetyInterviewResult | None

    def __repr__(self) -> str:
        return (
            "LiveCallOutcome("
            f"status={self.snapshot.raw_status!r}, "
            f"task_completed={self.snapshot.task_completed!r}, "
            f"structured_result_normalized={self.normalized_result is not None}, "
            f"evidence_count={len(self.snapshot.evidence)})"
        )


def build_redacted_runtime_evidence(outcome: LiveCallOutcome) -> dict[str, object]:
    """Build safe regression facts without raw provider, recipient, or evidence data."""

    confidence = outcome.snapshot.completion_confidence
    return {
        "provider": "calle",
        "status": (
            outcome.snapshot.raw_status
            if outcome.snapshot.raw_status
            in {"queued", "in_progress", "completed", "failed", "canceled"}
            else "unknown"
        ),
        "task_completed": outcome.snapshot.task_completed,
        "structured_result_present": outcome.snapshot.structured_result is not None,
        "completion_confidence_present": confidence is not None,
        "evidence_count": len(outcome.snapshot.evidence),
        "summary_present": bool(outcome.snapshot.summary),
        "review_disposition": derive_review_disposition(
            task_completed=outcome.snapshot.task_completed is True,
            result=outcome.normalized_result,
        ).value,
        "task_version": ENGLISH_SAFETY_TASK_VERSION,
        "result_schema_version": SAFETY_RESULT_SCHEMA_VERSION,
        "transcript_persisted": False,
        "phone_persisted": False,
    }


def is_valid_e164_format(value: str | None) -> bool:
    """Validate E.164 syntax only; this does not establish ownership or routability."""

    return isinstance(value, str) and _E164_FORMAT.fullmatch(value) is not None


def is_valid_japanese_self_call_recipient(value: str | None) -> bool:
    """Require single +81 syntax without a trunk zero; not ownership or allocation."""

    return (
        isinstance(value, str)
        and is_valid_e164_format(value)
        and _JAPANESE_SELF_CALL_FORMAT.fullmatch(value) is not None
    )


def _provider_state(provider: str) -> str:
    if provider == "calle":
        return "live"
    if provider == "fake":
        return "fake"
    return "unsupported"


def live_configuration_from_environment(
    environment: Mapping[str, str],
) -> LiveCallConfiguration:
    """Read only live-gate inputs; the API-key value is deliberately untouched."""

    provider = environment.get(CALL_PROVIDER_ENV, "fake").strip().lower()
    enabled = environment.get(ALLOW_REAL_CALLS_ENV, "false").strip().lower() == "true"
    recipient = environment.get(CALLE_RECIPIENT_ENV)
    confirmation = environment.get(HUMAN_CONFIRMATION_ENV)
    return LiveCallConfiguration(
        provider=provider,
        live_call_enabled=enabled,
        recipient=recipient,
        human_confirmation=confirmation,
    )


def build_live_call_preflight(
    environment: Mapping[str, str] | None = None,
    *,
    factory: ProductionCalleClientFactory | None = None,
) -> LiveCallPreflight:
    """Evaluate readiness without constructing a client, sending a request, or calling."""

    runtime_environment = os.environ if environment is None else environment
    configuration = live_configuration_from_environment(runtime_environment)
    client_factory = factory or ProductionCalleClientFactory(environment=runtime_environment)
    key_set = client_factory.api_key_is_set()
    return LiveCallPreflight(
        provider=_provider_state(configuration.provider),
        api_key_set=key_set,
        recipient_set=configuration.recipient is not None,
        recipient_format_valid=is_valid_japanese_self_call_recipient(configuration.recipient),
        live_call_enabled=configuration.live_call_enabled,
        human_confirmation_matches=(
            configuration.human_confirmation == EXACT_HUMAN_CONFIRMATION
        ),
        client_factory_ready=key_set and client_factory.sdk_is_ready(),
    )


def require_live_call_gates(configuration: LiveCallConfiguration) -> None:
    """Require every single-recipient gate before local client construction."""

    if configuration.provider != "calle":
        raise LiveCallGateError("CALL-E is not the explicitly selected provider")
    if configuration.live_call_enabled is not True:
        raise LiveCallGateError("Live CALL-E execution is not explicitly enabled")
    if configuration.recipient is None:
        raise LiveCallGateError("A single recipient is required")
    if not is_valid_e164_format(configuration.recipient):
        raise LiveCallGateError("Recipient format is invalid")
    if not is_valid_japanese_self_call_recipient(configuration.recipient):
        raise LiveCallGateError("A Japanese +81 recipient without a domestic trunk zero is required")
    if configuration.human_confirmation != EXACT_HUMAN_CONFIRMATION:
        raise LiveCallGateError("Exact human confirmation is required")


def require_live_call_readiness(environment: Mapping[str, str]) -> None:
    """Check all non-secret readiness gates before requesting the final permit."""

    configuration = live_configuration_from_environment(environment)
    require_live_call_gates(configuration)
    factory = ProductionCalleClientFactory(environment=environment)
    if not factory.api_key_is_set():
        raise CalleRuntimeConfigurationError("CALLE_API_KEY is not set")
    if not factory.sdk_is_ready():
        raise CalleClientConstructionError("Approved CALL-E SDK is not ready")


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


def _safe_normalized_result(
    snapshot: CalleResponseSnapshot,
) -> SafetyInterviewResult | None:
    """Return a result only for a complete, evidence-backed structured response."""

    if (
        snapshot.raw_status != "completed"
        or snapshot.task_completed is not True
        or snapshot.structured_result is None
        or not snapshot.evidence
    ):
        return None
    try:
        return map_calle_response(snapshot)
    except CalleAdapterError:
        return None


class GuardedCalleLiveBoundary:
    """Execute at most one CALL-E create attempt after every explicit gate."""

    name = "calle"
    maximum_recipients = 1
    scheduled_calls_supported = False
    automatic_call_retries = 0

    __slots__ = ("_configuration", "_factory")

    def __init__(
        self,
        configuration: LiveCallConfiguration,
        factory: ProductionCalleClientFactory,
    ) -> None:
        self._configuration = configuration
        self._factory = factory

    def __repr__(self) -> str:
        return "GuardedCalleLiveBoundary(recipient=<redacted>, execution=one-shot)"

    def construct_runtime_resources(self) -> CalleRuntimeResources:
        """Build the local client/Calls boundary only after every gate passes."""

        require_live_call_gates(self._configuration)
        return self._factory.create()

    def execute_call(
        self,
        plan: CallPlan,
        *,
        execution_permit: str | None,
    ) -> LiveCallOutcome:
        """Run one create-and-wait operation with no retry, batch, or schedule path."""

        require_live_call_gates(self._configuration)
        if execution_permit != EXACT_EXECUTION_PERMIT:
            raise LiveCallExecutionPermitError("Exact one-call execution permit is required")

        schema = _thaw_json(plan.result_schema)
        if not isinstance(schema, dict):
            raise LiveCallResultError("Result schema did not normalize to an object")
        assert self._configuration.recipient is not None
        resources = self._factory.create()
        try:
            calls_resource = resources.calls_resource
            create_and_wait = getattr(calls_resource, "create_and_wait", None)
            if not callable(create_and_wait):
                raise CalleClientConstructionError(
                    "Approved CALL-E create-and-wait operation is unavailable"
                )
            try:
                payload = create_and_wait(
                    task=plan.task,
                    recipient={
                        "phones": [self._configuration.recipient],
                        "region": plan.region,
                    },
                    result_schema=schema,
                    metadata={
                        "task_version": ENGLISH_SAFETY_TASK_VERSION,
                        "result_schema_version": SAFETY_RESULT_SCHEMA_VERSION,
                    },
                    idempotency_key=plan.plan_id,
                    interval_seconds=DEFAULT_INTERVAL_SECONDS,
                    timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
                )
            except Exception as error:
                raise map_calle_sdk_exception(error) from None
            try:
                snapshot = normalize_calle_sdk_response(payload)
            except Exception:
                raise LiveCallResultError(
                    "CALL-E result could not be normalized safely"
                ) from None
            return LiveCallOutcome(
                snapshot=snapshot,
                normalized_result=_safe_normalized_result(snapshot),
            )
        finally:
            resources.close()


def execute_one_live_call(
    plan: CallPlan,
    execution_permit: str | None,
    environment: Mapping[str, str] | None = None,
    *,
    factory: ProductionCalleClientFactory | None = None,
) -> LiveCallOutcome:
    """Compose the production boundary without retaining the permit or environment."""

    runtime_environment = os.environ if environment is None else environment
    configuration = live_configuration_from_environment(runtime_environment)
    client_factory = factory or ProductionCalleClientFactory(environment=runtime_environment)
    return GuardedCalleLiveBoundary(configuration, client_factory).execute_call(
        plan,
        execution_permit=execution_permit,
    )
