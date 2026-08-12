"""Direct CALL-E SDK integration with a deterministic no-network dry-run."""

from __future__ import annotations

from datetime import date, datetime, timezone
import hashlib
from typing import Any

from quotewake_salesforce.domain.models import (
    CALL_OUTCOME_VALUES,
    CALL_OUTCOME_VOCABULARY,
    CallOutcomeKind,
    CallRequest,
    CallResult,
)
from quotewake_salesforce.structured_logging import log_event


class CallEError(RuntimeError):
    pass


def result_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "required": ["outcome", "interest_level", "preferred_date", "summary", "next_action"],
        "properties": {
            "outcome": {"type": "string", "enum": list(CALL_OUTCOME_VALUES)},
            "interest_level": {"type": "string"},
            "preferred_date": {"type": ["string", "null"]},
            "summary": {"type": "string"},
            "next_action": {"type": "string"},
        },
        "additionalProperties": False,
    }


def idempotency_key(quote_id: str, next_attempt: int, retry_marker: datetime | None = None) -> str:
    if next_attempt < 1:
        raise ValueError("next attempt must be positive")
    key = f"quotewake-{quote_id}-{next_attempt}"
    if retry_marker is not None:
        if retry_marker.tzinfo is None or retry_marker.utcoffset() is None:
            raise ValueError("retry marker must be timezone-aware")
        marker = retry_marker.astimezone(timezone.utc).isoformat()
        key += "-" + hashlib.sha256(marker.encode("utf-8")).hexdigest()[:12]
    return key


SUCCESS_STATUSES = frozenset({"completed", "succeeded", "success"})
TECHNICAL_STATUSES = frozenset({"failed", "canceled", "cancelled"})


def _required_text(value: Any, field: str, maximum: int = 1000) -> str:
    if not isinstance(value, str):
        raise CallEError(f"CALL-E structured_result.{field} must be a non-empty string")
    cleaned = " ".join(value.split())
    if not cleaned:
        raise CallEError(f"CALL-E structured_result.{field} must be a non-empty string")
    return cleaned[:maximum]


def _parse_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise CallEError("CALL-E structured_result.preferred_date must be an ISO date")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise CallEError("CALL-E structured_result.preferred_date must be an ISO date") from None


def _required_outcome(value: Any) -> str:
    """Validate an outcome without accepting provider-specific aliases."""

    if not isinstance(value, str) or value not in CALL_OUTCOME_VOCABULARY:
        raise CallEError("CALL-E structured_result.outcome is unsupported")
    return value


def _failure_reason(error: BaseException) -> str:
    """Map provider failures to a small, non-sensitive operational vocabulary."""

    if isinstance(error, TimeoutError) or type(error).__name__ in {
        "TimeoutException",
        "ReadTimeout",
        "ConnectTimeout",
    }:
        return "timeout"
    if isinstance(error, CallEError):
        message = str(error)
        if "structured_result.outcome" in message:
            return "invalid_outcome"
        if "preferred_date" in message:
            return "invalid_preferred_date"
        if "provider status" in message or "non-terminal" in message:
            return "invalid_provider_status"
        if "structured_result" in message or "malformed" in message:
            return "malformed_result"
        return "invalid_result"
    return "provider_error"


