"""Check the answer before it is believed.

Two independent checks run on every terminal call, and neither of them trusts
the model that produced the result:

1. **Schema.** The returned object is validated locally against the closed
   workflow schema. Extra fields, missing fields, wrong types, and values
   outside an enum all fail here, whether or not the provider enforced them.

2. **Groundedness.** Each claim entry carries ``evidence_quote``, the
   representative's own words. If that quote cannot be found in the transcript
   of the call, the substantive fields it was supposed to support are reset to
   ``unknown`` and the claim is routed to a human.

The second check is the one that matters for billing. A denial code that no
representative actually said is worse than no answer at all, because a biller
will act on it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from . import workflows
from .models import (
    OUTCOME_ANSWERED,
    OUTCOME_HOLD_TIMEOUT,
    OUTCOME_IVR_DEAD_END,
    OUTCOME_NOT_ON_FILE,
    OUTCOME_PARTIAL,
    OUTCOME_REP_REFUSED,
    OUTCOME_UNREACHED,
    OUTCOME_UNUSABLE,
    UNKNOWN,
    Claim,
)

# Fewer words than this is not a quote, it is a coincidence.
MIN_GROUNDING_TOKENS = 6
_PUNCT_RE = re.compile(r"[^a-z0-9\s]+")
_WS_RE = re.compile(r"\s+")


class SchemaError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Minimal validator for the closed schemas in workflows.py.
# ---------------------------------------------------------------------------

def validate_against_schema(value: Any, schema: Dict[str, Any], path: str = "$") -> None:
    kind = schema.get("type")
    if kind == "object":
        if not isinstance(value, dict):
            raise SchemaError("%s must be an object" % path)
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            if extra:
                raise SchemaError("%s has fields outside the schema: %s" % (path, ", ".join(extra)))
        missing = sorted(set(schema.get("required", [])) - set(value))
        if missing:
            raise SchemaError("%s is missing required fields: %s" % (path, ", ".join(missing)))
        for name, subschema in properties.items():
            if name in value:
                validate_against_schema(value[name], subschema, "%s.%s" % (path, name))
        return
    if kind == "array":
        if not isinstance(value, list):
            raise SchemaError("%s must be an array" % path)
        item_schema = schema.get("items")
        if item_schema:
            for index, item in enumerate(value):
                validate_against_schema(item, item_schema, "%s[%d]" % (path, index))
        return
    if kind == "string":
        if not isinstance(value, str):
            raise SchemaError("%s must be a string" % path)
        allowed = schema.get("enum")
        if allowed is not None and value not in allowed:
            raise SchemaError("%s is %r, which is not one of: %s" % (path, value, ", ".join(allowed)))
        return
    if kind == "integer":
        if not isinstance(value, int) or isinstance(value, bool):
            raise SchemaError("%s must be an integer" % path)
        return
    raise SchemaError("%s has an unsupported schema type %r" % (path, kind))


# ---------------------------------------------------------------------------
# Groundedness
# ---------------------------------------------------------------------------

def normalize(text: str) -> str:
    lowered = str(text or "").lower()
    return _WS_RE.sub(" ", _PUNCT_RE.sub(" ", lowered)).strip()


def transcript_text(turns: Sequence[Dict[str, Any]]) -> str:
    return " ".join(str(turn.get("text", "")) for turn in turns)


def is_grounded(quote: str, transcript: str) -> bool:
    """Is this quote actually somewhere in what was said?

    A quote shorter than ``MIN_GROUNDING_TOKENS`` words is refused outright,
    however well it matches. A single common word like "paid" appears in almost
    any billing call, so accepting it as evidence would ground a field on
    nothing. Refusing it costs a trip through human review, which is the
    direction this product errs in.

    Above that length, an exact normalized match is the common case, and a run of
    consecutive tokens is the fallback, so a quote that drops a filler word or
    tidies punctuation still counts while an invented sentence does not.
    """
    needle = normalize(quote)
    haystack = normalize(transcript)
    if not needle or not haystack:
        return False
    tokens = needle.split()
    if len(tokens) < MIN_GROUNDING_TOKENS:
        return False
    if needle in haystack:
        return True
    for start in range(len(tokens) - MIN_GROUNDING_TOKENS + 1):
        if " ".join(tokens[start:start + MIN_GROUNDING_TOKENS]) in haystack:
            return True
    return False


def normalize_claim_number(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------

@dataclass
class VerifiedResult:
    outcome: str
    reference_number: str = UNKNOWN
    representative_name: str = UNKNOWN
    per_claim: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    findings: List[str] = field(default_factory=list)
    grounded_claims: int = 0
    ungrounded_claims: int = 0

    @property
    def usable(self) -> bool:
        return self.outcome in (OUTCOME_ANSWERED, OUTCOME_PARTIAL, OUTCOME_NOT_ON_FILE)


_REPORTED_OUTCOME_MAP = {
    "answered": OUTCOME_ANSWERED,
    "partial": OUTCOME_PARTIAL,
    "not_on_file": OUTCOME_NOT_ON_FILE,
    "rep_refused": OUTCOME_REP_REFUSED,
    "ivr_dead_end": OUTCOME_IVR_DEAD_END,
    "hold_timeout": OUTCOME_HOLD_TIMEOUT,
    "unreached": OUTCOME_UNREACHED,
    "unknown": OUTCOME_UNUSABLE,
}


def structured_result(payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Task-level result first, then the single recipient's result."""
    result = payload.get("structured_result")
    if isinstance(result, dict) and result:
        return result
    for recipient in payload.get("recipients") or []:
        candidate = recipient.get("structured_result")
        if isinstance(candidate, dict) and candidate:
            return candidate
    return None


