#!/usr/bin/env python3
"""Build a deterministic, no-call research-gap verification plan."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ID_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
E164_RE = re.compile(r"^\+[1-9][0-9]{7,14}$")
PROHIBITED_RE = re.compile(
    r"\b(?:market(?:ing)?|sales pitch|lead generation|fundrais(?:e|ing)|political|survey|"
    r"emergency|impersonat(?:e|ion)|pretend to be|bypass|evade|harass|password|passcode|"
    r"one[- ]time code|otp|pin number|credit card|debit card|bank account|social security|"
    r"date of birth|medical record|diagnos(?:e|is)|legal advice|loan eligibility|"
    r"employment eligibility|housing eligibility|insurance eligibility)\b",
    re.IGNORECASE,
)
SENSITIVE_NUMBER_RE = re.compile(r"(?<!\d)(?:\d[ -]?){6,19}(?!\d)")
TOP_KEYS = {"schema_version", "request_id", "goal", "constraints", "businesses"}
BUSINESS_KEYS = {
    "business_id", "name", "published_phone", "source_url",
    "established_facts", "gaps",
}
FACT_KEYS = {"fact_id", "statement", "source_url"}
GAP_KEYS = {"gap_id", "question"}
DISCLOSURE = (
    "Hello, I am an automated AI assistant calling on behalf of a customer. "
    "I am calling to verify public business information. This call may be recorded."
)


class ValidationError(ValueError):
    """Input does not satisfy the public plan contract."""


def fail(message: str) -> None:
    raise ValidationError(message)


def reject_unknown(obj: dict[str, Any], allowed: set[str], where: str) -> None:
    unknown = sorted(set(obj) - allowed)
    if unknown:
        fail(f"{where} contains unknown field(s): {', '.join(unknown)}")


def require_string(value: Any, where: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        fail(f"{where} must be a string")
    normalized = " ".join(value.split())
    if not minimum <= len(normalized) <= maximum:
        fail(f"{where} must contain {minimum} to {maximum} characters")
    return normalized


def require_id(value: Any, where: str) -> str:
    text = require_string(value, where, 1, 64)
    if not ID_RE.fullmatch(text):
        fail(f"{where} must use lowercase letters, digits, and internal hyphens")
    return text


def require_https(value: Any, where: str) -> str:
    text = require_string(value, where, 10, 2048)
    parsed = urlparse(text)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        fail(f"{where} must be an https URL without embedded credentials")
    return text


def scan_text(text: str, where: str) -> None:
    match = PROHIBITED_RE.search(text)
    if match:
        fail(f"{where} contains prohibited or sensitive purpose text: {match.group(0)!r}")
    if SENSITIVE_NUMBER_RE.search(text):
        fail(f"{where} contains a long numeric sequence that may be sensitive")


def canonical_hash(prefix: str, value: Any) -> str:
    encoded = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode()
    return prefix + hashlib.sha256(encoded).hexdigest()


def mask_phone(phone: str) -> str:
    return f"{phone[:3]}{'*' * max(0, len(phone) - 7)}{phone[-4:]}"


def validate_input(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        fail("input must be a JSON object")
    reject_unknown(raw, TOP_KEYS, "input")
    if raw.get("schema_version") != "1.0":
        fail("schema_version must be '1.0'")

    request_id = require_id(raw.get("request_id"), "request_id")
    goal = require_string(raw.get("goal"), "goal", 10, 300)
    scan_text(goal, "goal")
    constraints_raw = raw.get("constraints")
    if not isinstance(constraints_raw, list) or len(constraints_raw) > 10:
        fail("constraints must be an array with at most 10 items")
    constraints = []
    for index, item in enumerate(constraints_raw):
        text = require_string(item, f"constraints[{index}]", 1, 160)
        scan_text(text, f"constraints[{index}]")
        constraints.append(text)

    businesses_raw = raw.get("businesses")
    if not isinstance(businesses_raw, list) or not 1 <= len(businesses_raw) <= 5:
        fail("businesses must contain 1 to 5 items")
    businesses: list[dict[str, Any]] = []
    seen_businesses: set[str] = set()
    for index, item in enumerate(businesses_raw):
        where = f"businesses[{index}]"
        if not isinstance(item, dict):
            fail(f"{where} must be an object")
        reject_unknown(item, BUSINESS_KEYS, where)
        business_id = require_id(item.get("business_id"), f"{where}.business_id")
        if business_id in seen_businesses:
            fail(f"duplicate business_id: {business_id}")
        seen_businesses.add(business_id)
        name = require_string(item.get("name"), f"{where}.name", 2, 120)
        scan_text(name, f"{where}.name")
        phone = require_string(
            item.get("published_phone"), f"{where}.published_phone", 9, 16
        )
        if not E164_RE.fullmatch(phone):
            fail(f"{where}.published_phone must use E.164 format")
        source_url = require_https(item.get("source_url"), f"{where}.source_url")

        facts_raw = item.get("established_facts")
        if not isinstance(facts_raw, list) or len(facts_raw) > 20:
            fail(f"{where}.established_facts must contain at most 20 items")
        facts: list[dict[str, str]] = []
        fact_ids: set[str] = set()
        for fact_index, fact in enumerate(facts_raw):
            fact_where = f"{where}.established_facts[{fact_index}]"
            if not isinstance(fact, dict):
                fail(f"{fact_where} must be an object")
            reject_unknown(fact, FACT_KEYS, fact_where)
            fact_id = require_id(fact.get("fact_id"), f"{fact_where}.fact_id")
            if fact_id in fact_ids:
                fail(f"duplicate fact_id in {business_id}: {fact_id}")
            fact_ids.add(fact_id)
            statement = require_string(
                fact.get("statement"), f"{fact_where}.statement", 3, 300
            )
            scan_text(statement, f"{fact_where}.statement")
            facts.append({
                "fact_id": fact_id,
                "statement": statement,
                "source_url": require_https(
                    fact.get("source_url"), f"{fact_where}.source_url"
                ),
            })

        gaps_raw = item.get("gaps")
        if not isinstance(gaps_raw, list) or not 1 <= len(gaps_raw) <= 5:
            fail(f"{where}.gaps must contain 1 to 5 items")
        gaps: list[dict[str, str]] = []
        gap_ids: set[str] = set()
        for gap_index, gap in enumerate(gaps_raw):
            gap_where = f"{where}.gaps[{gap_index}]"
            if not isinstance(gap, dict):
                fail(f"{gap_where} must be an object")
            reject_unknown(gap, GAP_KEYS, gap_where)
            gap_id = require_id(gap.get("gap_id"), f"{gap_where}.gap_id")
            if gap_id in gap_ids:
                fail(f"duplicate gap_id in {business_id}: {gap_id}")
            gap_ids.add(gap_id)
            question = require_string(
                gap.get("question"), f"{gap_where}.question", 10, 240
            )
            if question.count("?") != 1 or not question.endswith("?"):
                fail(f"{gap_where}.question must contain one question mark at the end")
            scan_text(question, f"{gap_where}.question")
            gaps.append({"gap_id": gap_id, "question": question})

        businesses.append({
            "business_id": business_id,
            "name": name,
            "published_phone": phone,
            "source_url": source_url,
            "established_facts": sorted(facts, key=lambda value: value["fact_id"]),
            "gaps": sorted(gaps, key=lambda value: value["gap_id"]),
        })

    return {
        "schema_version": "1.0",
        "request_id": request_id,
        "goal": goal,
        "constraints": constraints,
        "businesses": sorted(businesses, key=lambda value: value["business_id"]),
    }


def build_plan(source: dict[str, Any]) -> dict[str, Any]:
    frozen = {
        "request_id": source["request_id"],
        "goal": source["goal"],
        "constraints": source["constraints"],
        "businesses": source["businesses"],
    }
    plan_id = canonical_hash("rgcv_", frozen)
    calls = []
    sourced_facts = []
    for business in source["businesses"]:
        for fact in business["established_facts"]:
            sourced_facts.append({
                "business_id": business["business_id"],
                "organization_name": business["name"],
                **fact,
                "status": "sourced",
            })
        binding = {
            "plan_id": plan_id,
            "business_id": business["business_id"],
            "recipient_e164": business["published_phone"],
            "purpose": source["goal"],
            "opening_disclosure": DISCLOSURE,
            "questions": business["gaps"],
        }
        call_id = canonical_hash("call_", binding)[:29]
        calls.append({
            "call_id": call_id,
            "business_id": business["business_id"],
            "organization_name": business["name"],
            "recipient_e164": business["published_phone"],
            "recipient_masked": mask_phone(business["published_phone"]),
            "source_url": business["source_url"],
            "purpose": source["goal"],
            "opening_disclosure": DISCLOSURE,
            "questions": business["gaps"],
            "idempotency_key": canonical_hash("rgcv_call_", binding),
            "attempt_limit": 1,
        })
    return {
        "schema_version": "1.0",
        "plan_id": plan_id,
        "request_id": source["request_id"],
        "goal": source["goal"],
        "constraints": source["constraints"],
        "dry_run": True,
        "approval_required": True,
        "provider": "CALL-E-compatible host",
        "total_calls": len(calls),
        "sourced_facts": sourced_facts,
        "calls": calls,
        "side_effect": "None. This preview placed no calls and created no schedules.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="write plan JSON here; stdout when omitted")
    args = parser.parse_args()
    try:
        raw = json.loads(args.input.read_text(encoding="utf-8"))
        plan = build_plan(validate_input(raw))
        rendered = json.dumps(plan, indent=2, ensure_ascii=False) + "\n"
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
            print(f"Wrote no-call preview to {args.output}. No call was placed.")
        else:
            sys.stdout.write(rendered)
        return 0
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        print(f"error: {exc}. No call was placed.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
