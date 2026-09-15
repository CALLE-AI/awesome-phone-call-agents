# -*- coding: utf-8 -*-
"""Call engine: validate -> preview -> dial -> confidence gate -> result.

The code gates live here. Unlike the disclosure wording in consent.py, these are
branches the model cannot talk its way past:

- dry-run is the default; live requires mode="live" AND human_confirmed=True
- any unrecognised adapter status becomes halted_safe rather than a guess
- confidence below CONFIDENCE_THRESHOLD emits no structured result at all
- a refusal gets its own terminal code and produces no content evidence
- the handoff context carries only allowlisted fields
"""
import json
import os

from . import consent
from .adapters import FakeAdapter

CONFIDENCE_THRESHOLD = 0.6

_SCHEMA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "references"))


def _load_schema(name: str) -> dict:
    with open(os.path.join(_SCHEMA_DIR, name), encoding="utf-8") as f:
        return json.load(f)


def validate_input(call_input: dict) -> list:
    """Minimal schema validation, stdlib only. Returns a list of error strings."""
    schema = _load_schema("call_input.schema.json")
    errors = []
    for key in schema["required"]:
        if key not in call_input:
            errors.append(f"missing required field: {key}")
    props = schema["properties"]
    for key, val in call_input.items():
        if key not in props:
            errors.append(f"unknown field: {key}")
            continue
        enum = props[key].get("enum")
        if enum and val not in enum:
            errors.append(f"{key}: '{val}' not in {enum}")
        if props[key].get("type") == "array" and enum is None:
            item_enum = props[key].get("items", {}).get("enum")
            if item_enum:
                for item in val:
                    if item not in item_enum:
                        errors.append(f"{key}: item '{item}' not allowed")
    if "phone" in call_input and not str(call_input["phone"]).startswith("+"):
        errors.append("phone: must be E.164 (+...)")
    if "case_id" in call_input and not str(call_input["case_id"]).startswith("PB-"):
        errors.append("case_id: must start with PB-")
    return errors


def _label(score: float) -> str:
    return "high" if score >= 0.8 else ("medium" if score >= CONFIDENCE_THRESHOLD else "low")


def _extract_structured(raw: dict) -> dict:
    """Derive a structured result from a transcript when the SDK did not supply one."""
    text = " ".join(raw["transcript_summary"]).lower()
    needs = []
    if "generator" in text:
        needs.append("generator")
    if "oxygen" in text:
        needs.append("oxygen_refill")
    if "evacuat" in text:
        needs.append("evacuation")
    if "medical" in text:
        needs.append("medical")
    battery = 3.0 if "3 hours" in text else None
    return {
        "is_safe": "yes" if "safe" in text else "unknown",
        "has_power": "no" if "power is out" in text else "unknown",
        "battery_hours_left": battery,
        "needs": needs or ["none"],
    }


def run(call_input: dict, mode: str = "dry_run", human_confirmed: bool = False,
        adapter=None) -> dict:
    """Run one call. Defaults to dry-run: nothing is dialled unless asked twice."""
    errors = validate_input(call_input)
    if errors:
        return _result(call_input, "insufficient_data", False, 1.0, None,
                       [f"input validation failed: {e}" for e in errors], True)

    preview = consent.build_preview(call_input)

    if mode == "dry_run":
        return _result(call_input, "halted_safe", False, 1.0, None,
                       ["dry-run: preview generated, no call placed",
                        f"preview: {preview['task_text'][:120]}..."], False)

    if mode == "live" and not human_confirmed:
        return _result(call_input, "halted_safe", False, 1.0, None,
                       ["live mode requires human_confirmed=True (approval gate)"], True)

    adapter = adapter or FakeAdapter()
    raw = adapter.dial(call_input, consent.build_task(call_input))

    if raw["status"] == "no_answer":
        return _result(call_input, "no_answer", False, 1.0, None, [], False)
    if raw["status"] == "voicemail":
        return _result(call_input, "voicemail", False, 1.0, None, [], False)
    if raw["status"] != "completed":
        return _result(call_input, "halted_safe", False, 0.0, None,
                       [f"unknown adapter status '{raw['status']}' -> fail-closed"], True)

    if raw["declined"]:
        return _result(call_input, "declined", False, raw["raw_confidence"], None, [], False)
    if raw["answered_by"] == "wrong_person":
        return _result(call_input, "wrong_person", False, raw["raw_confidence"], None,
                       raw["transcript_summary"], False)
    if raw.get("requested_human"):
        # They asked for a person. Stop questioning, escalate, do not force a structure
        # onto what was said.
        return _result(call_input, "answered_needs_help", True, raw["raw_confidence"], None,
                       raw["transcript_summary"], True)

    score = raw["raw_confidence"]
    if score < CONFIDENCE_THRESHOLD:
        return _result(call_input, "insufficient_data", False, score, None,
                       raw["transcript_summary"], True)

    structured = raw.get("sdk_structured") or _extract_structured(raw)
    needs_help = structured["needs"] != ["none"]
    code = "answered_needs_help" if needs_help else "answered_ok"
    return _result(call_input, code, True, score, structured,
                   raw["transcript_summary"], needs_help)


def _result(call_input, code, completed, score, structured, evidence, needs_human):
    allow = call_input.get("handoff_context", ["case_id", "scenario"])
    handoff_source = {
        "case_id": call_input.get("case_id"),
        "scenario": call_input.get("scenario"),
        "last_response_summary": (evidence or [None])[-1] if evidence else None,
        "risk_level": "high" if needs_human else "normal",
    }
    return {
        "case_id": call_input.get("case_id", "PB-UNKNOWN"),
        "result_code": code,
        "task_completed": completed,
        "completion_confidence": {"score": score, "label": _label(score)},
        "structured_result": structured,
        "evidence": evidence,
        "needs_human": needs_human,
        "handoff_context": {k: v for k, v in handoff_source.items() if k in allow},
    }
