"""Derive CALL-E's `recipient_result_schema` from the table's own columns.

Nobody on a verification desk writes JSON Schema. They do, however, create
columns -- and a column already carries everything the schema needs. A single
select's choices are an enum. Its description is the instruction. Its name is
the field.

So the schema is not written; it is read off the table:

    single select "Employment confirmed" (yes | no)
        -> {"type": "string", "enum": ["yes", "no", "unknown"],
            "description": <the column's description>}

Two decisions here come straight from CALL-E's API documentation rather than
from taste:

  * "Prefer string enums over booleans for business decisions that may be
    unclear, and include an `unknown` enum value when the call may not provide
    enough evidence." So `unknown` is appended to every derived enum, and an
    Airtable checkbox becomes yes/no/unknown rather than a boolean. A verifier
    who could not get an answer must be able to say so.
  * "Do not use reserved recipient response field names such as `summary`,
    `status`, `transcript`, `call_id`, or timing fields." Columns that collide
    are rejected with the rename spelled out, rather than silently dropped.

Only the schema features CALL-E documents as supported are ever emitted: type,
properties, required, enum, description and `additionalProperties: false`.
Nothing here can produce `$ref`, `oneOf`, `anyOf`, `allOf` or a recursive
schema.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# Reserved by CALL-E on the recipient result object. A derived column that
# collides would be silently discarded server-side, so it is refused here with
# a concrete suggestion instead.
RESERVED_KEYS = frozenset(
    {
        "summary",
        "status",
        "transcript",
        "transcript_url",
        "call_id",
        "recipient_id",
        "started_at",
        "completed_at",
        "duration",
        "duration_seconds",
    }
)

# The evidence-of-contact gate. CALL-E's own issue #341 reports the API
# returning task_completed: true when voice-agent setup fails before dialing.
# For a verification product that is the worst possible failure: employment
# marked confirmed when no conversation happened. So this column is mandatory,
# and nothing is allowed to reach a verified state without it.
CONTACT_GATE_KEY = "reached_employer"

UNKNOWN = "unknown"

_NON_WORD = re.compile(r"[^a-z0-9]+")


class SchemaError(Exception):
    """The table's columns cannot produce a valid recipient result schema."""


def slug(text: str) -> str:
    """Column name or choice label -> a stable schema identifier."""
    out = _NON_WORD.sub("_", (text or "").strip().lower()).strip("_")
    if not out:
        raise SchemaError(f"cannot derive an identifier from {text!r}")
    if out[0].isdigit():
        out = f"f_{out}"
    return out


@dataclass(frozen=True, slots=True)
class DerivedSchema:
    """The schema CALL-E receives, plus how to write the answers back.

    `field_names` maps a schema key to the Airtable column it came from, and
    `choice_labels` maps (key, enum value) to the choice label Airtable expects,
    so results can be written back without guessing at capitalisation.
    """

    schema: dict[str, Any]
    field_names: dict[str, str] = field(default_factory=dict)
    choice_labels: dict[tuple[str, str], str] = field(default_factory=dict)

    @property
    def keys(self) -> list[str]:
        return list(self.schema.get("properties", {}))


def _enum_property(
    key: str, column: dict[str, Any], choices: list[dict[str, Any]]
) -> tuple[dict[str, Any], dict[tuple[str, str], str]]:
    values: list[str] = []
    labels: dict[tuple[str, str], str] = {}
    has_unknown = False
    for choice in choices:
        label = choice.get("name", "")
        value = slug(label)
        if value == UNKNOWN:
            # The operator already modelled it. Keep their spelling for the
            # writeback ("Unknown", "Not stated", …) but do not duplicate the
            # enum value.
            has_unknown = True
            labels[(key, UNKNOWN)] = label
            continue
        if value in values:
            raise SchemaError(
                f"column {column.get('name')!r} has two choices that reduce to "
                f"the same value {value!r}; rename one"
            )
        values.append(value)
        labels[(key, value)] = label
    if not values:
        raise SchemaError(f"column {column.get('name')!r} has no choices")
    if not has_unknown:
        # CALL-E is told to answer `unknown` whenever it cannot establish a
        # fact, so it will. A select that cannot hold that value turns a
        # successful call into a failed write, and the operator discovers it
        # only after paying for the call. Refused here, with the fix named.
        raise SchemaError(
            f"column {column.get('name')!r} has no choice for an unclear "
            f"answer. Add a choice named \"Unknown\" to it. CALL-E answers "
            f"`unknown` when it cannot establish a fact -- if this column "
            f"cannot store that, the call succeeds and the write fails."
        )
    values.append(UNKNOWN)
    prop: dict[str, Any] = {"type": "string", "enum": values}
    return prop, labels


