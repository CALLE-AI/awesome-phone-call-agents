"""Clinic stock-report interview prompt, REPORT parser, and red-flag logic.

This module is the domain core of the clinic-stock-reporter app. It is
intentionally free of CALL-E and network concerns so it can be unit-tested in
isolation. See README.md for the DHIS2/HMIS field subset and safety boundaries.

The interview relies on CALL-E's `post_summary` as the structured-result
channel: the agent is instructed to end the call by stating a single
machine-parseable REPORT line, which `parse_report` extracts into a dict.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from typing import Any

# Representative subset of Uganda HMIS105 / DVDMIS weekly reporting fields.
# These mirror real DHIS2 indicators (cold-chain temperature, ARV/antimalarial
# stockouts, malaria and ANC case counts) but should be confirmed against the
# live DHIS2 instance before any production use. See README.md.
FIELD_DEFS: tuple[tuple[str, type], ...] = (
    ("fridge_temp_c", float),
    ("arv_stockout", bool),
    ("antimalarial_stockout", bool),
    ("malaria_cases", int),
    ("anc_visits", int),
    ("stockout_items", str),
)

# Safe vaccine cold-chain range in degrees Celsius (WHO +2 to +8).
COLD_CHAIN_MIN_C = 2.0
COLD_CHAIN_MAX_C = 8.0

REPORT_PREFIX = "REPORT"
REPORT_RE = re.compile(r"REPORT\b\s*(?P<body>[A-Za-z0-9_.=,\s-]+)", re.IGNORECASE)
KV_RE = re.compile(r"(?P<key>[A-Za-z0-9_]+)\s*=\s*(?P<value>[^=,]+?)(?=\s+[A-Za-z0-9_]+\s*=|$)")


@dataclass
class ParsedReport:
    clinic_id: str | None
    fields: dict[str, Any] = field(default_factory=dict)
    missing: list[str] = field(default_factory=list)
    invalid: dict[str, str] = field(default_factory=dict)
    red_flags: list[str] = field(default_factory=list)
    severity: str = "green"  # green | amber | red
    raw: str | None = None


def build_goal(clinic_id: str, clinic_name: str, nurse_name: str | None = None) -> str:
    """Build the CALL-E `goal` instruction for a clinic stock-report call.

    The goal tells the agent to run a short structured interview and end the
    call by stating the REPORT line exactly once. Keep it deterministic so the
    post_summary is machine-parseable.
    """
    addressee = f"the nurse in charge" if not nurse_name else nurse_name
    return (
        f"You are calling {clinic_name} ({clinic_id}) on behalf of the district "
        f"health office for the weekly HMIS stock and cold-chain report. Speak "
        f"to {addressee}. Keep the call under three minutes.\n\n"
        "Ask these questions one at a time and wait for the answer each time:\n"
        "1. What is the vaccine fridge temperature in degrees Celsius right now?\n"
        "2. Are you out of stock of ARVs (antiretrovirals) today? Answer yes or no.\n"
        "3. Are you out of stock of antimalarials (ACT) today? Answer yes or no.\n"
        "4. How many confirmed malaria cases did you see this week?\n"
        "5. How many new antenatal care first visits (ANC1) did you see this week?\n"
        "6. Are any other essential medicines out of stock today? List them by "
        "name, comma separated, or say none.\n\n"
        "After the last answer, read all answers back briefly for confirmation, "
        "then end the call by saying exactly once, on its own line:\n"
        "REPORT fridge_temp_c=<number> arv_stockout=<yes|no> "
        "antimalarial_stockout=<yes|no> malaria_cases=<integer> "
        "anc_visits=<integer> stockout_items=<comma list or none>\n"
        "Then say goodbye and hang up. Do not add commentary after the REPORT "
        "line. Do not ask follow-up questions after the REPORT line."
    )


def _coerce(key: str, raw_value: str, type_: type) -> Any:
    value = raw_value.strip()
    if type_ is bool:
        lowered = value.lower()
        if lowered in {"yes", "y", "true", "1"}:
            return True
        if lowered in {"no", "n", "false", "0"}:
            return False
        raise ValueError(f"expected yes/no, got {value!r}")
    if type_ is int:
        return int(value)
    if type_ is float:
        return float(value)
    return value


def parse_report(text: str, clinic_id: str | None = None) -> ParsedReport:
    """Parse a REPORT line out of a post_summary or transcript string.

    Returns a ParsedReport even when no REPORT line is found: `missing` lists
    every required field so the caller can record an unparseable call rather
    than silently dropping it.
    """
    result = ParsedReport(clinic_id=clinic_id, missing=list(name for name, _ in FIELD_DEFS))
    if not text:
        result.raw = text
        return result

    match = REPORT_RE.search(text)
    if not match:
        result.raw = text
        return result

    body = match.group("body").strip()
    result.raw = body
    parsed: dict[str, Any] = {}
    for kv in KV_RE.finditer(body):
        key = kv.group("key").lower()
        value = kv.group("value").strip()
        type_map = dict(FIELD_DEFS)
        if key not in type_map:
            continue
        try:
            parsed[key] = _coerce(key, value, type_map[key])
        except ValueError as error:
            result.invalid[key] = str(error)

    result.fields = parsed
    result.missing = [name for name, _ in FIELD_DEFS if name not in parsed]
    _apply_red_flags(result)
    return result


def _apply_red_flags(report: ParsedReport) -> None:
    flags: list[str] = []
    f = report.fields
    if "fridge_temp_c" in f and isinstance(f["fridge_temp_c"], (int, float)):
        temp = float(f["fridge_temp_c"])
        if temp < COLD_CHAIN_MIN_C or temp > COLD_CHAIN_MAX_C:
            flags.append(f"cold_chain_break:{temp}C")
    if f.get("arv_stockout") is True:
        flags.append("arv_stockout")
    if f.get("antimalarial_stockout") is True:
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
    """ponytail: smallest self-check that fails if the parser breaks."""
    sample = (
        "[00:00:00] BOT: Hello from CALL-E. [00:00:30] USER: fridge 4.5, no ARV "
        "stockout, antimalarial stockout yes, 12 malaria, 3 ANC, ACT out of stock. "
        "REPORT fridge_temp_c=4.5 arv_stockout=no antimalarial_stockout=yes "
        "malaria_cases=12 anc_visits=3 stockout_items=ACT"
    )
    report = parse_report(sample, clinic_id="hcii-kapeeka")
    assert report.fields["fridge_temp_c"] == 4.5, report.fields
    assert report.fields["arv_stockout"] is False
    assert report.fields["antimalarial_stockout"] is True
    assert report.fields["malaria_cases"] == 12
    assert report.fields["anc_visits"] == 3
    assert report.fields["stockout_items"] == "ACT"
    assert report.missing == [], report.missing
    assert report.severity == "red", report.severity
    assert "antimalarial_stockout" in report.red_flags
    assert "stockout_items:ACT" in report.red_flags

    broken = parse_report("Call failed, no answer.", clinic_id="hcii-x")
    assert broken.fields == {} and broken.missing and broken.severity == "green"
    print("questionnaire.demo ok")


if __name__ == "__main__":
    demo()
    sys.exit(0)
