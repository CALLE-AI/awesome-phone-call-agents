"""Small, defensive CALL-E SDK boundary used by QuoteWake.

The provider owns call state.  QuoteWake records only a terminal, schema-valid
business result, or a bounded ``unknown`` result after CALL-E has accepted a
call.  An indeterminate create without a call ID is never treated as an
accepted attempt: the same idempotency key must be used to reconcile it before
another attempt.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
import hashlib
import json
import logging
import re
import time
from dataclasses import replace
from typing import Any

from quotewake_salesforce.config import validate_calle_base_url
from quotewake_salesforce.domain.call_request import canonicalize_call_locale
from quotewake_salesforce.domain.models import (
    CALL_INTEREST_VALUES,
    CALL_INTEREST_VOCABULARY,
    CALL_OUTCOME_VALUES,
    CALL_OUTCOME_VOCABULARY,
    CallOutcomeKind,
    CallRequest,
    CallResult,
)
from quotewake_salesforce.structured_logging import log_event, logger


FAILURE_CLASSIFICATIONS = frozenset(
    {
        "auth",
        "balance",
        "rate",
        "schema",
        "recipient",
        "policy",
        "timeout",
        "connection",
        "idempotency",
        "provider",
    }
)

_TOKEN = re.compile(r"[^a-z0-9]+")
_CODE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")
_IDEMPOTENCY_SUFFIX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")
_PROVIDER_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_PHONE_LIKE = re.compile(r"(?<!\w)\+?[1-9]\d{7,14}(?!\w)")
_POLICY_CODES = frozenset({"policy_violation", "recipient_blocked"})
_RECIPIENT_CODES = frozenset(
    {"invalid_recipient", "invalid_phone", "no_recipients", "unsupported_region", "unsupported_language"}
)
_SCHEMA_CODES = frozenset(
    {"result_schema_invalid", "recipient_result_schema_invalid", "schema_override_not_allowed", "variables_invalid"}
)
_AUTH_CODES = frozenset({"unauthorized", "forbidden"})
_BALANCE_CODES = frozenset({"insufficient_balance"})
_RATE_CODES = frozenset({"rate_limit_exceeded"})
_IDEMPOTENCY_CODES = frozenset({"idempotency_conflict"})
_PROVIDER_CODES = frozenset({"provider_unavailable", "internal_error", "call_not_ready"})
_PROVIDER_REASONS = {
    "provider_unavailable": "provider_unavailable",
    "internal_error": "provider_internal_error",
    "call_not_ready": "call_not_ready",
}


class CallEError(RuntimeError):
    """A safe, actionable error at the CALL-E boundary.

    Provider exceptions are left intact for compatibility with the SDK, but
    receive these attributes before they are re-raised or converted into an
    accepted-call ``unknown`` result.  This lets the CLI report an actionable
    diagnosis without serialising provider text (which can contain credentials,
    phone numbers, or request bodies).
    """

    def __init__(
        self,
        message: str,
        *,
        classification: str = "provider",
        http_status: int | None = None,
        code: str = "provider_error",
        reason: str | None = None,
        creation_unknown: bool = False,
        idempotency_key: str | None = None,
        result_unknown: bool = False,
        provider_call_id: str | None = None,
        phase: str | None = None,
    ) -> None:
        super().__init__(message)
        self.classification = _classification(classification)
        self.http_status = _http_status(http_status)
        self.code = normalize_error_code(code)
        # Do not derive a CLI/log reason from arbitrary exception prose.  Call
        # sites that need a useful diagnosis pass one of the bounded reason
        # values explicitly.
        self.reason = normalize_reason(reason) if reason is not None else "provider_error"
        self.creation_unknown = bool(creation_unknown)
        self.idempotency_key = idempotency_key
        self.result_unknown = bool(result_unknown)
        self.provider_call_id = _provider_call_id(provider_call_id)
        self.phase = _phase(phase)


def normalize_reason(value: object) -> str:
    """Convert untrusted provider wording to a bounded snake-case reason."""

    text = " ".join(str(value).strip().lower().split())
    text = _TOKEN.sub("_", text).strip("_")
    return text[:96] or "provider_error"


def normalize_error_code(value: object) -> str:
    """Keep only a short provider code, never an arbitrary error message."""

    text = normalize_reason(value)
    return text if _CODE.fullmatch(text) else "provider_error"


def _classification(value: object) -> str:
    normalized = normalize_reason(value)
    return normalized if normalized in FAILURE_CLASSIFICATIONS else "provider"


def _http_status(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or not 100 <= value <= 599:
        return None
    return value


def _provider_call_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if _PROVIDER_ID.fullmatch(value) else None


def _phase(value: object) -> str | None:
    return value if isinstance(value, str) and value in {"create", "wait", "parse"} else None


def _set_failure_attributes(
    error: BaseException,
    *,
    classification: str,
    http_status: int | None = None,
    code: str = "provider_error",
    reason: str = "provider_error",
    creation_unknown: bool = False,
    idempotency_key: str | None = None,
    result_unknown: bool = False,
    provider_call_id: str | None = None,
    phase: str | None = None,
) -> None:
    """Attach bounded diagnostics to a provider exception before re-raising."""

    values = {
        "classification": _classification(classification),
        "http_status": _http_status(http_status),
        "code": normalize_error_code(code),
        "reason": normalize_reason(reason),
        "creation_unknown": bool(creation_unknown),
        "idempotency_key": idempotency_key,
        "result_unknown": bool(result_unknown),
        "provider_call_id": _provider_call_id(provider_call_id),
        "phase": _phase(phase),
    }
    for name, value in values.items():
        try:
            setattr(error, name, value)
        except Exception:  # pragma: no cover - a few extension exceptions disallow attrs
            pass


def failure_details(error: BaseException) -> dict[str, object | None]:
    """Return bounded diagnostics suitable for logs and CLI output."""

    if not hasattr(error, "classification"):
        inferred = _classify_provider_error(error)
        classification = inferred["classification"]
        status = inferred["http_status"]
        code = inferred["code"]
        reason = inferred["reason"]
    else:
        classification = getattr(error, "classification", "provider")
        status = getattr(error, "http_status", getattr(error, "status_code", None))
        code = getattr(error, "code", "provider_error")
        reason = getattr(error, "reason", _failure_reason(error))

    return {
        "classification": _classification(classification),
        "http_status": _http_status(status),
        "code": normalize_error_code(code),
        "reason": normalize_reason(reason),
        "creation_unknown": bool(getattr(error, "creation_unknown", False)),
        "idempotency_key": getattr(error, "idempotency_key", None),
        "result_unknown": bool(getattr(error, "result_unknown", False)),
        "provider_call_id": _provider_call_id(getattr(error, "provider_call_id", None)),
        "phase": _phase(getattr(error, "phase", None)),
    }


def result_schema() -> dict[str, Any]:
    """Return the strict, non-union schema sent to CALL-E.

    ``preferred_date`` is optional by omission.  A provider result containing a
    JSON null is rejected by the parser because this schema deliberately does
    not use a string/null union.
    """

    return {
        "type": "object",
        "required": ["outcome", "interest_level", "summary", "next_action"],
        "properties": {
            "outcome": {
                "type": "string",
                "enum": list(CALL_OUTCOME_VALUES),
                "description": (
                    "The explicit commercial disposition: interested, call_back_later, "
                    "not_interested, stop_quote_follow_up, unknown, no_answer, or busy."
                ),
            },
            "interest_level": {
                "type": "string",
                "enum": list(CALL_INTEREST_VALUES),
                "description": "The contact's stated interest level: high, medium, low, or unknown.",
            },
            "preferred_date": {
                "type": "string",
                "description": "Optional future callback or work date in YYYY-MM-DD format; omit when none was agreed.",
            },
            "summary": {
                "type": "string",
                "description": "A concise factual summary of what the recipient said and what was agreed.",
            },
            "next_action": {
                "type": "string",
                "description": "The next operational action QuoteWake or a salesperson should take.",
            },
        },
        "additionalProperties": False,
    }


def validate_idempotency_suffix(value: object) -> str | None:
    """Validate the optional test/support suffix used to avoid key reuse.

    The suffix is deliberately limited to ASCII characters that are safe in a
    provider identifier.  ``None`` is the production/default behavior and is
    kept distinct from an invalid empty suffix.
    """

    if value is None:
        return None
    if not isinstance(value, str) or not _IDEMPOTENCY_SUFFIX.fullmatch(value):
        raise ValueError(
            "idempotency suffix must start with an ASCII letter or digit and "
            "contain only ASCII letters, digits, '.', '_' or '-' (maximum 32 characters)"
        )
    return value


def idempotency_key(
    quote_id: str,
    next_attempt: int,
    retry_marker: datetime | None = None,
    suffix: str | None = None,
    binding_digest: str | None = None,
) -> str:
    if isinstance(next_attempt, bool) or not isinstance(next_attempt, int) or next_attempt < 1:
        raise ValueError("next attempt must be positive")
    suffix = validate_idempotency_suffix(suffix)
    key = f"quotewake-{quote_id}-{next_attempt}"
    if retry_marker is not None:
        if retry_marker.tzinfo is None or retry_marker.utcoffset() is None:
            raise ValueError("retry marker must be timezone-aware")
        marker = retry_marker.astimezone(timezone.utc).isoformat()
        key += "-" + hashlib.sha256(marker.encode("utf-8")).hexdigest()[:12]
    if suffix is not None:
        key += "-" + suffix
    if binding_digest is not None:
        if not isinstance(binding_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", binding_digest):
            raise ValueError("binding digest must be a lowercase SHA-256 hex digest")
        key += "-b" + binding_digest[:32]
    return key


def _canonical_json(value: object) -> str:
    """Serialize provider-bound values deterministically for fingerprinting."""

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def request_metadata(request: CallRequest) -> dict[str, str]:
    """Return the QuoteWake metadata sent with every live CALL-E request."""

    return {
        "quotewake_quote_id": request.quote_id,
        "quotewake_opportunity_id": request.opportunity_id,
        "quotewake_contact_id": request.contact_id,
    }


def operation_binding_digest(
    request: CallRequest,
    *,
    next_attempt: int,
    retry_marker: datetime | None = None,
    suffix: str | None = None,
    metadata: dict[str, str] | None = None,
    schema: dict[str, Any] | None = None,
) -> str:
    """Fingerprint every value that can change the outbound CALL-E operation."""

    if isinstance(next_attempt, bool) or not isinstance(next_attempt, int) or next_attempt < 1:
        raise ValueError("next attempt must be positive")
    locale = canonicalize_call_locale(request.locale)
    suffix = validate_idempotency_suffix(suffix)
    if retry_marker is not None:
        if retry_marker.tzinfo is None or retry_marker.utcoffset() is None:
            raise ValueError("retry marker must be timezone-aware")
        retry_value = retry_marker.astimezone(timezone.utc).isoformat()
    else:
        retry_value = None
    operation = {
        "version": 1,
        "quote_id": request.quote_id,
        "opportunity_id": request.opportunity_id,
        "contact_id": request.contact_id,
        "phone": request.phone,
        "task": request.goal,
        "locale": locale,
        "region": request.region,
        "result_schema": result_schema() if schema is None else schema,
        "metadata": metadata if metadata is not None else request_metadata(request),
        "next_attempt": next_attempt,
        "retry_marker": retry_value,
        "idempotency_suffix": suffix,
    }
    return hashlib.sha256(_canonical_json(operation).encode("utf-8")).hexdigest()


def _bound_operation(
    request: CallRequest,
    *,
    next_attempt: int,
    retry_marker: datetime | None,
    suffix: str | None,
) -> tuple[str, dict[str, str]]:
    metadata = request_metadata(request)
    digest = operation_binding_digest(
        request,
        next_attempt=next_attempt,
        retry_marker=retry_marker,
        suffix=suffix,
        metadata=metadata,
    )
    return digest, {**metadata, "quotewake_binding_digest": digest}


def _verify_provider_binding(
    request: CallRequest,
    call_id: str,
    payload: dict[str, Any],
    *,
    provider_key: str,
    metadata: dict[str, str],
) -> None:
    """Reject a terminal result unless CALL-E echoes the initiated operation."""

    returned_call_id = _extract_call_id(payload)
    returned_metadata = payload.get("metadata")
    returned_task = payload.get("task")
    returned_key = payload.get("idempotency_key", payload.get("idempotencyKey"))
    recipient = _first_recipient(payload)
    returned_phones = recipient.get("phones") if recipient else None
    if returned_phones is None and recipient and recipient.get("phone") is not None:
        returned_phones = [recipient["phone"]]
    returned_locale = recipient.get("locale") if recipient else None
    returned_region = recipient.get("region") if recipient else None
    returned_schema = payload.get("result_schema")
    # The CALL-E create response is the authoritative binding for the
    # idempotency key and request metadata. The later GET result may omit
    # those request fields, so missing optional echoes are valid; an echo that
    # is present must still match exactly.
    checks = (
        (returned_call_id, call_id, "call ID", False),
        (returned_metadata, metadata, "metadata", True),
        (returned_task, request.goal, "task", True),
        (returned_phones, [request.phone], "recipient phone", True),
        (returned_locale, canonicalize_call_locale(request.locale), "recipient locale", True),
        (returned_region, request.region, "recipient region", True),
        (returned_schema, result_schema(), "result schema", True),
        (returned_key, provider_key, "provider key", True),
    )
    for returned, expected, field, optional in checks:
        if (returned is None and not optional) or (returned is not None and returned != expected):
            raise CallEError(
                f"CALL-E result binding does not match {field}",
                classification="schema",
                code="result_binding_mismatch",
                reason="result_binding_mismatch",
            )


SUCCESS_STATUSES = frozenset({"completed", "succeeded", "success"})
TECHNICAL_STATUSES = frozenset(
    {"failed", "rejected", "declined", "canceled", "cancelled"}
)
TERMINAL_STATUSES = SUCCESS_STATUSES | TECHNICAL_STATUSES


def _required_text(value: Any, field: str, maximum: int = 1000) -> str:
    if not isinstance(value, str):
        raise CallEError(
            f"CALL-E structured_result.{field} must be a non-empty string",
            classification="schema",
            code=f"invalid_{field}",
            reason=f"invalid_{field}",
        )
    # Keep paragraph/line boundaries from CALL-E so they remain readable in
    # Salesforce Task.Description.  Collapse only whitespace within each line
    # and normalize CRLF/CR to the Salesforce-friendly LF representation.
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    cleaned = "\n".join(" ".join(line.split()) for line in normalized.split("\n")).strip()
    if not cleaned:
        raise CallEError(
            f"CALL-E structured_result.{field} must be a non-empty string",
            classification="schema",
            code=f"invalid_{field}",
            reason=f"invalid_{field}",
        )
    return cleaned[:maximum]


_MISSING = object()


def _parse_date(value: Any) -> date | None:
    if value is _MISSING:
        return None
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        raise CallEError(
            "CALL-E structured_result.preferred_date must be an ISO date when present",
            classification="schema",
            code="invalid_preferred_date",
            reason="invalid_preferred_date",
        )
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise CallEError(
            "CALL-E structured_result.preferred_date must be an ISO date when present",
            classification="schema",
            code="invalid_preferred_date",
            reason="invalid_preferred_date",
        ) from None


def _required_outcome(value: Any) -> str:
    """Validate an outcome without accepting provider-specific aliases."""

    if not isinstance(value, str) or value not in CALL_OUTCOME_VOCABULARY:
        raise CallEError(
            "CALL-E structured_result.outcome is unsupported",
            classification="schema",
            code="invalid_outcome",
            reason="invalid_outcome",
        )
    return value


def _failure_reason(error: BaseException) -> str:
    """Map provider failures to a small, non-sensitive operational vocabulary."""

    if isinstance(error, TimeoutError) or type(error).__name__ in {
        "TimeoutException",
        "ReadTimeout",
        "ConnectTimeout",
        "CalleTimeoutError",
    }:
        return "timeout"
    if type(error).__name__ in {"CalleConnectionError", "ConnectError", "NetworkError"}:
        return "connection"
    if isinstance(error, CallEError):
        return error.reason
    message = str(error).lower()
    if "idempot" in message:
        return "idempotency_error"
    if "balance" in message or "insufficient" in message:
        return "insufficient_balance"
    if "recipient" in message or "phone" in message:
        return "invalid_recipient"
    return "provider_error"


def _classify_provider_error(error: BaseException) -> dict[str, object | None]:
    """Classify SDK errors without exposing their untrusted message."""

    name = type(error).__name__.lower()
    status = _http_status(getattr(error, "status_code", None))
    raw_code = getattr(error, "code", None)
    code = normalize_error_code(raw_code or "provider_error")
    if "timeout" in name or isinstance(error, TimeoutError):
        classification, reason = "timeout", "timeout"
    elif "connection" in name or "connect" in name or "network" in name:
        classification, reason = "connection", "connection_error"
    elif code in _POLICY_CODES:
        classification, reason = "policy", "policy_rejected"
    elif status in {401, 403} or name == "calleauthenticationerror" or code in _AUTH_CODES:
        classification, reason = "auth", "authentication_failed"
    elif status == 402 or code in _BALANCE_CODES:
        classification, reason = "balance", "insufficient_balance"
    elif status == 429 or code in _RATE_CODES:
        classification, reason = "rate", "rate_limited"
    elif code in _PROVIDER_CODES:
        classification, reason = "provider", _PROVIDER_REASONS[code]
    elif status == 409 or code in _IDEMPOTENCY_CODES:
        classification, reason = "idempotency", "idempotency_conflict"
    elif code in _SCHEMA_CODES:
        classification, reason = "schema", "schema_rejected"
    elif code in _RECIPIENT_CODES:
        classification, reason = "recipient", "recipient_rejected"
    else:
        classification, reason = "provider", "provider_error"
    return {
        "classification": classification,
        "http_status": status,
        "code": code,
        "reason": reason,
    }


def _provider_operation_unknown(details: dict[str, object | None]) -> bool:
    """Return whether a create/wait failure may have left provider state unknown.

    API 4xx responses are deterministic rejections: they did not create a new
    call and should not trigger same-key reconciliation guidance.  Transport
    failures, provider errors without an HTTP response, and HTTP 5xx errors
    remain ambiguous and require reconciliation before replay.
    """

    status = details.get("http_status")
    if isinstance(status, int):
        return status >= 500
    return details.get("classification") in {"timeout", "connection", "provider"}


def _extract_call_id(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    candidates = [
        payload.get("id"),
        payload.get("call_id"),
        payload.get("callId"),
        (payload.get("data") or {}).get("id") if isinstance(payload.get("data"), dict) else None,
        (payload.get("call") or {}).get("id") if isinstance(payload.get("call"), dict) else None,
    ]
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _first_recipient(payload: dict[str, Any]) -> dict[str, Any] | None:
    recipients = payload.get("recipients")
    if isinstance(recipients, list) and recipients and isinstance(recipients[0], dict):
        return recipients[0]
    recipient = payload.get("recipient")
    if isinstance(recipient, dict):
        return recipient
    return None


def _last_attempt(recipient: dict[str, Any] | None, payload: dict[str, Any]) -> dict[str, Any] | None:
    sources: list[Any] = [recipient.get("attempts") if recipient else None, payload.get("attempts")]
    for attempts in sources:
        if isinstance(attempts, list) and attempts and isinstance(attempts[-1], dict):
            return attempts[-1]
    for candidate in (
        recipient.get("last_attempt") if recipient else None,
        payload.get("last_attempt"),
        recipient.get("lastAttempt") if recipient else None,
        payload.get("lastAttempt"),
        recipient.get("attempt") if recipient else None,
        payload.get("attempt"),
    ):
        if isinstance(candidate, dict):
            return candidate
    return None


def _status(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return "_".join(value.strip().lower().replace("-", " ").split())


def _safe_log_identifier(value: object) -> str | None:
    """Keep provider identifiers bounded before placing them in a log record."""

    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if _PROVIDER_ID.fullmatch(value) and not _PHONE_LIKE.search(value) else None


def _safe_provider_status(value: object) -> str | None:
    """Keep only a short machine status; never serialize provider prose."""

    normalized = _status(value)
    safe_statuses = (
        SUCCESS_STATUSES
        | TECHNICAL_STATUSES
        | {
            "accepted",
            "pending",
            "queued",
            "running",
            "processing",
            "in_progress",
        }
        | _POLICY_CODES
        | _RECIPIENT_CODES
        | _SCHEMA_CODES
        | _AUTH_CODES
        | _BALANCE_CODES
        | _RATE_CODES
        | _IDEMPOTENCY_CODES
        | _PROVIDER_CODES
    )
    return normalized if normalized in safe_statuses else None


def _elapsed_ms(started: float) -> float:
    return round(max(0.0, time.perf_counter() - started) * 1000, 2)


def _log_provider_boundary(
    event: str,
    *,
    operation: str,
    phase: str,
    quote_id: str,
    idempotency_key: str,
    call_id: object = None,
    provider_status: object = None,
    http_status: int | None = None,
    elapsed_ms: float,
    error_type: str | None = None,
    aggregate: bool | None = None,
    timeout_seconds: int | None = None,
) -> None:
    """Log aggregate CALL-E invocation metadata, excluding request/result data."""

    fields: dict[str, object] = {
        "service": "call_e",
        "operation": operation,
        "phase": phase,
        "quote_id": _safe_log_identifier(quote_id),
        "idempotency_key": _safe_log_identifier(idempotency_key),
        "call_id": _safe_log_identifier(call_id),
        "provider_status": _safe_provider_status(provider_status),
        "http_status": http_status,
        "elapsed_ms": elapsed_ms,
    }
    if error_type is not None:
        fields["error_type"] = error_type
    if aggregate is not None:
        fields["aggregate"] = aggregate
    if timeout_seconds is not None:
        fields["timeout_seconds"] = timeout_seconds
    log_event(event, level=logging.DEBUG, **fields)
    # INFO shows the main provider phases without exposing raw payloads or
    # every internal poll; DEBUG retains the detailed boundary events.
    if event in {"call_e_create_finished", "call_e_wait_finished"}:
        log_event("call_e_operation_completed", level=logging.INFO, **fields)


def _raw_api_log(
    event: str,
    *,
    operation: str,
    phase: str,
    payload: Any,
) -> None:
    """Emit an opt-in, redacted CALL-E payload for temporary support diagnostics."""

    log_event(
        event,
        level=logging.DEBUG,
        service="call_e",
        operation=operation,
        phase=phase,
        raw_api=True,
        sensitive=True,
        raw_payload=payload,
        preserve_phone_fields=True,
    )


def _effective_status(
    top_status: str | None,
    recipient_status: str | None,
    attempt_status: str | None,
) -> str | None:
    """Choose a stable terminal status across provider result locations.

    A top-level completed result can contain a failed recipient/attempt, and
    some SDK versions expose only the nested terminal state.  Prefer the most
    specific technical leaf for failures, then the first successful terminal
    location, while retaining top-level status when it is authoritative.
    """

    for value in (attempt_status, recipient_status, top_status):
        if value in TECHNICAL_STATUSES:
            return value
    for value in (top_status, recipient_status, attempt_status):
        if value in SUCCESS_STATUSES:
            return value
    return top_status or recipient_status or attempt_status


def _locations(payload: dict[str, Any], recipient: dict[str, Any] | None, attempt: dict[str, Any] | None) -> tuple[dict[str, Any], ...]:
    """Return result locations in provider-to-leaf precedence order."""

    return tuple(source for source in (payload, recipient, attempt) if isinstance(source, dict))


def _field_at_locations(
    locations: tuple[dict[str, Any], ...], field: str
) -> object:
    for source in locations:
        if field in source:
            return source[field]
    return _MISSING


def _structured_result(
    locations: tuple[dict[str, Any], ...],
) -> tuple[bool, dict[str, Any] | None]:
    """Find structured output and fail closed when any provider copy is malformed."""

    present = False
    selected: dict[str, Any] | None = None
    for source in locations:
        for field in ("structured_result", "result"):
            if field not in source:
                continue
            present = True
            value = source[field]
            if value is None:
                continue
            if not isinstance(value, dict):
                raise CallEError(
                    "CALL-E structured result was malformed",
                    classification="schema",
                    code="malformed_result",
                    reason="malformed_result",
                )
            if selected is None:
                selected = value
    return present, selected


def _signal_from_locations(
    locations: tuple[dict[str, Any], ...],
) -> str | None:
    """Derive only explicit no-answer/busy provider signals.

    The SDK's last attempt exposes ``failure_code`` and some API versions
    expose ``outcome``/``disposition`` instead.  We inspect only those bounded
    machine-result fields; ``failure_message`` and other prose are deliberately
    ignored so text cannot become a commercial disposition.
    """

    fields = ("failure_code", "outcome", "disposition", "result_code", "reason_code", "status")
    for source in reversed(locations):
        for field in fields:
            value = _status(source.get(field))
            if value is None:
                continue
            if value in {"no_answer", "noanswer"} or value.startswith("no_answer_"):
                return "no_answer"
            if value == "busy" or value.startswith("busy_"):
                return "busy"
    return None


def _derived_result(
    quote_id: str,
    call_id: str,
    outcome: str,
    provider_status: str,
    *,
    reason: str,
) -> CallResult:
    next_action = {
        "no_answer": "Retry the quote follow-up after the configured delay.",
        "busy": "Retry the quote follow-up after the configured delay.",
        "call_not_established": "Retry the quote follow-up after the configured delay.",
        "unknown": "Have a salesperson review the call evidence before taking action.",
    }[outcome]
    summary = {
        "no_answer": "CALL-E reported that the recipient did not answer.",
        "busy": "CALL-E reported that the recipient was busy.",
        "call_not_established": "CALL-E reported that the call was not established.",
        "unknown": "CALL-E did not provide sufficient evidence for a commercial disposition.",
    }[outcome]
    return CallResult(
        quote_id,
        call_id,
        provider_status,
        outcome,
        "unknown",
        None,
        f"{summary} ({reason}).",
        next_action,
        None,
        CallOutcomeKind.BUSINESS,
        datetime.now(timezone.utc),
    )


def _bounded_failure_diagnostic(details: dict[str, object | None]) -> str:
    """Return a short diagnostic made only from bounded machine fields."""

    reason = normalize_reason(details.get("reason", "provider_error"))
    code = normalize_error_code(details.get("code", "provider_error"))
    if reason == code:
        return reason
    return f"{reason}/{code}"[:128]


def _unknown_result(
    quote_id: str,
    call_id: str,
    provider_status: str,
    *,
    diagnostic: str,
) -> CallResult:
    """Represent an accepted call with insufficient evidence as a business result."""

    return _derived_result(
        quote_id,
        call_id,
        "unknown",
        provider_status or "unknown",
        reason=diagnostic,
    )


class CallEClient:
    """Run one call or report its request without contacting CALL-E."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = "https://api.heycall-e.com",
        execute: bool = False,
        client: Any | None = None,
        timeout_seconds: int = 600,
        raw_calle_api: bool = False,
        idempotency_suffix: str | None = None,
    ) -> None:
        if not isinstance(raw_calle_api, bool):
            raise ValueError("raw_calle_api must be a boolean")
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int) or timeout_seconds < 1:
            raise ValueError("timeout_seconds must be a positive integer")
        self.api_key = api_key
        self.base_url = validate_calle_base_url(base_url)
        self.execute_enabled = execute
        self._client = client
        self._owns_client = False
        self._closed = False
        self.timeout_seconds = timeout_seconds
        self.raw_calle_api = raw_calle_api
        self.idempotency_suffix = validate_idempotency_suffix(idempotency_suffix)

    def _log_raw_api(
        self,
        event: str,
        *,
        operation: str,
        phase: str,
        payload: Any,
    ) -> None:
        """Log raw CALL-E data only when explicitly enabled at DEBUG level."""

        if self.raw_calle_api and logger().isEnabledFor(logging.DEBUG):
            _raw_api_log(
                event,
                operation=operation,
                phase=phase,
                payload=payload,
            )

    def _sdk(self) -> Any:
        if self._closed:
            raise CallEError("CALL-E client is closed", code="client_closed", reason="client_closed")
        if self._client is None:
            if not self.api_key:
                raise CallEError(
                    "CALLE_API_KEY is required with --execute",
                    classification="auth",
                    code="missing_api_key",
                    reason="missing_api_key",
                )
            from calle import CalleClient

            self._client = CalleClient(api_key=self.api_key, base_url=self.base_url)
            self._owns_client = True
        return self._client

    def close(self) -> None:
        """Close an SDK-owned HTTP client; injected test doubles are not owned."""

        if self._owns_client and self._client is not None:
            close = getattr(self._client, "close", None)
            if callable(close):
                close()
        self._closed = True
        log_event(
            "call_e_client_closed",
            level=logging.DEBUG,
            service="call_e",
            operation="close",
            phase="close",
            sdk_owned=self._owns_client,
        )

    def __enter__(self) -> "CallEClient":
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()

    def preview(self, request: CallRequest, *, next_attempt: int, retry_marker: datetime | None = None) -> dict[str, Any]:
        """Build a masked dry-run payload; it never constructs the SDK client."""

        locale = canonicalize_call_locale(request.locale)
        binding_digest, metadata = _bound_operation(
            request,
            next_attempt=next_attempt,
            retry_marker=retry_marker,
            suffix=self.idempotency_suffix,
        )
        return {
            "mode": "dry_run",
            "quote_id": request.quote_id,
            "locale": locale,
            "region": request.region,
            "idempotency_key": idempotency_key(
                request.quote_id,
                next_attempt,
                retry_marker,
                self.idempotency_suffix,
                binding_digest,
            ),
            "binding_digest": binding_digest,
            "metadata": metadata,
            "phone_configured": bool(request.phone),
            "task": request.goal,
        }

    def execute(self, request: CallRequest, *, next_attempt: int, retry_marker: datetime | None = None) -> CallResult:
        if not self.execute_enabled:
            raise CallEError("live CALL-E execution requires --execute", code="execute_required", reason="execute_required")
        locale = canonicalize_call_locale(request.locale)
        binding_digest, metadata = _bound_operation(
            request,
            next_attempt=next_attempt,
            retry_marker=retry_marker,
            suffix=self.idempotency_suffix,
        )
        key = idempotency_key(
            request.quote_id,
            next_attempt,
            retry_marker,
            self.idempotency_suffix,
            binding_digest,
        )
        sdk = self._sdk()
        create_started = time.perf_counter()
        _log_provider_boundary(
            "call_e_create_started",
            operation="calls.create",
            phase="create",
            quote_id=request.quote_id,
            idempotency_key=key,
            elapsed_ms=0,
        )
        create_response_logged = False
        try:
            create_payload = {
                "task": request.goal,
                "recipient": {"phones": [request.phone], "locale": locale, "region": request.region},
                "result_schema": result_schema(),
                "metadata": metadata,
                "idempotency_key": key,
            }
            self._log_raw_api(
                "call_e_raw_request",
                operation="calls.create",
                phase="create",
                payload=create_payload,
            )
            created = sdk.calls.create(**create_payload)
            self._log_raw_api(
                "call_e_raw_response",
                operation="calls.create",
                phase="create",
                payload=created,
            )
            call_id = _extract_call_id(created)
            _log_provider_boundary(
                "call_e_create_finished",
                operation="calls.create",
                phase="create",
                quote_id=request.quote_id,
                idempotency_key=key,
                call_id=call_id,
                provider_status=created.get("status") if isinstance(created, dict) else None,
                elapsed_ms=_elapsed_ms(create_started),
            )
            create_response_logged = True
            if call_id is None:
                error = CallEError(
                    "CALL-E create returned no call ID; creation outcome is unknown",
                    classification="provider",
                    code="missing_call_id",
                    reason="create_outcome_unknown",
                    creation_unknown=True,
                    idempotency_key=key,
                    phase="create",
                )
                raise error
            log_event(
                "call_e_call_accepted",
                quote_id=_safe_log_identifier(request.quote_id),
                call_id=_safe_log_identifier(call_id),
            )
        except Exception as exc:
            if not hasattr(exc, "classification"):
                info = _classify_provider_error(exc)
                _set_failure_attributes(
                    exc,
                    **info,
                    creation_unknown=_provider_operation_unknown(info),
                    idempotency_key=key,
                    phase="create",
                )
            details = failure_details(exc)
            self._log_raw_api(
                "call_e_raw_response",
                operation="calls.create",
                phase="create",
                payload={
                    "status": details["http_status"],
                    "failure_code": details["code"],
                    "error_type": type(exc).__name__,
                },
            )
            if not create_response_logged:
                _log_provider_boundary(
                    "call_e_create_finished",
                    operation="calls.create",
                    phase="create",
                    quote_id=request.quote_id,
                    idempotency_key=key,
                    provider_status=details["code"],
                    http_status=details["http_status"],
                    elapsed_ms=_elapsed_ms(create_started),
                    error_type=type(exc).__name__,
                )
            log_event(
                "call_e_execution_failed",
                quote_id=_safe_log_identifier(request.quote_id),
                phase="create",
                classification=details["classification"],
                http_status=details["http_status"],
                code=details["code"],
                reason=details["reason"],
                creation_unknown=details["creation_unknown"],
                result_unknown=details["result_unknown"],
                provider_call_id=details["provider_call_id"],
                idempotency_key=_safe_log_identifier(key),
                error_type=type(exc).__name__,
            )
            raise
        wait_started = time.perf_counter()
        # wait_for_result performs provider polling internally.  This event is
        # deliberately one aggregate invocation boundary, not one event per poll.
        _log_provider_boundary(
            "call_e_wait_started",
            operation="calls.wait_for_result",
            phase="wait",
            quote_id=request.quote_id,
            idempotency_key=key,
            call_id=call_id,
            elapsed_ms=0,
            aggregate=True,
            timeout_seconds=self.timeout_seconds,
        )
        self._log_raw_api(
            "call_e_raw_request",
            operation="calls.wait_for_result",
            phase="wait",
            payload={
                "call_id": call_id,
                "timeout_seconds": self.timeout_seconds,
                "interval_seconds": 2,
            },
        )
        try:
            completed = sdk.calls.wait_for_result(call_id, timeout_seconds=self.timeout_seconds, interval_seconds=2)
            self._log_raw_api(
                "call_e_raw_response",
                operation="calls.wait_for_result",
                phase="wait",
                payload=completed,
            )
            _log_provider_boundary(
                "call_e_wait_finished",
                operation="calls.wait_for_result",
                phase="wait",
                quote_id=request.quote_id,
                idempotency_key=key,
                call_id=call_id,
                provider_status=completed.get("status") if isinstance(completed, dict) else None,
                elapsed_ms=_elapsed_ms(wait_started),
                aggregate=True,
                timeout_seconds=self.timeout_seconds,
            )
        except Exception as exc:
            info = _classify_provider_error(exc)
            # Creation returned a provider call ID.  Any failed poll leaves
            # the terminal call result unknown, including deterministic HTTP
            # 4xx responses from the status endpoint.  The classification and
            # code still tell the operator what to fix before retrying.
            _set_failure_attributes(
                exc,
                **info,
                creation_unknown=False,
                result_unknown=True,
                provider_call_id=call_id,
                idempotency_key=key,
                phase="wait",
            )
            details = failure_details(exc)
            self._log_raw_api(
                "call_e_raw_response",
                operation="calls.wait_for_result",
                phase="wait",
                payload={
                    "status": details["http_status"],
                    "failure_code": details["code"],
                    "error_type": type(exc).__name__,
                },
            )
            _log_provider_boundary(
                "call_e_wait_finished",
                operation="calls.wait_for_result",
                phase="wait",
                quote_id=request.quote_id,
                idempotency_key=key,
                call_id=call_id,
                provider_status=details["code"],
                http_status=details["http_status"],
                elapsed_ms=_elapsed_ms(wait_started),
                error_type=type(exc).__name__,
                aggregate=True,
                timeout_seconds=self.timeout_seconds,
            )
            log_event(
                "call_e_wait_failed",
                quote_id=_safe_log_identifier(request.quote_id),
                call_id=_safe_log_identifier(call_id),
                phase="wait",
                classification=details["classification"],
                http_status=details["http_status"],
                code=details["code"],
                reason=details["reason"],
                creation_unknown=details["creation_unknown"],
                result_unknown=details["result_unknown"],
                provider_call_id=details["provider_call_id"],
                idempotency_key=_safe_log_identifier(key),
                error_type=type(exc).__name__,
            )
            return _unknown_result(
                request.quote_id,
                call_id,
                str(details["code"]),
                diagnostic=_bounded_failure_diagnostic(details),
            )
        try:
            _verify_provider_binding(
                request,
                call_id,
                completed,
                provider_key=key,
                metadata=metadata,
            )
            parsed = self._parse_result(request.quote_id, call_id, completed)
            return replace(
                parsed,
                binding_digest=binding_digest,
                provider_key=key,
                bound_phone=request.phone,
                bound_task=request.goal,
                bound_schema_digest=hashlib.sha256(
                    _canonical_json(result_schema()).encode("utf-8")
                ).hexdigest(),
                bound_metadata=tuple(sorted(metadata.items())),
                binding_verified=True,
            )
        except Exception as exc:
            details = failure_details(exc)
            _set_failure_attributes(
                exc,
                classification=details["classification"],
                http_status=details["http_status"],
                code=details["code"],
                reason=details["reason"],
                creation_unknown=False,
                result_unknown=True,
                provider_call_id=call_id,
                idempotency_key=key,
                phase="parse",
            )
            details = failure_details(exc)
            log_event(
                "call_e_parse_failed",
                quote_id=_safe_log_identifier(request.quote_id),
                call_id=_safe_log_identifier(call_id),
                phase="parse",
                classification=details["classification"],
                http_status=details["http_status"],
                code=details["code"],
                reason=details["reason"],
                creation_unknown=details["creation_unknown"],
                result_unknown=details["result_unknown"],
                provider_call_id=details["provider_call_id"],
                idempotency_key=_safe_log_identifier(key),
                error_type=type(exc).__name__,
            )
            provider_status = (
                _safe_provider_status(completed.get("status"))
                if isinstance(completed, dict)
                else None
            )
            return _unknown_result(
                request.quote_id,
                call_id,
                provider_status or str(details["code"]),
                diagnostic=_bounded_failure_diagnostic(details),
            )

    def _parse_result(self, quote_id: str, call_id: str, payload: Any) -> CallResult:
        if not isinstance(payload, dict):
            raise CallEError("CALL-E result was malformed", classification="schema", code="malformed_result", reason="malformed_result")
        top_status = _status(payload.get("status"))
        recipient = _first_recipient(payload)
        attempt = _last_attempt(recipient, payload)
        recipient_status = _status(recipient.get("status")) if recipient else None
        attempt_status = _status(attempt.get("status")) if attempt else None
        locations = _locations(payload, recipient, attempt)
        task_completed = _field_at_locations(locations, "task_completed")
        structured_present, structured = _structured_result(locations)
        signal = _signal_from_locations(locations)
        effective_status = _effective_status(top_status, recipient_status, attempt_status)

        if task_completed is not _MISSING and task_completed is not None and not isinstance(task_completed, bool):
            raise CallEError(
                "CALL-E task_completed must be a boolean when present",
                classification="schema",
                code="invalid_task_completed",
                reason="invalid_task_completed",
            )

        # Once CALL-E has returned a call ID, the provider operation is an
        # accepted attempt.  Failed/rejected/declined/canceled terminal states
        # therefore become the internal ``call_not_established`` outcome unless
        # CALL-E supplies an explicit, machine-readable no-answer/busy signal.
        # Never inspect free-text failure messages for a disposition.
        if top_status in TECHNICAL_STATUSES or recipient_status in TECHNICAL_STATUSES or attempt_status in TECHNICAL_STATUSES:
            if (
                structured is not None
                and structured.get("outcome") in {"no_answer", "busy"}
            ):
                return _derived_result(
                    quote_id,
                    call_id,
                    structured["outcome"],
                    effective_status or "failed",
                    reason="explicit aggregate structured outcome",
                )
            if signal is not None:
                return _derived_result(
                    quote_id,
                    call_id,
                    signal,
                    effective_status or "completed",
                    reason="explicit provider attempt code",
                )
            return _derived_result(
                quote_id,
                call_id,
                "call_not_established",
                effective_status or "failed",
                reason="terminal provider status without a reliable business signal",
            )
        if signal is not None and structured is None:
            return _derived_result(
                quote_id,
                call_id,
                signal,
                effective_status or signal,
                reason="explicit provider attempt code",
            )
        if effective_status is None or effective_status not in SUCCESS_STATUSES:
            raise CallEError(
                "CALL-E result has no recognized terminal provider status",
                classification="provider",
                code="invalid_provider_status",
                reason="invalid_provider_status",
            )
        if recipient_status is not None and recipient_status not in SUCCESS_STATUSES:
            raise CallEError(
                "CALL-E recipient result has no recognized terminal status",
                classification="provider",
                code="invalid_recipient_status",
                reason="invalid_recipient_status",
            )
        if attempt_status is not None and attempt_status not in SUCCESS_STATUSES:
            raise CallEError(
                "CALL-E last attempt has no recognized terminal status",
                classification="provider",
                code="invalid_attempt_status",
                reason="invalid_attempt_status",
            )

        # A no-answer/busy disposition is valid evidence even when CALL-E
        # reports task_completed=False: the task (a conversation) was not
        # completed, but the provider did establish the retryable call
        # outcome.  Other commercial outcomes still require task_completed
        # so that provider processing completion is never confused with
        # commercial success.
        if task_completed is not True:
            if (
                structured is not None
                and structured.get("outcome") in {"no_answer", "busy"}
            ):
                pass
            else:
                return _derived_result(
                    quote_id,
                    call_id,
                    "unknown",
                    effective_status,
                    reason="task_completed was not true",
                )
        if not structured_present or structured is None:
            return _derived_result(
                quote_id,
                call_id,
                "unknown",
                effective_status,
                reason="structured result was absent",
            )
        # additionalProperties=false is enforced at our boundary as well as in
        # the provider request schema.
        unknown = set(structured) - set(result_schema()["properties"])
        if unknown:
            raise CallEError(
                "CALL-E structured_result contains unsupported fields",
                classification="schema",
                code="unexpected_result_field",
                reason="unexpected_result_field",
            )
        preferred = _parse_date(structured.get("preferred_date", _MISSING))
        outcome = _required_outcome(structured.get("outcome"))
        interest = _required_text(structured.get("interest_level"), "interest_level", 80)
        if interest not in CALL_INTEREST_VOCABULARY:
            raise CallEError(
                "CALL-E structured_result.interest_level is unsupported",
                classification="schema",
                code="invalid_interest_level",
                reason="invalid_interest_level",
            )
        summary = _required_text(structured.get("summary"), "summary")
        next_action = _required_text(structured.get("next_action"), "next_action")
        occurred = datetime.now(timezone.utc)
        preferred_at = datetime.combine(preferred, datetime.min.time(), timezone.utc) if preferred is not None else None
        return CallResult(
            quote_id,
            call_id,
            effective_status,
            outcome,
            interest,
            preferred,
            summary,
            next_action,
            preferred_at,
            CallOutcomeKind.BUSINESS,
            occurred,
        )


__all__ = [
    "CallEClient",
    "CallEError",
    "FAILURE_CLASSIFICATIONS",
    "failure_details",
    "idempotency_key",
    "normalize_error_code",
    "normalize_reason",
    "operation_binding_digest",
    "request_metadata",
    "result_schema",
    "validate_idempotency_suffix",
]
