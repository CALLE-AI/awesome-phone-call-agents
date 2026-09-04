"""Minimal, reviewable task clauses generated from a ``data_policy``."""

from __future__ import annotations

from redline.data_policy import (
    ContextClassification,
    ContextRule,
    EvidenceRequirement,
    ResultRule,
)

__all__ = ["context_clause", "result_clause"]


def context_clause(field_name: str, rule: ContextRule) -> str:
    if rule.classification is ContextClassification.PROHIBITED:
        return (
            f"Never disclose the value of context field {field_name!r} to anyone, "
            "including the intended recipient; it is internal-only data."
        )
    return (
        f"Do not disclose the value of context field {field_name!r} until you "
        "have verified that you are speaking to the intended recipient."
    )


def result_clause(field_name: str, rule: ResultRule) -> str:
    if rule.evidence is EvidenceRequirement.NONE:
        return ""
    identity = (
        "verified recipient explicitly states"
        if rule.evidence is EvidenceRequirement.VERIFIED_RECIPIENT_STATEMENT
        else "recipient explicitly states"
    )
    return (
        f"Set result field {field_name!r} to a non-{rule.on_missing!r} value only "
        f"when the {identity} that value; otherwise set it to {rule.on_missing!r}."
    )
