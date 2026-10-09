"""Provider-neutral call interface. The orchestrator only ever sees these types."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

# UNKNOWN: we cannot tell whether a phone rang or how the call went — the create request timed out,
# failed with a 5xx, or came back without an id, or the poll deadline passed on a call that exists.
# It is never mapped onto UNREACHABLE (that would be a finding we do not have) nor onto "no call was
# placed" (that would be a reassurance we do not have). The runner stops the roster on it.
OutcomeStatus = Literal["COMPLETED", "NO_ANSWER", "FAILED", "INVALID_RESULT", "UNKNOWN"]


class CallRequest(BaseModel):
    phone: str
    region: str = "US"
    locale: str = "en-US"
    task: str
    result_schema: dict[str, Any]
    metadata: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str
    neighbour_id: str  # who the call is about; the mock provider picks its fixture by it
    webhook_url: str | None = None
    existing_provider_call_id: str | None = None  # set on startup resume


class ProviderEvent(BaseModel):
    """A provider-side lifecycle event, forwarded verbatim into the timeline."""

    type: str  # e.g. call.queued, call.dialing, call.in_progress, call.completed
    message: str
    status: str | None = None
    provider_call_id: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class CallOutcome(BaseModel):
    provider_call_id: str | None
    status: OutcomeStatus
    structured_result: dict[str, Any] | None
    transcript: list[dict[str, Any]] = Field(default_factory=list)
    summary: str | None = None
    duration_s: int | None = None
    failure_code: str | None = None
    failure_message: str | None = None
    # CALL-E's own post-call judgment (CallTask.task_completed / completion_confidence / evidence).
    # None / [] for providers that do not produce them.
    task_completed: bool | None = None
    completion_confidence: dict[str, Any] | None = None  # {"score": 0..1, "label": "low|medium|high"}
    evidence: list[str] = Field(default_factory=list)
    raw: dict[str, Any] = Field(default_factory=dict)


EventSink = Callable[[ProviderEvent], Awaitable[None]]


class CallProvider(Protocol):
    name: str

    async def place(self, req: CallRequest, on_event: EventSink) -> CallOutcome: ...


class NumberNotAllowlisted(PermissionError):
    pass


class CallBudgetExhausted(RuntimeError):
    pass


class ProviderFatalError(RuntimeError):
    """The provider rejected something that is the same for every candidate (schema, auth, balance).
    The run must stop before any further dial."""

    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = details  # the provider's own explanation; the only thing that says WHY


class CandidateRejectedByProvider(RuntimeError):
    """The provider rejected this recipient specifically (bad number, blocked, unsupported region).
    Skip the candidate, keep the run going."""

    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = details


# CALL-E API error codes (from the OpenAPI schema), grouped by what the orchestrator should do.
RUN_FATAL_CODES = frozenset({"result_schema_invalid", "recipient_result_schema_invalid", "unauthorized", "forbidden", "insufficient_balance", "invalid_request", "policy_violation"})
CANDIDATE_SKIP_CODES = frozenset({"invalid_phone", "invalid_recipient", "recipient_blocked", "unsupported_region", "unsupported_language", "no_recipients"})
# everything else (rate_limit_exceeded, provider_unavailable, internal_error, call_not_ready, ...) is a transient
# FAILED outcome for this candidate.
