#!/usr/bin/env python3
"""Validate and reconcile provider-neutral results against a frozen call plan."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


STATUSES = {"completed", "failed", "canceled", "timed_out", "unknown"}
NO_EVIDENCE_RE = re.compile(
    r"\b(?:voicemail|answering machine|cannot confirm|can't confirm|decline to|refus(?:e|ed)|"
    r"not sure|unsure|uncertain|do not know|don't know|maybe|probably|possibly|"
    r"i think|i believe|seems?|appears?|might|could be|call back later)\b",
    re.IGNORECASE,
)
TOP_KEYS = {"schema_version", "plan_id", "calls"}
CALL_KEYS = {
    "call_id", "idempotency_key", "recipient_e164", "provider_call_id",
    "status", "answers",
}
ANSWER_KEYS = {"gap_id", "answer", "callee_quote"}


class ValidationError(ValueError):
    """Result does not match the frozen plan contract."""


def fail(message: str) -> None:
    raise ValidationError(message)


def reject_unknown(obj: dict[str, Any], allowed: set[str], where: str) -> None:
    unknown = sorted(set(obj) - allowed)
    if unknown:
        fail(f"{where} contains unknown field(s): {', '.join(unknown)}")


def require_string(value: Any, where: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        fail(f"{where} must be a string")
    normalized = " ".join(value.split())
    if not allow_empty and not normalized:
        fail(f"{where} must not be empty")
    if len(normalized) > 1000:
        fail(f"{where} is too long")
    return normalized


def load_object(path: Path, label: str) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        fail(f"{label} must be a JSON object")
    return raw


def reconcile(plan: dict[str, Any], results: dict[str, Any]) -> dict[str, Any]:
    if plan.get("schema_version") != "1.0" or not plan.get("dry_run"):
        fail("plan is not a version 1.0 no-call preview")
    calls_raw = plan.get("calls")
    if not isinstance(calls_raw, list):
        fail("plan.calls must be an array")
    plan_calls: dict[str, dict[str, Any]] = {}
    for index, call in enumerate(calls_raw):
        if not isinstance(call, dict):
            fail(f"plan.calls[{index}] must be an object")
        call_id = require_string(call.get("call_id"), f"plan.calls[{index}].call_id")
        if call_id in plan_calls:
            fail(f"duplicate planned call_id: {call_id}")
        plan_calls[call_id] = call

    reject_unknown(results, TOP_KEYS, "results")
    if results.get("schema_version") != "1.0":
        fail("results.schema_version must be '1.0'")
    if results.get("plan_id") != plan.get("plan_id"):
        fail("results.plan_id does not match the frozen plan")
    result_calls_raw = results.get("calls")
    if not isinstance(result_calls_raw, list):
        fail("results.calls must be an array")
    result_calls: dict[str, dict[str, Any]] = {}
    for index, result in enumerate(result_calls_raw):
        where = f"results.calls[{index}]"
        if not isinstance(result, dict):
            fail(f"{where} must be an object")
        reject_unknown(result, CALL_KEYS, where)
        call_id = require_string(result.get("call_id"), f"{where}.call_id")
        if call_id not in plan_calls:
            fail(f"{where}.call_id is not in the frozen plan")
        if call_id in result_calls:
            fail(f"duplicate result call_id: {call_id}")
        planned = plan_calls[call_id]
        for field in ("idempotency_key", "recipient_e164"):
            if result.get(field) != planned.get(field):
                fail(f"{where}.{field} does not match the frozen plan")
        status = result.get("status")
        if status not in STATUSES:
            fail(f"{where}.status must be one of: {', '.join(sorted(STATUSES))}")
        require_string(result.get("provider_call_id"), f"{where}.provider_call_id")
        answers_raw = result.get("answers")
        if not isinstance(answers_raw, list):
            fail(f"{where}.answers must be an array")
        planned_gap_ids = {gap["gap_id"] for gap in planned.get("questions", [])}
        seen_gaps: set[str] = set()
        clean_answers = []
        for answer_index, answer in enumerate(answers_raw):
            answer_where = f"{where}.answers[{answer_index}]"
            if not isinstance(answer, dict):
                fail(f"{answer_where} must be an object")
            reject_unknown(answer, ANSWER_KEYS, answer_where)
            gap_id = require_string(answer.get("gap_id"), f"{answer_where}.gap_id")
            if gap_id not in planned_gap_ids:
                fail(f"{answer_where}.gap_id was not asked in the frozen plan")
            if gap_id in seen_gaps:
                fail(f"duplicate answer for gap_id {gap_id} in {call_id}")
            seen_gaps.add(gap_id)
            clean_answers.append({
                "gap_id": gap_id,
                "answer": require_string(
                    answer.get("answer"), f"{answer_where}.answer", allow_empty=True
                ),
                "callee_quote": require_string(
                    answer.get("callee_quote"),
                    f"{answer_where}.callee_quote",
                    allow_empty=True,
                ),
            })
        result_calls[call_id] = {**result, "answers": clean_answers}

    facts = [{**fact, "status": "sourced"} for fact in plan.get("sourced_facts", [])]
    reported = completed = confirmed = 0
    for call_id, planned in plan_calls.items():
        result = result_calls.get(call_id)
        answers = {answer["gap_id"]: answer for answer in (result or {}).get("answers", [])}
        if result:
            reported += 1
        if result and result["status"] == "completed":
            completed += 1
        for gap in planned.get("questions", []):
            item = {
                "business_id": planned["business_id"],
                "organization_name": planned["organization_name"],
                "call_id": call_id,
                "gap_id": gap["gap_id"],
                "question": gap["question"],
            }
            if not result or result["status"] != "completed":
                facts.append({**item, "status": "not_reached"})
                continue
            answer = answers.get(gap["gap_id"])
            if (
                not answer
                or not answer["answer"]
                or not answer["callee_quote"]
                or NO_EVIDENCE_RE.search(answer["answer"])
                or NO_EVIDENCE_RE.search(answer["callee_quote"])
            ):
                facts.append({**item, "status": "not_established"})
                continue
            confirmed += 1
            facts.append({
                **item,
                "status": "confirmed_by_phone",
                "answer": answer["answer"],
                "callee_quote": answer["callee_quote"],
            })

    total_gaps = sum(len(call.get("questions", [])) for call in plan_calls.values())
    return {
        "schema_version": "1.0",
        "plan_id": plan["plan_id"],
        "summary": {
            "calls_planned": len(plan_calls),
            "calls_reported": reported,
            "calls_completed": completed,
            "gaps_total": total_gaps,
            "gaps_confirmed_by_phone": confirmed,
        },
        "facts": facts,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--output", type=Path, help="write reconciled JSON here; stdout when omitted")
    args = parser.parse_args()
    try:
        reconciled = reconcile(
            load_object(args.plan, "plan"), load_object(args.results, "results")
        )
        rendered = json.dumps(reconciled, indent=2, ensure_ascii=False) + "\n"
        if args.output:
            args.output.write_text(rendered, encoding="utf-8")
            print(f"Wrote reconciled results to {args.output}.")
        else:
            sys.stdout.write(rendered)
        return 0
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
