"""The four payer workflows: what to ask, and the closed schema the answer must fit.

Every schema here is closed (``additionalProperties: false``) and every property
is required. Every field accepts the literal string ``unknown``. That pairing is
the fail-closed rule: the agent is never forced to invent a value to satisfy the
schema, and a field it did not actually hear comes back as ``unknown`` rather
than as a plausible guess.

``evidence_quote`` carries the representative's own words for that claim. It is
the anchor for the groundedness check in ``verify.py``: a quote that cannot be
found in the transcript invalidates the fields it was supposed to support.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from . import policy

CALL_OUTCOMES: Tuple[str, ...] = (
    "answered",
    "partial",
    "not_on_file",
    "rep_refused",
    "ivr_dead_end",
    "hold_timeout",
    "unreached",
    "unknown",
)


def _string(description: str) -> Dict[str, Any]:
    return {"type": "string", "description": description + ' Use "unknown" if not clearly stated.'}


def _enum(values: Tuple[str, ...], description: str) -> Dict[str, Any]:
    return {"type": "string", "enum": list(values), "description": description}


def _closed(properties: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": sorted(properties),
        "properties": properties,
    }


CLAIM_KEY = {"claim_number": _string("The claim number this answer belongs to, repeated back exactly.")}
EVIDENCE = {
    "evidence_quote": _string(
        "The representative's own words that support this answer, quoted verbatim from the call."
    )
}


def _per_claim(properties: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    merged.update(CLAIM_KEY)
    merged.update(properties)
    merged.update(EVIDENCE)
    return _closed(merged)


CLAIM_STATUS_ITEM = _per_claim({
    "claim_status": _enum(
        ("paid", "denied", "pending", "in_process", "rejected", "not_on_file", "unknown"),
        "The plan's processing status for this claim.",
    ),
    "paid_amount": _string("Amount the plan paid, as spoken, including currency if stated."),
    "allowed_amount": _string("Allowed amount for the claim."),
    "patient_responsibility": _string("Amount that is the patient's responsibility."),
    "check_number": _string("Check or EFT trace number for the payment."),
    "paid_date": _string("Date the payment was issued, as YYYY-MM-DD if stated."),
})

DENIAL_REASON_ITEM = _per_claim({
    "carc_code": _string("Claim Adjustment Reason Code, for example CO-97."),
    "rarc_code": _string("Remittance Advice Remark Code, for example N130."),
    "denial_reason_text": _string("The denial reason in the representative's words."),
    "appealable": _enum(("yes", "no", "unknown"), "Whether the plan says this denial can be appealed."),
    "appeal_deadline": _string("Last date an appeal may be filed, as YYYY-MM-DD if stated."),
    "appeal_method": _string("Where and how an appeal must be sent."),
    "corrected_claim_accepted": _enum(
        ("yes", "no", "unknown"), "Whether a corrected claim is accepted instead of an appeal."
    ),
})

PRIOR_AUTH_ITEM = _per_claim({
    "auth_status": _enum(
        ("approved", "denied", "pending", "not_found", "unknown"),
        "Status of the prior authorization request.",
    ),
    "auth_number": _string("Authorization number issued by the plan."),
    "effective_date": _string("First date the authorization is valid, as YYYY-MM-DD if stated."),
    "expiration_date": _string("Last date the authorization is valid, as YYYY-MM-DD if stated."),
    "units_approved": _string("Number of visits or units approved."),
    "missing_information": _string("What the plan still needs before it can decide."),
})

ELIGIBILITY_ITEM = _per_claim({
    "coverage_active": _enum(
        ("active", "inactive", "terminated", "unknown"),
        "Whether coverage was active on the date of service.",
    ),
    "plan_name": _string("Name of the plan or product."),
    "group_number": _string("Group number for the member's plan."),
    "deductible_total": _string("Total individual deductible for the benefit year."),
    "deductible_met": _string("Deductible met so far this benefit year."),
    "copay": _string("Copay that applies to this service."),
    "coinsurance": _string("Coinsurance percentage that applies to this service."),
    "out_of_pocket_max": _string("Individual out-of-pocket maximum."),
    "out_of_pocket_met": _string("Out-of-pocket amount met so far."),
    "prior_auth_required": _enum(
        ("yes", "no", "unknown"), "Whether the plan requires prior authorization for this service."
    ),
})


def result_schema(item_schema: Dict[str, Any]) -> Dict[str, Any]:
    return _closed({
        "call_outcome": _enum(CALL_OUTCOMES, "How the call ended overall."),
        "reference_number": _string("The plan's reference number for this call."),
        "representative_name": _string("First name of the representative who answered."),
        "claims": {
            "type": "array",
            "description": "One entry per claim discussed, in the order they were raised.",
            "items": item_schema,
        },
    })


class Workflow:
    """One payer question, its schema, and what counts as a complete answer.

    Completeness is status-aware on purpose. A denied claim has no allowed
    amount, and a pending authorization has no authorization number; reporting
    those as ``unknown`` is the correct answer, not a half answer. ``core_fields``
    are always required, and ``conditional_fields`` adds the extra fields that
    only become meaningful once a status is known.
    """

    def __init__(
        self,
        name: str,
        title: str,
        purpose: str,
        ask: List[str],
        item_schema: Dict[str, Any],
        core_fields: Tuple[str, ...],
        conditional_fields: Optional[Dict[str, Dict[str, Tuple[str, ...]]]] = None,
    ) -> None:
        self.name = name
        self.title = title
        self.purpose = purpose
        self.ask = ask
        self.item_schema = item_schema
        self.core_fields = core_fields
        self.conditional_fields = conditional_fields or {}

    @property
    def substantive_fields(self) -> Tuple[str, ...]:
        """Every field that carries an answer, blanked when evidence is ungrounded."""
        return tuple(
            name for name in self.item_schema["required"]
            if name not in ("claim_number", "evidence_quote")
        )

    def required_for(self, entry: Dict[str, Any]) -> Tuple[str, ...]:
        required = list(self.core_fields)
        for driver, mapping in self.conditional_fields.items():
            value = str(entry.get(driver, ""))
            required.extend(mapping.get(value, ()))
        return tuple(dict.fromkeys(required))

    def is_complete(self, entry: Dict[str, Any]) -> bool:
        return all(str(entry.get(name, "unknown")) != "unknown" for name in self.required_for(entry))

    @property
    def envelope(self) -> Tuple[str, ...]:
        return policy.DISCLOSURE_ENVELOPES[self.name]

    @property
    def schema(self) -> Dict[str, Any]:
        return result_schema(self.item_schema)


WORKFLOWS: Dict[str, Workflow] = {
    "claim_status": Workflow(
        name="claim_status",
        title="Claim status inquiry",
        purpose="Find out what the plan did with a submitted claim.",
        ask=[
            "the current processing status of the claim",
            "the paid amount, allowed amount, and patient responsibility",
            "the check or EFT trace number and the date payment was issued",
        ],
        item_schema=CLAIM_STATUS_ITEM,
        core_fields=("claim_status",),
        conditional_fields={"claim_status": {"paid": ("paid_amount", "paid_date")}},
    ),
    "denial_reason": Workflow(
        name="denial_reason",
        title="Denial reason extraction",
        purpose="Find out exactly why a claim was denied and what the plan will accept next.",
        ask=[
            "the claim adjustment reason code and any remark code",
            "the denial reason in plain words",
            "whether the denial can be appealed, by when, and where the appeal must be sent",
            "whether a corrected claim is accepted instead of an appeal",
        ],
        item_schema=DENIAL_REASON_ITEM,
        core_fields=("carc_code", "denial_reason_text", "appealable"),
        conditional_fields={"appealable": {"yes": ("appeal_deadline", "appeal_method")}},
    ),
    "prior_auth_status": Workflow(
        name="prior_auth_status",
        title="Prior authorization status",
        purpose="Find out where an authorization request stands and what is still missing.",
        ask=[
            "the status of the authorization request",
            "the authorization number and the dates it covers",
            "how many visits or units were approved",
            "what information the plan is still waiting for",
        ],
        item_schema=PRIOR_AUTH_ITEM,
        core_fields=("auth_status",),
        conditional_fields={
            "auth_status": {
                "approved": ("auth_number", "effective_date"),
                "pending": ("missing_information",),
            }
        },
    ),
    "eligibility": Workflow(
        name="eligibility",
        title="Eligibility and benefits verification",
        purpose="Confirm coverage and cost sharing for a date of service.",
        ask=[
            "whether coverage was active on the date of service",
            "the plan name and group number",
            "the deductible, how much is met, the copay, and the coinsurance",
            "the out-of-pocket maximum and how much is met",
            "whether prior authorization is required for this service",
        ],
        item_schema=ELIGIBILITY_ITEM,
        core_fields=("coverage_active",),
        conditional_fields={
            "coverage_active": {
                "active": ("plan_name", "deductible_total", "copay", "prior_auth_required")
            }
        },
    ),
}


def get(name: str) -> Workflow:
    try:
        return WORKFLOWS[name]
    except KeyError:
        raise KeyError(
            "unknown workflow %r; available: %s" % (name, ", ".join(sorted(WORKFLOWS)))
        ) from None


def names() -> List[str]:
    return sorted(WORKFLOWS)