def verify(
    payload: Dict[str, Any],
    workflow_name: str,
    claims: Sequence[Claim],
    turns: Sequence[Dict[str, Any]],
) -> VerifiedResult:
    workflow = workflows.get(workflow_name)
    findings: List[str] = []

    status = str(payload.get("status", "")).lower()
    if status in ("failed", "canceled", "cancelled"):
        return VerifiedResult(
            outcome=OUTCOME_UNREACHED,
            findings=["CALL-E reported the call as %s: %s" % (status, payload.get("failure_message") or "no detail")],
        )

    result = structured_result(payload)
    if result is None:
        return VerifiedResult(outcome=OUTCOME_UNUSABLE, findings=["the call returned no structured result"])

    try:
        validate_against_schema(result, workflow.schema)
    except SchemaError as error:
        return VerifiedResult(outcome=OUTCOME_UNUSABLE, findings=["schema check failed: %s" % error])

    reported = _REPORTED_OUTCOME_MAP.get(str(result.get("call_outcome", "")), OUTCOME_UNUSABLE)
    if reported in (OUTCOME_UNREACHED, OUTCOME_HOLD_TIMEOUT, OUTCOME_IVR_DEAD_END, OUTCOME_REP_REFUSED):
        return VerifiedResult(
            outcome=reported,
            reference_number=str(result.get("reference_number") or UNKNOWN),
            representative_name=str(result.get("representative_name") or UNKNOWN),
            findings=["the agent reported call_outcome %s; nothing was recorded" % reported],
        )

    spoken = transcript_text(turns)
    by_number = {}
    for entry in result.get("claims", []):
        by_number[normalize_claim_number(entry.get("claim_number", ""))] = entry

    per_claim: Dict[str, Dict[str, Any]] = {}
    grounded_count = 0
    ungrounded_count = 0

    for claim in claims:
        entry = by_number.get(normalize_claim_number(claim.claim_number))
        if entry is None:
            findings.append("claim %s was not answered on the call" % claim.claim_number)
            per_claim[claim.id] = _blank_entry(workflow, claim.claim_number, "not answered on the call")
            ungrounded_count += 1
            continue

        fields_out = dict(entry)
        quote = str(entry.get("evidence_quote", ""))
        grounded = is_grounded(quote, spoken)

        if grounded:
            grounded_count += 1
        else:
            ungrounded_count += 1
            findings.append(
                "claim %s: the quoted evidence does not appear in the transcript, so its answers "
                "were reset to unknown" % claim.claim_number
            )
            for name in workflow.substantive_fields:
                fields_out[name] = UNKNOWN
            fields_out["evidence_quote"] = UNKNOWN

        fields_out["_grounded"] = grounded
        per_claim[claim.id] = fields_out

    outcome = _outcome_for(workflow, per_claim, reported)

    return VerifiedResult(
        outcome=outcome,
        reference_number=str(result.get("reference_number") or UNKNOWN),
        representative_name=str(result.get("representative_name") or UNKNOWN),
        per_claim=per_claim,
        findings=findings,
        grounded_claims=grounded_count,
        ungrounded_claims=ungrounded_count,
    )


def _blank_entry(workflow: workflows.Workflow, claim_number: str, note: str) -> Dict[str, Any]:
    entry: Dict[str, Any] = {"claim_number": claim_number, "evidence_quote": UNKNOWN}
    for name in workflow.item_schema["required"]:
        entry.setdefault(name, UNKNOWN)
    entry["_grounded"] = False
    entry["_note"] = note
    return entry


def _outcome_for(
    workflow: workflows.Workflow,
    per_claim: Dict[str, Dict[str, Any]],
    reported: str,
) -> str:
    if not per_claim:
        return OUTCOME_UNUSABLE
    if reported == OUTCOME_NOT_ON_FILE:
        return OUTCOME_NOT_ON_FILE
    complete = 0
    for entry in per_claim.values():
        if entry.get("_grounded") and workflow.is_complete(entry):
            complete += 1
    if complete == len(per_claim):
        return OUTCOME_ANSWERED
    if complete or any(entry.get("_grounded") for entry in per_claim.values()):
        return OUTCOME_PARTIAL
    return OUTCOME_UNUSABLE
