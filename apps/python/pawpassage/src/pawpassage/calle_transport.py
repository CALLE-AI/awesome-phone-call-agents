from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import unquote, urlparse

OFFICIAL_BASE_URL = "https://api.heycall-e.com"
AMBIGUOUS_CODES = frozenset(
    {
        "idempotency_conflict",
        "internal_error",
        "provider_unavailable",
        "rate_limit_exceeded",
    }
)
DETERMINISTIC_REJECTION_CODES = frozenset(
    {
        "call_not_ready",
        "forbidden",
        "insufficient_balance",
        "invalid_phone",
        "invalid_recipient",
        "invalid_request",
        "no_recipients",
        "not_found",
        "policy_violation",
        "recipient_blocked",
        "recipient_result_schema_invalid",
        "result_schema_invalid",
        "unauthorized",
        "unsupported_language",
        "unsupported_region",
    }
)


class CallsPort(Protocol):
    def create(self, **kwargs: Any) -> dict[str, Any]: ...

    def wait_for_result(
        self, call_id: str, *, interval_seconds: float, timeout_seconds: float
    ) -> dict[str, Any]: ...

    def get(self, call_id: str) -> dict[str, Any]: ...


class ClientPort(Protocol):
    calls: CallsPort

    def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class DispatchBinding:
    task: str
    phone_e164: str
    region: str
    locale: str
    result_schema: dict[str, Any]
    metadata: dict[str, str]
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class SubmitOutcome:
    kind: str
    call_id: str | None = None
    reason_code: str | None = None
    provider_diagnostic: str | None = None


@dataclass(frozen=True, slots=True)
class TerminalOutcome:
    kind: str
    raw_result: dict[str, Any] | None = None
    reason_code: str | None = None


