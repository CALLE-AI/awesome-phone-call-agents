"""Validate a ``result_schema`` against the subset of JSON Schema CALL-E accepts.

CALL-E does not run a general JSON Schema validator. Its contract names a
closed list of supported keywords and an explicit list of rejected ones, and a
schema outside that profile is refused at create time with
``result_schema_invalid`` -- the call never happens.

This matters to REDLINE twice over:

* a **finding** is worthless if the fix it proposes cannot be submitted, so
  :mod:`redline.remediate` validates every generated schema through here before
  offering it;
* several failure modes are *authored in*, not accidental. A boolean
  ``confirmed`` field with no ``unknown`` state forces the extraction model to
  pick true or false when the call gave it neither -- which is how "I'll see"
  becomes ``confirmed: true``. That is a design defect a linter can see, so it
  is reported as a warning rather than waiting to be discovered on a customer.

Errors are what the API rejects. Warnings are what the API accepts and you
regret. Both are reported; only errors block.

Reference: CALL-E Developer API, OpenAPI 3.1 v0.6.0, ``CreateCallRequest``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

__all__ = [
    "AFFIRMATIVE_MEMBERS",
    "Issue",
    "IssueLevel",
    "SchemaReport",
    "validate_result_schema",
]

#: Keywords CALL-E documents as supported.
SUPPORTED_KEYWORDS = frozenset(
    {
        "type",
        "properties",
        "required",
        "enum",
        "items",
        "description",
        "additionalProperties",
        "title",
    }
)

#: Keywords CALL-E documents as unsupported. Naming them individually produces
#: a better message than a generic "unknown keyword".
REJECTED_KEYWORDS: Mapping[str, str] = {
    "$ref": "references are not resolved; inline the definition",
    "$defs": "definition blocks are not read; inline the definition",
    "definitions": "definition blocks are not read; inline the definition",
    "oneOf": "use a string enum to express alternatives",
    "anyOf": "use a string enum to express alternatives",
    "allOf": "compose the object literally instead",
    "not": "negation is not supported",
    "if": "conditional schemas are not supported",
    "then": "conditional schemas are not supported",
    "else": "conditional schemas are not supported",
    "patternProperties": "declare each property explicitly",
    "format": "complex format validation is not applied",
    "pattern": "regular-expression validation is not applied",
}

SUPPORTED_TYPES = frozenset(
    {"object", "array", "string", "number", "integer", "boolean"}
)

#: Reserved on `recipient_result_schema`: these names collide with fields
#: CALL-E already puts on a recipient response.
RESERVED_RECIPIENT_FIELDS = frozenset(
    {
        "summary",
        "status",
        "transcript",
        "transcript_turns",
        "call_id",
        "id",
        "phones",
        "locale",
        "region",
        "attempts",
        "started_at",
        "completed_at",
    }
)

#: The value that lets an extraction model decline to guess. Its absence from
#: an enum is the single most common cause of a confidently wrong result.
UNKNOWN_MEMBERS = frozenset({"unknown", "unclear", "not_stated", "no_answer"})

#: Values that report an agreement. Kept beside UNKNOWN_MEMBERS because the
#: two are read together everywhere: an extracted value is either an
#: agreement, an abstention, or something else, and three parts of the tool
#: need to agree on which.
AFFIRMATIVE_MEMBERS = frozenset(
    {
        "yes",
        "true",
        "confirmed",
        "confirm",
        "accepted",
        "agreed",
        "attending",
        "available",
    }
)


class IssueLevel(StrEnum):
    ERROR = "error"
    """CALL-E will reject the schema. The call cannot be created."""

    WARNING = "warning"
    """CALL-E accepts it, but the shape invites a wrong answer."""


@dataclass(frozen=True, slots=True)
class Issue:
    """One problem with a schema, and what to do about it."""

    level: IssueLevel
    path: str
    message: str
    remedy: str

    def render(self) -> str:
        location = self.path or "<root>"
        return f"[{self.level}] {location}: {self.message} -- {self.remedy}"


@dataclass(frozen=True, slots=True)
class SchemaReport:
    """The verdict on one schema."""

    issues: tuple[Issue, ...] = ()

    @property
    def errors(self) -> tuple[Issue, ...]:
        return tuple(i for i in self.issues if i.level is IssueLevel.ERROR)

    @property
    def warnings(self) -> tuple[Issue, ...]:
        return tuple(i for i in self.issues if i.level is IssueLevel.WARNING)

    @property
    def is_submittable(self) -> bool:
        """Whether CALL-E would accept this schema."""
        return not self.errors

    @property
    def is_clean(self) -> bool:
        return not self.issues


def validate_result_schema(
    schema: object,
    *,
    per_recipient: bool = False,
) -> SchemaReport:
    """Check ``schema`` against the CALL-E profile.

    ``schema`` is typed ``object`` on purpose: schemas arrive from YAML and
    JSON written by hand, so "this is not even a schema" is a real case the
    validator has to report rather than a state the type system can rule out.

    Set ``per_recipient`` when validating ``recipient_result_schema``, which
    additionally forbids field names that collide with CALL-E's own recipient
    response fields.
    """
    if schema is None:
        return SchemaReport()
    if not isinstance(schema, Mapping):
        return SchemaReport(
            (
                Issue(
                    level=IssueLevel.ERROR,
                    path="",
                    message="schema is not a JSON object",
                    remedy="Provide an object schema, or omit the field.",
                ),
            )
        )

    issues: list[Issue] = []
    _walk(schema, path="", issues=issues, seen=set(), depth=0)

    if per_recipient:
        issues.extend(_reserved_field_issues(schema))

    root_type = schema.get("type")
    if root_type != "object":
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path="",
                message=f"root schema type is {root_type!r}, not 'object'",
                remedy="CALL-E extracts into an object. Wrap the value in one.",
            )
        )

    return SchemaReport(tuple(issues))


# --- Traversal ---------------------------------------------------------------


def _walk(
    node: Mapping[str, Any],
    *,
    path: str,
    issues: list[Issue],
    seen: set[int],
    depth: int,
) -> None:
    if id(node) in seen:
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=path,
                message="schema is recursive",
                remedy="Flatten the structure; recursive schemas are rejected.",
            )
        )
        return
    if depth > 12:
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=path,
                message="schema nests more than 12 levels deep",
                remedy="Flatten the structure.",
            )
        )
        return
    seen = seen | {id(node)}

    _check_keywords(node, path=path, issues=issues)
    _check_type(node, path=path, issues=issues)
    _check_enum(node, path=path, issues=issues)
    _check_object(node, path=path, issues=issues, seen=seen, depth=depth)
    _check_array(node, path=path, issues=issues, seen=seen, depth=depth)


def _check_keywords(node: Mapping[str, Any], *, path: str, issues: list[Issue]) -> None:
    for keyword in node:
        if keyword in REJECTED_KEYWORDS:
            issues.append(
                Issue(
                    level=IssueLevel.ERROR,
                    path=_join(path, keyword),
                    message=f"{keyword!r} is not supported by CALL-E",
                    remedy=REJECTED_KEYWORDS[keyword].capitalize() + ".",
                )
            )
        elif keyword not in SUPPORTED_KEYWORDS:
            issues.append(
                Issue(
                    level=IssueLevel.WARNING,
                    path=_join(path, keyword),
                    message=f"{keyword!r} is outside the documented profile",
                    remedy="It will most likely be ignored. Remove it.",
                )
            )


def _check_type(node: Mapping[str, Any], *, path: str, issues: list[Issue]) -> None:
    declared = node.get("type")
    if declared is None:
        if "enum" not in node and "properties" not in node:
            issues.append(
                Issue(
                    level=IssueLevel.WARNING,
                    path=path,
                    message="no 'type' declared",
                    remedy="State the type; untyped fields extract unpredictably.",
                )
            )
        return
    if isinstance(declared, list):
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "type"),
                message="union types are not supported",
                remedy="Pick one type; use a string enum for alternatives.",
            )
        )
        return
    if declared == "null" or declared not in SUPPORTED_TYPES:
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "type"),
                message=f"type {declared!r} is not supported",
                remedy=f"Use one of: {', '.join(sorted(SUPPORTED_TYPES))}.",
            )
        )


def _check_enum(node: Mapping[str, Any], *, path: str, issues: list[Issue]) -> None:
    enum = node.get("enum")
    if enum is None:
        return
    if not isinstance(enum, Sequence) or isinstance(enum, (str, bytes)):
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "enum"),
                message="'enum' must be a list",
                remedy="Provide the allowed values as a list.",
            )
        )
        return
    if not enum:
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "enum"),
                message="'enum' is empty",
                remedy="An empty enum can never be satisfied. Remove or fill it.",
            )
        )
        return
    if not all(isinstance(value, str) for value in enum):
        issues.append(
            Issue(
                level=IssueLevel.WARNING,
                path=_join(path, "enum"),
                message="enum mixes non-string values",
                remedy="String enums extract far more reliably.",
            )
        )
        return
    if not any(str(value).casefold() in UNKNOWN_MEMBERS for value in enum):
        issues.append(
            Issue(
                level=IssueLevel.WARNING,
                path=_join(path, "enum"),
                message="no 'unknown' member",
                remedy=(
                    "Add 'unknown'. Without an escape hatch the model must "
                    "pick a real value even when the call gave it none."
                ),
            )
        )


def _check_object(
    node: Mapping[str, Any],
    *,
    path: str,
    issues: list[Issue],
    seen: set[int],
    depth: int,
) -> None:
    properties = node.get("properties")
    if properties is None:
        return
    if not isinstance(properties, Mapping):
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "properties"),
                message="'properties' must be an object",
                remedy="Map each field name to its schema.",
            )
        )
        return

    if node.get("additionalProperties") is True:
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "additionalProperties"),
                message="'additionalProperties: true' is not supported",
                remedy="Set it to false and declare every field explicitly.",
            )
        )
    elif "additionalProperties" not in node:
        issues.append(
            Issue(
                level=IssueLevel.WARNING,
                path=path,
                message="'additionalProperties' is not declared",
                remedy="Set 'additionalProperties: false' to close the object.",
            )
        )

    _check_required(node, properties, path=path, issues=issues)

    for name, child in properties.items():
        child_path = _join(path, name)
        if not isinstance(child, Mapping):
            issues.append(
                Issue(
                    level=IssueLevel.ERROR,
                    path=child_path,
                    message="property schema is not an object",
                    remedy="Give the property a schema object.",
                )
            )
            continue
        if not child.get("description"):
            issues.append(
                Issue(
                    level=IssueLevel.WARNING,
                    path=child_path,
                    message="no 'description'",
                    remedy=(
                        "Descriptions are passed to the extraction model and "
                        "are the main lever on what it decides."
                    ),
                )
            )
        if child.get("type") == "boolean":
            issues.append(
                Issue(
                    level=IssueLevel.WARNING,
                    path=child_path,
                    message="boolean field for a call outcome",
                    remedy=(
                        "Use a string enum with an 'unknown' member. A boolean "
                        "forces a guess when the call was ambiguous."
                    ),
                )
            )
        _walk(child, path=child_path, issues=issues, seen=seen, depth=depth + 1)


def _check_required(
    node: Mapping[str, Any],
    properties: Mapping[str, Any],
    *,
    path: str,
    issues: list[Issue],
) -> None:
    required = node.get("required")
    if required is None:
        return
    if not isinstance(required, Sequence) or isinstance(required, (str, bytes)):
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "required"),
                message="'required' must be a list of field names",
                remedy="Provide the required field names as a list.",
            )
        )
        return
    for name in required:
        if not isinstance(name, str) or name not in properties:
            issues.append(
                Issue(
                    level=IssueLevel.ERROR,
                    path=_join(path, "required"),
                    message=f"required field {name!r} is not declared",
                    remedy="Every required name must appear in 'properties'.",
                )
            )


def _check_array(
    node: Mapping[str, Any],
    *,
    path: str,
    issues: list[Issue],
    seen: set[int],
    depth: int,
) -> None:
    if node.get("type") != "array":
        return
    items = node.get("items")
    if items is None:
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=path,
                message="array has no 'items' schema",
                remedy="Declare 'items'; only simple item schemas are read.",
            )
        )
        return
    if isinstance(items, Sequence) and not isinstance(items, (str, bytes)):
        issues.append(
            Issue(
                level=IssueLevel.ERROR,
                path=_join(path, "items"),
                message="tuple-style 'items' is not supported",
                remedy="Use a single item schema.",
            )
        )
        return
    if isinstance(items, Mapping):
        _walk(
            items, path=_join(path, "items"), issues=issues, seen=seen, depth=depth + 1
        )


def _reserved_field_issues(schema: Mapping[str, Any]) -> list[Issue]:
    properties = schema.get("properties")
    if not isinstance(properties, Mapping):
        return []
    return [
        Issue(
            level=IssueLevel.ERROR,
            path=_join("", name),
            message=f"{name!r} is reserved on a recipient result",
            remedy=f"Rename it, for example 'customer_{name}' or 'notes'.",
        )
        for name in properties
        if name in RESERVED_RECIPIENT_FIELDS
    ]


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key
