"""Clinic stock-report task, result schema, and red-flag classifier.

This module is the domain core of the clinic-stock-reporter app. It is free of
CALL-E and network concerns so it can be unit-tested in isolation. See
README.md for the DHIS2/HMIS field subset and safety boundaries.

Structured results are native to the CALL-E Developer API: we send
`RESULT_SCHEMA` (a JSON Schema) on call creation, and CALL-E extracts a
schema-valid `structured_result` from the call transcript/ASR/summary. When
CALL-E cannot produce one, `structured_result` is null and `classify` records
an empty report instead of dropping the call.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any

# Representative subset of Uganda HMIS105 / DVDMIS weekly reporting indicators.
# These mirror real DHIS2 fields but should be confirmed against the live DHIS2
# instance before any production use. See README.md.
COLD_CHAIN_MIN_C = 2.0
COLD_CHAIN_MAX_C = 8.0
UNKNOWN_COUNT = -1

# JSON Schema sent to CALL-E as `result_schema`. CALL-E extracts a
# schema-valid object from the call evidence and validates it before
# returning the terminal call. Object schemas are strict by default, so
# undeclared fields are rejected.
RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "fridge_temp_c",
        "arv_stockout",
        "antimalarial_stockout",
        "malaria_cases",
        "anc_visits",
        "stockout_items",
    ],
    "properties": {
        "fridge_temp_c": {
            "type": "number",
            "description": (
                "Vaccine fridge temperature in degrees Celsius reported by the "
                "clinic right now. Use -999 if the clinic has no vaccine fridge "
                "or the reading is unavailable."
            ),
        },
        "arv_stockout": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "yes if the clinic is out of stock of ARVs (antiretrovirals) "
                "today; no if ARVs are in stock; unknown if the answer is unclear."
            ),
        },
        "antimalarial_stockout": {
            "type": "string",
            "enum": ["yes", "no", "unknown"],
            "description": (
                "yes if the clinic is out of stock of antimalarials (ACT) today; "
                "no if in stock; unknown if the answer is unclear."
            ),
        },
        "malaria_cases": {
            "type": "integer",
            "description": (
                "Number of confirmed malaria cases the clinic saw this week. "
                "Use -1 if the count is unknown."
            ),
        },
        "anc_visits": {
            "type": "integer",
            "description": (
                "Number of new antenatal care first visits (ANC1) the clinic saw "
                "this week. Use -1 if the count is unknown."
            ),
        },
        "stockout_items": {
            "type": "string",
            "description": (
                "Other essential medicines out of stock today, comma separated "
                "by name, or 'none' if there are no other stockouts."
            ),
        },
    },
    "additionalProperties": False,
}

REQUIRED_FIELDS = tuple(RESULT_SCHEMA["required"])


@dataclass
class ParsedReport:
    clinic_id: str | None
    fields: dict[str, Any] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    red_flags: list[str] = field(default_factory=list)
    severity: str = "green"  # green | amber | red
    structured_result: dict[str, Any] | None = None


def build_task(clinic_id: str, clinic_name: str, nurse_name: str | None = None) -> str:
    """Build the CALL-E `task` instruction for a clinic stock-report call.

    Keep the questions explicit and outcome-oriented so CALL-E can extract the
    structured result from the transcript. Do not ask the recipient to produce
    a machine-formatted line; the result schema handles structuring.
    """
    addressee = "the nurse in charge" if not nurse_name else nurse_name
    return (
        f"Call {clinic_name} ({clinic_id}) on behalf of the district health "
        f"office for the weekly HMIS stock and cold-chain report. Speak to "
        f"{addressee}. Keep the call under three minutes.\n\n"
        "Ask these questions one at a time and wait for each answer:\n"
        "1. What is the vaccine fridge temperature in degrees Celsius right now?\n"
        "2. Are you out of stock of ARVs (antiretrovirals) today?\n"
        "3. Are you out of stock of antimalarials (ACT) today?\n"
        "4. How many confirmed malaria cases did you see this week?\n"
        "5. How many new antenatal care first visits (ANC1) did you see this week?\n"
        "6. Are any other essential medicines out of stock today? List them by name.\n\n"
        "Be courteous, confirm you are speaking to clinic staff, and thank them "
        "before ending the call. Do not give medical advice or diagnose."
    )


def classify(structured_result: dict[str, Any] | None, clinic_id: str | None = None) -> ParsedReport:
    """Classify a CALL-E structured_result into a ParsedReport with red flags.

    A null structured_result (CALL-E could not produce a schema-valid result)
    yields an empty report with all fields missing but is still recorded, not
    dropped.
    """
    report = ParsedReport(clinic_id=clinic_id, structured_result=structured_result)
    if not isinstance(structured_result, dict):
        report.missing = list(REQUIRED_FIELDS)
        return report

    fields: dict[str, Any] = {}
    for name in REQUIRED_FIELDS:
        if name in structured_result:
            fields[name] = structured_result[name]
    report.fields = fields
    report.missing = [name for name in REQUIRED_FIELDS if name not in fields]
    _apply_red_flags(report)
    return report


def _apply_red_flags(report: ParsedReport) -> None:
    flags: list[str] = []
    f = report.fields
    temp = f.get("fridge_temp_c")
    if isinstance(temp, (int, float)) and temp != -999:
        if temp < COLD_CHAIN_MIN_C or temp > COLD_CHAIN_MAX_C:
            flags.append(f"cold_chain_break:{temp}C")
    if f.get("arv_stockout") == "yes":
        flags.append("arv_stockout")
    if f.get("antimalarial_stockout") == "yes":
        flags.append("antimalarial_stockout")
    items = f.get("stockout_items")
    if isinstance(items, str) and items.strip().lower() not in {"", "none"}:
        flags.append(f"stockout_items:{items.strip()}")
    report.red_flags = flags
    if any(flag.startswith("cold_chain_break") or flag in {"arv_stockout", "antimalarial_stockout"} for flag in flags):
        report.severity = "red"
    elif flags:
        report.severity = "amber"
    else:
        report.severity = "green"


def demo() -> None:
    """ponytail: smallest self-check that fails if the classifier breaks."""
    ok = classify(
        {
            "fridge_temp_c": 4.5,
            "arv_stockout": "no",
            "antimalarial_stockout": "yes",
            "malaria_cases": 12,
            "anc_visits": 3,
            "stockout_items": "ACT",
        },
        clinic_id="hcii-kapeeka",
    )
    assert ok.fields["fridge_temp_c"] == 4.5, ok.fields
    assert ok.fields["arv_stockout"] == "no"
    assert ok.fields["antimalarial_stockout"] == "yes"
    assert ok.fields["malaria_cases"] == 12
    assert ok.missing == [], ok.missing
    assert ok.severity == "red", ok.severity
    assert "antimalarial_stockout" in ok.red_flags
    assert "stockout_items:ACT" in ok.red_flags

    cold = classify({"fridge_temp_c": 10.0, "arv_stockout": "no", "antimalarial_stockout": "no",
                     "malaria_cases": 5, "anc_visits": 1, "stockout_items": "none"}, clinic_id="x")
    assert cold.severity == "red" and any(s.startswith("cold_chain_break") for s in cold.red_flags)

    amber = classify({"fridge_temp_c": 4.0, "arv_stockout": "no", "antimalarial_stockout": "no",
                      "malaria_cases": 5, "anc_visits": 1, "stockout_items": "Amoxicillin"}, clinic_id="x")
    assert amber.severity == "amber", amber.severity

    empty = classify(None, clinic_id="y")
    assert empty.fields == {} and empty.missing and empty.severity == "green"
    print("questionnaire.demo ok")


if __name__ == "__main__":
    demo()
    sys.exit(0)
