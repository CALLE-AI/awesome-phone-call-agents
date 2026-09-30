from __future__ import annotations

from dataclasses import dataclass
from typing import Any

CONTACT_OUTCOMES = ("REACHED", "UNREACHED", "DO_NOT_CONTACT")
ROLE_MATCHES = ("YES", "NO", "UNKNOWN")
PROPOSITION_OUTCOMES = ("CONFIRMED", "CONTRADICTED", "NOT_ESTABLISHED")
WRITTEN_REFERENCE_OUTCOMES = ("OFFERED", "NOT_OFFERED", "UNKNOWN")
COMMITMENT_OUTCOMES = ("NO", "YES", "UNKNOWN")

RESULT_KEYS = frozenset(
    {
        "schemaVersion",
        "contactOutcome",
        "roleMatch",
        "propositions",
        "writtenReference",
        "commitmentRequested",
    }
)
PROPOSITION_KEYS = frozenset({"P1", "P2", "P3"})


class ResultContractError(ValueError):
    """Raised when provider output cannot be trusted as a closed result."""


@dataclass(frozen=True, slots=True)
class EvaluatedResult:
    disposition: str
    reason_codes: tuple[str, ...]
    result: dict[str, Any]

    @property
    def action_authorized(self) -> bool:
        # A call result is evidence only. It can never book, pay, clear, or certify.
        return False


def provider_result_schema() -> dict[str, Any]:
    """Small CALL-E-compatible wire schema; local checks below are stricter."""

    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "schemaVersion",
            "contactOutcome",
            "roleMatch",
            "propositions",
            "writtenReference",
            "commitmentRequested",
        ],
        "properties": {
            "schemaVersion": {"type": "string", "enum": ["1.0"]},
            "contactOutcome": {"type": "string", "enum": list(CONTACT_OUTCOMES)},
            "roleMatch": {"type": "string", "enum": list(ROLE_MATCHES)},
            "propositions": {
                "type": "object",
                "additionalProperties": False,
                "required": ["P1", "P2", "P3"],
                "properties": {
                    key: {"type": "string", "enum": list(PROPOSITION_OUTCOMES)}
                    for key in ("P1", "P2", "P3")
                },
            },
            "writtenReference": {
                "type": "string",
                "enum": list(WRITTEN_REFERENCE_OUTCOMES),
            },
            "commitmentRequested": {
                "type": "string",
                "enum": list(COMMITMENT_OUTCOMES),
            },
        },
    }


def validate_and_evaluate(raw: Any) -> EvaluatedResult:
    if not isinstance(raw, dict):
        raise ResultContractError("RESULT_NOT_OBJECT")
    _exact_keys(raw, RESULT_KEYS, "RESULT_KEYS_MISMATCH")
    if raw["schemaVersion"] != "1.0":
        raise ResultContractError("SCHEMA_VERSION_MISMATCH")
    _one_of(raw["contactOutcome"], CONTACT_OUTCOMES, "CONTACT_OUTCOME_INVALID")
    _one_of(raw["roleMatch"], ROLE_MATCHES, "ROLE_MATCH_INVALID")
    _one_of(
        raw["writtenReference"], WRITTEN_REFERENCE_OUTCOMES, "WRITTEN_REFERENCE_INVALID"
    )
    _one_of(
        raw["commitmentRequested"], COMMITMENT_OUTCOMES, "COMMITMENT_REQUESTED_INVALID"
    )

    answers = raw["propositions"]
    if not isinstance(answers, dict):
        raise ResultContractError("PROPOSITIONS_NOT_OBJECT")
    _exact_keys(answers, PROPOSITION_KEYS, "PROPOSITION_KEYS_MISMATCH")
    for key in ("P1", "P2", "P3"):
        _one_of(answers[key], PROPOSITION_OUTCOMES, f"{key}_OUTCOME_INVALID")

    contact = raw["contactOutcome"]
    role = raw["roleMatch"]
    written = raw["writtenReference"]
    commitment = raw["commitmentRequested"]
    proposition_values = tuple(answers[key] for key in ("P1", "P2", "P3"))

    if contact != "REACHED":
        if role != "UNKNOWN" or any(
            value != "NOT_ESTABLISHED" for value in proposition_values
        ):
            raise ResultContractError("UNREACHED_RESULT_CONTRADICTION")
        if written != "UNKNOWN" or commitment != "UNKNOWN":
            raise ResultContractError("UNREACHED_AUXILIARY_CONTRADICTION")
        disposition = (
            "DO_NOT_CONTACT"
            if contact == "DO_NOT_CONTACT"
            else "NEEDS_HUMAN_RECONCILIATION"
        )
        return EvaluatedResult(disposition, (contact,), dict(raw))

    if role == "UNKNOWN":
        if any(value != "NOT_ESTABLISHED" for value in proposition_values):
            raise ResultContractError("UNKNOWN_ROLE_HAS_FACTUAL_ANSWERS")
        return EvaluatedResult(
            "NEEDS_HUMAN_REVIEW", ("ROLE_NOT_ESTABLISHED",), dict(raw)
        )

    if role == "NO":
        if any(value != "NOT_ESTABLISHED" for value in proposition_values):
            raise ResultContractError("WRONG_ROLE_HAS_FACTUAL_ANSWERS")
        return EvaluatedResult("NEEDS_HUMAN_REVIEW", ("WRONG_CONTACT_ROLE",), dict(raw))

    if commitment != "NO":
        return EvaluatedResult(
            "NEEDS_HUMAN_REVIEW",
            ("COMMITMENT_OR_PAYMENT_BOUNDARY",),
            dict(raw),
        )

    contradicted = tuple(
        key for key in ("P1", "P2", "P3") if answers[key] == "CONTRADICTED"
    )
    unresolved = tuple(
        key for key in ("P1", "P2", "P3") if answers[key] == "NOT_ESTABLISHED"
    )
    if contradicted:
        return EvaluatedResult(
            "GAPS_FOUND",
            tuple(f"{key}_CONTRADICTED" for key in contradicted),
            dict(raw),
        )
    if unresolved:
        return EvaluatedResult(
            "NEEDS_HUMAN_REVIEW",
            tuple(f"{key}_NOT_ESTABLISHED" for key in unresolved),
            dict(raw),
        )
    if written != "OFFERED":
        return EvaluatedResult(
            "NEEDS_HUMAN_REVIEW",
            ("NO_WRITTEN_REFERENCE_OFFERED",),
            dict(raw),
        )
    return EvaluatedResult(
        "EVIDENCE_PACKET_READY",
        ("ALL_PROPOSITIONS_CONFIRMED", "WRITTEN_REFERENCE_OFFERED"),
        dict(raw),
    )


def _exact_keys(value: dict[str, Any], expected: frozenset[str], error: str) -> None:
    if frozenset(value) != expected:
        raise ResultContractError(error)


def _one_of(value: Any, allowed: tuple[str, ...], error: str) -> None:
    if not isinstance(value, str) or value not in allowed:
        raise ResultContractError(error)
