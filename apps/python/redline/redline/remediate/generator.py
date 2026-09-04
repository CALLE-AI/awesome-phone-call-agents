"""Turn findings into a patch the user can apply.

This is the half of REDLINE that makes it worth running twice. A scanner tells
you that you have a problem; this tells you what to write, and
:mod:`redline.verify` then checks the rewritten contract against the same suite.

Two rules govern what gets generated:

* **Only fix what was actually probed.** A patch proposes a defence when a
  scenario attacked it and the goal did not state it. Adding every clause in
  the catalogue to every goal would be free to implement, useless to read, and
  would make the verification meaningless -- of course the attacks stop when
  you paste in the answer key.
* **Never propose something the API would reject.** Schema patches are
  validated through :mod:`redline.calle.schema_profile` before they are
  offered. A fix that cannot be submitted is not a fix.

The generated goal keeps the author's original text untouched and appends a
clearly delimited block. Nobody wants a tool rewriting their prose, and a
reviewer needs to see what changed.
"""

from __future__ import annotations

import difflib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from redline.calle.schema_profile import (
    UNKNOWN_MEMBERS,
    validate_result_schema,
)
from redline.data_policy import ContextClassification
from redline.evaluate.engine import RunReport
from redline.policy import Defence
from redline.remediate.clauses import clause_for, rationale_for
from redline.remediate.data_policy import context_clause, result_clause
from redline.subject import HARDENING_HEADER, SubjectUnderTest

__all__ = ["HARDENING_HEADER", "Patch", "Remedy", "RemedyKind", "generate_patch"]


class RemedyKind(StrEnum):
    GOAL = "goal"
    SCHEMA = "schema"
    DATA_POLICY = "data_policy"


@dataclass(frozen=True, slots=True)
class Remedy:
    """One change, and the argument for it."""

    kind: RemedyKind
    summary: str
    rationale: str
    defence: Defence | None = None
    clause: str = ""
    closes: tuple[str, ...] = ()
    """Scenario ids this change is expected to close."""


@dataclass(frozen=True, slots=True)
class Patch:
    """A proposed rewrite of the subject, with its justification."""

    before: SubjectUnderTest
    after: SubjectUnderTest
    remedies: tuple[Remedy, ...] = ()

    @property
    def is_empty(self) -> bool:
        return not self.remedies

    @property
    def goal_changed(self) -> bool:
        return self.before.goal != self.after.goal

    @property
    def schema_changed(self) -> bool:
        return self.before.result_schema != self.after.result_schema

    @property
    def defences_added(self) -> frozenset[Defence]:
        """Defences the rewritten goal states and the original did not.

        Computed by re-reading the patched goal rather than trusting the list
        of clauses applied. If a clause failed to register, this is empty and
        the patch says so instead of promising a change it did not make.
        """
        return self.after.defences - self.before.defences

    def goal_diff(self) -> str:
        """A unified diff of the goal, for a reviewer or a commit message."""
        return "\n".join(
            difflib.unified_diff(
                self.before.goal.splitlines(),
                self.after.goal.splitlines(),
                fromfile="goal (current)",
                tofile="goal (hardened)",
                lineterm="",
            )
        )

    def closes(self) -> frozenset[str]:
        return frozenset(
            scenario_id for remedy in self.remedies for scenario_id in remedy.closes
        )


def generate_patch(report: RunReport, subject: SubjectUnderTest) -> Patch:
    """Propose a rewrite that addresses what this run found."""
    remedies: list[Remedy] = []

    goal = subject.goal
    for defence in _defences_to_add(report, subject):
        remedies.append(
            Remedy(
                kind=RemedyKind.GOAL,
                summary=_summary_for(defence),
                rationale=rationale_for(defence),
                defence=defence,
                clause=clause_for(defence),
                closes=_scenarios_needing(report, defence),
            )
        )
    policy_remedies = _data_policy_remedies(subject, goal)
    if policy_remedies:
        remedies.extend(policy_remedies)

    if remedies:
        goal = _append_clauses(goal, [remedy.clause for remedy in remedies])

    patched = subject.with_goal(goal)

    schema_remedy, patched_schema = _patch_schema(subject.result_schema)
    if schema_remedy is not None:
        remedies.append(schema_remedy)
        patched = patched.with_result_schema(patched_schema)

    return Patch(before=subject, after=patched, remedies=tuple(remedies))


