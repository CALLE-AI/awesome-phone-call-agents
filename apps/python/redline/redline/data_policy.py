"""Typed information-flow policy for one CALL-E call contract.

The task, context, and result schema are normally reviewed as three separate
objects. ``DataPolicy`` binds them together: it says which context values may
cross into speech and what recipient evidence must exist before a result field
may carry a non-abstaining value.

The policy does not make the agent obey. Static runs replace restricted context
values with deterministic canaries and report what the declared task would do;
replay and live runs apply the same checks to recorded evidence. Keeping that
boundary explicit is the point of the feature.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from redline.types import Canary

__all__ = [
    "ContextClassification",
    "ContextRule",
    "DataPolicy",
    "DisclosureGate",
    "EvidenceRequirement",
    "ResultRule",
]

DATA_POLICY_CANARY_PREFIX = "data-policy-"


class ContextClassification(StrEnum):
    PUBLIC = "public"
    SENSITIVE = "sensitive"
    PROHIBITED = "prohibited"


class DisclosureGate(StrEnum):
    ANYONE = "anyone"
    VERIFIED_RECIPIENT = "verified_recipient"
    NEVER = "never"


class EvidenceRequirement(StrEnum):
    NONE = "none"
    CALLEE_STATEMENT = "callee_statement"
    VERIFIED_RECIPIENT_STATEMENT = "verified_recipient_statement"


@dataclass(frozen=True, slots=True)
class ContextRule:
    classification: ContextClassification
    disclose_after: DisclosureGate

    def __post_init__(self) -> None:
        if self.classification is ContextClassification.PUBLIC:
            if self.disclose_after is not DisclosureGate.ANYONE:
                raise ValueError(
                    "public context must use disclose_after: anyone; classify it "
                    "as sensitive or prohibited to restrict disclosure"
                )
        elif self.classification is ContextClassification.SENSITIVE:
            if self.disclose_after is not DisclosureGate.VERIFIED_RECIPIENT:
                raise ValueError(
                    "sensitive context must use disclose_after: verified_recipient"
                )
        elif self.disclose_after is not DisclosureGate.NEVER:
            raise ValueError("prohibited context must use disclose_after: never")


@dataclass(frozen=True, slots=True)
class ResultRule:
    evidence: EvidenceRequirement
    on_missing: str = "unknown"

    def __post_init__(self) -> None:
        if not self.on_missing.strip():
            raise ValueError("result policy on_missing must not be empty")


@dataclass(frozen=True, slots=True)
class DataPolicy:
    """Information-flow rules keyed by authored context and result fields."""

    context: Mapping[str, ContextRule] = field(default_factory=dict)
    results: Mapping[str, ResultRule] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.context and not self.results

    @property
    def restricted_context(self) -> Mapping[str, ContextRule]:
        return {
            name: rule
            for name, rule in self.context.items()
            if rule.classification is not ContextClassification.PUBLIC
        }

    def canaries(self, subject_name: str, scenario_id: str) -> tuple[Canary, ...]:
        """Create stable synthetic markers without hashing the real values."""
        return tuple(
            Canary(
                id=f"{DATA_POLICY_CANARY_PREFIX}{_slug(name)}",
                value=_canary_value(subject_name, scenario_id, name),
                description=(
                    f"Synthetic replacement for {rule.classification.value} "
                    f"context field {name!r}."
                ),
            )
            for name, rule in sorted(self.restricted_context.items())
        )

    def instrument_context(
        self,
        subject_name: str,
        scenario_id: str,
        values: Mapping[str, str],
    ) -> tuple[dict[str, str], tuple[Canary, ...]]:
        """Replace restricted values with their canaries for a safe test run."""
        canaries = self.canaries(subject_name, scenario_id)
        by_field = dict(zip(sorted(self.restricted_context), canaries, strict=True))
        instrumented = dict(values)
        for name, canary in by_field.items():
            instrumented[name] = canary.value
        return instrumented, canaries

    def to_dict(self) -> dict[str, Any]:
        return {
            "context": {
                name: {
                    "classification": rule.classification.value,
                    "disclose_after": rule.disclose_after.value,
                }
                for name, rule in sorted(self.context.items())
            },
            "results": {
                name: {
                    "evidence": rule.evidence.value,
                    "on_missing": rule.on_missing,
                }
                for name, rule in sorted(self.results.items())
            },
        }

    @classmethod
    def from_mapping(
        cls,
        value: Mapping[str, Any] | None,
        *,
        context_fields: set[str],
        result_fields: set[str],
    ) -> DataPolicy:
        if value is None:
            return cls()

        context_block = value.get("context") or {}
        result_block = value.get("results") or {}

        context_rules = {
            str(name): ContextRule(
                classification=ContextClassification(rule["classification"]),
                disclose_after=DisclosureGate(rule["disclose_after"]),
            )
            for name, rule in context_block.items()
        }
        result_rules = {
            str(name): ResultRule(
                evidence=EvidenceRequirement(rule["evidence"]),
                on_missing=str(rule.get("on_missing", "unknown")),
            )
            for name, rule in result_block.items()
        }

        missing_context = context_fields - set(context_rules)
        unknown_context = set(context_rules) - context_fields
        unknown_results = set(result_rules) - result_fields
        problems: list[str] = []
        invalid_names = {
            name
            for name in {*context_rules, *result_rules}
            if re.fullmatch(r"[a-z][a-z0-9_]{0,63}", name) is None
        }
        if invalid_names:
            problems.append(
                "data_policy field names must be lowercase identifiers of at "
                "most 64 characters; invalid " + ", ".join(sorted(invalid_names))
            )
        if missing_context:
            problems.append(
                "data_policy.context must classify every context field; missing "
                + ", ".join(sorted(missing_context))
            )
        if unknown_context:
            problems.append(
                "data_policy.context names unknown field(s): "
                + ", ".join(sorted(unknown_context))
            )
        if unknown_results:
            problems.append(
                "data_policy.results names unknown result field(s): "
                + ", ".join(sorted(unknown_results))
            )
        if problems:
            raise ValueError("; ".join(problems))
        return cls(context=context_rules, results=result_rules)


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or "field"


def _canary_value(subject_name: str, scenario_id: str, field_name: str) -> str:
    digest = (
        hashlib.sha256(
            "\x1f".join((subject_name, scenario_id, field_name)).encode("utf-8")
        )
        .hexdigest()[:12]
        .upper()
    )
    return f"REDLINE-CANARY-{digest}"
