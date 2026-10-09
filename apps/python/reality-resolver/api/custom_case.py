"""Validation and normalization for one client-supplied Case.

Custom cases stay in memory for one resolution. They are never written to
``cases/`` and therefore cannot widen the shipped-case allowlist or expose the
operator's untracked live fixture. The returned ``Case`` is the same model the
deterministic engine already consumes.
"""

from __future__ import annotations

import argparse
import math
from datetime import timedelta
from typing import Any

from client import PHONE_PATTERN, parse_utc_timestamp
from evidence.model import Ambiguity, Case, Evidence, EvidenceMatrix, EvidenceType

CUSTOM_CASE_FIELDS = frozenset(
    {
        "name",
        "use_case",
        "deadline",
        "decision_deadline_threshold_hours",
        "decision_options",
        "call_phone",
        "call_task_hint",
        "evidence",
        "industry",
    }
)
CUSTOM_USE_CASES = frozenset(
    {
        "appointment_confirmation",
        "critical_service_escalation",
        "factual_state_confirmation",
    }
)
DEFAULT_CUSTOM_PHONE = "+10000000003"
MAX_EVIDENCE_ITEMS = 20
MAX_TEXT_CHARS = 2000
MAX_NAME_CHARS = 160
MAX_USE_CASE_CHARS = 80
MAX_INDUSTRY_CHARS = 80
MAX_THRESHOLD_HOURS = 24 * 30
MAX_FRESHNESS_HOURS = 24 * 365


class CustomCaseValidationError(ValueError):
    """A safe, client-facing validation failure with no input echo."""

    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _fail(code: str, message: str) -> None:
    raise CustomCaseValidationError(code, message)


def _text(value: Any, field: str, maximum: int, *, required: bool = True) -> str:
    if not isinstance(value, str):
        _fail("invalid_custom_case", f"{field} must be a string")
    if any(ord(char) < 32 for char in value):
        _fail("invalid_custom_case", f"{field} contains control characters")
    normalized = value.strip()
    if required and not normalized:
        _fail("invalid_custom_case", f"{field} is required")
    if len(normalized) > maximum:
        _fail("custom_case_too_large", f"{field} is too long")
    return normalized


def _number(value: Any, field: str, maximum: float, *, minimum: float = 0.0) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        _fail("invalid_custom_case", f"{field} must be a finite number")
    if value < minimum or value > maximum:
        _fail("invalid_custom_case", f"{field} is outside the supported range")
    return float(value)


def parse_custom_case(raw: Any) -> Case:
    """Validate a public custom-case object and return the engine's Case."""
    if not isinstance(raw, dict):
        _fail("invalid_custom_case", "custom_case must be a JSON object")

    unknown = set(raw) - CUSTOM_CASE_FIELDS
    if unknown:
        _fail("unknown_custom_case_field", "custom_case contains an unsupported field")

    name = _text(raw.get("name"), "name", MAX_NAME_CHARS)
    use_case = _text(raw.get("use_case"), "use_case", MAX_USE_CASE_CHARS)
    if use_case not in CUSTOM_USE_CASES:
        _fail("unsupported_custom_use_case", "use_case is not supported for custom cases")

    deadline_text = _text(raw.get("deadline"), "deadline", 64)
    try:
        deadline = parse_utc_timestamp(deadline_text)
    except (TypeError, ValueError, OverflowError, argparse.ArgumentTypeError):
        _fail("invalid_custom_deadline", "deadline must be an ISO 8601 UTC timestamp")

    threshold = _number(
        raw.get("decision_deadline_threshold_hours"),
        "decision_deadline_threshold_hours",
        MAX_THRESHOLD_HOURS,
        minimum=0.01,
    )

    options = raw.get("decision_options")
    if not isinstance(options, dict) or set(options) != {"if_confirmed", "if_cancelled"}:
        _fail("invalid_custom_case", "decision_options must define if_confirmed and if_cancelled")
    decision_options = {
        key: _text(options[key], f"decision_options.{key}", 160)
        for key in ("if_confirmed", "if_cancelled")
    }

    call_task_hint = _text(raw.get("call_task_hint"), "call_task_hint", MAX_TEXT_CHARS)
    call_phone = raw.get("call_phone", DEFAULT_CUSTOM_PHONE)
    call_phone = _text(call_phone, "call_phone", 32)
    if not PHONE_PATTERN.fullmatch(call_phone):
        _fail("invalid_custom_phone", "call_phone must be strict ASCII E.164")

    if "industry" in raw:
        _text(raw["industry"], "industry", MAX_INDUSTRY_CHARS)

    evidence_raw = raw.get("evidence")
    if not isinstance(evidence_raw, list) or not evidence_raw:
        _fail("invalid_custom_evidence", "evidence must be a non-empty array")
    if len(evidence_raw) > MAX_EVIDENCE_ITEMS:
        _fail("custom_case_too_large", "evidence has too many items")

    evidence_items: list[Evidence] = []
    evidence_fields = {"source", "type", "freshness_hours", "claim", "ambiguity"}
    for item in evidence_raw:
        if not isinstance(item, dict) or set(item) != evidence_fields:
            _fail("invalid_custom_evidence", "each evidence item has an invalid shape")
        source = _text(item.get("source"), "evidence.source", 160)
        claim = _text(item.get("claim"), "evidence.claim", MAX_TEXT_CHARS)
        evidence_type = _text(item.get("type"), "evidence.type", 32)
        ambiguity = _text(item.get("ambiguity"), "evidence.ambiguity", 32)
        try:
            evidence_enum = EvidenceType(evidence_type)
            ambiguity_enum = Ambiguity(ambiguity)
        except ValueError:
            _fail("invalid_custom_evidence", "evidence type or ambiguity is unsupported")
        freshness = _number(
            item.get("freshness_hours"),
            "evidence.freshness_hours",
            MAX_FRESHNESS_HOURS,
        )
        evidence_items.append(
            Evidence(
                source=source,
                type=evidence_enum,
                freshness=timedelta(hours=freshness),
                claim=claim,
                ambiguity=ambiguity_enum,
            )
        )

    return Case(
        name=name,
        evidence=EvidenceMatrix(tuple(evidence_items)),
        deadline=deadline,
        decision_deadline_threshold=timedelta(hours=threshold),
        decision_options=decision_options,
        call_phone=call_phone,
        call_task_hint=call_task_hint,
        use_case=use_case,
    )
