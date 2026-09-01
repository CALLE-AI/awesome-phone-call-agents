"""WarrantyOps result contract v0.

Two schemas live here and they are deliberately not the same object.

``build_extraction_schema`` is what CALL-E is asked to fill in. It describes
only what a person on the call can say.

``BusinessResult`` is what this application is willing to assert. It is derived
from the extraction, never copied from it, and a field that was not established
on the call stays ``None`` or ``UNKNOWN``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

CONTRACT_VERSION = "warranty-recovery/v0"


class CoverageStatus(str, Enum):
    """Whether the counterparty stated the failure is covered."""

    COVERED = "COVERED"
    NOT_COVERED = "NOT_COVERED"
    UNKNOWN = "UNKNOWN"


class ResolutionStatus(str, Enum):
    """What the counterparty agreed to do next."""

    RMA_ISSUED = "RMA_ISSUED"
    REPLACEMENT_APPROVED = "REPLACEMENT_APPROVED"
    REPAIR_APPROVED = "REPAIR_APPROVED"
    DOCUMENTATION_REQUIRED = "DOCUMENTATION_REQUIRED"
    DIAGNOSTICS_REQUIRED = "DIAGNOSTICS_REQUIRED"
    HUMAN_ACTION_REQUIRED = "HUMAN_ACTION_REQUIRED"
    UNRESOLVED = "UNRESOLVED"


#: Resolutions that assert an authorization the operator will act on. Each one
#: is only allowed to survive when a high-consequence identifier reached the
#: CONFIRMED state. See :mod:`warrantyops.identifiers`.
AUTHORIZING_RESOLUTIONS = frozenset(
    {
        ResolutionStatus.RMA_ISSUED,
        ResolutionStatus.REPLACEMENT_APPROVED,
        ResolutionStatus.REPAIR_APPROVED,
    }
)

#: Every key the extraction schema may return. Anything else is a malformed
#: result, whatever the transport said.
EXTRACTION_FIELDS = (
    "coverage_status",
    "coverage_evidence_quote",
    "resolution_status",
    "resolution_evidence_quote",
    "authorization_reference_heard",
    "authorization_reference_readback_performed",
    "authorization_reference_confirmed",
    "authorization_reference_confirmation_quote",
    "replacement_eta",
    "return_deadline",
    "required_documents",
    "next_action",
)

REQUIRED_EXTRACTION_FIELDS = (
    "coverage_status",
    "resolution_status",
    "authorization_reference_readback_performed",
)


def build_extraction_schema() -> dict[str, Any]:
    """Return the JSON Schema handed to CALL-E as ``result_schema``.

    Written to the documented guidance for CALL-E structured results: a small
    schema, enum selection rules carried in ``description``, an explicit
    ``UNKNOWN`` member wherever the call may not contain enough evidence,
    ``additionalProperties: false``, and evidence fields beside every value
    this workflow would act on.
    """

    nullable_string = {"type": ["string", "null"]}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(REQUIRED_EXTRACTION_FIELDS),
        "properties": {
            "coverage_status": {
                "type": "string",
                "enum": [status.value for status in CoverageStatus],
                "description": (
                    "COVERED only when the representative stated the failure is "
                    "covered. NOT_COVERED only when they stated it is not. "
                    "UNKNOWN for anything hedged, conditional, deferred to a "
                    "record they could not see, or never discussed."
                ),
            },
            "coverage_evidence_quote": {
                **nullable_string,
                "description": (
                    "The representative's own words that establish "
                    "coverage_status, at most 200 characters. Null when they "
                    "said nothing that establishes it."
                ),
            },
            "resolution_status": {
                "type": "string",
                "enum": [status.value for status in ResolutionStatus],
                "description": (
                    "What the representative agreed to do. Use "
                    "DOCUMENTATION_REQUIRED when they asked for a document or "
                    "photograph, DIAGNOSTICS_REQUIRED when they asked for a "
                    "further test or reading, HUMAN_ACTION_REQUIRED when they "
                    "referred the matter onward, and UNRESOLVED when the call "
                    "ended without any of these."
                ),
            },
            "resolution_evidence_quote": {
                **nullable_string,
                "description": (
                    "The representative's own words that establish "
                    "resolution_status, at most 200 characters. Null when they "
                    "said nothing that establishes it."
                ),
            },
            "authorization_reference_heard": {
                **nullable_string,
                "description": (
                    "The authorization, RMA, claim or case reference exactly as "
                    "first heard, before any read-back. Null when none was "
                    "given."
                ),
            },
            "authorization_reference_readback_performed": {
                "type": "boolean",
                "description": (
                    "True only when the reference was read back to the "
                    "representative digit by digit and they responded to that "
                    "read-back. False when no read-back happened, including "
                    "when no reference was given."
                ),
            },
            "authorization_reference_confirmed": {
                **nullable_string,
                "description": (
                    "The reference as the representative confirmed it during "
                    "the read-back. When they corrected the read-back, this is "
                    "the corrected value. Null unless they explicitly confirmed "
                    "a value."
                ),
            },
            "authorization_reference_confirmation_quote": {
                **nullable_string,
                "description": (
                    "The representative's own words confirming or correcting "
                    "the read-back, at most 200 characters. Null when they did "
                    "not respond to a read-back."
                ),
            },
            "replacement_eta": {
                **nullable_string,
                "description": (
                    "Replacement or shipment timing exactly as stated. Null "
                    "when not stated. Do not compute a date from a duration."
                ),
            },
            "return_deadline": {
                **nullable_string,
                "description": (
                    "Deadline for returning the failed unit exactly as stated. "
                    "Null when not stated."
                ),
            },
            "required_documents": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Documents or photographs the representative asked for, one "
                    "per entry, in their words. Empty array when none were "
                    "asked for."
                ),
            },
            "next_action": {
                **nullable_string,
                "description": (
                    "The single next step the representative asked for, in one "
                    "sentence. Null when they asked for nothing."
                ),
            },
        },
    }


@dataclass(frozen=True)
class BusinessResult:
    """What the application is willing to assert after a call.

    ``authorization_reference`` is populated only from a CONFIRMED identifier.
    Every other unknown stays ``None`` or ``UNKNOWN``.
    """

    contract_version: str
    coverage_status: CoverageStatus
    resolution_status: ResolutionStatus
    authorization_reference: str | None = None
    replacement_eta: str | None = None
    return_deadline: str | None = None
    required_documents: tuple[str, ...] = ()
    next_action: str | None = None
    evidence: tuple[dict[str, str], ...] = ()
    downgrades: tuple[str, ...] = field(default=())

    def to_dict(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "coverage_status": self.coverage_status.value,
            "resolution_status": self.resolution_status.value,
            "authorization_reference": self.authorization_reference,
            "replacement_eta": self.replacement_eta,
            "return_deadline": self.return_deadline,
            "required_documents": list(self.required_documents),
            "next_action": self.next_action,
            "evidence": [dict(item) for item in self.evidence],
            "downgrades": list(self.downgrades),
        }


def unresolved_result(reason: str) -> BusinessResult:
    """The only result a call that produced no business evidence may become."""

    return BusinessResult(
        contract_version=CONTRACT_VERSION,
        coverage_status=CoverageStatus.UNKNOWN,
        resolution_status=ResolutionStatus.UNRESOLVED,
        downgrades=(reason,),
    )
