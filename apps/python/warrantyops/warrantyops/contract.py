"""WarrantyOps result contract v1: the counterparty-stated exception answer.

Two schemas live here and they are deliberately not the same object.

``build_extraction_schema`` is what CALL-E is asked to fill in. It describes
only what a person on the call can say, and it never asks the model to decide
anything: no value, no probability, no recovery estimate.

``ClaimResult`` is what this application is willing to assert. It is derived
from the extraction under transcript grounding, never copied from it, and a
field that was not established on the call stays ``None`` or ``UNKNOWN``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

#: v1 is the residual post-submission claim-exception contract. v0 was the
#: former coverage/RMA hero; results under the two contracts are not
#: comparable and the old test suite proves nothing about this one.
CONTRACT_VERSION = "warranty-claim-exception/v1"


class ClaimStatus(str, Enum):
    """Where the counterparty says the claim stands, in their words.

    This is the counterparty's statement about their own system, not an
    adjudication of the claim and not a copy of the source record's status.
    """

    STATED_REJECTED = "STATED_REJECTED"
    STATED_RETURNED = "STATED_RETURNED"
    STATED_IN_PROCESS = "STATED_IN_PROCESS"
    STATED_PAID = "STATED_PAID"
    UNKNOWN = "UNKNOWN"


class ReferenceKind(str, Enum):
    """What kind of reference the counterparty gave, if any."""

    CLAIM = "CLAIM"
    CASE = "CASE"
    CREDIT = "CREDIT"
    UNKNOWN = "UNKNOWN"


#: Every key the extraction schema may return. Anything else is a malformed
#: result, whatever the transport said.
EXTRACTION_FIELDS = (
    "claim_status",
    "claim_status_evidence_quote",
    "stated_reason",
    "required_correction",
    "required_documents",
    "stated_deadline",
    "escalation_path",
    "stated_next_action",
    "reference_kind",
    "reference_heard",
    "reference_readback_performed",
    "reference_confirmed",
    "reference_confirmation_quote",
)

REQUIRED_EXTRACTION_FIELDS = (
    "claim_status",
    "reference_kind",
    "reference_readback_performed",
)

#: Free-text fields whose values must be traceable to a counterparty turn
#: before this application will assert them. See :mod:`warrantyops.evidence`.
STATED_TEXT_FIELDS = (
    "stated_reason",
    "required_correction",
    "stated_deadline",
    "escalation_path",
    "stated_next_action",
)


def build_extraction_schema() -> dict[str, Any]:
    """Return the JSON Schema handed to CALL-E as ``result_schema``.

    Written to the documented guidance for CALL-E structured results: a small
    schema, enum selection rules carried in ``description``, an explicit
    ``UNKNOWN`` member wherever the call may not contain enough evidence,
    ``additionalProperties: false``, and an evidence quote beside the one enum
    this workflow would act on first.

    It uses only the schema features CALL-E documents as supported: ``type``
    with a single value, ``properties``, ``required``, ``enum``, simple
    ``array.items``, ``description`` and ``additionalProperties: false``.

    "Not stated" is expressed by omitting the field, because a type array
    including ``null`` is not a documented CALL-E feature. "Stated but not
    established" — hedged, deferred, contradicted — is the ``UNKNOWN`` enum
    member. "Malformed" is a local validation failure. The three states stay
    distinguishable end to end.
    """

    optional_string = {"type": "string"}
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(REQUIRED_EXTRACTION_FIELDS),
        "properties": {
            "claim_status": {
                "type": "string",
                "enum": [status.value for status in ClaimStatus],
                "description": (
                    "What the representative says the current status of this "
                    "claim is in their system. Use UNKNOWN for anything "
                    "hedged, deferred to a record they could not see, or never "
                    "discussed. This is their statement, not your judgement of "
                    "the claim."
                ),
            },
            "claim_status_evidence_quote": {
                **optional_string,
                "description": (
                    "The representative's own words that establish "
                    "claim_status, at most 200 characters. Omit this field "
                    "when they said nothing that establishes it."
                ),
            },
            "stated_reason": {
                **optional_string,
                "description": (
                    "The reason they gave for the claim being held, rejected, "
                    "returned or unpaid, as close to their own words as "
                    "possible. Omit this field when they gave no reason."
                ),
            },
            "required_correction": {
                **optional_string,
                "description": (
                    "The correction they asked for, in one sentence of their "
                    "words. Omit this field when they asked for no correction."
                ),
            },
            "required_documents": {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "Documents or photographs they asked for, one per entry, "
                    "in their words. Empty array when none were asked for."
                ),
            },
            "stated_deadline": {
                **optional_string,
                "description": (
                    "Any deadline they stated, exactly as stated. Omit this "
                    "field when none was stated. Do not compute a date from a "
                    "duration."
                ),
            },
            "escalation_path": {
                **optional_string,
                "description": (
                    "Where they said this should be escalated or directed, in "
                    "their words. Omit this field when they gave no path."
                ),
            },
            "stated_next_action": {
                **optional_string,
                "description": (
                    "The single next step they asked for, in one sentence. "
                    "Omit this field when they asked for nothing."
                ),
            },
            "reference_kind": {
                "type": "string",
                "enum": [kind.value for kind in ReferenceKind],
                "description": (
                    "What kind of reference they gave: CLAIM, CASE or CREDIT. "
                    "UNKNOWN when they gave none or it was not clear."
                ),
            },
            "reference_heard": {
                **optional_string,
                "description": (
                    "The claim, case or credit reference exactly as first "
                    "heard, before any read-back. Omit this field when none "
                    "was given."
                ),
            },
            "reference_readback_performed": {
                "type": "boolean",
                "description": (
                    "True only when the reference was read back to the "
                    "representative digit by digit and they responded to that "
                    "read-back. False when no read-back happened, including "
                    "when no reference was given."
                ),
            },
            "reference_confirmed": {
                **optional_string,
                "description": (
                    "The reference as the representative confirmed it during "
                    "the read-back. When they corrected the read-back, this is "
                    "the corrected value. Omit this field unless they "
                    "explicitly confirmed a value."
                ),
            },
            "reference_confirmation_quote": {
                **optional_string,
                "description": (
                    "The representative's own words confirming or correcting "
                    "the read-back, at most 200 characters. Omit this field "
                    "when they did not respond to a read-back."
                ),
            },
        },
    }


@dataclass(frozen=True)
class ConfirmedReference:
    """A reference this application is willing to assert.

    Populated only from an identifier that reached ``CONFIRMED_IDENTIFIER``
    through its own read-back exchange. See :mod:`warrantyops.identifiers`.
    """

    value: str
    kind: ReferenceKind
    corrected: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "value": self.value,
            "kind": self.kind.value,
            "corrected": self.corrected,
        }


@dataclass(frozen=True)
class ClaimResult:
    """What the application is willing to assert after a call.

    Every field is counterparty-stated or it is empty. Missing, ambiguous and
    not-stated remain distinguishable: omitted by the extractor means not
    stated, ``UNKNOWN`` means stated but not established, and a value that
    failed grounding is dropped with a note in ``downgrades``.
    """

    contract_version: str
    claim_status: ClaimStatus
    stated_reason: str | None = None
    required_correction: str | None = None
    required_documents: tuple[str, ...] = ()
    stated_deadline: str | None = None
    escalation_path: str | None = None
    stated_next_action: str | None = None
    confirmed_reference: ConfirmedReference | None = None
    evidence: tuple[dict[str, str], ...] = ()
    downgrades: tuple[str, ...] = field(default=())

    def to_dict(self) -> dict[str, Any]:
        return {
            "contract_version": self.contract_version,
            "claim_status": self.claim_status.value,
            "stated_reason": self.stated_reason,
            "required_correction": self.required_correction,
            "required_documents": list(self.required_documents),
            "stated_deadline": self.stated_deadline,
            "escalation_path": self.escalation_path,
            "stated_next_action": self.stated_next_action,
            "confirmed_reference": (
                self.confirmed_reference.to_dict()
                if self.confirmed_reference
                else None
            ),
            "evidence": [dict(item) for item in self.evidence],
            "downgrades": list(self.downgrades),
        }


def unresolved_result(reason: str) -> ClaimResult:
    """The only result a call that produced no business evidence may become."""

    return ClaimResult(
        contract_version=CONTRACT_VERSION,
        claim_status=ClaimStatus.UNKNOWN,
        downgrades=(reason,),
    )