def _data_policy_remedies(subject: SubjectUnderTest, goal: str) -> tuple[Remedy, ...]:
    remedies: list[Remedy] = []
    for field_name, context_rule_value in sorted(subject.data_policy.context.items()):
        if context_rule_value.classification is ContextClassification.PUBLIC:
            continue
        clause = context_clause(field_name, context_rule_value)
        if clause in goal:
            continue
        remedies.append(
            Remedy(
                kind=RemedyKind.DATA_POLICY,
                summary=f"enforce the disclosure gate for {field_name!r}",
                rationale=(
                    "The data policy restricts this context field, but the CALL-E "
                    "task does not yet state that restriction."
                ),
                clause=clause,
            )
        )

    for field_name, result_rule_value in sorted(subject.data_policy.results.items()):
        clause = result_clause(field_name, result_rule_value)
        if not clause or clause in goal:
            continue
        remedies.append(
            Remedy(
                kind=RemedyKind.DATA_POLICY,
                summary=f"bind result field {field_name!r} to spoken evidence",
                rationale=(
                    "The data policy requires recipient evidence before this "
                    "structured result may assert a value."
                ),
                clause=clause,
            )
        )
    return tuple(remedies)


# --- Goal --------------------------------------------------------------------


def _defences_to_add(
    report: RunReport, subject: SubjectUnderTest
) -> tuple[Defence, ...]:
    """Defences that were probed, are missing, and would change something.

    Ordered by :class:`~redline.policy.Defence` declaration order so that two
    runs of the same suite produce the same patch, byte for byte.
    """
    missing = report.missing_defences - subject.defences
    return tuple(defence for defence in Defence if defence in missing)


def _summary_for(defence: Defence) -> str:
    label = defence.value.replace("_", " ")
    article = "an" if label[0] in "aeiou" else "a"
    return f"state {article} {label} rule"


def _scenarios_needing(report: RunReport, defence: Defence) -> tuple[str, ...]:
    return tuple(
        sorted(
            result.scenario.id
            for result in report.results
            if defence in result.missing_defences
        )
    )


def _append_clauses(goal: str, clauses: Sequence[str]) -> str:
    """Append a delimited block, leaving the author's own text alone."""
    body = "\n".join(f"- {clause}" for clause in clauses)
    separator = "\n\n" if goal.strip() else ""
    return f"{goal.rstrip()}{separator}{HARDENING_HEADER}\n{body}"


# --- Schema -------------------------------------------------------------------


def _patch_schema(
    schema: Mapping[str, Any] | None,
) -> tuple[Remedy | None, Mapping[str, Any] | None]:
    """Rewrite a result schema so it can express "I don't know".

    Two changes, both of which turn an authored-in failure into a recoverable
    one: a boolean outcome becomes a three-valued string enum, and an enum
    without an escape hatch gains ``unknown``. Both leave a model able to
    decline rather than obliged to guess.
    """
    if schema is None:
        return None, None

    patched, changes = _rewrite(schema)
    if not changes:
        return None, schema

    verdict = validate_result_schema(patched)
    if not verdict.is_submittable:
        # Refuse to offer something CALL-E would reject with
        # `result_schema_invalid`. Better no schema fix than a broken one.
        return None, schema

    return (
        Remedy(
            kind=RemedyKind.SCHEMA,
            summary="let the schema express an unknown answer",
            rationale=(
                "A field with no way to say "
                '"I don\'t know" forces the extraction model to pick a real '
                "value even when the call gave it none. " + "; ".join(changes)
            ),
        ),
        patched,
    )


def _rewrite(schema: Mapping[str, Any]) -> tuple[dict[str, Any], list[str]]:
    changes: list[str] = []
    patched = dict(schema)

    properties = patched.get("properties")
    if not isinstance(properties, Mapping):
        return patched, changes

    new_properties: dict[str, Any] = {}
    for name, field_schema in properties.items():
        if not isinstance(field_schema, Mapping):
            new_properties[name] = field_schema
            continue

        updated = dict(field_schema)

        if updated.get("type") == "boolean":
            updated["type"] = "string"
            updated["enum"] = ["yes", "no", "unknown"]
            updated.setdefault(
                "description",
                "Use yes or no only when the recipient was explicit. "
                "Use unknown when the call did not settle it.",
            )
            changes.append(f"{name!r} becomes a string enum instead of a boolean")
        else:
            enum = updated.get("enum")
            if (
                isinstance(enum, Sequence)
                and not isinstance(enum, (str, bytes))
                and enum
                and all(isinstance(value, str) for value in enum)
                and not any(str(v).casefold() in UNKNOWN_MEMBERS for v in enum)
            ):
                updated["enum"] = [*enum, "unknown"]
                changes.append(f"{name!r} gains an 'unknown' member")

        new_properties[name] = updated

    patched["properties"] = new_properties

    if patched.get("additionalProperties") is not False:
        patched["additionalProperties"] = False
        changes.append("the object is closed with additionalProperties: false")

    return patched, changes
