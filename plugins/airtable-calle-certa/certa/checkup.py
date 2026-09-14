"""Whether this table can actually run, and exactly what to change if not.

Certa reads a table the operator built, so most failures are configuration,
not code -- a missing column, a select that cannot hold the answer CALL-E
will give. The worst version of that is the one this module exists to stop:
the call connects, the agent does its job, the extraction is correct, and the
write fails. The operator has paid for a call and learned nothing.

Every problem here is therefore reported with the change that fixes it, in
the operator's own column names, before anything is dialed.

`unknown` has its own entry because it is the least obvious. CALL-E is
instructed to answer `unknown` whenever it cannot establish a fact, so it
will, and a Yes/No select has nowhere to put that. Airtable's Update Field
API can change only a field's name and description -- not its choices -- so
Certa cannot repair this for the operator and has to say precisely what to
click.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .airtable import FieldMap, answer_columns
from .schema import CONTACT_GATE_KEY, SchemaError, derive_recipient_schema, slug

# Columns Certa reads or writes itself, with what each one is for. Control
# columns are matched by name because the operator chose those names.
CONTROL_PURPOSE: dict[str, str] = {
    "request_id": "identifies the request in the audit log",
    "applicant_name": "the person being verified; spoken on the call",
    "employer_name": "the employer being called",
    "sourced_number": "the only number that is ever dialed",
    "number_source": "where that number came from; its provenance",
    "applicant_supplied_number": "recorded and never dialed",
    "consent_receipt_id": "which consent record authorises this call",
    "consent_token": "the hash a filled-down cell cannot forge",
    "status": "written back: the disposition",
    "reason": "written back: why, in words",
    "call_id": "written back: the CALL-E call this came from",
}

OK = "ok"
PROBLEM = "problem"


@dataclass(frozen=True, slots=True)
class Finding:
    column: str
    state: str          # OK | PROBLEM
    detail: str
    fix: str = ""


@dataclass(frozen=True, slots=True)
class Checkup:
    findings: tuple[Finding, ...]
    runnable: bool
    answer_columns: tuple[str, ...]

    @property
    def problems(self) -> tuple[Finding, ...]:
        return tuple(f for f in self.findings if f.state == PROBLEM)


def _choice_names(column: dict[str, Any]) -> list[str]:
    return [c.get("name", "") for c in (column.get("options") or {}).get("choices") or []]


def check_table(schema: list[dict[str, Any]], fields: FieldMap | None = None) -> Checkup:
    """Report what this table can and cannot do, without calling anything."""
    fields = fields or FieldMap()
    present = {c.get("name", ""): c for c in schema}
    findings: list[Finding] = []

    # 1. The columns Certa itself needs.
    for attr, purpose in CONTROL_PURPOSE.items():
        name = getattr(fields, attr)
        if name in present:
            findings.append(Finding(name, OK, purpose))
        else:
            findings.append(
                Finding(
                    name, PROBLEM,
                    f"missing -- {purpose}",
                    f'Add a column named "{name}".',
                )
            )

    # 2. The answer columns, which are the operator's to invent.
    answers = answer_columns(schema, fields)
    names = tuple(c.get("name", "") for c in answers)

    if not answers:
        findings.append(
            Finding(
                "(answer columns)", PROBLEM,
                "the table has no answer columns, so a call could not report anything",
                'Add a single select named "Reached employer" with choices '
                "Yes, No and Unknown.",
            )
        )
    if answers and not any(slug(n) == CONTACT_GATE_KEY for n in names):
        findings.append(
            Finding(
                "Reached employer", PROBLEM,
                "no column records whether a person was actually reached, so "
                "nothing could ever be trusted as verified",
                'Add a single select named "Reached employer" with choices '
                "Yes, No and Unknown.",
            )
        )

    for column in answers:
        name = column.get("name", "")
        kind = column.get("type", "")
        if kind == "checkbox":
            findings.append(Finding(
                name, PROBLEM,
                "a checkbox has two states and CALL-E answers with three; "
                "an unclear answer would be recorded as 'no'",
                f'Change "{name}" to a single select with choices Yes, No and Unknown.',
            ))
            continue
        if kind in ("singleSelect", "multipleSelects"):
            choices = _choice_names(column)
            if not any(slug(c) == "unknown" for c in choices):
                findings.append(Finding(
                    name, PROBLEM,
                    "cannot store an unclear answer. CALL-E replies `unknown` "
                    "when it cannot establish a fact, and the write would fail "
                    "after the call was paid for",
                    f'Open "{name}" in Airtable and add a choice named exactly '
                    f'"Unknown". Airtable\'s API cannot add choices, so this one '
                    f"has to be done in the base.",
                ))
                continue
            findings.append(Finding(name, OK, f"answer column ({', '.join(choices)})"))
            continue
        findings.append(Finding(name, OK, f"answer column ({kind})"))

    # 3. The authoritative check: would a schema actually derive?
    try:
        derive_recipient_schema(answers)
    except SchemaError as exc:
        if not any(f.state == PROBLEM for f in findings):
            findings.append(Finding("(schema)", PROBLEM, str(exc), ""))
        runnable = False
    else:
        runnable = not any(f.state == PROBLEM for f in findings)

    return Checkup(tuple(findings), runnable, names)