def derive_recipient_schema(columns: list[dict[str, Any]]) -> DerivedSchema:
    """Build `recipient_result_schema` from Airtable field definitions.

    `columns` is the `fields` array from
    `GET /v0/meta/bases/{baseId}/tables`, filtered to the answer columns.
    """
    properties: dict[str, Any] = {}
    required: list[str] = []
    names: dict[str, str] = {}
    labels: dict[tuple[str, str], str] = {}

    for column in columns:
        raw_name = column.get("name", "")
        key = slug(raw_name)

        if key in RESERVED_KEYS:
            raise SchemaError(
                f"column {raw_name!r} maps to {key!r}, which CALL-E reserves on "
                f"the recipient result. Rename the column, for example "
                f"{'employer_' + key!r}."
            )
        if key in properties:
            raise SchemaError(
                f"two columns both map to {key!r}; rename one so the derived "
                "schema is unambiguous"
            )

        kind = column.get("type", "")
        options = column.get("options") or {}
        prop: dict[str, Any]

        if kind in ("singleSelect", "multipleSelects"):
            prop, choice_labels = _enum_property(
                key, column, options.get("choices") or []
            )
            labels.update(choice_labels)
        elif kind == "checkbox":
            # A checkbox has two states, and CALL-E answers with three. Ticked
            # and unticked cannot say "HR would not tell me", and writing that
            # answer as unticked is the exact misrepresentation this product
            # exists to prevent -- an unverified fact recorded as a negative.
            raise SchemaError(
                f"column {raw_name!r} is a checkbox, which has no way to record "
                "an unclear answer. Change it to a single select with choices "
                "Yes, No and Unknown. CALL-E answers `unknown` when it cannot "
                "establish a fact, and a checkbox would record that as 'no'."
            )
        elif kind == "number":
            precision = int(options.get("precision", 0) or 0)
            prop = {"type": "integer" if precision == 0 else "number"}
        elif kind in ("singleLineText", "multilineText", "richText"):
            prop = {"type": "string"}
        else:
            raise SchemaError(
                f"column {raw_name!r} has type {kind!r}, which does not map to a "
                "supported CALL-E result field. Use a single select, checkbox, "
                "number, or text column."
            )

        # The column's own description is passed to the extraction model, which
        # is why the README asks operators to write it as an instruction.
        description = (column.get("description") or "").strip()
        if description:
            prop["description"] = description

        properties[key] = prop
        names[key] = raw_name
        required.append(key)

    if CONTACT_GATE_KEY not in properties:
        raise SchemaError(
            f"the answer columns must include one that maps to "
            f"{CONTACT_GATE_KEY!r}. Nothing may be reported as verified without "
            "positive evidence that a person at the employer was reached."
        )

    gate = properties[CONTACT_GATE_KEY]
    if gate.get("type") != "string" or "yes" not in gate.get("enum", []):
        raise SchemaError(
            f"{CONTACT_GATE_KEY!r} must be a single select or checkbox that can "
            "answer yes"
        )

    schema = {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }
    return DerivedSchema(schema=schema, field_names=names, choice_labels=labels)


def derive_task_schema() -> dict[str, Any]:
    """Request-level roll-up, sent as CALL-E's `result_schema`.

    Fixed rather than derived: these are the dispositions the workflow itself
    defines, not something an operator should be able to redraw by adding a
    column.
    """
    return {
        "type": "object",
        "properties": {
            "verification_outcome": {
                "type": "string",
                "enum": [
                    "verified",
                    "partial",
                    "not_verified",
                    "employer_unreachable",
                    "declined",
                    UNKNOWN,
                ],
                "description": (
                    "Use verified only when a person at the employer was reached "
                    "and confirmed employment. Use declined when someone was "
                    "reached but would not answer. Use employer_unreachable when "
                    "no person was reached. Use unknown if the evidence does not "
                    "support any of the others."
                ),
            }
        },
        "required": ["verification_outcome"],
        "additionalProperties": False,
    }