class OfficialCalleTransport:
    """One-submit CALL-E Python SDK adapter with an injectable fake-server seam."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = OFFICIAL_BASE_URL,
        live: bool,
        client_factory: Callable[[str, str], ClientPort] | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("An API key is required by the SDK transport")
        self.base_url = _validate_base_url(base_url, live=live)
        self.live = live
        self._client_factory = client_factory or _default_client_factory
        self._api_key = api_key

    def submit(self, binding: DispatchBinding) -> SubmitOutcome:
        client = self._client_factory(self._api_key, self.base_url)
        try:
            try:
                created = client.calls.create(
                    task=binding.task,
                    recipients=[
                        {
                            "phones": [binding.phone_e164],
                            "region": binding.region,
                            "locale": binding.locale,
                        }
                    ],
                    recipient_result_schema=binding.result_schema,
                    metadata=binding.metadata,
                    idempotency_key=binding.idempotency_key,
                )
            except Exception as error:  # noqa: BLE001 - classify every SDK/transport failure safely
                return _classify_create_error(
                    error, api_key=self._api_key, phone_e164=binding.phone_e164
                )
        finally:
            client.close()

        call_id = _call_id(created)
        if not call_id:
            return SubmitOutcome(
                "AMBIGUOUS", reason_code="CREATE_RESPONSE_MISSING_CALL_ID"
            )
        binding_problem = _verify_binding(created, binding, require_terminal=False)
        if binding_problem:
            return SubmitOutcome(
                "AMBIGUOUS", call_id=call_id, reason_code=binding_problem
            )
        return SubmitOutcome("ACCEPTED", call_id=call_id)

    def wait_for_terminal(
        self,
        call_id: str,
        binding: DispatchBinding,
        *,
        interval_seconds: float = 2.0,
        timeout_seconds: float = 600.0,
    ) -> TerminalOutcome:
        client = self._client_factory(self._api_key, self.base_url)
        try:
            try:
                terminal = client.calls.wait_for_result(
                    call_id,
                    interval_seconds=interval_seconds,
                    timeout_seconds=timeout_seconds,
                )
            except Exception as error:  # noqa: BLE001 - unknown read failures remain ambiguous
                return TerminalOutcome("PENDING", reason_code=_read_error_code(error))
        finally:
            client.close()
        return _map_terminal(terminal, call_id, binding)

    def reconcile(self, call_id: str, binding: DispatchBinding) -> TerminalOutcome:
        """Read an already known call once. This method never creates a call."""

        client = self._client_factory(self._api_key, self.base_url)
        try:
            try:
                call = client.calls.get(call_id)
            except Exception as error:  # noqa: BLE001 - unknown read failures remain ambiguous
                return TerminalOutcome("PENDING", reason_code=_read_error_code(error))
        finally:
            client.close()
        status = _text(call, "status")
        if status not in {"completed", "failed", "canceled"}:
            return TerminalOutcome("PENDING", reason_code="CALL_NOT_TERMINAL")
        return _map_terminal(call, call_id, binding)


def _default_client_factory(api_key: str, base_url: str) -> ClientPort:
    from calle import CalleClient

    return CalleClient(api_key=api_key, base_url=base_url)  # type: ignore[return-value]


def _validate_base_url(base_url: str, *, live: bool) -> str:
    normalized = base_url.rstrip("/")
    if live:
        if normalized != OFFICIAL_BASE_URL:
            raise ValueError(f"Live CALL-E base URL must be {OFFICIAL_BASE_URL}")
        return normalized
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {
        "127.0.0.1",
        "localhost",
        "::1",
    }:
        raise ValueError("Fake mode may connect only to a loopback fake server")
    if parsed.username or parsed.password:
        raise ValueError("Fake-server URL may not contain credentials")
    return normalized


def _classify_create_error(
    error: Exception, *, api_key: str, phone_e164: str
) -> SubmitOutcome:
    code = getattr(error, "code", None)
    normalized_code = _normalize_code(code) if isinstance(code, str) else None
    status = getattr(error, "status_code", getattr(error, "status", None))
    status = status if isinstance(status, int) else None
    if (
        normalized_code in AMBIGUOUS_CODES
        or status in {408, 409, 429}
        or (status is not None and status >= 500)
    ):
        suffix = (normalized_code or f"HTTP_{status}").upper()
        return SubmitOutcome("AMBIGUOUS", reason_code=f"CREATE_{suffix}")
    if normalized_code in DETERMINISTIC_REJECTION_CODES:
        return SubmitOutcome(
            "REJECTED",
            reason_code=f"CREATE_{normalized_code.upper()}",
            provider_diagnostic=_safe_provider_diagnostic(error, api_key, phone_e164),
        )
    if status is not None and 400 <= status < 500:
        return SubmitOutcome(
            "REJECTED",
            reason_code=f"CREATE_HTTP_{status}",
            provider_diagnostic=_safe_provider_diagnostic(error, api_key, phone_e164),
        )
    return SubmitOutcome(
        "AMBIGUOUS", reason_code=f"CREATE_{type(error).__name__.upper()}"
    )


def _safe_provider_diagnostic(
    error: Exception, api_key: str, phone_e164: str
) -> str | None:
    """Retain a bounded SDK message, never its request, headers or details."""

    message = error.args[0] if error.args else None
    if not isinstance(message, str) or not message.strip():
        return None
    # Do not slice unredacted text: a boundary could expose part of a secret.
    if len(message) > 8192:
        return "Provider diagnostic omitted because its message exceeded the size limit."
    message = unicodedata.normalize("NFKC", unquote(message))
    for secret in (api_key, phone_e164):
        message = message.replace(
            unicodedata.normalize("NFKC", unquote(secret)), "[redacted]"
        )
    message = re.sub(
        r"(?i)\b(?:bearer\s+|(?:api[_ -]?key|authorization|access[_ -]?token)\s*[:=]\s*)"
        r"[\"']?[^\s\"',;]+",
        "[credential redacted]",
        message,
    )
    # Also catch formatted and local phone numbers that differ from E.164.
    message = re.sub(r"\+?\d(?:[\s().-]*\d){6,}", "[phone redacted]", message)
    message = " ".join(
        "".join(
            character if character.isprintable() else " " for character in message
        ).split()
    )
    if len(message) > 800:
        suffix = " [truncated]"
        message = message[: 800 - len(suffix)] + suffix
    return message or None


def _map_terminal(
    call: dict[str, Any], call_id: str, binding: DispatchBinding
) -> TerminalOutcome:
    if _call_id(call) != call_id:
        return TerminalOutcome("AMBIGUOUS", reason_code="TERMINAL_CALL_ID_MISMATCH")
    binding_problem = _verify_binding(call, binding, require_terminal=True)
    if binding_problem:
        return TerminalOutcome("AMBIGUOUS", reason_code=binding_problem)
    status = _text(call, "status")
    if status != "completed":
        # The public Calls contract does not enumerate failure-code semantics.
        return TerminalOutcome(
            "AMBIGUOUS", reason_code="FAILED_STATUS_REQUIRES_RECONCILIATION"
        )
    if _field(call, "task_completed", "taskCompleted") is not True:
        return TerminalOutcome("AMBIGUOUS", reason_code="TASK_NOT_CONFIRMED_COMPLETE")
    recipients = call.get("recipients")
    recipient = (
        recipients[0] if isinstance(recipients, list) and len(recipients) == 1 else None
    )
    if not isinstance(recipient, dict):
        return TerminalOutcome("AMBIGUOUS", reason_code="TERMINAL_RECIPIENT_MISSING")
    if _text(recipient, "status") != "completed":
        return TerminalOutcome(
            "AMBIGUOUS", reason_code="RECIPIENT_NOT_CONFIRMED_COMPLETE"
        )
    raw_result = _field(recipient, "structured_result", "structuredResult")
    if not isinstance(raw_result, dict):
        return TerminalOutcome("AMBIGUOUS", reason_code="STRUCTURED_RESULT_MISSING")
    if _field(call, "failure_code", "failureCode") not in {None, ""}:
        return TerminalOutcome("AMBIGUOUS", reason_code="COMPLETED_WITH_FAILURE_CODE")
    return TerminalOutcome("COMPLETED", raw_result=raw_result)


def _verify_binding(
    call: dict[str, Any], binding: DispatchBinding, *, require_terminal: bool
) -> str | None:
    if call.get("task") != binding.task:
        return "TASK_BINDING_MISMATCH"
    metadata = call.get("metadata")
    if not isinstance(metadata, dict) or any(
        metadata.get(key) != value for key, value in binding.metadata.items()
    ):
        return "METADATA_BINDING_MISMATCH"
    recipients = call.get("recipients")
    if (
        not isinstance(recipients, list)
        or len(recipients) != 1
        or not isinstance(recipients[0], dict)
    ):
        return "RECIPIENT_COUNT_MISMATCH"
    recipient = recipients[0]
    phones = recipient.get("phones")
    if phones != [binding.phone_e164]:
        return "RECIPIENT_PHONE_MISMATCH"
    if recipient.get("region") not in {None, binding.region} or recipient.get(
        "locale"
    ) not in {None, binding.locale}:
        return "RECIPIENT_LOCALE_MISMATCH"
    attempts = recipient.get("attempts", [])
    if not isinstance(attempts, list) or len(attempts) > 1:
        return "ATTEMPT_COUNT_MISMATCH"
    for attempt in attempts:
        if not isinstance(attempt, dict) or attempt.get("phone") != binding.phone_e164:
            return "ATTEMPT_RECIPIENT_MISMATCH"
    if require_terminal and len(attempts) != 1:
        return "TERMINAL_ATTEMPT_MISSING"
    return None


def _call_id(call: dict[str, Any]) -> str | None:
    value = _field(call, "id", "call_id", "callId")
    return value if isinstance(value, str) and value else None


def _field(value: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in value:
            return value[name]
    return None


def _text(value: dict[str, Any], *names: str) -> str | None:
    raw = _field(value, *names)
    return raw.lower() if isinstance(raw, str) else None


def _normalize_code(value: str) -> str:
    return value.strip().lower().replace("-", "_").replace(" ", "_")


def _read_error_code(error: Exception) -> str:
    status = getattr(error, "status_code", getattr(error, "status", None))
    if isinstance(status, int):
        return f"READ_HTTP_{status}"
    return f"READ_{type(error).__name__.upper()}"