class CallEClient:
    """Run one call or report its request without contacting CALL-E."""

    def __init__(self, api_key: str | None = None, *, base_url: str = "https://api.heycall-e.com", execute: bool = False, client: Any | None = None, timeout_seconds: int = 600) -> None:
        self.api_key = api_key
        self.base_url = base_url
        self.execute_enabled = execute
        self._client = client
        self.timeout_seconds = timeout_seconds

    def _sdk(self) -> Any:
        if self._client is None:
            if not self.api_key:
                raise CallEError("CALLE_API_KEY is required with --execute")
            from calle import CalleClient
            self._client = CalleClient(api_key=self.api_key, base_url=self.base_url)
        return self._client

    def preview(self, request: CallRequest, *, next_attempt: int, retry_marker: datetime | None = None) -> dict[str, Any]:
        """Build a masked dry-run payload; it never constructs the SDK client."""

        return {
            "mode": "dry_run",
            "quote_id": request.quote_id,
            "locale": request.locale,
            "region": request.region,
            "idempotency_key": idempotency_key(request.quote_id, next_attempt, retry_marker),
            "phone_configured": bool(request.phone),
            "task": request.goal,
        }

    def execute(self, request: CallRequest, *, next_attempt: int, retry_marker: datetime | None = None) -> CallResult:
        if not self.execute_enabled:
            raise CallEError("live CALL-E execution requires --execute")
        key = idempotency_key(request.quote_id, next_attempt, retry_marker)
        sdk = self._sdk()
        try:
            created = sdk.calls.create(
                task=request.goal,
                recipient={"phone": request.phone, "locale": request.locale},
                result_schema=result_schema(),
                metadata={"quotewake_quote_id": request.quote_id},
                idempotency_key=key,
            )
            call_id = created.get("id") if isinstance(created, dict) else None
            if not isinstance(call_id, str) or not call_id:
                raise CallEError("CALL-E create returned no call ID")
            log_event("call_e_call_accepted", quote_id=request.quote_id, call_id=call_id)
        except Exception as exc:
            log_event(
                "call_e_execution_failed",
                quote_id=request.quote_id,
                phase="create",
                reason=_failure_reason(exc),
                error_type=type(exc).__name__,
            )
            raise
        try:
            completed = sdk.calls.wait_for_result(call_id, timeout_seconds=self.timeout_seconds, interval_seconds=2)
        except Exception as exc:
            log_event(
                "call_e_wait_failed",
                quote_id=request.quote_id,
                call_id=call_id,
                phase="wait",
                reason=_failure_reason(exc),
                error_type=type(exc).__name__,
            )
            raise
        try:
            if isinstance(completed, dict) and str(completed.get("status", "")).strip().lower() in TECHNICAL_STATUSES:
                return self._technical_result(request.quote_id, call_id, str(completed["status"]))
            return self._parse_result(request.quote_id, call_id, completed)
        except Exception as exc:
            log_event(
                "call_e_parse_failed",
                quote_id=request.quote_id,
                call_id=call_id,
                phase="parse",
                reason=_failure_reason(exc),
                error_type=type(exc).__name__,
            )
            raise

    @staticmethod
    def _technical_result(quote_id: str, call_id: str, status: str) -> CallResult:
        return CallResult(quote_id, call_id, status, "technical_failure", "unknown", None, "CALL-E provider failure", "Retry after the technical failure.", None, CallOutcomeKind.TECHNICAL_FAILURE, datetime.now(timezone.utc))

    def _parse_result(self, quote_id: str, call_id: str, payload: Any) -> CallResult:
        if not isinstance(payload, dict):
            raise CallEError("CALL-E result was malformed")
        raw_status = payload.get("status")
        if not isinstance(raw_status, str) or not raw_status.strip():
            raise CallEError("CALL-E result did not contain a provider status")
        status = raw_status.strip().lower()
        if status not in SUCCESS_STATUSES:
            raise CallEError(f"CALL-E result has non-terminal provider status: {status}")
        structured = payload.get("structured_result")
        if not isinstance(structured, dict):
            raise CallEError("CALL-E result did not contain structured_result")
        if "preferred_date" not in structured:
            raise CallEError("CALL-E structured_result.preferred_date is required")
        preferred = _parse_date(structured.get("preferred_date"))
        outcome = _required_outcome(structured.get("outcome"))
        interest = _required_text(structured.get("interest_level"), "interest_level", 80)
        summary = _required_text(structured.get("summary"), "summary")
        next_action = _required_text(structured.get("next_action"), "next_action")
        occurred = datetime.now(timezone.utc)
        preferred_at = datetime.combine(preferred, datetime.min.time(), timezone.utc) if preferred is not None else None
        return CallResult(quote_id, call_id, status, outcome, interest, preferred, summary, next_action, preferred_at, CallOutcomeKind.BUSINESS, occurred)
