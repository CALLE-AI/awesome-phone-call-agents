"""No protected health information, anywhere.

"Medical Baseline" is a tariff enrollment flag. The system must never carry a condition, a
device, a diagnosis, or a medication, in a model field, a schema, a fixture, or a document.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from positive_contact.models import (
    Contact,
    Disposition,
    Event,
    Intent,
    WorkOrder,
)
from positive_contact.script import RECIPIENT_RESULT_SCHEMA

APP_ROOT = Path(__file__).resolve().parent.parent

# Field-name fragments that would mean the system is storing a health fact.
PHI_FIELD_FRAGMENTS = (
    "condition",
    "diagnos",
    "medication",
    "prescription",
    "device_type",
    "equipment_type",
    "symptom",
    "illness",
    "disability",
    "treatment",
    "oxygen",
    "dialysis",
    "ventilator",
    "icd",
    "health_status",
)

MODELS = (Event, Contact, Intent, Disposition, WorkOrder)


@pytest.mark.parametrize("model", MODELS, ids=lambda model: model.__name__)
def test_no_model_has_a_phi_shaped_field(model):
    for name in model.model_fields:
        lowered = name.lower()
        for fragment in PHI_FIELD_FRAGMENTS:
            assert fragment not in lowered, f"{model.__name__}.{name}"


def test_the_result_schema_has_no_phi_shaped_field():
    for name in RECIPIENT_RESULT_SCHEMA["properties"]:
        lowered = name.lower()
        for fragment in PHI_FIELD_FRAGMENTS:
            assert fragment not in lowered, name


def test_the_result_schema_has_no_free_text_field_that_invites_phi():
    """`notes_for_human` is the only free-text field, and it is told not to carry any."""
    free_text = [
        name
        for name, spec in RECIPIENT_RESULT_SCHEMA["properties"].items()
        if "enum" not in spec
    ]
    assert set(free_text) == {"callback_window", "preferred_language", "notes_for_human"}
    description = RECIPIENT_RESULT_SCHEMA["properties"]["notes_for_human"]["description"]
    assert "medical detail" in description
    assert "condition" in description


def test_the_ledger_schema_has_no_phi_column(ledger):
    rows = ledger.conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    for row in rows:
        columns = ledger.conn.execute(f"PRAGMA table_info({row['name']})").fetchall()  # noqa: S608
        for column in columns:
            lowered = column["name"].lower()
            for fragment in PHI_FIELD_FRAGMENTS:
                assert fragment not in lowered, f"{row['name']}.{column['name']}"


def _shipped_files():
    """Everything the app ships.

    The test suite itself is excluded on purpose: it contains deliberate rejection cases
    such as a result carrying a `diagnosis` key, which exist precisely to prove the
    validator refuses them.
    """
    skip_dirs = {".venv", "__pycache__", ".pytest_cache", "node_modules", "tests"}
    for path in APP_ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in {".py", ".json", ".csv", ".md", ".html"}:
            continue
        if set(path.relative_to(APP_ROOT).parts) & skip_dirs:
            continue
        yield path


# Assignments and JSON keys, so prose that merely discusses the boundary is allowed.
FIELD_ASSIGNMENT_RE = re.compile(
    r'(?:"(?P<json>[a-z_]+)"\s*:)|(?:\b(?P<py>[a-z_]+)\s*[:=])'
)


def test_no_shipped_file_declares_a_phi_field():
    offenders: list[str] = []
    for path in _shipped_files():
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith("-") or stripped.startswith("*"):
                continue
            for match in FIELD_ASSIGNMENT_RE.finditer(line):
                name = match.group("json") or match.group("py") or ""
                lowered = name.lower()
                for fragment in PHI_FIELD_FRAGMENTS:
                    if fragment in lowered:
                        offenders.append(f"{path.relative_to(APP_ROOT)}:{number} {name}")
    assert not offenders, "PHI-shaped field declared in: " + ", ".join(offenders)


def test_the_fixtures_record_no_health_fact():
    """A caller may mention equipment on the call. Nothing may store what they said."""
    import json

    for path in (APP_ROOT / "fixtures").rglob("*.json"):
        document = json.loads(path.read_text(encoding="utf-8"))

        def walk(node, trail="") -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    lowered = str(key).lower()
                    for fragment in PHI_FIELD_FRAGMENTS:
                        assert fragment not in lowered, f"{path.name}{trail}.{key}"
                    walk(value, f"{trail}.{key}")
            elif isinstance(node, list):
                for index, item in enumerate(node):
                    walk(item, f"{trail}[{index}]")

        walk(document)


def test_the_notes_field_in_the_fixtures_carries_no_health_detail():
    """The medical-question fixture must route to a human without recording the reason."""
    import json

    path = APP_ROOT / "fixtures" / "scenarios" / "pc-009-medical-question.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    result = document["steps"][0]["response"]["recipients"][0]["structured_result"]
    assert result["needs_assistance"] == "medical_question"
    notes = result["notes_for_human"].lower()
    for banned in ("oxygen", "concentrator", "dialysis", "ventilator", "diagnosis"):
        assert banned not in notes, notes


def test_the_call_script_forbids_recording_a_health_fact(event):
    from positive_contact.script import render_task_text

    text = render_task_text(
        event,
        first_name="Maria",
        service_address_short="1200 block of Elm St",
        locale="en-US",
        tz_name="America/Los_Angeles",
    )
    assert "Do not record any medical condition, device, diagnosis, or medication" in text
    assert "Give no medical advice" in text


def test_medical_baseline_is_only_ever_an_enrollment_flag(event):
    from positive_contact.script import render_task_text

    text = render_task_text(
        event,
        first_name="Maria",
        service_address_short="1200 block of Elm St",
        locale="en-US",
        tz_name="America/Los_Angeles",
    )
    assert "enrolled in the Medical Baseline program" in text
    # The contact model has no place to put anything more than that.
    assert "medical" not in " ".join(Contact.model_fields).lower()
