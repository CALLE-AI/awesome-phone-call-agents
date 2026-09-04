"""Loading and checking a call plan.

A call plan is the three things that decide whether a phone call is safe to
automate: the ``task`` the agent will speak, the ``result_schema`` the call is
expected to return, and the ``decision_rule`` the surrounding automation
applies to that result.

Field roles are declared, never inferred. The repository design principles say
a workflow must not guess critical values, and which field carries a decision
is exactly such a value: guessing it wrong would silently rehearse the wrong
thing and report a clean run. ``suggest_decision_fields`` exists so a human can
be *offered* candidates, but nothing acts on them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import expressions

FIELD_ROLES = ("decision", "reachability", "consent", "identity", "deferral")

_DECISION_HINTS = (
    "confirm",
    "approve",
    "accept",
    "agree",
    "authorized",
    "consented",
    "success",
    "answer",
    "decision",
    "outcome",
)


class PlanError(ValueError):
    """Raised when a call plan cannot be rehearsed as written."""


@dataclass(frozen=True)
class Branch:
    """What the automation does when the decision rule resolves one way."""

    action: str
    side_effect: bool


@dataclass(frozen=True)
class CallPlan:
    """A call plan ready to rehearse."""

    name: str
    task: str
    result_schema: dict
    fields: dict[str, str]
    expression: str
    on_true: Branch
    on_false: Branch
    source: Path | None = None

    @property
    def schema_properties(self) -> dict[str, dict]:
        properties = self.result_schema.get("properties")
        return properties if isinstance(properties, dict) else {}

    @property
    def required_fields(self) -> list[str]:
        required = self.result_schema.get("required")
        return [item for item in required if isinstance(item, str)] if isinstance(required, list) else []

    def field_for(self, role: str) -> str | None:
        return self.fields.get(role)

    def branch_for(self, taken: bool) -> Branch:
        return self.on_true if taken else self.on_false


def suggest_decision_fields(result_schema: dict) -> list[str]:
    """Offer candidate decision fields for a human to choose between."""
    properties = result_schema.get("properties")
    if not isinstance(properties, dict):
        return []
    candidates = []
    for name, spec in properties.items():
        lowered = name.lower()
        is_boolean = isinstance(spec, dict) and spec.get("type") == "boolean"
        if is_boolean or any(hint in lowered for hint in _DECISION_HINTS):
            candidates.append(name)
    return candidates


def load_plan(path: Path) -> CallPlan:
    """Read a call plan from disk and check that it can be rehearsed."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PlanError(f"Call plan not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise PlanError(f"Call plan is not valid JSON ({path}): {exc}") from exc
    if not isinstance(raw, dict):
        raise PlanError(f"Call plan must be a JSON object: {path}")
    return build_plan(raw, source=path)


def build_plan(raw: dict, source: Path | None = None) -> CallPlan:
    """Validate a call plan mapping and return it."""
    name = raw.get("name")
    if not isinstance(name, str) or not name.strip():
        raise PlanError("Call plan needs a non-empty 'name'.")

    task = raw.get("task")
    if not isinstance(task, str) or not task.strip():
        raise PlanError("Call plan needs a non-empty 'task' describing what the agent says.")

    result_schema = raw.get("result_schema")
    if not isinstance(result_schema, dict):
        raise PlanError("Call plan needs a 'result_schema' object.")
    properties = result_schema.get("properties")
    if not isinstance(properties, dict) or not properties:
        raise PlanError("'result_schema.properties' must list at least one result field.")

    fields = _read_fields(raw, properties, result_schema)
    expression, on_true, on_false = _read_decision_rule(raw, properties)

    return CallPlan(
        name=name.strip(),
        task=task.strip(),
        result_schema=result_schema,
        fields=fields,
        expression=expression,
        on_true=on_true,
        on_false=on_false,
        source=source,
    )


def _read_fields(raw: dict, properties: dict, result_schema: dict) -> dict[str, str]:
    fields = raw.get("fields")
    if not isinstance(fields, dict):
        raise PlanError(
            "Call plan needs a 'fields' object declaring at least "
            "'decision'. Field roles are declared, never inferred."
        )
    resolved: dict[str, str] = {}
    for role in FIELD_ROLES:
        value = fields.get(role)
        if value is None:
            continue
        if not isinstance(value, str) or not value.strip():
            raise PlanError(f"fields.{role} must be a result field name.")
        if value not in properties:
            raise PlanError(
                f"fields.{role} refers to '{value}', which is not in result_schema.properties."
            )
        resolved[role] = value

    unknown = set(fields) - set(FIELD_ROLES)
    if unknown:
        known = ", ".join(FIELD_ROLES)
        raise PlanError(f"Unknown field roles: {', '.join(sorted(unknown))}. Known roles: {known}.")

    if "decision" not in resolved:
        candidates = suggest_decision_fields(result_schema)
        hint = f" Candidates in this schema: {', '.join(candidates)}." if candidates else ""
        raise PlanError(
            "fields.decision must name the result field that carries the single "
            "decision this call exists to establish." + hint
        )
    return resolved


def _read_decision_rule(raw: dict, properties: dict) -> tuple[str, Branch, Branch]:
    rule = raw.get("decision_rule")
    if not isinstance(rule, dict):
        raise PlanError("Call plan needs a 'decision_rule' object.")

    expression = rule.get("expression")
    if not isinstance(expression, str) or not expression.strip():
        raise PlanError("decision_rule.expression must be a non-empty expression.")
    try:
        referenced = expressions.referenced_fields(expression)
    except expressions.ExpressionError as exc:
        raise PlanError(str(exc)) from exc

    unknown = sorted(referenced - set(properties))
    if unknown:
        raise PlanError(
            "decision_rule.expression reads fields that are not in "
            f"result_schema.properties: {', '.join(unknown)}."
        )
    return expression.strip(), _read_branch(rule, "on_true"), _read_branch(rule, "on_false")


def _read_branch(rule: dict, key: str) -> Branch:
    branch = rule.get(key)
    if not isinstance(branch, dict):
        raise PlanError(f"decision_rule.{key} must be an object.")
    action = branch.get("action")
    if not isinstance(action, str) or not action.strip():
        raise PlanError(f"decision_rule.{key}.action must describe what the automation does.")
    side_effect = branch.get("side_effect")
    if not isinstance(side_effect, bool):
        raise PlanError(
            f"decision_rule.{key}.side_effect must be true or false: does this branch "
            "change the real world?"
        )
    return Branch(action=action.strip(), side_effect=side_effect)
