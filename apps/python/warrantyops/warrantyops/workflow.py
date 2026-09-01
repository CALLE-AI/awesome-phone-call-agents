"""One authorized call, from the authorization record to a terminal outcome.

The order is fixed and every step can refuse: authorize, derive the key, build
the task, place the call through a provider, validate what came back, then fold
transport and business state into one outcome. Nothing later in the chain can
rescue a refusal earlier in it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from .authorization import (
    AuthorizationDecision,
    CallAuthorization,
    authorize_call,
    mask_e164,
)
from .contract import CONTRACT_VERSION, build_extraction_schema
from .idempotency import derive_idempotency_key
from .outcome import TerminalState, TransportOutcome, TransportState, WorkflowOutcome, derive_outcome
from .contract import unresolved_result
from .providers.base import CallProvider, CallRequest
from .validation import validate_structured_result

DEFAULT_IDENTIFIER_PREFIX = "RMA"
DEFAULT_IDENTIFIER_PATTERN = r"RMA-[A-Z0-9]{3,20}"

#: The read-back instruction. It is a property of the task text, not of the
#: schema, because the schema can only record that a read-back happened; only
#: the task can make it happen.
READBACK_INSTRUCTION = (
    "If they give you an authorization, RMA, claim or case reference, read it "
    "back to them digit by digit and ask them to confirm it before you end the "
    "call. If they correct you, read the corrected value back and ask again. "
    "Do not end the call treating a reference as final until they have "
    "confirmed the value you read to them."
)

TRUTHFULNESS_INSTRUCTION = (
    "Do not guess, complete or tidy up anything they did not say. If they hedge "
    "or defer to a record they cannot see, treat the answer as not established."
)


@dataclass(frozen=True)
class CaseInput:
    """The minimum a case needs. Deliberately not warranty-specific in shape."""

    case_reference: str
    asset_description: str
    failure_description: str
    prior_channel_outcome: str
    caller_organization: str


def build_task(case: CaseInput, authorization: CallAuthorization) -> str:
    """Compose the natural-language task CALL-E is asked to carry out."""

    return (
        f"You are calling on behalf of {case.caller_organization} about a "
        f"warranty exception. Say at the start that you are an AI assistant "
        f"calling for {case.caller_organization}, and never deny it.\n\n"
        f"Case reference: {case.case_reference}.\n"
        f"Asset: {case.asset_description}.\n"
        f"Failure: {case.failure_description}.\n"
        f"What already happened: {case.prior_channel_outcome}.\n\n"
        "Ask whether this failure is covered, and what they will do about it. "
        f"{READBACK_INSTRUCTION} {TRUTHFULNESS_INSTRUCTION}"
    )


@dataclass(frozen=True)
class WorkflowRefusal:
    """A run that never became a call."""

    reason: str
    authorization: AuthorizationDecision

    def to_dict(self) -> dict[str, Any]:
        return {
            "refused": True,
            "reason": self.reason,
            "authorization": self.authorization.to_dict(),
        }


def run_case(
    case: CaseInput,
    authorization: CallAuthorization,
    provider: CallProvider,
    *,
    idempotency_namespace: str = "warrantyops",
    now: datetime | None = None,
    allowlist: frozenset[str] | None = None,
    recheck_token: str | None = None,
) -> WorkflowOutcome | WorkflowRefusal:
    """Run one case end to end against whichever provider was supplied."""

    decision = authorize_call(
        authorization,
        requested_purpose=authorization.purpose,
        now=now,
        allowlist=allowlist,
    )
    if not decision.allowed:
        return WorkflowRefusal(
            reason="authorization gate refused the call", authorization=decision
        )

    key = derive_idempotency_key(
        namespace=idempotency_namespace,
        authorization_record_reference=authorization.record_reference,
        case_reference=case.case_reference,
        contract_version=CONTRACT_VERSION,
        recheck_token=recheck_token,
    )
    schema = build_extraction_schema()
    request = CallRequest(
        task=build_task(case, authorization),
        recipient_e164=authorization.recipient_e164,
        result_schema=schema,
        idempotency_key=key,
        metadata={
            "app": "warrantyops",
            "contract_version": CONTRACT_VERSION,
            "case_reference": case.case_reference,
            "authorization_record_reference": authorization.record_reference,
        },
    )
    call = provider.place_call(request)
    validation = validate_structured_result(call.structured_result, schema)
    return derive_outcome(
        call.transport,
        validation,
        transcript_turns=call.transcript_turns or None,
        expected_identifier_pattern=DEFAULT_IDENTIFIER_PATTERN,
        identifier_prefix=DEFAULT_IDENTIFIER_PREFIX,
    )


def masked_report(
    outcome: WorkflowOutcome | WorkflowRefusal, recipient_e164: str
) -> dict[str, Any]:
    """The only shape this application prints. The number is always masked."""

    body = outcome.to_dict()
    body["recipient"] = mask_e164(recipient_e164)
    return body


__all__ = [
    "CaseInput",
    "WorkflowRefusal",
    "build_task",
    "run_case",
    "masked_report",
    "READBACK_INSTRUCTION",
    "TerminalState",
    "TransportOutcome",
    "TransportState",
    "unresolved_result",
]
