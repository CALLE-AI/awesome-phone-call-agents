#!/usr/bin/env python3
"""Preview and reconcile a donation-specification task without placing a call."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAN = ROOT / "assets" / "example-donation.json"
TERNARY = {"yes", "no", "unknown"}


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


def question_set_hash(plan: dict[str, Any]) -> str:
    canonical = json.dumps(plan["questions"], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def idempotency_key(plan: dict[str, Any]) -> str:
    material = "|".join(
        [
            str(plan["batch_reference"]),
            str(plan["contact_reference"]),
            str(plan["authorisation_version"]),
            question_set_hash(plan),
        ]
    )
    return "donation-specification-" + hashlib.sha256(material.encode("utf-8")).hexdigest()


def validate_plan(plan: dict[str, Any]) -> None:
    required = {
        "batch_reference",
        "contact_reference",
        "contact_masked",
        "contact_role",
        "organisation_name",
        "represented_organisation",
        "authorised_purpose",
        "authorisation_version",
        "authorisation_expires_at",
        "recipient_organisation_authorised",
        "consent_to_call",
        "subjects",
        "questions",
        "recipient_result_schema",
    }
    missing = sorted(required - set(plan))
    if missing:
        raise ValueError("missing plan fields: " + ", ".join(missing))
    if plan["authorised_purpose"] != "donation_specification":
        raise ValueError("authorised_purpose must be donation_specification")
    if plan["recipient_organisation_authorised"] is not True:
        raise ValueError("recipient organisation has not authorised the inquiry")
    if plan["consent_to_call"] is not True:
        raise ValueError("contact has not consented to this call purpose")

    subjects = {
        subject.get("subject_reference"): subject
        for subject in plan["subjects"]
        if isinstance(subject, dict)
    }
    if not subjects:
        raise ValueError("subjects must contain at least one known subject")
    seen: set[tuple[str, str]] = set()
    for question in plan["questions"]:
        reference = question.get("subject_reference")
        attribute = question.get("attribute_key")
        if reference not in subjects:
            raise ValueError(f"question references unknown subject: {reference}")
        allowed = subjects[reference].get("allowed_attributes", {})
        if attribute not in allowed:
            raise ValueError(f"question uses disallowed attribute: {reference}.{attribute}")
        pair = (reference, attribute)
        if pair in seen:
            raise ValueError(f"duplicate question: {reference}.{attribute}")
        seen.add(pair)


def build_task(plan: dict[str, Any]) -> str:
    lines = [
        (
            f"You are an automated caller representing {plan['represented_organisation']}. "
            f"You are calling the authorised {plan['contact_role']} at "
            f"{plan['organisation_name']} to complete missing donation information."
        ),
        "Confirm the intended role and ask whether they consent to continue.",
        "Ask only the approved questions below, one at a time. Do not improvise.",
        "Stop immediately if consent is withdrawn. Do not promise allocation or collection.",
    ]
    for index, question in enumerate(plan["questions"], start=1):
        lines.append(f"{index}. {question['question']} Why: {question['why']}")
    return "\n".join(lines)


def value_error(rule: dict[str, Any], value: Any, unit: Any) -> str | None:
    expected = rule.get("type")
    if value is None:
        return "null values remain unanswered"
    if expected == "boolean" and type(value) is not bool:
        return "expected boolean"
    if expected == "integer" and (type(value) is not int):
        return "expected integer"
    if expected == "number" and (type(value) not in {int, float}):
        return "expected number"
    if expected == "string" and not isinstance(value, str):
        return "expected string"
    if expected == "enum" and value not in rule.get("allowed_values", []):
        return "value is outside the allowed enum"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in rule and value < rule["minimum"]:
            return "value is below the allowed minimum"
        if "maximum" in rule and value > rule["maximum"]:
            return "value is above the allowed maximum"
    if unit != rule.get("unit"):
        return f"unit must be {rule.get('unit')!r}"
    return None


def reconcile(plan: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    required = {
        "reached_intended_contact",
        "contact_role_confirmed",
        "consent_continued",
        "subject_references",
        "attribute_updates",
        "availability_windows",
        "unanswered_questions",
    }
    allowed_top = required | {"notes"}
    missing = sorted(required - set(result))
    extras = sorted(set(result) - allowed_top)
    if missing or extras:
        return {
            "outcome": "schema_rejected",
            "accepted_claims": [],
            "rejected_updates": [],
            "errors": [
                *(f"missing field: {field}" for field in missing),
                *(f"unknown field: {field}" for field in extras),
            ],
        }
    for field in ("reached_intended_contact", "contact_role_confirmed", "consent_continued"):
        if result[field] not in TERNARY:
            return {
                "outcome": "schema_rejected",
                "accepted_claims": [],
                "rejected_updates": [],
                "errors": [f"{field} must be yes, no, or unknown"],
            }
    if any(result[field] != "yes" for field in ("reached_intended_contact", "contact_role_confirmed", "consent_continued")):
        return {
            "outcome": "unresolved_contact_or_consent",
            "accepted_claims": [],
            "rejected_updates": [],
            "unanswered_questions": result.get("unanswered_questions", []),
            "human_review_required": True,
        }

    subjects = {
        subject["subject_reference"]: subject
        for subject in plan["subjects"]
    }
    asked = {
        (question["subject_reference"], question["attribute_key"])
        for question in plan["questions"]
    }
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    updates = result.get("attribute_updates")
    if not isinstance(updates, list):
        return {
            "outcome": "schema_rejected",
            "accepted_claims": [],
            "rejected_updates": [],
            "errors": ["attribute_updates must be an array"],
        }

    for update in updates:
        reference = update.get("subject_reference") if isinstance(update, dict) else None
        attribute = update.get("attribute_key") if isinstance(update, dict) else None
        reason: str | None = None
        if not isinstance(update, dict):
            reason = "update must be an object"
        elif reference not in subjects:
            reason = "unknown subject reference"
        elif (reference, attribute) not in asked:
            reason = "subject and attribute were not in the approved question set"
        elif not isinstance(update.get("supporting_quote"), str) or not update["supporting_quote"].strip():
            reason = "a supporting quote is required"
        else:
            rule = subjects[reference]["allowed_attributes"][attribute]
            reason = value_error(rule, update.get("value"), update.get("unit"))

        if reason:
            rejected.append(
                {
                    "subject_reference": reference,
                    "attribute_key": attribute,
                    "reason": reason,
                }
            )
        else:
            accepted.append(
                {
                    "subject_reference": reference,
                    "attribute_key": attribute,
                    "value": update["value"],
                    "unit": update.get("unit"),
                    "supporting_quote": update["supporting_quote"],
                    "verification_level": "donor_reported",
                    "status": "pending_human_review",
                }
            )

    return {
        "outcome": "reported_claims_for_review" if accepted else "unresolved",
        "accepted_claims": accepted,
        "rejected_updates": rejected,
        "unanswered_questions": result.get("unanswered_questions", []),
        "human_review_required": True,
        "allocation_approved": False,
    }


def preview(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "mode": "preview",
        "call_placed": False,
        "contact": plan["contact_masked"],
        "batch_reference": plan["batch_reference"],
        "purpose": plan["authorised_purpose"],
        "task": build_task(plan),
        "recipient_result_schema": plan["recipient_result_schema"],
        "metadata": {
            "batch_reference": plan["batch_reference"],
            "contact_reference": plan["contact_reference"],
            "authorisation_version": plan["authorisation_version"],
        },
        "idempotency_key": idempotency_key(plan),
        "side_effect": "none",
        "banner": "NO CALL WAS PLACED",
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preview a donation-specification CALL-E task. This program never dials."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--result", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    plan = load_json(args.input)
    validate_plan(plan)
    output: dict[str, Any] = {"preview": preview(plan)}
    if args.result:
        output["fixture_reconciliation"] = reconcile(plan, load_json(args.result))

    if args.json:
        print(json.dumps(output, indent=2, sort_keys=True))
        return

    call_preview = output["preview"]
    print(call_preview["banner"])
    print(f"mode: {call_preview['mode']}")
    print(f"contact: {call_preview['contact']}")
    print(f"batch: {call_preview['batch_reference']}")
    print(f"purpose: {call_preview['purpose']}")
    print("task:")
    print(call_preview["task"])
    print(f"idempotency_key: {call_preview['idempotency_key']}")
    print("side_effect: none")
    if "fixture_reconciliation" in output:
        print("fixture_reconciliation:")
        print(json.dumps(output["fixture_reconciliation"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
