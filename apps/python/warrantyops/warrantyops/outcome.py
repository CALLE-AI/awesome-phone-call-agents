"""Transport state and business state are different questions.

CALL-E reports whether a call happened. It does not report whether a warranty
claim was resolved, and the documentation is explicit that the Calls API does
not currently guarantee a distinct no-answer or decline value, so a failed call
must leave the business outcome unresolved rather than infer one.

The rule this module enforces is that no transport state can ever produce a
business assertion. A call nobody answered is UNKNOWN coverage, never
NOT_COVERED.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

from .contract import (
    AUTHORIZING_RESOLUTIONS,
    CONTRACT_VERSION,
    BusinessResult,
    CoverageStatus,
    ResolutionStatus,
    unresolved_result,
)
from .identifiers import (
    IdentifierClaim,
    IdentifierDecision,
    IdentifierState,
    TranscriptTurn,
    evaluate_identifier,
)
from .validation import ValidationResult


class TransportState(str, Enum):
    """The CALL-E call lifecycle, plus the state before anything was sent."""

    NOT_ATTEMPTED = "NOT_ATTEMPTED"
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


TERMINAL_TRANSPORT_STATES = frozenset(
    {TransportState.COMPLETED, TransportState.FAILED, TransportState.CANCELED}
)


class TerminalState(str, Enum):
    """What this workflow concluded, once nothing more will change."""

    NOT_ATTEMPTED = "NOT_ATTEMPTED"
    IN_FLIGHT = "IN_FLIGHT"
    TRANSPORT_FAILED = "TRANSPORT_FAILED"
    RESULT_UNAVAILABLE = "RESULT_UNAVAILABLE"
    BUSINESS_RESOLVED = "BUSINESS_RESOLVED"
    BUSINESS_ACTION_REQUIRED = "BUSINESS_ACTION_REQUIRED"
    BUSINESS_UNRESOLVED = "BUSINESS_UNRESOLVED"


_ACTION_RESOLUTIONS = frozenset(
    {
        ResolutionStatus.DOCUMENTATION_REQUIRED,
        ResolutionStatus.DIAGNOSTICS_REQUIRED,
        ResolutionStatus.HUMAN_ACTION_REQUIRED,
    }
)


@dataclass(frozen=True)
class TransportOutcome:
    """Everything known about the call as a call.

    ``failure_code`` is carried for support and never branched on: the CALL-E
    documentation states it is a nullable string with no published enum and
    tells integrators not to drive retry, reporting or analytics from it.
    """

    state: TransportState
    call_id: str | None = None
    diagnostic_failure_code: str | None = None
    diagnostic_failure_message: str | None = None

    @property
    def is_terminal(self) -> bool:
        return self.state in TERMINAL_TRANSPORT_STATES

    def to_dict(self) -> dict[str, Any]:
        return {
            "state": self.state.value,
            "call_id": self.call_id,
            "diagnostic_failure_code": self.diagnostic_failure_code,
            "diagnostic_failure_message": self.diagnostic_failure_message,
        }


@dataclass(frozen=True)
class WorkflowOutcome:
    terminal_state: TerminalState
    transport: TransportOutcome
    business: BusinessResult
    identifier: IdentifierDecision | None
    validation_errors: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "terminal_state": self.terminal_state.value,
            "transport": self.transport.to_dict(),
            "business": self.business.to_dict(),
            "identifier": self.identifier.to_dict() if self.identifier else None,
            "validation_errors": list(self.validation_errors),
        }


def _claim_from(extraction: dict[str, Any]) -> IdentifierClaim:
    return IdentifierClaim(
        value_heard=extraction.get("authorization_reference_heard"),
        readback_performed=bool(
            extraction.get("authorization_reference_readback_performed")
        ),
        value_confirmed=extraction.get("authorization_reference_confirmed"),
        confirmation_quote=extraction.get(
            "authorization_reference_confirmation_quote"
        ),
    )


def derive_outcome(
    transport: TransportOutcome,
    validation: ValidationResult,
    *,
    transcript: tuple[TranscriptTurn, ...] | None = None,
    expected_identifier_pattern: str | None = None,
    identifier_prefix: str | None = None,
) -> WorkflowOutcome:
    """Fold a transport state and a validated extraction into one outcome."""

    if transport.state is TransportState.NOT_ATTEMPTED:
        return WorkflowOutcome(
            terminal_state=TerminalState.NOT_ATTEMPTED,
            transport=transport,
            business=unresolved_result("call was not attempted"),
            identifier=None,
        )
    if not transport.is_terminal:
        return WorkflowOutcome(
            terminal_state=TerminalState.IN_FLIGHT,
            transport=transport,
            business=unresolved_result("call has not reached a terminal state"),
            identifier=None,
        )
    if transport.state is not TransportState.COMPLETED:
        return WorkflowOutcome(
            terminal_state=TerminalState.TRANSPORT_FAILED,
            transport=transport,
            business=unresolved_result(
                f"call reached terminal state {transport.state.value} without a "
                "business outcome"
            ),
            identifier=None,
        )
    if not validation.ok or validation.value is None:
        return WorkflowOutcome(
            terminal_state=TerminalState.RESULT_UNAVAILABLE,
            transport=transport,
            business=unresolved_result(
                "call completed without a schema-valid structured result"
            ),
            identifier=None,
            validation_errors=validation.errors,
        )

    extraction = validation.value
    downgrades: list[str] = []

    coverage = CoverageStatus(extraction["coverage_status"])
    coverage_quote = extraction.get("coverage_evidence_quote")
    if coverage is not CoverageStatus.UNKNOWN and not (coverage_quote or "").strip():
        downgrades.append(
            f"coverage_status {coverage.value} had no evidence quote and was "
            "reduced to UNKNOWN"
        )
        coverage = CoverageStatus.UNKNOWN

    resolution = ResolutionStatus(extraction["resolution_status"])
    identifier = evaluate_identifier(
        _claim_from(extraction),
        transcript=transcript,
        expected_pattern=expected_identifier_pattern,
        prefix=identifier_prefix,
    )

    authorization_reference = None
    if identifier.state is IdentifierState.CONFIRMED_IDENTIFIER:
        authorization_reference = identifier.value
    elif resolution in AUTHORIZING_RESOLUTIONS:
        downgrades.append(
            f"resolution_status {resolution.value} asserted an authorization "
            "whose identifier never reached CONFIRMED_IDENTIFIER; reduced to "
            "HUMAN_ACTION_REQUIRED"
        )
        resolution = ResolutionStatus.HUMAN_ACTION_REQUIRED

    evidence: list[dict[str, str]] = []
    if (coverage_quote or "").strip() and coverage is not CoverageStatus.UNKNOWN:
        evidence.append({"field": "coverage_status", "quote": coverage_quote.strip()})
    resolution_quote = extraction.get("resolution_evidence_quote")
    if (resolution_quote or "").strip():
        evidence.append(
            {"field": "resolution_status", "quote": resolution_quote.strip()}
        )
    if identifier.state is IdentifierState.CONFIRMED_IDENTIFIER:
        quote = extraction.get("authorization_reference_confirmation_quote") or ""
        evidence.append(
            {"field": "authorization_reference", "quote": quote.strip()}
        )

    business = BusinessResult(
        contract_version=CONTRACT_VERSION,
        coverage_status=coverage,
        resolution_status=resolution,
        authorization_reference=authorization_reference,
        replacement_eta=extraction.get("replacement_eta"),
        return_deadline=extraction.get("return_deadline"),
        required_documents=tuple(extraction.get("required_documents") or ()),
        next_action=extraction.get("next_action"),
        evidence=tuple(evidence),
        downgrades=tuple(downgrades),
    )

    if resolution in AUTHORIZING_RESOLUTIONS:
        terminal_state = TerminalState.BUSINESS_RESOLVED
    elif resolution in _ACTION_RESOLUTIONS:
        terminal_state = TerminalState.BUSINESS_ACTION_REQUIRED
    else:
        terminal_state = TerminalState.BUSINESS_UNRESOLVED

    return WorkflowOutcome(
        terminal_state=terminal_state,
        transport=transport,
        business=business,
        identifier=identifier,
    )
